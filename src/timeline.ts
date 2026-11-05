export type TransportMode = 'flight' | 'ferry' | 'rail' | 'road' | 'walking' | 'cycling'
export type TimelineActivity = { id: string; mode: TransportMode; startTimestamp: string; endTimestamp: string; distanceKm: number }

export type TimelinePoint = {
  id: string
  lat: number
  lng: number
  timestamp: string
  // Keep observed paths separate from Google's inferred visits/activity anchors.
  // Routes can then prefer timed path evidence when semantic records conflict.
  source?: 'timelinePath' | 'raw' | 'activity' | 'visit'
  // Canonical activities are retained on their endpoints, including duplicate
  // endpoints that also occur in a measured path. Alternatives are not imported.
  activities?: TimelineActivity[]
  // Only visits have a known stay interval. Do not infer stays between route points.
  endTimestamp?: string
  kind: 'path' | 'visit'
  label: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function validCoordinate(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  if (lat === null || lng === null) return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null
  }
  return { lat, lng }
}

function parseCoordinate(value: unknown): { lat: number; lng: number } | null {
  if (typeof value === 'string') {
    // iOS exports use geo: URIs; Android exports also use degree-marked strings.
    const match = value.trim().match(/^(?:geo:\s*)?([+-]?\d+(?:\.\d+)?)\s*°?\s*,\s*([+-]?\d+(?:\.\d+)?)\s*°?(?:\s*(?:,|;).*)?$/i)
    return match ? validCoordinate(Number(match[1]), Number(match[2])) : null
  }
  const record = asRecord(value)
  if (!record) return null
  const latLng = record.latLng ?? record.LatLng
  if (typeof latLng === 'string') return parseCoordinate(latLng)
  const latE7 = finiteNumber(record.latitudeE7 ?? record.latE7)
  const lngE7 = finiteNumber(record.longitudeE7 ?? record.lngE7)
  return validCoordinate(latE7 === null ? null : latE7 / 1e7, lngE7 === null ? null : lngE7 / 1e7)
}

function isoTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  // Require a dated instant, not Date's permissive interpretations of e.g. "1".
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]!) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function millisecondsTime(value: unknown): string | null {
  const milliseconds = finiteNumber(value)
  if (milliseconds === null) return null
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function transportMode(value: unknown): TransportMode | undefined {
  if (typeof value !== 'string') return undefined
  const type = value.toLowerCase().replace(/[^a-z]/g, '')
  if (['flying', 'inairplane', 'airplane', 'flight', 'inflight'].includes(type)) return 'flight'
  if (['inferry', 'ferry', 'sailing', 'inboat', 'boating'].includes(type)) return 'ferry'
  if (['intrain', 'train', 'intram', 'tram', 'insubway', 'subway'].includes(type)) return 'rail'
  if (['inpassengervehicle', 'invehicle', 'incar', 'driving', 'inbus', 'motorcycling', 'inmotorcycle'].includes(type)) return 'road'
  if (['walking', 'running', 'onfoot'].includes(type)) return 'walking'
  if (['cycling', 'onbicycle', 'bicycling'].includes(type)) return 'cycling'
  return undefined
}

export function parseTimeline(input: unknown): TimelinePoint[] {
  const points: TimelinePoint[] = []
  const seen = new WeakSet<object>()
  const pointKeys = new Map<string, TimelinePoint>()
  let activityCount = 0

  const addPoint = (location: unknown, timestamp: string | null, kind: TimelinePoint['kind'], label: string, source: NonNullable<TimelinePoint['source']>, endTimestamp: string | null = null) => {
    const coordinate = parseCoordinate(location)
    if (!coordinate || !timestamp) return
    const end = kind === 'visit' && endTimestamp && endTimestamp >= timestamp ? endTimestamp : undefined
    const key = `${kind}:${coordinate.lat}:${coordinate.lng}:${timestamp}`
    const existing = pointKeys.get(key)
    if (existing) {
      if (end && (!existing.endTimestamp || end > existing.endTimestamp)) existing.endTimestamp = end
      // A duplicate may first appear as an inferred activity endpoint. Retain
      // its stronger provenance when the same observation also has path data.
      if (source === 'timelinePath' || (source === 'raw' && existing.source !== 'timelinePath')) existing.source = source
      return existing
    }
    const point: TimelinePoint = {
      id: kind + '-' + points.length,
      ...coordinate,
      timestamp,
      source,
      ...(end ? { endTimestamp: end } : {}),
      kind,
      label,
    }
    points.push(point)
    pointKeys.set(key, point)
    return point
  }

  const addActivity = (start: unknown, end: unknown, from: string | null, to: string | null, modeValue: unknown, reportedMeters: unknown) => {
    const first = addPoint(start, from, 'path', 'Rutepunkt', 'activity')
    const last = addPoint(end, to, 'path', 'Rutepunkt', 'activity')
    const mode = transportMode(modeValue)
    if (!mode || !first || !last || !from || !to || to <= from) return
    const reported = finiteNumber(reportedMeters)
    const activity: TimelineActivity = { id: `activity-${activityCount++}`, mode, startTimestamp: from, endTimestamp: to,
      distanceKm: Math.max(distanceKm([first, last]), reported !== null && reported >= 0 ? reported / 1000 : 0) }
    // Older Google exports write probability zero even for the selected activity.
    // Retain that canonical mode; routes validate its timing before using it.
    for (const point of first === last ? [first] : [first, last]) (point.activities ??= []).push(activity)
  }

  const visitNode = (value: unknown) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach(visitNode)
      return
    }

    const record = asRecord(value)
    if (!record) return

    const start = isoTime(record.startTime)
    const end = isoTime(record.endTime)

    if (Array.isArray(record.timelinePath)) {
      for (const rawPoint of record.timelinePath) {
        const item = asRecord(rawPoint)
        if (!item) continue
        const offset = finiteNumber(item.durationMinutesOffsetFromStartTime)
        const offsetTime = start && offset !== null
          ? millisecondsTime(new Date(start).getTime() + offset * 60_000)
          : null
        const timestamp = isoTime(item.time) ?? isoTime(item.timestamp) ?? offsetTime
        addPoint(item.point, timestamp, 'path', 'Rutepunkt', 'timelinePath')
      }
    }

    const visit = asRecord(record.visit)
    const topCandidate = asRecord(visit?.topCandidate)
    if (topCandidate) {
      const semanticType = typeof topCandidate?.semanticType === 'string'
        ? topCandidate.semanticType
        : 'Besøkt sted'
      addPoint(topCandidate.placeLocation, start, 'visit', semanticType === 'Unknown' ? 'Besøkt sted' : semanticType, 'visit', end)
    }

    // Some days only contain activity endpoints, with no timelinePath at all.
    const activity = asRecord(record.activity)
    if (activity) {
      addActivity(activity.start, activity.end, start, end, asRecord(activity.topCandidate)?.type ?? activity.activityType, activity.distanceMeters)
    }

    // Older Takeout semantic history represents visits and journeys separately.
    const placeVisit = asRecord(record.placeVisit)
    if (placeVisit) {
      const duration = asRecord(placeVisit.duration)
      const location = asRecord(placeVisit.location)
      const visitStart = isoTime(duration?.startTimestamp) ?? millisecondsTime(duration?.startTimestampMs)
      const visitEnd = isoTime(duration?.endTimestamp) ?? millisecondsTime(duration?.endTimestampMs)
      addPoint(location, visitStart, 'visit', typeof location?.name === 'string' ? location.name : 'Besøkt sted', 'visit', visitEnd)
    }
    const activitySegment = asRecord(record.activitySegment)
    if (activitySegment) {
      const duration = asRecord(activitySegment.duration)
      const segmentStart = isoTime(duration?.startTimestamp) ?? millisecondsTime(duration?.startTimestampMs)
      const segmentEnd = isoTime(duration?.endTimestamp) ?? millisecondsTime(duration?.endTimestampMs)
      addActivity(activitySegment.startLocation, activitySegment.endLocation, segmentStart, segmentEnd, activitySegment.activityType, activitySegment.distance)
    }

    // Records.json, timestamped simplifiedRawPath points, and Android raw positions.
    // Untimed waypoints and likely-location candidates are deliberately not dated.
    const rawTime = isoTime(record.timestamp) ?? millisecondsTime(record.timestampMs)
    if (rawTime) addPoint(record, rawTime, 'path', 'Rutepunkt', 'raw')

    Object.values(record).forEach(visitNode)
  }

  visitNode(input)
  return points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function localDateKey(timestamp: string): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return [year, month, day].join('-')
}

export function formatTime(timestamp: string, locale = 'nb-NO'): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

export function formatLongDate(dateKey: string, locale = 'nb-NO'): string {
  const date = new Date(dateKey + 'T12:00:00')
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export function distanceKm(points: TimelinePoint[]): number {
  let meters = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    if (!previous || !current) continue
    const radians = (degrees: number) => (degrees * Math.PI) / 180
    const dLat = radians(current.lat - previous.lat)
    const dLng = radians(current.lng - previous.lng)
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(previous.lat)) * Math.cos(radians(current.lat)) * Math.sin(dLng / 2) ** 2
    meters += 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  return meters / 1000
}
