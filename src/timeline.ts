export type TimelinePoint = {
  id: string
  lat: number
  lng: number
  timestamp: string
  kind: 'path' | 'visit'
  label: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function parseCoordinate(value: unknown): { lat: number; lng: number } | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i)
  if (!match) return null
  const lat = Number(match[1])
  const lng = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null
  }
  return { lat, lng }
}

function isoTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function parseTimeline(input: unknown): TimelinePoint[] {
  const points: TimelinePoint[] = []
  const seen = new WeakSet<object>()

  const visitNode = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visitNode)
      return
    }

    const record = asRecord(value)
    if (!record || seen.has(record)) return
    seen.add(record)

    const start = isoTime(record.startTime)

    if (Array.isArray(record.timelinePath)) {
      for (const [index, rawPoint] of record.timelinePath.entries()) {
        const item = asRecord(rawPoint)
        if (!item) continue
        const coordinate = parseCoordinate(item.point)
        if (!coordinate) continue

        const offset = Number(item.durationMinutesOffsetFromStartTime ?? 0)
        const timestamp = start
          ? new Date(new Date(start).getTime() + (Number.isFinite(offset) ? offset : 0) * 60_000).toISOString()
          : null
        if (!timestamp) continue

        points.push({
          id: 'path-' + points.length + '-' + index,
          ...coordinate,
          timestamp,
          kind: 'path',
          label: 'Rutepunkt',
        })
      }
    }

    const visit = asRecord(record.visit)
    const topCandidate = asRecord(visit?.topCandidate)
    const coordinate = parseCoordinate(topCandidate?.placeLocation)
    if (coordinate && start) {
      const semanticType = typeof topCandidate?.semanticType === 'string'
        ? topCandidate.semanticType
        : 'Besøkt sted'
      points.push({
        id: 'visit-' + points.length,
        ...coordinate,
        timestamp: start,
        kind: 'visit',
        label: semanticType === 'Unknown' ? 'Besøkt sted' : semanticType,
      })
    }

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

export function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat('no-NO', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

export function formatLongDate(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00')
  return new Intl.DateTimeFormat('no-NO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
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
