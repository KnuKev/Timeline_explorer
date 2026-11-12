import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRouteSegments, nearestPointWithinRadius } from '../src/routes.ts'
import { distanceKm, parseTimeline, type TimelinePoint } from '../src/timeline.ts'

const point = (id: string, lat: number, lng: number, timestamp: string): TimelinePoint => ({ id, lat, lng, timestamp, kind: 'path', label: 'Rutepunkt' })

test('ordered samples with the same minute offset retain their short route and original timestamps', () => {
  const timestamp = '2026-10-13T08:24:00.000Z'
  const samples = ['0,10', '0,10.002', '0,10.006'].map(point => ({ point, durationMinutesOffsetFromStartTime: '0' }))
  const points = parseTimeline({ startTime: timestamp, timelinePath: samples })
  const route = buildRouteSegments(points)
  assert.ok(points.every(point => point.timestamp === timestamp))
  assert.deepEqual(route.segments.map(segment => segment.points), [points])
  assert.equal(route.segments[0]!.estimated, true)
  assert.equal(route.distanceKm, distanceKm(points))
  assert.equal(buildRouteSegments([points[0]!, points[2]!], points).distanceKm, 0)

  const exact = parseTimeline({ startTime: timestamp, timelinePath: samples.map(point => ({ ...point, time: timestamp })) })
  assert.equal(buildRouteSegments(exact).distanceKm, 0, 'explicit timestamps keep their original precision')
  const independent = parseTimeline(samples.map(sample => ({ startTime: timestamp, timelinePath: [sample] })))
  assert.equal(buildRouteSegments(independent).distanceKm, 0, 'sharing a minute across separate paths is insufficient')

  const flightStart: TimelinePoint = { ...points[0]!, activities: [{ id: 'flight', mode: 'flight',
    startTimestamp: timestamp, endTimestamp: '2026-10-13T10:30:00Z', distanceKm: 1200 }] }
  assert.equal(buildRouteSegments([flightStart, ...points.slice(1)]).segments[0]!.transport, 'flight')
})

test('the distance budget covers the entire minute-offset run rather than each leg', () => {
  const timelinePath = ['0,10', '0,10.017', '0,10.035'].map(point => ({ point, durationMinutesOffsetFromStartTime: 0 }))
  const points = parseTimeline({ startTime: '2026-10-13T08:24:00Z', timelinePath })
  assert.ok(distanceKm(points.slice(0, 2)) < 3 && distanceKm(points.slice(1)) < 3 && distanceKm(points) > 3)
  assert.deepEqual(buildRouteSegments(points), { segments: [], distanceKm: 0 })
})

test('routes preserve the recorded anchors without inventing curved kinks', () => {
  const points = [
    point('a', 59.91, 10.70, '2025-01-01T10:00:00Z'),
    point('b', 59.92, 10.73, '2025-01-01T10:10:00Z'),
    point('c', 59.90, 10.76, '2025-01-01T10:20:00Z'),
  ]
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.deepEqual(result.segments[0].points, points)
  assert.ok(result.segments[0].points.every((entry, index) => entry === points[index]))
  assert.ok(Math.abs(result.distanceKm - distanceKm(points)) < 1e-9)
})

test('an isolated impossible Colombia jump does not create a transatlantic line or distance', () => {
  const points = [
    point('before', 59.91, 10.70, '2025-01-01T10:00:00Z'),
    point('bad', 4.71, -74.07, '2025-01-01T10:01:00Z'),
    point('after', 59.92, 10.71, '2025-01-01T10:02:00Z'),
    point('later', 59.93, 10.72, '2025-01-01T10:03:00Z'),
  ]
  const result = buildRouteSegments(points)
  assert.deepEqual(result.segments.map(segment => segment.points.map(entry => entry.id)), [['after', 'later']])
  assert.equal(result.distanceKm, distanceKm(points.slice(2)))
  const filtered = buildRouteSegments([points[0], points[2], points[3]], points)
  assert.deepEqual(filtered.segments.map(segment => segment.points.map(entry => entry.id)), [['after', 'later']])
})

test('a plausible sparse flight retains its recorded endpoints', () => {
  const points = [
    point('dublin', 53.4264, -6.2499, '2025-01-01T10:00:00Z'),
    point('new-york', 40.6413, -73.7781, '2025-01-01T15:45:00Z'),
  ]
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.deepEqual(result.segments[0].points, points)
  assert.ok(result.distanceKm > 5000)
})

test('plausible long journeys survive six-hour recording gaps as estimated connections', () => {
  const journeys = [
    [point('germany', 50.04, 8.56, '2026-06-01T10:00:00Z'), point('china', 31.14, 121.81, '2026-06-01T22:35:00Z')],
    [point('dubai', 25.25, 55.37, '2026-06-17T00:30:00Z'), point('oslo', 60.19, 11.10, '2026-06-17T08:40:00Z')],
    [point('oslo', 60.19, 11.10, '2025-01-01T10:00:00Z'), point('tenerife', 28.04, -16.57, '2025-01-01T18:20:00Z')],
  ]
  for (const points of journeys) {
    const result = buildRouteSegments(points)
    assert.equal(result.segments.length, 1)
    assert.equal(result.segments[0].estimated, true)
    assert.deepEqual(result.segments[0].points, points)
    assert.equal(result.distanceKm, distanceKm(points))
  }
  const weekGap = [journeys[0][0], { ...journeys[0][1], timestamp: '2026-06-08T22:35:00Z' }]
  assert.deepEqual(buildRouteSegments(weekGap), { segments: [], distanceKm: 0 })
  const excessiveSpeed = [journeys[0][0], { ...journeys[0][1], timestamp: '2026-06-01T16:01:00Z' }]
  assert.deepEqual(buildRouteSegments(excessiveSpeed), { segments: [], distanceKm: 0 })
})

const measured = (id: string, lat: number, lng: number, timestamp: string): TimelinePoint => ({ ...point(id, lat, lng, timestamp), source: 'timelinePath' })
const inferredVisit = (id: string, lat: number, lng: number, timestamp: string, endTimestamp: string): TimelinePoint => ({ ...point(id, lat, lng, timestamp), source: 'visit', kind: 'visit', endTimestamp })

test('a destination visit covering the flight recovers one measured Korea–Dubai connection', () => {
  const points = [
    measured('korea', 37.44697, 126.44785, '2026-06-16T13:59:00Z'),
    inferredVisit('early-dubai', 25.25154, 55.368307, '2026-06-16T14:03:10Z', '2026-06-17T00:32:00Z'),
    measured('dubai', 25.247337, 55.363005, '2026-06-17T00:28:00Z'),
    measured('dubai-later', 25.2475, 55.3631, '2026-06-17T00:29:00Z'),
  ]
  const original = structuredClone(points)
  const result = buildRouteSegments(points)
  assert.deepEqual(result.segments.map(segment => [segment.estimated === true, segment.points.map(entry => entry.id)]), [
    [true, ['korea', 'dubai']],
    [false, ['dubai', 'dubai-later']],
  ])
  assert.equal(result.distanceKm, distanceKm([points[0], points[2], points[3]]))
  assert.deepEqual(points, original)
  assert.deepEqual(buildRouteSegments(points.map(entry => ({ ...entry })), points), result)
})

test('stale semantic activity coordinates cannot erase a measured ferry journey', () => {
  const points = [
    measured('sea', 58.372741, 10.753681, '2018-08-11T16:57:00Z'),
    { ...point('stale-oslo', 59.909246, 10.708572, '2018-08-12T07:20:00Z'), source: 'activity' as const },
    inferredVisit('stale-stay', 59.909246, 10.708572, '2018-08-12T07:25:00Z', '2018-08-12T07:45:00Z'),
    { ...point('stale-endpoint', 59.909246, 10.708572, '2018-08-12T07:45:55Z'), source: 'activity' as const },
    measured('kiel', 54.32127, 10.140469, '2018-08-12T07:53:00Z'),
  ]
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].estimated, true)
  assert.deepEqual(result.segments[0].points, [points[0], points[4]])
  assert.equal(result.distanceKm, distanceKm([points[0], points[4]]))
})

test('semantic recovery never crosses observations removed by a country or quality filter', () => {
  const points = [
    measured('korea', 37.44697, 126.44785, '2026-06-16T13:59:00Z'),
    inferredVisit('early-dubai', 25.25154, 55.368307, '2026-06-16T14:03:10Z', '2026-06-17T00:32:00Z'),
    measured('dubai', 25.247337, 55.363005, '2026-06-17T00:28:00Z'),
  ]
  assert.deepEqual(buildRouteSegments([points[0], points[2]], points), { segments: [], distanceKm: 0 })
  assert.deepEqual(buildRouteSegments(points.slice(0, 2), points), { segments: [], distanceKm: 0 })
})

test('semantic recovery requires known provenance, reachable anchors and no intervening measurement', () => {
  const origin = measured('oslo', 59.91, 10.70, '2025-01-01T10:00:00Z')
  const wrong = inferredVisit('wrong', 4.71, -74.07, '2025-01-01T10:01:00Z', '2025-01-01T13:00:00Z')
  const destination = measured('berlin', 52.52, 13.40, '2025-01-01T12:00:00Z')
  const cases: TimelinePoint[][] = [
    [origin, { ...wrong, source: undefined }, destination],
    [origin, { ...wrong, source: 'timelinePath' }, destination],
    [origin, { ...wrong, source: 'raw' }, destination],
    [origin, wrong, { ...destination, timestamp: '2025-01-01T10:02:00Z' }],
    [origin, wrong, { ...destination, timestamp: '2025-01-02T12:00:00Z' }],
    [origin, wrong, { ...destination, timestamp: 'invalid' }],
    [origin, wrong, measured('near-oslo', 59.92, 10.71, '2025-01-01T12:00:00Z')],
    [measured('east', 0, 179, '2025-01-01T10:00:00Z'), wrong, measured('west', 0, -150, '2025-01-01T12:00:00Z')],
  ]
  for (const points of cases) {
    const result = buildRouteSegments(points)
    assert.ok(!result.segments.some(segment => segment.points.includes(points[0]) && segment.points.includes(points[2])), 'must not shortcut an unsupported interval')
  }
})

test('plausible semantic stops stay in the route instead of being replaced by a direct estimate', () => {
  const points = [
    measured('oslo', 59.91, 10.70, '2025-01-01T10:00:00Z'),
    inferredVisit('gothenburg', 57.71, 11.97, '2025-01-01T14:00:00Z', '2025-01-01T15:00:00Z'),
    measured('copenhagen', 55.68, 12.57, '2025-01-01T19:00:00Z'),
  ]
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.deepEqual(result.segments[0].points, points)
  assert.equal(result.segments[0].estimated, undefined)
  assert.ok(Math.abs(result.distanceKm - distanceKm(points)) < 1e-9)
})

test('back-to-back semantic recoveries share an anchor without duplicating distance', () => {
  const points = [
    measured('oslo', 59.91, 10.70, '2025-01-01T10:00:00Z'),
    inferredVisit('early-berlin', 52.52, 13.40, '2025-01-01T10:01:00Z', '2025-01-01T12:30:00Z'),
    measured('berlin', 52.52, 13.40, '2025-01-01T12:00:00Z'),
    inferredVisit('early-paris', 48.86, 2.35, '2025-01-01T12:01:00Z', '2025-01-01T14:30:00Z'),
    measured('paris', 48.86, 2.35, '2025-01-01T14:00:00Z'),
  ]
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].estimated, true)
  assert.deepEqual(result.segments[0].points, [points[0], points[2], points[4]])
  assert.ok(Math.abs(result.distanceKm - distanceKm([points[0], points[2], points[4]])) < 1e-9)
})

test('a minor local conflict does not replace a long route and its semantic stops', () => {
  for (const latitude of [59.92, 60.10]) {
    const points = [
      measured('oslo', 59.91, 10.70, '2025-01-01T10:00:00Z'),
      inferredVisit('local-jitter', latitude, 10.70, '2025-01-01T10:00:00Z', '2025-01-01T10:05:00Z'),
      measured('gothenburg', 57.71, 11.97, '2025-01-01T14:00:00Z'),
    ]
    const result = buildRouteSegments(points)
    assert.equal(result.segments.length, 1)
    assert.equal(result.segments[0].estimated, undefined)
    assert.deepEqual(result.segments[0].points, [points[1], points[2]])
  }
})

test('a narrow measured timestamp margin is estimated and never relaxes semantic or local speed checks', () => {
  const departure = measured('oslo', 59.91, 10.70, '2025-01-01T10:00:00Z')
  const berlin = measured('berlin', 52.52, 13.40, '2025-01-01T11:00:00Z')
  const atSpeed = (destination: TimelinePoint, speed: number) => ({
    ...destination,
    timestamp: new Date(Date.parse(departure.timestamp) + Math.ceil(distanceKm([departure, destination]) / speed * 3_600_000)).toISOString(),
  })
  assert.equal(buildRouteSegments([departure, atSpeed(berlin, 1299)]).segments[0].estimated, undefined)
  for (const speed of [1400, 1500]) {
    const points = [departure, atSpeed(berlin, speed)]
    const result = buildRouteSegments(points)
    assert.equal(result.segments.length, 1)
    assert.equal(result.segments[0].estimated, true)
    assert.equal(result.distanceKm, distanceKm(points))
  }
  const rejected = [
    [departure, atSpeed(berlin, 1501)],
    [{ ...departure, source: 'activity' as const }, atSpeed(berlin, 1400)],
    [departure, { ...atSpeed(berlin, 1400), source: 'activity' as const }],
    [departure, atSpeed(measured('local', 60.10, 10.70, '2025-01-01T11:00:00Z'), 1400)],
    [departure, { ...berlin, timestamp: departure.timestamp }],
  ]
  for (const points of rejected) assert.deepEqual(buildRouteSegments(points), { segments: [], distanceKm: 0 })
})

test('contradictory semantic endpoints retain strict speed checks inside a measured timing recovery', () => {
  const points = [
    measured('oslo', 59.909246, 10.708572, '2018-08-12T07:26:00Z'),
    { ...point('stale-endpoint', 59.909246, 10.708572, '2018-08-12T07:45:55Z'), source: 'activity' as const },
    measured('kiel', 54.32127, 10.140469, '2018-08-12T07:53:00Z'),
  ]
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].estimated, true)
  assert.deepEqual(result.segments[0].points, [points[0], points[2]])
  assert.equal(result.distanceKm, distanceKm([points[0], points[2]]))
  assert.deepEqual(buildRouteSegments([points[0], points[2]], points), { segments: [], distanceKm: 0 })

  // The semantic conflict is still detected between 1300 and 1500 km/h; its
  // narrow tolerance belongs only to the measured anchors, never the chain.
  const destination = measured('berlin', 52.52, 13.40, '2025-01-01T12:00:00Z')
  const origin = measured('oslo', 59.91, 10.70, '2025-01-01T10:00:00Z')
  const semanticTime = new Date(Date.parse(destination.timestamp) - Math.floor(distanceKm([origin, destination]) / 1400 * 3_600_000)).toISOString()
  const semantic = { ...origin, id: 'stale-oslo', source: 'activity' as const, timestamp: semanticTime }
  const recovered = buildRouteSegments([origin, semantic, destination])
  assert.equal(recovered.segments[0].estimated, true)
  assert.deepEqual(recovered.segments[0].points, [origin, destination])
})

test('gaps and impossible simultaneous movement do not create lines', () => {
  const cases = [
    [point('a', 59.91, 10.7, '2025-01-01T10:00:00Z'), point('b', 59.92, 10.71, '2025-01-02T10:00:00Z')],
    [point('a', 59.91, 10.7, '2025-01-01T10:00:00Z'), point('b', 59.92, 10.71, '2025-01-01T10:00:00Z')],
    [point('a', 59.91, 10.7, '2025-01-01T10:00:00Z'), point('b', 59.92, 10.71, '2025-01-01T09:59:00Z')],
  ]
  for (const points of cases) assert.deepEqual(buildRouteSegments(points), { segments: [], distanceKm: 0 })
})

test('a plausible Los Angeles to Tokyo flight crosses the date line and counts its distance', () => {
  const origin = point('LAX', 33.94, -118.41, '2025-01-01T18:00:00Z')
  const destination = point('HND', 35.55, 139.78, '2025-01-02T05:30:00Z')
  const result = buildRouteSegments([origin, destination])
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0]?.transport, 'flight')
  assert.ok(result.distanceKm > 8_000 && result.distanceKm < 10_000)
})

test('filtering out another country never connects the two separate visits', () => {
  const points = [
    point('at-1', 46.62, 14.30, '2025-01-01T10:00:00Z'),
    point('at-2', 46.60, 14.30, '2025-01-01T10:10:00Z'),
    point('si', 46.36, 14.30, '2025-01-01T11:00:00Z'),
    point('at-3', 46.60, 14.30, '2025-01-01T12:00:00Z'),
    point('at-4', 46.62, 14.30, '2025-01-01T12:10:00Z'),
  ]
  const result = buildRouteSegments(points.filter(entry => entry.id !== 'si'), points)
  assert.deepEqual(result.segments.map(segment => segment.points.map(entry => entry.id)), [['at-1', 'at-2'], ['at-3', 'at-4']])
  assert.equal(result.distanceKm, distanceKm(points.slice(0, 2)) + distanceKm(points.slice(3)))
})

test('duplicate source IDs and copied points retain occurrence-based adjacency', () => {
  const points = [
    point('same-id', 59.91, 10.70, '2025-01-01T10:00:00Z'),
    point('same-id', 59.92, 10.71, '2025-01-01T10:01:00Z'),
    point('last', 59.93, 10.72, '2025-01-01T10:02:00Z'),
  ]
  assert.equal(buildRouteSegments(points.map(entry => ({ ...entry })), points).segments.length, 1)
  assert.equal(buildRouteSegments([points[0], points[2]], points).segments.length, 0)
})

test('repeated selections reuse source indices without consuming duplicate occurrences', () => {
  const first = point('same', 59.91, 10.70, '2025-01-01T10:00:00Z')
  const duplicate = { ...first }
  const last = point('last', 59.92, 10.71, '2025-01-01T10:01:00Z')
  const points = Object.freeze([first, duplicate, last])
  const initial = buildRouteSegments(points, points)
  buildRouteSegments([last], points)
  assert.deepEqual(buildRouteSegments(points.map(entry => ({ ...entry })), points), initial)
  assert.deepEqual(buildRouteSegments(points, points), initial)
  assert.equal(initial.segments[0].points.length, 3)
  assert.deepEqual(buildRouteSegments([first, last], points).segments, [])
  assert.equal(buildRouteSegments([duplicate, last], points).segments[0].points.length, 2)
})

test('repeated source references and mixed copied observations consume each occurrence once', () => {
  const first = point('same', 59.91, 10.70, '2025-01-01T10:00:00Z')
  const last = point('last', 59.92, 10.71, '2025-01-01T10:01:00Z')
  const points = [first, first, last]
  const initial = buildRouteSegments(points, points)
  assert.equal(initial.segments[0].points.length, 3)
  assert.deepEqual(buildRouteSegments([first, { ...first }, last], points), initial)
  assert.deepEqual(buildRouteSegments([{ ...first }, first, last], points), initial)
  assert.deepEqual(buildRouteSegments(points, points), initial)
})

test('a recorded visit end can anchor a subsequent journey after a multi-day stay', () => {
  const points = [
    { ...point('visit', 59.91, 10.70, '2025-01-01T10:00:00Z'), kind: 'visit' as const, endTimestamp: '2025-01-04T10:00:00Z' },
    point('departure', 59.93, 10.72, '2025-01-04T10:10:00Z'),
  ]
  assert.equal(buildRouteSegments(points).segments.length, 1)
})

test('pointer hits must be near a measured point instead of an arbitrary distant endpoint', () => {
  const points = [point('spain', 40, -3, '2025-01-01T10:00:00Z'), point('colombia', 4, -74, '2025-01-01T10:01:00Z')]
  const project = (entry: TimelinePoint) => entry.id === 'spain' ? { x: 500, y: 100 } : { x: 0, y: 500 }
  assert.equal(nearestPointWithinRadius(points, { x: 250, y: 300 }, project), null)
  assert.equal(nearestPointWithinRadius(points, { x: 493, y: 105 }, project)?.id, 'spain')
  assert.equal(nearestPointWithinRadius(points, { x: 480, y: 100 }, project), null)
})

test('flight styling applies to ordinary flights and long recording gaps, while overnight surface travel stays solid', () => {
  const flights = [
    [point('oslo', 60.19, 11.10, '2025-01-01T08:00:00Z'), point('frankfurt', 50.04, 8.55, '2025-01-01T10:30:00Z')],
    [point('frankfurt', 50.04, 8.55, '2025-01-01T19:00:00Z'), point('shanghai', 31.15, 121.81, '2025-01-02T07:30:00Z')],
  ]
  for (const points of flights) assert.ok(buildRouteSegments(points).segments.every(segment => segment.transport === 'flight'))
  const ferry = [point('oslo', 59.90, 10.74, '2025-01-01T18:00:00Z'), point('copenhagen', 55.70, 12.60, '2025-01-02T08:00:00Z')]
  const result = buildRouteSegments(ferry)
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].estimated, true)
  assert.equal(result.segments[0].transport, undefined)
})

test('canonical flight intervals style short flights and separately recorded path points', () => {
  const points = parseTimeline([
    { startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T11:00:00Z', activity: {
      start: 'geo:59,10', end: 'geo:58,11', topCandidate: { type: 'flying', probability: 0 },
    } },
    { timelinePath: [
      { point: 'geo:58.9,10.1', time: '2025-01-01T10:10:00Z' },
      { point: 'geo:58.1,10.9', time: '2025-01-01T10:50:00Z' },
    ] },
  ])
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].transport, 'flight')
  assert.ok(result.distanceKm < 250)
})

test('plausible surface metadata prevents aircraft-speed inference from stale timestamps', () => {
  const points = parseTimeline([
    { startTime: '2025-01-01T07:45:00Z', endTime: '2025-01-01T12:17:00Z', activity: {
      start: 'geo:59.909246,10.708572', end: 'geo:52.752499,12.855452', topCandidate: { type: 'in passenger vehicle', probability: 0 }, distanceMeters: 886754,
    } },
    { timelinePath: [
      { point: 'geo:59.909246,10.708572', time: '2025-01-01T07:26:00Z' },
      { point: 'geo:54.321270,10.140469', time: '2025-01-01T07:53:00Z' },
    ] },
  ])
  const result = buildRouteSegments(points)
  assert.ok(result.segments.some(segment => segment.estimated))
  assert.ok(result.segments.every(segment => segment.transport !== 'flight'))
})

test('sustained dense flight observations are dashed as a complete run, not only large jumps', () => {
  const points = Array.from({ length: 41 }, (_, index) => ({
    ...point(String(index), 50 + index * .1, 10, new Date(Date.UTC(2025, 0, 1, 10, index)).toISOString()), source: 'timelinePath' as const,
  }))
  const result = buildRouteSegments(points)
  assert.equal(result.segments.length, 1)
  assert.equal(result.segments[0].transport, 'flight')
  assert.equal(result.segments[0].points.length, points.length)
  const shortDrive = buildRouteSegments(points.slice(0, 2))
  assert.equal(shortDrive.segments[0].transport, undefined, 'One brief fast GPS edge is not a flight')
})

test('implausible walking metadata cannot hide a supported long flight', () => {
  const points = parseTimeline({ startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T12:00:00Z', activity: {
    start: 'geo:60.19,11.10', end: 'geo:50.04,8.55', topCandidate: { type: 'walking', probability: 0 },
  } })
  assert.equal(buildRouteSegments(points).segments[0].transport, 'flight')
})
