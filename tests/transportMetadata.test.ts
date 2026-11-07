import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTimeline } from '../src/timeline.ts'

const startTime = '2025-05-01T08:00:00Z'
const endTime = '2025-05-01T09:00:00Z'
const modern = (type: unknown = 'IN_TRAIN', probability?: unknown) => ({ startTime, endTime,
  activity: { start: 'geo:59,10', end: 'geo:59.1,10.1', distanceMeters: 25000,
    topCandidate: { type, probability }, candidates: [{ type: 'FLYING', probability: 1 }] } })
const legacy = (properties: Record<string, unknown> = {}) => ({ activitySegment: {
  startLocation: { latE7: 590000000, lngE7: 100000000 }, endLocation: { latE7: 591000000, lngE7: 101000000 },
  duration: { startTimestamp: startTime, endTimestamp: endTime },
  activityType: 'IN_BUS', distance: 25000, ...properties,
} })
const activityFrom = (input: unknown) => parseTimeline(input)[0]?.activities?.[0]

test('mobile transport metadata preserves the original selected subtype, times, distance and probability on both endpoints', () => {
  const record = modern('in_Subway', '0.87')
  for (const input of [[record], { semanticSegments: [record] }]) {
    const points = parseTimeline(input)
    assert.equal(points.length, 2)
    const activity = points[0]!.activities![0]!
    assert.equal(activity.mode, 'rail')
    assert.equal(activity.sourceType, 'in_Subway')
    assert.equal(activity.confidence, 0.87)
    assert.equal(activity.confidenceLevel, undefined)
    assert.equal(activity.startTimestamp, '2025-05-01T08:00:00.000Z')
    assert.equal(activity.endTimestamp, '2025-05-01T09:00:00.000Z')
    assert.equal(activity.distanceKm, 25)
    assert.equal(points[1]!.activities![0], activity)
    assert.equal(points[0]!.activities!.length, 1, 'Alternative labels must not become selected activities')
  }
})

test('mobile probabilities retain zero and low values without accepting percentages or malformed scores', () => {
  for (const [raw, expected] of [[0, 0], ['0.000000', 0], [0.2, 0.2], [1, 1]] as const) {
    assert.equal(activityFrom(modern('FLYING', raw))?.confidence, expected)
    assert.equal(activityFrom(modern('FLYING', raw))?.mode, 'flight', 'Confidence must not change the existing route mode')
  }
  for (const raw of [undefined, null, '', ' ', false, true, {}, [], NaN, Infinity, 'Infinity', -0.1, 1.1, 95, 'HIGH']) {
    const activity = activityFrom(modern('FLYING', raw))!
    assert.equal(activity.confidence, undefined, `Reject ${String(raw)}`)
    assert.equal(activity.confidenceLevel, undefined)
    assert.equal(activity.sourceType, 'FLYING')
  }
})

test('fallback activity types never borrow confidence from a top candidate without its own selected type', () => {
  const record = modern(undefined, 0.99)
  record.activity.topCandidate.type = undefined
  const input = { ...record, activity: { ...record.activity, activityType: 'IN_BUS' } }
  const activity = activityFrom(input)!
  assert.equal(activity.sourceType, 'IN_BUS')
  assert.equal(activity.mode, 'road')
  assert.equal(activity.confidence, undefined)
})

test('legacy probabilities use only matching selected labels and convert the legacy percentage scale', () => {
  for (const [raw, expected] of [[0, 0], [1, 0.01], ['72.5', 0.725], [100, 1]] as const) {
    const activity = activityFrom(legacy({ activities: [
      { activityType: 'IN_TRAIN', probability: 100 },
      { activityType: 'inBus', probability: raw },
    ] }))!
    assert.equal(activity.mode, 'road')
    assert.equal(activity.sourceType, 'IN_BUS')
    assert.equal(activity.confidence, expected)
  }
  const alternative = activityFrom(legacy({ activities: [{ activityType: 'IN_PASSENGER_VEHICLE', probability: 100 }] }))!
  assert.equal(alternative.confidence, undefined, 'A different subtype in the same broad transport group is still an alternative')
  for (const probability of [undefined, null, false, '', NaN, Infinity, 'Infinity', -1, 101]) {
    assert.equal(activityFrom(legacy({ activities: [{ activityType: 'IN_BUS', probability }] }))?.confidence, undefined)
  }
  assert.equal(activityFrom(legacy({ activities: [
    { activityType: 'IN_BUS', probability: 95 }, { activityType: 'IN_BUS', probability: 15 },
  ] }))?.confidence, 0.15, 'Conflicting duplicate scores retain the conservative value')
})

test('legacy qualitative confidence stays separate from numeric probabilities and is not inferred when absent', () => {
  for (const [confidence, expected] of [['LOW', 'low'], ['MEDIUM', 'medium'], [' high ', 'high']] as const) {
    const activity = activityFrom(legacy({ confidence }))!
    assert.equal(activity.confidenceLevel, expected)
    assert.equal(activity.confidence, undefined, 'Do not invent a numeric probability from a qualitative grade')
  }
  for (const confidence of [undefined, null, false, 1, 'UNKNOWN', '']) {
    assert.equal(activityFrom(legacy({ confidence }))?.confidenceLevel, undefined)
  }
  const conflicting = activityFrom(legacy({ confidence: 'HIGH', activities: [{ activityType: 'IN_BUS', probability: 0 }] }))!
  assert.equal(conflicting.confidenceLevel, 'high')
  assert.equal(conflicting.confidence, 0, 'Consumers must be able to see both signals when they disagree')
})

test('unknown modes still retain their coordinate anchors and do not promote alternatives', () => {
  const points = parseTimeline(modern('UNRECOGNIZED_MODE', 0.99))
  assert.equal(points.length, 2)
  assert.ok(points.every(point => point.activities === undefined))
  assert.deepEqual(points.map(point => [point.lat, point.lng]), [[59, 10], [59.1, 10.1]])
})

const olderMobile = () => ({ startTime, endTime, activity: {
  start: 'geo:59,10', end: 'geo:59.1,10.1', distanceMeters: '25000.000000',
  topCandidate: { type: 'in train', probability: '0.000000' },
} })

test('older mobile placeholder scores retain the raw zero with an unavailable marker through merged wrappers', () => {
  const record = olderMobile()
  const original = structuredClone(record)
  for (const input of [[record], { semanticSegments: [record] }, { timelineObjects: [record] }]) {
    const points = parseTimeline(input)
    assert.equal(points.length, 2)
    const activity = points[0]!.activities![0]!
    assert.equal(activity.mode, 'rail')
    assert.equal(activity.sourceType, 'in train')
    assert.equal(activity.confidence, 0, 'Keep the original score available for inspection')
    assert.equal(activity.confidenceUnavailable, true, 'The known old representation carries no usable confidence score')
    assert.equal(activity.confidenceLevel, undefined, 'Unavailable must never become high confidence')
    assert.equal(points[1]!.activities![0], activity)
  }
  assert.deepEqual(record, original)
})

test('explicit modern zero scores and positive older scores never receive the placeholder exemption', () => {
  for (const overall of [0, '0.998157', null, undefined]) {
    const record = olderMobile()
    const activity = activityFrom({ ...record, activity: { ...record.activity, probability: overall } })!
    assert.equal(activity.confidence, 0)
    assert.equal(activity.confidenceUnavailable, undefined, 'An explicit activity.probability field identifies the newer representation')
  }
  for (const score of ['0.200000', '0.950000']) {
    const record = olderMobile()
    record.activity.topCandidate.probability = score
    const activity = activityFrom(record)!
    assert.equal(activity.confidence, Number(score))
    assert.equal(activity.confidenceUnavailable, undefined)
  }
  const legacyZero = activityFrom(legacy({ activities: [{ activityType: 'IN_BUS', probability: 0 }] }))!
  assert.equal(legacyZero.confidence, 0)
  assert.equal(legacyZero.confidenceUnavailable, undefined, 'The exception is not for Takeout candidate probabilities')
})

test('the unavailable marker requires the complete old mobile field fingerprint', () => {
  const variations: Array<(record: ReturnType<typeof olderMobile>) => unknown> = [
    record => ({ ...record, activity: { ...record.activity, topCandidate: { ...record.activity.topCandidate, probability: 0 } } }),
    ...['0', '0.00000'].map(score => (record: ReturnType<typeof olderMobile>) => ({ ...record, activity: { ...record.activity, topCandidate: { ...record.activity.topCandidate, probability: score } } })),
    ...['IN_TRAIN', 'in_train'].map(type => (record: ReturnType<typeof olderMobile>) => ({ ...record, activity: { ...record.activity, topCandidate: { ...record.activity.topCandidate, type } } })),
    ...[25000, '25000', '-25000.000000', 'Infinity', '9'.repeat(400) + '.000000'].map(distanceMeters => (record: ReturnType<typeof olderMobile>) => ({ ...record, activity: { ...record.activity, distanceMeters } })),
    record => ({ ...record, activity: { ...record.activity, start: { latitudeE7: 590000000, longitudeE7: 100000000 } } }),
    record => ({ ...record, activity: { ...record.activity, end: { latitudeE7: 591000000, longitudeE7: 101000000 } } }),
  ]
  for (const variation of variations) {
    const activity = activityFrom(variation(olderMobile()))!
    assert.ok(activity, 'The fixture should still retain a selected activity')
    assert.equal(activity.confidenceUnavailable, undefined)
  }
})
