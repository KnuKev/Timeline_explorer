import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTimeline } from '../src/timeline.ts'

test('keeps iOS geo paths and computes offsets before chronological sorting', () => {
  const points = parseTimeline([
    { startTime: '2025-01-20T11:00:00+01:00', timelinePath: [
      { point: 'geo:28.2916,-16.6291', durationMinutesOffsetFromStartTime: '45' },
      { point: 'geo:28.4636,-16.2518', durationMinutesOffsetFromStartTime: 0 },
    ] },
  ])
  assert.equal(points.length, 2)
  assert.deepEqual(points.map((point) => point.timestamp), ['2025-01-20T10:00:00.000Z', '2025-01-20T10:45:00.000Z'])
  assert.deepEqual(points.map((point) => point.lat), [28.4636, 28.2916])
  assert.ok(points.every(point => point.source === 'timelinePath'))
})

test('reads Android degree coordinates, absolute path times, and full recorded visit intervals', () => {
  const points = parseTimeline({ semanticSegments: [
    {
      startTime: '2025-01-15T09:00:00Z', endTime: '2025-01-18T10:00:00Z',
      visit: { topCandidate: { placeLocation: { latLng: '28.2916°, -16.6291°' }, semanticType: 'Unknown' } },
    },
    { timelinePath: [
      { point: '28.4636°, -16.2518°', time: '2025-01-19T15:00:00Z' },
    ] },
  ] })
  assert.equal(points.length, 2)
  assert.equal(points[0].kind, 'visit')
  assert.equal(points[0].endTimestamp, '2025-01-18T10:00:00.000Z')
  assert.equal(points[0].label, 'Besøkt sted')
  assert.equal(points[1].timestamp, '2025-01-19T15:00:00.000Z')
})

test('imports Austria journeys represented only as activity endpoints', () => {
  const points = parseTimeline({ semanticSegments: [
    {
      startTime: '2024-07-03T08:00:00+02:00', endTime: '2024-07-03T10:00:00+02:00',
      activity: {
        start: { latLng: '46.6247°, 14.3053°' },
        end: { latLng: '47.2197°, 14.7647°' },
      },
    },
    {
      startTime: '2024-07-03T15:00:00+02:00', endTime: '2024-07-03T17:00:00+02:00',
      activity: { start: 'geo:47.2197,14.7647', end: 'geo:46.6247,14.3053' },
    },
  ] })
  assert.equal(points.length, 4)
  assert.deepEqual(points.map((point) => point.lat), [46.6247, 47.2197, 47.2197, 46.6247])
  assert.ok(points.every((point) => point.kind === 'path' && !point.endTimestamp))
  assert.ok(points.every(point => point.source === 'activity'))
})

test('reads legacy Takeout visits, activity endpoints, and dated raw E7 locations', () => {
  const points = parseTimeline({ timelineObjects: [
    { placeVisit: {
      location: { latitudeE7: 466247000, longitudeE7: 143053000, name: 'Klagenfurt' },
      duration: { startTimestampMs: '1719990000000', endTimestampMs: '1719993600000' },
    } },
    { activitySegment: {
      startLocation: { latitudeE7: 466247000, longitudeE7: 143053000 },
      endLocation: { latitudeE7: 472197000, longitudeE7: 147647000 },
      duration: { startTimestamp: '2024-07-03T10:00:00Z', endTimestamp: '2024-07-03T12:00:00Z' },
      simplifiedRawPath: { points: [{ latE7: 470000000, lngE7: 145000000, timestamp: '2024-07-03T11:00:00Z' }] },
      waypointPath: { waypoints: [{ latE7: 471000000, lngE7: 146000000 }] },
    } },
  ], locations: [
    { latitudeE7: 284636000, longitudeE7: -162518000, timestampMs: '1737370800000' },
  ] })
  assert.equal(points.length, 5)
  const visit = points.find((point) => point.kind === 'visit')!
  assert.equal(visit.label, 'Klagenfurt')
  assert.equal(visit.endTimestamp, new Date(1719993600000).toISOString())
  assert.ok(points.some((point) => point.lat === 47 && point.lng === 14.5))
  assert.ok(!points.some((point) => point.lat === 47.1))
})

test('reads Android raw positions without duplicating equivalent path measurements', () => {
  const points = parseTimeline({
    semanticSegments: [{ timelinePath: [{ point: '28.2916°, -16.6291°', time: '2025-01-15T10:00:00Z' }] }],
    rawSignals: [
      { position: { LatLng: '28.2916°, -16.6291°', timestamp: '2025-01-15T10:00:00Z' } },
      { position: { LatLng: '28.3°, -16.6°', timestamp: '2025-01-15T11:00:00Z' } },
    ],
  })
  assert.equal(points.length, 2)
  assert.equal(new Set(points.map((point) => point.id)).size, 2)
  assert.deepEqual(points.map(point => point.source), ['timelinePath', 'raw'])
})

test('duplicate endpoints retain measured provenance regardless of import order', () => {
  const startTime = '2025-01-15T10:00:00Z'
  const semantic = { startTime, endTime: '2025-01-15T11:00:00Z', activity: { start: 'geo:59,10', end: 'geo:59.1,10.1' } }
  const measured = { timelinePath: [{ point: 'geo:59,10', time: startTime }] }
  for (const records of [[semantic, measured], [measured, semantic]]) {
    const points = parseTimeline(records)
    assert.equal(points.length, 2)
    assert.equal(points[0].source, 'timelinePath')
    assert.equal(points[1].source, 'activity')
  }
  const raw = { latitudeE7: 590000000, longitudeE7: 100000000, timestamp: startTime }
  assert.equal(parseTimeline([semantic, raw])[0].source, 'raw')
})

test('malformed offsets and coordinates do not abort valid records or invent midnight points', () => {
  const points = parseTimeline({ semanticSegments: [
    { startTime: '2025-01-15T10:00:00Z', timelinePath: [
      { point: 'geo:28,-16', durationMinutesOffsetFromStartTime: '1e300' },
      { point: 'geo:28,-16', durationMinutesOffsetFromStartTime: 'unknown' },
      { point: 'geo:28,-16' },
      { point: 'geo:91,-16', durationMinutesOffsetFromStartTime: 10 },
      { point: 'geo:28,-16', durationMinutesOffsetFromStartTime: 20 },
    ] },
  ], locations: [
    { latitudeE7: null, longitudeE7: null, timestamp: '2025-01-15T10:00:00Z' },
    { latitudeE7: '', longitudeE7: false, timestamp: '2025-01-15T10:00:00Z' },
    { latitudeE7: 280000000, longitudeE7: -160000000, timestampMs: '1e300' },
  ] })
  assert.equal(points.length, 1)
  assert.equal(points[0].timestamp, '2025-01-15T10:20:00.000Z')
})

test('ignores reversed visit intervals while retaining valid start coordinates', () => {
  const points = parseTimeline({
    startTime: '2025-01-20T10:00:00Z', endTime: '2025-01-15T10:00:00Z',
    visit: { topCandidate: { placeLocation: 'geo:28.2916,-16.6291', semanticType: 'Home' } },
  })
  assert.equal(points.length, 1)
  assert.equal(points[0].label, 'Home')
  assert.equal(points[0].endTimestamp, undefined)
})

test('rejects invalid calendar dates and ambiguous timestamp strings', () => {
  const points = parseTimeline({ locations: [
    '1', '2025-02-30T10:00:00Z', '2025-13-01T00:00:00Z', '2025-01-01', '2024-02-29T10:00:00+01:00',
  ].map((timestamp) => ({ latitudeE7: 280000000, longitudeE7: -160000000, timestamp })) })
  assert.equal(points.length, 1)
  assert.equal(points[0].timestamp, '2024-02-29T09:00:00.000Z')
})

test('preserves the selected transport activity, including legacy zero probabilities, without importing alternatives', () => {
  const points = parseTimeline([
    { startTime: '2025-01-01T10:00:00Z', endTime: '2025-01-01T11:00:00Z', activity: {
      start: 'geo:59,10', end: 'geo:58,11', distanceMeters: 130000,
      topCandidate: { type: 'flying', probability: '0.000000' },
      candidates: [{ type: 'walking', probability: 0.9 }],
    } },
    { timelinePath: [{ point: 'geo:59,10', time: '2025-01-01T10:00:00Z' }] },
    { activitySegment: { startLocation: { latE7: 580000000, lngE7: 110000000 }, endLocation: { latE7: 579000000, lngE7: 111000000 },
      duration: { startTimestamp: '2025-01-01T12:00:00Z', endTimestamp: '2025-01-01T13:00:00Z' }, activityType: 'IN_FERRY', distance: 15000,
      activities: [{ activityType: 'FLYING', probability: 100 }],
    } },
  ])
  assert.equal(points.length, 4)
  assert.equal(points[0].source, 'timelinePath')
  assert.equal(points[0].activities?.[0]?.mode, 'flight')
  assert.equal(points[1].activities?.[0], points[0].activities?.[0])
  assert.equal(points[2].activities?.[0]?.mode, 'ferry')
  assert.equal(points[3].activities?.[0]?.mode, 'ferry')
})
