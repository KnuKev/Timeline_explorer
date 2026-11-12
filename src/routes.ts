import { distanceKm, type TimelineActivity, type TimelinePoint, type TransportMode } from './timeline.ts'

export type RouteSegment = { id: string; points: TimelinePoint[]; estimated?: boolean; transport?: 'flight' }
export type RouteAnalysis = { segments: RouteSegment[]; distanceKm: number }
export type ScreenPoint = { x: number; y: number }

const MAX_GAP_MS = 6 * 60 * 60 * 1000
const MAX_TRAVEL_GAP_MS = 24 * 60 * 60 * 1000
const MIN_TRAVEL_DISTANCE_KM = 100
const MAX_SPEED_KMH = 1300
// Allow a narrow timing margin only for measured long-distance endpoints. These
// edges remain estimated; inferred semantic records never receive this margin.
const MAX_MEASURED_TIMING_SPEED_KMH = 1500
const MIN_SPEED_CHECK_KM = 10
const SAME_TIME_TOLERANCE_KM = 0.1
// A whole minute can reasonably contain up to 3 km of local travel (180 km/h).
// Apply this to the complete ordered run, not separately to each leg.
const MAX_MINUTE_PATH_KM = 3
type SourceIndices = number | number[]
type Recovery = { end: number; distanceKm: number }
type ActivityInterval = { activity: TimelineActivity; start: number; end: number; maximumEnd: number; inferred?: boolean }
type SourceIndex = { references: Map<TimelinePoint, SourceIndices>; recoveries: Map<number, Recovery>; activities: ActivityInterval[]; keys?: Map<string, SourceIndices> }
const sourceIndexCache = new WeakMap<readonly TimelinePoint[], SourceIndex>()

function occurrenceKey(point: TimelinePoint): string {
  return JSON.stringify([point.id, point.kind, point.timestamp, point.lat, point.lng])
}

function addIndex<Key>(map: Map<Key, SourceIndices>, key: Key, index: number): void {
  const existing = map.get(key)
  if (existing === undefined) map.set(key, index)
  else if (typeof existing === 'number') map.set(key, [existing, index])
  else existing.push(index)
}

function sourceIndex(allPoints: readonly TimelinePoint[]): SourceIndex {
  const cached = sourceIndexCache.get(allPoints)
  if (cached) return cached
  const references = new Map<TimelinePoint, SourceIndices>()
  for (let index = 0; index < allPoints.length; index++) {
    addIndex(references, allPoints[index]!, index)
  }
  const result = { references, recoveries: semanticRecoveries(allPoints), activities: activityIntervals(allPoints) }
  sourceIndexCache.set(allPoints, result)
  return result
}

function copiedPointIndex(index: SourceIndex, allPoints: readonly TimelinePoint[]): Map<string, SourceIndices> {
  // Normal app selections retain the original point objects, including after
  // structured cloning the import and selection together. Only external callers
  // supplying copied points need the more expensive string-based fallback.
  if (!index.keys) {
    const keys = new Map<string, SourceIndices>()
    for (let position = 0; position < allPoints.length; position++) {
      addIndex(keys, occurrenceKey(allPoints[position]!), position)
    }
    index.keys = keys
  }
  return index.keys
}

type Edge = { distanceKm: number; estimated: boolean; transport?: 'flight' } | { reason: 'invalid-time' | 'gap' | 'speed' | 'same-time' | 'invalid-distance' }

function activityIntervals(points: readonly TimelinePoint[]): ActivityInterval[] {
  const activities = new Map<string, TimelineActivity>()
  for (const point of points) for (const activity of point.activities ?? []) activities.set(activity.id, activity)
  const result: ActivityInterval[] = Array.from(activities.values(), activity => ({ activity, start: Date.parse(activity.startTimestamp), end: Date.parse(activity.endTimestamp), maximumEnd: 0 }))
    .filter(interval => Number.isFinite(interval.start) && interval.end > interval.start)
  // A flight may contain hundreds of short path edges. Recognise a sustained
  // aircraft-speed run as a whole instead of dashing only its longest edges.
  let previous: TimelinePoint | undefined
  let runStart: TimelinePoint | undefined
  let runDistance = 0
  const finishRun = () => {
    if (runStart && previous && runDistance >= 250) {
      const activity: TimelineActivity = { id: `inferred-flight-${result.length}`, mode: 'flight', startTimestamp: runStart.timestamp, endTimestamp: previous.timestamp, distanceKm: runDistance }
      result.push({ activity, start: Date.parse(activity.startTimestamp), end: Date.parse(activity.endTimestamp), maximumEnd: 0, inferred: true })
    }
    runStart = undefined
    runDistance = 0
  }
  for (const point of points) {
    if (!isMeasured(point)) continue
    if (previous) {
      const hours = (Date.parse(point.timestamp) - Date.parse(previous.timestamp)) / 3_600_000
      const kilometers = distanceKm([previous, point])
      const speed = kilometers / hours
      if (hours > 0 && hours <= 24 && kilometers >= 1 && speed >= 350 && speed <= MAX_MEASURED_TIMING_SPEED_KMH) {
        runStart ??= previous
        runDistance += kilometers
      } else finishRun()
    }
    previous = point
  }
  finishRun()
  result.sort((a, b) => a.start - b.start)
  let maximumEnd = -Infinity
  for (const interval of result) interval.maximumEnd = maximumEnd = Math.max(maximumEnd, interval.end)
  return result
}

const MODE_SPEED_LIMITS: Record<TransportMode, number> = { flight: 1500, ferry: 120, rail: 360, road: 220, walking: 25, cycling: 80 }

/** Dash transport, not missing samples. Selected activity modes take priority;
 * absent metadata, substantial movement at aircraft speed supports a flight.
 * Implausible semantic modes (e.g. 600 km of "walking") cannot veto that evidence.
 * A bounded interval query also finds activities stored separately from paths. */
function withTransport(edge: Edge | null, previous: TimelinePoint | undefined, current: TimelinePoint, intervals: ActivityInterval[]): Edge | null {
  if (!edge || 'reason' in edge || !previous) return edge
  let start = Date.parse(previous.timestamp)
  const end = Date.parse(current.timestamp)
  const visitEnd = previous.kind === 'visit' && previous.endTimestamp ? Date.parse(previous.endTimestamp) : NaN
  if (Number.isFinite(visitEnd) && visitEnd >= start && visitEnd <= end) start = visitEnd
  const elapsed = end - start
  // A rounded-minute edge can inherit an activity covering that instant.
  if (elapsed < 0 || (elapsed === 0 && !edge.estimated)) return edge
  let left = 0
  let right = intervals.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (intervals[middle]!.start <= end) left = middle + 1
    else right = middle
  }
  let surfaceEvidence = false
  let flightRun = false
  for (let index = left - 1; index >= 0 && intervals[index]!.maximumEnd > start; index--) {
    const interval = intervals[index]!
    const overlap = Math.min(end, interval.end) - Math.max(start, interval.start)
    if (overlap < elapsed * 0.2) continue
    const { activity } = interval
    const speed = activity.distanceKm * 3_600_000 / (interval.end - interval.start)
    if (!Number.isFinite(speed) || speed > MODE_SPEED_LIMITS[activity.mode]) continue
    if (activity.mode === 'flight') {
      if (!interval.inferred) return { ...edge, transport: 'flight' }
      if (interval.start <= start && interval.end >= end) flightRun = true
      continue
    }
    surfaceEvidence = true
  }
  if (!surfaceEvidence && (flightRun || (elapsed > 0 && edge.distanceKm >= 250 && edge.distanceKm * 3_600_000 / elapsed >= 300))) return { ...edge, transport: 'flight' }
  return edge
}

function analyseEdge(previous: TimelinePoint, current: TimelinePoint, allowMeasuredTimingTolerance = false): Edge {
  const currentTime = Date.parse(current.timestamp)
  let previousTime = Date.parse(previous.timestamp)
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime) || currentTime < previousTime) return { reason: 'invalid-time' }

  // A known stay can span days. Travel begins when that recorded stay ends,
  // unless this next measurement is itself inside the visit interval.
  const visitEnd = previous.kind === 'visit' && previous.endTimestamp ? Date.parse(previous.endTimestamp) : NaN
  if (Number.isFinite(visitEnd) && visitEnd >= previousTime && visitEnd <= currentTime) previousTime = visitEnd
  const elapsed = currentTime - previousTime

  const kilometers = distanceKm([previous, current])
  if (!Number.isFinite(kilometers)) return { reason: 'invalid-distance' }
  if (elapsed === 0) {
    const link = current.minutePathLink
    if (previous.source === 'timelinePath' && current.source === 'timelinePath' && link?.previousId === previous.id
      && link.runDistanceKm <= MAX_MINUTE_PATH_KM) return { distanceKm: kilometers, estimated: true }
    if (kilometers > SAME_TIME_TOLERANCE_KM) return { reason: 'same-time' }
  }
  let uncertainTiming = false
  if (elapsed > 0 && kilometers > MIN_SPEED_CHECK_KM) {
    const speed = kilometers / (elapsed / 3_600_000)
    if (speed > MAX_SPEED_KMH) {
      if (allowMeasuredTimingTolerance && isMeasured(previous) && isMeasured(current)
        && kilometers >= MIN_TRAVEL_DISTANCE_KM && speed <= MAX_MEASURED_TIMING_SPEED_KMH) uncertainTiming = true
      else return { reason: 'speed' }
    }
  }
  const longGap = elapsed > MAX_GAP_MS
  if (longGap && (elapsed > MAX_TRAVEL_GAP_MS || kilometers < MIN_TRAVEL_DISTANCE_KM)) return { reason: 'gap' }
  return { distanceKm: kilometers, estimated: longGap || uncertainTiming }
}

function isMeasured(point: TimelinePoint): boolean {
  return point.source === 'timelinePath' || point.source === 'raw'
}

/** Google can assign travel time to a destination visit or retain stale activity
 * locations during a journey. A pair of actual timed measurements can support an
 * estimated connection when the intervening semantic chain contradicts itself.
 * Consecutive measured-anchor intervals do not overlap, keeping this scan linear.
 * This changes route geometry only; no source observations or dates are edited. */
function semanticRecoveries(points: readonly TimelinePoint[]): Map<number, Recovery> {
  const result = new Map<number, Recovery>()
  let previousMeasured = -1
  for (let end = 0; end < points.length; end++) {
    const last = points[end]!
    if (!isMeasured(last)) continue
    const start = previousMeasured
    previousMeasured = end
    if (start < 0 || end === start + 1) continue
    const first = points[start]!
    const elapsed = Date.parse(last.timestamp) - Date.parse(first.timestamp)
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > MAX_TRAVEL_GAP_MS) continue
    const direct = analyseEdge(first, last, true)
    if ('reason' in direct || direct.distanceKm < MIN_TRAVEL_DISTANCE_KM) continue
    let semanticOnly = true
    let contradictory = false
    for (let index = start + 1; index <= end; index++) {
      const point = points[index]!
      if (index < end && point.source !== 'activity' && point.source !== 'visit') {
        semanticOnly = false
        break
      }
      const edge = analyseEdge(points[index - 1]!, point)
      if ('reason' in edge && (edge.reason === 'speed' || edge.reason === 'same-time')
        && distanceKm([points[index - 1]!, point]) >= MIN_TRAVEL_DISTANCE_KM) contradictory = true
    }
    if (semanticOnly && contradictory) result.set(start, { end, distanceKm: direct.distanceKm })
  }
  return result
}

/**
 * Build only supported connections between adjacent source observations.
 * allPoints must be the immutable original chronological import, before
 * place/quality filtering. Replace the array when source observations change;
 * its index is cached by array identity so changing dates only scans the selection.
 * Missing selected observations split the line instead of creating a shortcut.
 * Supported long gaps and contradictory semantic intervals are explicitly
 * estimated, and never connect across an observation omitted by the selection.
 * No interpolated positions or curved control points are introduced.
 */
export function buildRouteSegments(visiblePoints: readonly TimelinePoint[], allPoints: readonly TimelinePoint[] = visiblePoints): RouteAnalysis {
  const index = sourceIndex(allPoints)
  // Cursors belong to this selection, never to the cached source index.
  const nextOccurrences = new Map<number[], number>()
  const usedIndices = new Set<number>()
  const takeIndex = (indices: SourceIndices | undefined): number => {
    if (indices === undefined) return -1
    if (typeof indices === 'number') return usedIndices.has(indices) ? -1 : indices
    let next = nextOccurrences.get(indices) ?? 0
    while (next < indices.length && usedIndices.has(indices[next]!)) next++
    nextOccurrences.set(indices, next + 1)
    return indices[next] ?? -1
  }

  const segments: RouteSegment[] = []
  let currentSegment: TimelinePoint[] = []
  let currentEstimated = false
  let currentTransport: 'flight' | undefined
  let previousIndex = -1
  let totalDistance = 0
  const finishSegment = () => {
    if (currentSegment.length > 1) {
      segments.push({ id: `${currentSegment[0]!.id}:${currentSegment[currentSegment.length - 1]!.id}:${segments.length}`, points: currentSegment, ...(currentEstimated ? { estimated: true } : {}), ...(currentTransport ? { transport: currentTransport } : {}) })
    }
    currentSegment = []
  }
  const append = (point: TimelinePoint, edge: Edge | null) => {
    if (!edge || 'reason' in edge) finishSegment()
    else {
      const previous = currentSegment[currentSegment.length - 1]!
      if (currentSegment.length > 1 && (currentEstimated !== edge.estimated || currentTransport !== edge.transport)) {
        finishSegment()
        currentSegment.push(previous)
      }
      currentEstimated = edge.estimated
      currentTransport = edge.transport
      totalDistance += edge.distanceKm
    }
    currentSegment.push(point)
  }

  // Resolve occurrences once, so recovery can verify every intervening source
  // point is selected without repeatedly searching the import or point IDs.
  const selectedIndices = new Int32Array(visiblePoints.length)
  for (let position = 0; position < visiblePoints.length; position++) {
    const point = visiblePoints[position]!
    const indices = index.references.get(point)
      ?? copiedPointIndex(index, allPoints).get(occurrenceKey(point))
    const sourcePosition = takeIndex(indices)
    selectedIndices[position] = sourcePosition
    if (sourcePosition >= 0) usedIndices.add(sourcePosition)
  }

  for (let position = 0; position < visiblePoints.length; position++) {
    const point = visiblePoints[position]!
    const sourcePosition = selectedIndices[position]!
    const previous = currentSegment[currentSegment.length - 1]
    const edge = previous && sourcePosition >= 0 && previousIndex >= 0 && sourcePosition === previousIndex + 1
      ? analyseEdge(previous, point, true)
      : null
    append(point, withTransport(edge, previous, point, index.activities))
    previousIndex = sourcePosition

    // A recovered destination may also begin the next supported interval.
    for (;;) {
      const recovery = index.recoveries.get(previousIndex)
      if (!recovery) break
      const count = recovery.end - previousIndex
      if (position + count >= visiblePoints.length) break
      let complete = true
      for (let offset = 1; offset <= count; offset++) {
        if (selectedIndices[position + offset] !== previousIndex + offset) { complete = false; break }
      }
      if (!complete) break
      const origin = visiblePoints[position]!
      position += count
      append(visiblePoints[position]!, withTransport({ distanceKm: recovery.distanceKm, estimated: true }, origin, visiblePoints[position]!, index.activities))
      previousIndex = recovery.end
    }
  }
  finishSegment()
  return { segments, distanceKm: totalDistance }
}

/** Select only a recorded point actually near the pointer, never a distant
 * endpoint of a line crossing an empty area. Project through the current map. */
export function nearestPointWithinRadius(
  points: TimelinePoint[],
  pointer: ScreenPoint,
  project: (point: TimelinePoint) => ScreenPoint,
  radius = 12,
): TimelinePoint | null {
  if (!Number.isFinite(radius) || radius < 0 || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null
  let nearest: TimelinePoint | null = null
  let bestSquared = radius * radius
  for (const point of points) {
    const position = project(point)
    const dx = position.x - pointer.x
    const dy = position.y - pointer.y
    const squared = dx * dx + dy * dy
    if (Number.isFinite(squared) && squared <= bestSquared) {
      nearest = point
      bestSquared = squared
    }
  }
  return nearest
}
