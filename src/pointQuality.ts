import type { TimelinePoint } from './timeline.ts'

export type SuspectedPoint = {
  point: TimelinePoint
  reason: 'implausible-excursion'
  previousPointId: string
  nextPointId: string
}

export type PointQualityResult = {
  points: TimelinePoint[]
  excluded: SuspectedPoint[]
}

const MIN_JUMP_KM = 100
const MIN_SHORT_JUMP_KM = 10
const MAX_SHORT_JUMP_WINDOW_MS = 2 * 60_000
// Deliberately above normal commercial aircraft speeds. Distance alone is not a fault.
const MAX_PLAUSIBLE_SPEED_KMH = 1_500
const MAX_EXCURSION_POINTS = 3
const MAX_CLUSTER_RADIUS_KM = 50
const MAX_EXCURSION_MS = 60 * 60_000
const MAX_ANCHOR_WINDOW_MS = 24 * 60 * 60_000

function distanceBetween(a: TimelinePoint, b: TimelinePoint): number {
  const radians = Math.PI / 180
  const dLat = (b.lat - a.lat) * radians
  const dLng = (b.lng - a.lng) * radians
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
}

function speedKmh(distance: number, elapsedMs: number): number {
  return elapsedMs > 0 ? distance * 3_600_000 / elapsedMs : Infinity
}

/**
 * Flag only a short, distant detour bracketed by nearby, compatible observations.
 * Both travel legs must be implausible, while skipping the detour must be plausible.
 * An endpoint, a one-way jump, or a real long-distance journey is not enough evidence.
 * Input objects are retained so the UI can reveal every suspected point again.
 */
export function analysePointQuality(points: TimelinePoint[]): PointQualityResult {
  const timestamps = points.map(point => Date.parse(point.timestamp))
  const excluded: SuspectedPoint[] = []
  const excludedIndices = new Set<number>()

  for (let index = 1; index < points.length - 1; index++) {
    if (excludedIndices.has(index - 1)) continue
    const previous = points[index - 1]!
    const first = points[index]!
    const previousTime = timestamps[index - 1]!
    const firstTime = timestamps[index]!
    if (!Number.isFinite(previousTime) || !Number.isFinite(firstTime) || firstTime < previousTime) continue
    const outbound = distanceBetween(previous, first)
    if (outbound < MIN_SHORT_JUMP_KM || speedKmh(outbound, firstTime - previousTime) <= MAX_PLAUSIBLE_SPEED_KMH) continue

    let clusterEndTime = firstTime
    for (let count = 1; count <= MAX_EXCURSION_POINTS && index + count < points.length; count++) {
      const lastIndex = index + count - 1
      const last = points[lastIndex]!
      const lastTime = timestamps[lastIndex]!
      if (!Number.isFinite(lastTime) || lastTime < firstTime || lastTime - firstTime > MAX_EXCURSION_MS) break
      if (distanceBetween(first, last) > MAX_CLUSTER_RADIUS_KM) break
      // Preserve an explicitly recorded stay instead of treating it as a fleeting fix.
      const lastEnd = last.kind === 'visit' && last.endTimestamp ? Date.parse(last.endTimestamp) : lastTime
      if (!Number.isFinite(lastEnd) || lastEnd - firstTime > MAX_EXCURSION_MS) break
      clusterEndTime = Math.max(clusterEndTime, lastEnd)

      const next = points[index + count]!
      const nextTime = timestamps[index + count]!
      const anchorWindow = nextTime - previousTime
      if (!Number.isFinite(nextTime) || nextTime < lastTime || anchorWindow < 0 || anchorWindow > MAX_ANCHOR_WINDOW_MS || clusterEndTime > nextTime) continue
      const inbound = distanceBetween(last, next)
      if (inbound < MIN_SHORT_JUMP_KM || speedKmh(inbound, nextTime - lastTime) <= MAX_PLAUSIBLE_SPEED_KMH) continue

      const direct = distanceBetween(previous, next)
      const shortestLeg = Math.min(outbound, inbound)
      const shortJump = shortestLeg < MIN_JUMP_KM
      // Regional jumps need much closer anchors in both time and space.
      if (shortJump && anchorWindow > MAX_SHORT_JUMP_WINDOW_MS) continue
      const maxDirectDistance = Math.max(shortJump ? 1 : 100, shortestLeg * 0.1)
      if (direct > maxDirectDistance) continue
      if (direct > 1 && speedKmh(direct, anchorWindow) > MAX_PLAUSIBLE_SPEED_KMH) continue

      for (let suspect = index; suspect <= lastIndex; suspect++) {
        excludedIndices.add(suspect)
        excluded.push({ point: points[suspect]!, reason: 'implausible-excursion', previousPointId: previous.id, nextPointId: next.id })
      }
      index = lastIndex
      break
    }
  }

  return { points: points.filter((_, index) => !excludedIndices.has(index)), excluded }
}
