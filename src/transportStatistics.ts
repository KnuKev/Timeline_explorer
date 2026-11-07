import tzLookup from 'tz-lookup'
import { buildRouteSegments, type RouteAnalysis } from './routes.ts'
import { pointDateKeys } from './pointDates.ts'
import { distanceKm, type TimelineActivity, type TimelinePoint, type TransportMode } from './timeline.ts'

export type TransportCategory = 'flight' | 'road' | 'rail' | 'unknown'
export type TransportTotal = { category: TransportCategory; distanceKm: number; minutes: number }
export type TransportStatistics = { all: TransportTotal[]; byYear: Record<string, TransportTotal[]> }

const CATEGORIES: TransportCategory[] = ['flight', 'road', 'rail', 'unknown']
const HOUR_MS = 3_600_000
const MAX_OBSERVED_GAP_MS = 30 * 60_000
const SPEED_LIMITS: Record<TransportMode, number> = { flight: 1500, road: 220, rail: 360, walking: 25, cycling: 80, ferry: 120 }
const empty = (): TransportTotal[] => CATEGORIES.map(category => ({ category, distanceKm: 0, minutes: 0 }))
type Evidence = { activity: TimelineActivity; start: number; end: number; selectedStart: boolean; selectedEnd: boolean }
type SpanEvidence = { category: TransportCategory; speedLimit: number; timed: boolean; missingAnchor: boolean; impossible: boolean }
type Span = { start: number; end: number; groups: SpanEvidence[] }
type Slice = { start: number; end: number; evidence?: Span }

function categoryOf(activity: TimelineActivity): TransportCategory {
  // Only the importer's exact legacy-format sentinel means an unavailable
  // score; a genuine zero or any other low score must remain unclassified.
  const unavailableZero = activity.confidenceUnavailable === true && activity.confidence === 0
  if (!unavailableZero && activity.confidence !== undefined && (!Number.isFinite(activity.confidence) || activity.confidence < 0.7 || activity.confidence > 1)) return 'unknown'
  if (activity.confidenceLevel && activity.confidenceLevel !== 'high') return 'unknown'
  // The route parser's broad road category also contains motorcycles. They
  // should not appear under the narrower car/bus label used by this report.
  if (/motorcycl/i.test(activity.sourceType ?? '')) return 'unknown'
  return activity.mode === 'flight' || activity.mode === 'road' || activity.mode === 'rail' ? activity.mode : 'unknown'
}

/** Turn canonical activity records into disjoint evidence spans. A mode is not
 * inferred from alternative Google candidates, and neither duplicate endpoint
 * attachments nor duplicate exports add time. Conflicting modes stay unknown. */
function activitySpans(points: TimelinePoint[], allPoints: TimelinePoint[]): Span[] {
  const selected = new Set(points)
  const evidence = new Map<string, Evidence>()
  for (const point of allPoints) {
    for (const activity of point.activities ?? []) {
      const start = Date.parse(activity.startTimestamp)
      const end = Date.parse(activity.endTimestamp)
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      const key = JSON.stringify([activity.mode, start, end, activity.distanceKm, activity.sourceType, activity.confidence, activity.confidenceLevel, activity.confidenceUnavailable])
      let entry = evidence.get(key)
      if (!entry) {
        entry = { activity, start, end, selectedStart: false, selectedEnd: false }
        evidence.set(key, entry)
      }
      if (selected.has(point)) {
        const timestamp = Date.parse(point.timestamp)
        if (timestamp === start) entry.selectedStart = true
        if (timestamp === end) entry.selectedEnd = true
      }
    }
  }
  type Event = { time: number; delta: 1 | -1; key: string; group: SpanEvidence }
  const events: Event[] = []
  for (const entry of evidence.values()) {
    const { activity, start, end } = entry
    const speedLimit = SPEED_LIMITS[activity.mode] ?? 0
    const speed = activity.distanceKm * HOUR_MS / (end - start)
    const plausible = Number.isFinite(speed) && speed >= 0 && speed <= speedLimit
    const missingAnchor = !entry.selectedStart || !entry.selectedEnd
    const supported = !missingAnchor && plausible
    const category = supported ? categoryOf(activity) : 'unknown'
    // The duration can remain meaningful when the mode confidence is low.
    // A stationary record or a rejected/missing activity anchor cannot supply it.
    const timed = supported && activity.distanceKm >= 0.03
    const group = { category, timed, speedLimit, missingAnchor, impossible: !plausible }
    const key = JSON.stringify(group)
    events.push({ time: start, delta: 1, key, group }, { time: end, delta: -1, key, group })
  }
  events.sort((a, b) => a.time - b.time)
  // Group by the small set of mode/quality combinations rather than retaining
  // every overlapping record. Queries remain bounded even with merged exports.
  const active = new Map<string, { count: number; group: SpanEvidence }>()
  const spans: Span[] = []
  for (let index = 0; index < events.length;) {
    const time = events[index]!.time
    do {
      const event = events[index++]!
      const count = (active.get(event.key)?.count ?? 0) + event.delta
      if (count) active.set(event.key, { count, group: event.group })
      else active.delete(event.key)
    } while (index < events.length && events[index]!.time === time)
    if (index === events.length) break
    if (!active.size) continue
    spans.push({ start: time, end: events[index]!.time, groups: [...active.values()].map(entry => entry.group) })
  }
  return spans
}

function spanCategory(span: Span, speed: number): TransportCategory {
  // A filtered anchor remains an uncertainty boundary. In contrast, an
  // impossible walking record cannot veto an independently supported flight.
  if (span.groups.some(group => group.missingAnchor)) return 'unknown'
  const candidates = span.groups.filter(group => !group.impossible && speed <= group.speedLimit)
  if (!candidates.length) return 'unknown'
  const category = candidates[0]!.category
  return candidates.every(group => group.category === category) ? category : 'unknown'
}

function firstSpan(spans: Span[], time: number): number {
  let left = 0
  let right = spans.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (spans[middle]!.end <= time) left = middle + 1
    else right = middle
  }
  return left
}

function slicesBetween(spans: Span[], start: number, end: number): Slice[] {
  const slices: Slice[] = []
  let cursor = start
  for (let index = firstSpan(spans, start); index < spans.length && spans[index]!.start < end; index++) {
    const evidence = spans[index]!
    if (evidence.start > cursor) slices.push({ start: cursor, end: Math.min(evidence.start, end) })
    cursor = Math.min(evidence.end, end)
    slices.push({ start: Math.max(start, evidence.start), end: cursor, evidence })
  }
  if (cursor < end) slices.push({ start: cursor, end })
  return slices
}

/** Aggregate only accepted route geometry. Distance follows the arrival's local
 * year, exactly like the main distance statistic. Minutes use actual elapsed
 * time in the departure location's time zone; known stops are trimmed, and long
 * unobserved gaps supply no duration. Recorded activity time may include stops
 * within that activity, so it is not an estimate of continuous active motion. */
export function buildTransportStatistics(points: TimelinePoint[], allPoints: TimelinePoint[] = points, route: RouteAnalysis = buildRouteSegments(points, allPoints)): TransportStatistics {
  const all = empty()
  const byYear: Record<string, TransportTotal[]> = {}
  const ensureYear = (year: string) => byYear[year] ??= empty()
  const addDistance = (category: TransportCategory, kilometers: number, year: string) => {
    const index = CATEGORIES.indexOf(category)
    all[index]!.distanceKm += kilometers
    ensureYear(year)[index]!.distanceKm += kilometers
  }
  const zones = new Map<string, string>()
  const yearFormatters = new Map<string, Intl.DateTimeFormat>()
  const zoneAt = (point: TimelinePoint) => {
    const key = `${point.lat}:${point.lng}`
    let zone = zones.get(key)
    if (!zone) {
      try { zone = tzLookup(point.lat, point.lng) } catch { zone = 'UTC' }
      if (zones.size >= 4096) zones.clear()
      zones.set(key, zone)
    }
    return zone
  }
  const yearAt = (time: number, zone: string) => {
    let formatter = yearFormatters.get(zone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric' })
      yearFormatters.set(zone, formatter)
    }
    return formatter.format(time)
  }
  // Accepted route edges are chronological and do not overlap. The guard also
  // prevents repeated edges supplied by a caller from adding their time twice.
  let countedUntil = -Infinity
  const addTime = (category: TransportCategory, from: number, end: number, point: TimelinePoint) => {
    let start = Math.max(from, countedUntil)
    if (end <= start) return
    const zone = zoneAt(point)
    const index = CATEGORIES.indexOf(category)
    while (start < end) {
      const year = yearAt(start, zone)
      let next = end
      if (yearAt(end - 1, zone) !== year) {
        // Locate local New Year without assuming an integer-hour UTC offset.
        let left = start + 1
        let right = end
        while (left < right) {
          const middle = Math.floor((left + right) / 2)
          if (yearAt(middle, zone) === year) left = middle + 1
          else right = middle
        }
        next = left
      }
      const minutes = (next - start) / 60_000
      all[index]!.minutes += minutes
      ensureYear(year)[index]!.minutes += minutes
      start = next
    }
    countedUntil = end
  }

  const spans = activitySpans(points, allPoints)
  for (const segment of route.segments) {
    for (let index = 1; index < segment.points.length; index++) {
      const previous = segment.points[index - 1]!
      const current = segment.points[index]!
      const kilometers = distanceKm([previous, current])
      const date = pointDateKeys(current)[0]
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(kilometers)) continue
      const year = String(Number(date.slice(0, 4)))
      let start = Date.parse(previous.timestamp)
      const end = Date.parse(current.timestamp)
      const visitEnd = previous.kind === 'visit' && previous.endTimestamp ? Date.parse(previous.endTimestamp) : NaN
      if (Number.isFinite(visitEnd) && visitEnd >= start && visitEnd <= end) start = visitEnd
      const elapsed = end - start
      const speed = elapsed > 0 ? kilometers * HOUR_MS / elapsed : 0
      const fallback: TransportCategory = segment.transport === 'flight' ? 'flight' : 'unknown'
      const slices = elapsed > 0 ? slicesBetween(spans, start, end) : []
      if (elapsed === 0) {
        const evidence = spans[firstSpan(spans, start)]
        const category = evidence && evidence.start <= start ? spanCategory(evidence, 0) : fallback
        addDistance(category, kilometers, year)
        continue
      }
      if (!Number.isFinite(elapsed) || elapsed < 0) { addDistance('unknown', kilometers, year); continue }
      const hasEvidence = slices.some(slice => slice.evidence)
      const categoryFor = (slice: Slice): TransportCategory => slice.evidence
        ? spanCategory(slice.evidence, speed)
        : hasEvidence ? 'unknown' : fallback
      const categories = new Set(slices.map(categoryFor))
      // Avoid assuming uniform speed to apportion one sparse edge across modes.
      // Real activity boundaries normally provide their own route endpoints.
      const category = categories.size === 1 ? [...categories][0]! : 'unknown'
      addDistance(category, kilometers, year)
      const observed = !segment.estimated && elapsed <= MAX_OBSERVED_GAP_MS && kilometers >= 0.03 && speed >= 1
      for (const slice of slices) {
        const supportedDuration = slice.evidence?.groups.some(group => group.timed && speed <= group.speedLimit)
        if (supportedDuration || observed) addTime(categoryFor(slice), slice.start, slice.end, previous)
      }
    }
  }
  return { all, byYear }
}
