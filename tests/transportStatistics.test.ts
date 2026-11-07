import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTransportStatistics, type TransportCategory, type TransportStatistics } from '../src/transportStatistics.ts'
import { buildRouteSegments } from '../src/routes.ts'
import { distanceKm, parseTimeline, type TimelineActivity, type TimelinePoint, type TransportMode } from '../src/timeline.ts'

const point = (id: string, time: string, lat = 59.91, lng = 10.7): TimelinePoint => ({ id, timestamp: time, lat, lng, kind: 'path', source: 'timelinePath', label: 'Route point' })
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const row = (stats: TransportStatistics, category: TransportCategory) => stats.all.find(value => value.category === category)!
const sum = (stats: TransportStatistics, field: 'distanceKm' | 'minutes') => stats.all.reduce((total, entry) => total + entry[field], 0)
const attach = (points: TimelinePoint[], mode: TransportMode, start = 0, end = points.length - 1, extra: Partial<TimelineActivity> = {}) => {
  const activity: TimelineActivity = { id: `${mode}-${start}-${end}`, mode, startTimestamp: points[start]!.timestamp, endTimestamp: points[end]!.timestamp, distanceKm: distanceKm(points.slice(start, end + 1)), ...extra }
  for (const index of [start, end]) (points[index]!.activities ??= []).push(activity)
  return activity
}
const journey = (mode?: TransportMode, extra: Partial<TimelineActivity> = {}) => {
  const points = [point('a', '2025-05-01T10:00:00Z'), point('b', '2025-05-01T11:00:00Z', 60.2, 11)]
  if (mode) attach(points, mode, 0, 1, extra)
  return points
}

test('transport distances use accepted geometry, while explicit journey intervals supply recorded time', () => {
  for (const mode of ['flight', 'road', 'rail'] as const) {
    const points = journey(mode, { distanceKm: 100, confidence: 0.95 })
    const route = buildRouteSegments(points)
    const stats = buildTransportStatistics(points, points, route)
    near(row(stats, mode).distanceKm, route.distanceKm)
    near(sum(stats, 'distanceKm'), route.distanceKm)
    near(row(stats, mode).minutes, 60)
    assert.deepEqual(stats.byYear['2025'], stats.all)
    assert.ok(row(stats, mode).distanceKm < 100, 'Do not mix Google-reported distance into the geometric overview total')
  }
})

test('walking, cycling, ferry and motorcycle records belong to the other/unclassified group', () => {
  for (const [mode, sourceType] of [['walking', 'RUNNING'], ['cycling', 'ON_BICYCLE'], ['ferry', 'IN_FERRY'], ['road', 'MOTORCYCLING']] as const) {
    const points = [point('a', '2025-05-01T10:00:00Z'), point('b', '2025-05-01T11:00:00Z', 59.94, 10.7)]
    attach(points, mode, 0, 1, { sourceType })
    const stats = buildTransportStatistics(points)
    near(row(stats, 'unknown').distanceKm, distanceKm(points))
    near(row(stats, 'unknown').minutes, 60)
  }
})

test('low confidence and conflicting confidence levels remain unclassified without dropping recorded duration', () => {
  for (const extra of [{ confidence: 0 }, { confidence: 0.69 }, { confidence: NaN }, { confidence: 2 }, { confidenceLevel: 'low' as const }, { confidenceLevel: 'medium' as const }, { confidence: 0.2, confidenceLevel: 'high' as const }]) {
    const points = journey('road', extra)
    const stats = buildTransportStatistics(points)
    near(row(stats, 'unknown').distanceKm, distanceKm(points))
    near(row(stats, 'unknown').minutes, 60)
    assert.equal(row(stats, 'road').distanceKm, 0)
  }
  for (const extra of [{}, { confidence: 0.7 }, { confidenceLevel: 'high' as const }]) {
    const stats = buildTransportStatistics(journey('road', extra))
    assert.ok(row(stats, 'road').distanceKm > 0)
    assert.equal(row(stats, 'road').minutes, 60)
  }
})

test('duplicate endpoint attachments and duplicate merged activity IDs cannot double totals', () => {
  const points = journey('rail')
  const activity = points[0]!.activities![0]!
  points[0]!.activities!.push({ ...activity, id: 'duplicate-from-other-file' }, activity)
  points[1]!.activities!.push({ ...activity, id: 'duplicate-from-other-file' }, activity)
  const original = structuredClone(points)
  const stats = buildTransportStatistics(points)
  near(row(stats, 'rail').minutes, 60)
  near(sum(stats, 'distanceKm'), distanceKm(points))
  assert.deepEqual(points, original)
})

test('a specifically identified unavailable legacy zero is distinct from a genuine zero score', () => {
  const legacy = journey('road', { confidence: 0, confidenceUnavailable: true })
  const legacyStats = buildTransportStatistics(legacy)
  near(row(legacyStats, 'road').distanceKm, distanceKm(legacy))
  near(row(legacyStats, 'road').minutes, 60)
  for (const extra of [
    { confidence: 0 },
    { confidence: 0, confidenceUnavailable: false },
    { confidence: 0.2, confidenceUnavailable: true },
    { confidence: NaN, confidenceUnavailable: true },
    { confidence: 0, confidenceUnavailable: true, confidenceLevel: 'low' as const },
  ]) {
    const points = journey('road', extra)
    const stats = buildTransportStatistics(points)
    near(row(stats, 'unknown').distanceKm, distanceKm(points))
    near(row(stats, 'road').distanceKm, 0)
  }
})

test('merging a placeholder zero and a genuine low-confidence duplicate does not erase the uncertainty', () => {
  for (const reversed of [false, true]) {
    const points = journey('road', { confidence: 0, confidenceUnavailable: true })
    attach(points, 'road', 0, 1, { id: 'genuine-zero', confidence: 0 })
    if (reversed) for (const point of points) point.activities!.reverse()
    const stats = buildTransportStatistics(points)
    near(row(stats, 'unknown').distanceKm, distanceKm(points))
    near(row(stats, 'unknown').minutes, 60)
    near(row(stats, 'road').distanceKm, 0)
  }
})

test('overlapping conflicting activities count the overlap once as unclassified', () => {
  const points = Array.from({ length: 4 }, (_, index) => point(String(index), new Date(Date.parse('2025-05-01T10:00:00Z') + index * 30 * 60_000).toISOString(), 59.91 + index * 0.1, 10.7))
  attach(points, 'road', 0, 2)
  attach(points, 'rail', 1, 3)
  const stats = buildTransportStatistics(points)
  near(row(stats, 'road').minutes, 30)
  near(row(stats, 'unknown').minutes, 30)
  near(row(stats, 'rail').minutes, 30)
  near(sum(stats, 'minutes'), 90)
  near(sum(stats, 'distanceKm'), buildRouteSegments(points).distanceKm)
})

test('overlapping compatible car and bus records form one continuous road interval', () => {
  const points = Array.from({ length: 4 }, (_, index) => point(String(index), new Date(Date.parse('2025-05-01T10:00:00Z') + index * 30 * 60_000).toISOString(), 59.91 + index * 0.1, 10.7))
  attach(points, 'road', 0, 2, { sourceType: 'IN_CAR' })
  attach(points, 'road', 1, 3, { sourceType: 'IN_BUS' })
  const stats = buildTransportStatistics(points)
  near(row(stats, 'road').minutes, 90)
  near(row(stats, 'unknown').minutes, 0)
  near(row(stats, 'road').distanceKm, buildRouteSegments(points).distanceKm)
})

test('implausible activity speeds do not label a valid route or manufacture long journey time', () => {
  const points = journey('walking', { distanceKm: 1000 })
  const stats = buildTransportStatistics(points)
  near(row(stats, 'unknown').distanceKm, buildRouteSegments(points).distanceKm)
  assert.equal(sum(stats, 'minutes'), 0, 'An unsupported hour-long gap is not recorded travel time')
  const moving = journey('road', { distanceKm: 10000 })
  moving[1]!.timestamp = '2025-05-01T10:20:00Z'
  for (const point of moving) point.activities![0]!.endTimestamp = moving[1]!.timestamp
  const observed = buildTransportStatistics(moving)
  assert.equal(row(observed, 'unknown').minutes, 20, 'Short observed movement is retained even when its mode is implausible')
})

test('a plausible whole-activity average cannot mislabel a fast individual edge as road travel', () => {
  const points = [point('a', '2025-05-01T10:00:00Z'), point('b', '2025-05-01T10:02:00Z', 60.09, 10.7), point('c', '2025-05-01T12:00:00Z', 60.2, 10.7)]
  attach(points, 'road')
  const stats = buildTransportStatistics(points)
  near(row(stats, 'unknown').distanceKm, distanceKm(points.slice(0, 2)))
  near(row(stats, 'unknown').minutes, 2)
  near(row(stats, 'road').distanceKm, distanceKm(points.slice(1)))
  near(row(stats, 'road').minutes, 118)
})

test('a filtered activity anchor cannot leak its transport classification into retained route points', () => {
  const points = Array.from({ length: 5 }, (_, index) => point(String(index), new Date(Date.parse('2025-05-01T10:00:00Z') + index * 15 * 60_000).toISOString(), 59.91 + index * 0.1, 10.7))
  attach(points, 'flight')
  const selected = points.slice(0, 4)
  const route = buildRouteSegments(selected, points)
  assert.ok(route.segments.some(segment => segment.transport === 'flight'), 'Map metadata and reporting confidence are deliberately separate')
  const stats = buildTransportStatistics(selected, points, route)
  near(row(stats, 'unknown').distanceKm, route.distanceKm)
  near(row(stats, 'unknown').minutes, 45)
  assert.equal(row(stats, 'flight').distanceKm, 0)
})

test('inferred flights can classify distance, but sparse endpoints alone do not supply hours', () => {
  const points = [point('a', '2025-05-01T10:00:00Z', 51.47, -0.45), point('b', '2025-05-01T12:00:00Z', 60.19, 11.1)]
  const inferred = buildTransportStatistics(points)
  near(row(inferred, 'flight').distanceKm, distanceKm(points))
  assert.equal(sum(inferred, 'minutes'), 0)
  attach(points, 'flight')
  const explicit = buildTransportStatistics(points)
  near(row(explicit, 'flight').minutes, 120)
  for (const point of points) point.activities![0]!.confidence = 0.3
  const low = buildTransportStatistics(points)
  near(row(low, 'unknown').distanceKm, distanceKm(points))
  near(row(low, 'unknown').minutes, 120)
})

test('stationary records and overnight home samples do not accumulate travel hours', () => {
  const home = Array.from({ length: 30 }, (_, index) => point(String(index), new Date(Date.parse('2025-04-01T01:00:00Z') + index * 24 * 60 * 60_000).toISOString()))
  const stats = buildTransportStatistics(home)
  assert.equal(sum(stats, 'minutes'), 0)
  assert.equal(sum(stats, 'distanceKm'), 0)
  const stationary = [point('a', '2025-05-01T10:00:00Z'), point('b', '2025-05-01T11:00:00Z')]
  attach(stationary, 'road')
  assert.equal(sum(buildTransportStatistics(stationary), 'minutes'), 0)
})

test('recorded visits trim the stay before observed movement is timed', () => {
  const stay: TimelinePoint = { ...point('stay', '2025-05-01T00:00:00Z'), kind: 'visit', source: 'visit', endTimestamp: '2025-05-01T10:00:00Z' }
  const end = point('end', '2025-05-01T10:20:00Z', 59.93, 10.7)
  const stats = buildTransportStatistics([stay, end])
  near(row(stats, 'unknown').minutes, 20)
  near(row(stats, 'unknown').distanceKm, distanceKm([stay, end]))
})

test('same-minute path detail contributes distance without fabricated seconds', () => {
  const points = parseTimeline({ startTime: '2025-05-01T10:00:00Z', timelinePath: [
    { point: '59.91,10.7', durationMinutesOffsetFromStartTime: 0 },
    { point: '59.915,10.7', durationMinutesOffsetFromStartTime: 0 },
    { point: '59.92,10.7', durationMinutesOffsetFromStartTime: 0 },
  ] })
  const route = buildRouteSegments(points)
  const stats = buildTransportStatistics(points, points, route)
  assert.ok(route.distanceKm > 1)
  near(row(stats, 'unknown').distanceKm, route.distanceKm)
  assert.equal(sum(stats, 'minutes'), 0)
})

test('distance follows arrival-local year while elapsed minutes split at local New Year', () => {
  const points = [point('a', '2024-12-31T22:50:00Z'), point('b', '2024-12-31T23:10:00Z', 59.94, 10.7)]
  attach(points, 'road')
  const stats = buildTransportStatistics(points)
  const old = stats.byYear['2024']!.find(entry => entry.category === 'road')!
  const current = stats.byYear['2025']!.find(entry => entry.category === 'road')!
  near(old.distanceKm, 0)
  near(current.distanceKm, distanceKm(points))
  near(old.minutes, 10)
  near(current.minutes, 10)
  near(row(stats, 'road').minutes, old.minutes + current.minutes)
})

test('DST changes use elapsed time rather than repeated or missing wall-clock hours', () => {
  for (const date of ['2025-03-30', '2025-10-26']) {
    const points = [point('a', `${date}T00:50:00Z`), point('b', `${date}T01:10:00Z`, 59.94, 10.7)]
    attach(points, 'rail')
    near(row(buildTransportStatistics(points), 'rail').minutes, 20)
  }
})

test('partially annotated sparse geometry stays unclassified instead of inventing a distance split', () => {
  const points = [point('a', '2025-05-01T10:00:00Z'), point('b', '2025-05-01T10:30:00Z', 60, 10.7), point('c', '2025-05-01T11:00:00Z', 60.1, 10.7)]
  attach(points, 'road', 0, 1)
  const route = { segments: [{ id: 'sparse', points: [points[0]!, points[2]!] }], distanceKm: distanceKm([points[0]!, points[2]!]) }
  const stats = buildTransportStatistics(points, points, route)
  near(row(stats, 'unknown').distanceKm, route.distanceKm)
  near(row(stats, 'road').distanceKm, 0)
  near(row(stats, 'road').minutes, 30)
  near(row(stats, 'unknown').minutes, 0, 'The other half-hour lacks observed or activity duration evidence')
})

test('a missing selected activity endpoint cannot supply duration across a long recording gap', () => {
  const points = [point('a', '2025-05-01T10:00:00Z'), point('b', '2025-05-01T11:00:00Z', 60, 10.7), point('c', '2025-05-01T12:00:00Z', 60.1, 10.7)]
  attach(points, 'road')
  const selected = points.slice(0, 2)
  const stats = buildTransportStatistics(selected, points)
  assert.ok(row(stats, 'unknown').distanceKm > 0)
  assert.equal(sum(stats, 'minutes'), 0)
})

test('an impossible conflicting mode cannot erase a separately supported road journey', () => {
  const points = journey('road')
  attach(points, 'walking', 0, 1, { distanceKm: 1000 })
  const stats = buildTransportStatistics(points)
  near(row(stats, 'road').minutes, 60)
  near(row(stats, 'road').distanceKm, distanceKm(points))
  near(row(stats, 'unknown').distanceKm, 0)
})

test('an impossible walking record cannot veto an overlapping valid flight', () => {
  const points = [point('a', '2025-05-01T10:00:00Z', 51.47, -0.45), point('b', '2025-05-01T12:00:00Z', 60.19, 11.1)]
  attach(points, 'flight', 0, 1, { confidence: 0.99 })
  attach(points, 'walking', 0, 1, { confidence: 0.99 })
  const route = buildRouteSegments(points)
  const stats = buildTransportStatistics(points, points, route)
  near(row(stats, 'flight').distanceKm, route.distanceKm)
  near(row(stats, 'flight').minutes, 120)
  near(row(stats, 'unknown').distanceKm, 0)
  near(sum(stats, 'minutes'), 120)
})

test('edge-specific speed can disprove an overlapping mode with an otherwise plausible overall average', () => {
  const points = [
    point('walk-start', '2025-05-01T00:00:00Z', 0, 10),
    point('flight-start', '2025-05-01T08:00:00Z', 0, 10),
    point('flight-end', '2025-05-01T08:45:00Z', 0, 15),
    point('walk-end', '2025-05-02T00:00:00Z', 0, 15),
  ]
  attach(points, 'walking', 0, 3, { confidence: 0.99 })
  attach(points, 'flight', 1, 2, { confidence: 0.99 })
  assert.ok(distanceKm(points) / 24 < 25, 'The full walking interval passes its average-speed check')
  const stats = buildTransportStatistics(points)
  near(row(stats, 'flight').distanceKm, distanceKm(points.slice(1, 3)))
  near(row(stats, 'flight').minutes, 45)
  near(row(stats, 'unknown').distanceKm, 0)
})

test('discarding an impossible label does not by itself promote a metadata-only flight inference', () => {
  const points = [point('a', '2025-05-01T10:00:00Z', 51.47, -0.45), point('b', '2025-05-01T12:00:00Z', 60.19, 11.1)]
  for (const point of points) point.source = 'activity'
  attach(points, 'walking', 0, 1, { confidence: 0.99 })
  const route = buildRouteSegments(points)
  assert.ok(route.segments.some(segment => segment.transport === 'flight'))
  const stats = buildTransportStatistics(points, points, route)
  near(row(stats, 'unknown').distanceKm, route.distanceKm)
  near(row(stats, 'flight').distanceKm, 0)
  near(sum(stats, 'minutes'), 0)
})

test('a missing anchor remains a boundary even when another activity supplies a plausible mode', () => {
  const points = [
    point('a', '2025-05-01T10:00:00Z', 51.47, -0.45),
    point('b', '2025-05-01T12:00:00Z', 60.19, 11.1),
    point('omitted', '2025-05-01T13:00:00Z', 60.2, 11.1),
  ]
  attach(points, 'flight', 0, 1, { confidence: 0.99 })
  attach(points, 'walking', 0, 2, { confidence: 0.99 })
  const selected = points.slice(0, 2)
  const stats = buildTransportStatistics(selected, points)
  near(row(stats, 'unknown').distanceKm, distanceKm(selected))
  near(row(stats, 'flight').distanceKm, 0)
  near(row(stats, 'unknown').minutes, 120)
})

test('flight time can introduce a local year not present in either endpoint date', () => {
  const points = [point('a', '2024-12-31T21:50:00Z', 67, 24.5), point('b', '2024-12-31T22:10:00Z', 67, 23)]
  attach(points, 'flight')
  const stats = buildTransportStatistics(points)
  const old = stats.byYear['2024']!.find(entry => entry.category === 'flight')!
  const current = stats.byYear['2025']!.find(entry => entry.category === 'flight')!
  near(old.distanceKm, distanceKm(points))
  near(current.distanceKm, 0)
  near(old.minutes, 10)
  near(current.minutes, 10)
})
