import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeTimelineFiles, TimelineMergeError } from '../src/timelineMerge.ts'
import { parseTimeline } from '../src/timeline.ts'

const start = '2025-06-07T08:00:00Z'
const end = '2025-06-07T09:00:00Z'
const pathPoint = (offset: number, longitude: number) => ({ point: `geo:48.86,${longitude}`, durationMinutesOffsetFromStartTime: offset })
const walk = (path: unknown[]) => ({ startTime: start, endTime: end, timelinePath: path })

test('merges overlapping mobile exports and fills missing metadata without changing either input', () => {
  const left = [walk([pathPoint(0, 2.33), pathPoint(20, 2.35)]), { startTime: '2024-01-01T08:00:00Z', visit: { topCandidate: { placeLocation: 'geo:48.86,2.33' } } }]
  const right = [{ ...walk([pathPoint(0, 2.33), pathPoint(10, 2.34), pathPoint(20, 2.35)]), extra: { count: 0, verified: false } }]
  const before = JSON.stringify([left, right])
  const result = mergeTimelineFiles(left, right)
  assert.equal(JSON.stringify([left, right]), before)
  const records = result.data as typeof right
  assert.equal(records.length, 2)
  assert.equal(records[0].startTime, '2024-01-01T08:00:00Z')
  assert.deepEqual(records[1].timelinePath, [pathPoint(0, 2.33), pathPoint(10, 2.34), pathPoint(20, 2.35)])
  assert.deepEqual(records[1].extra, { count: 0, verified: false })
  assert.deepEqual(result.summary, { inputRecords: 3, outputRecords: 2, duplicatesRemoved: 1, conflicts: 0 })
  assert.equal(parseTimeline(result.data).length, 4)
})

test('normalizes property ordering and equivalent time, offset and coordinate representations for matching', () => {
  const left = [walk([pathPoint(0, 2.33)])]
  const right = [{ timelinePath: [{ durationMinutesOffsetFromStartTime: '0', point: '48.860°, 2.330°' }], endTime: '2025-06-07T11:00:00+02:00', startTime: '2025-06-07T10:00:00+02:00' }]
  const { data, summary } = mergeTimelineFiles(left, right)
  assert.deepEqual(data, left)
  assert.equal(summary.duplicatesRemoved, 1)
})

test('retains a missing year as well as new data and deduplicates records within each input', () => {
  const old = { locations: [{ latitudeE7: 488600000, longitudeE7: 23300000, timestamp: '2024-06-07T08:00:00Z' }] }
  const fresh = { latitudeE7: 488700000, longitudeE7: 23400000, timestamp: start }
  const { data, summary } = mergeTimelineFiles(old, { locations: [fresh, fresh] })
  assert.equal((data as { locations: unknown[] }).locations.length, 2)
  assert.equal(summary.duplicatesRemoved, 1)
  assert.deepEqual(parseTimeline(data).map(point => point.timestamp.slice(0, 4)), ['2024', '2025'])
})

test('empty values are filled while false and zero remain meaningful', () => {
  const left = [{ ...walk([]), visit: null, note: '', metadata: {}, confirmed: false, cost: 0 }]
  const right = [{ ...walk([pathPoint(0, 2.33)]), visit: { topCandidate: { placeLocation: 'geo:48.86,2.33' } }, note: 'museum', metadata: { name: 'Paris' }, confirmed: null, cost: '' }]
  const { data, summary } = mergeTimelineFiles(left, right)
  const record = (data as typeof right)[0]
  assert.equal(record.note, 'museum')
  assert.equal(record.confirmed, false)
  assert.equal(record.cost, 0)
  assert.deepEqual(record.metadata, { name: 'Paris' })
  assert.equal(parseTimeline(data).length, 2)
  assert.equal(summary.conflicts, 0)
})

test('an end time can be filled without losing the original visit label or overnight duration', () => {
  const visit = { startTime: start, visit: { topCandidate: { placeLocation: 'geo:48.86,2.33', semanticType: 'Hotel' } } }
  const { data } = mergeTimelineFiles([visit], [{ ...visit, endTime: '2025-06-10T08:00:00Z' }])
  assert.equal((data as unknown[]).length, 1)
  const points = parseTimeline(data)
  assert.equal(points[0].label, 'Hotel')
  assert.equal(points[0].endTimestamp, '2025-06-10T08:00:00.000Z')
})

test('differing nonempty intervals and locations retain both records with a conflict count', () => {
  const first = { startTime: start, endTime: end, visit: { topCandidate: { placeLocation: 'geo:48.86,2.33' } } }
  const second = { ...first, endTime: '2025-06-08T09:00:00Z', visit: { topCandidate: { placeLocation: 'geo:52.5,13.4' } } }
  const result = mergeTimelineFiles([first], [second])
  assert.deepEqual(result.data, [first, second])
  assert.equal(result.summary.conflicts, 1)
  assert.equal(result.summary.duplicatesRemoved, 0)
  assert.deepEqual(mergeTimelineFiles(result.data, [first, second]).data, result.data)
})

test('same-minute path samples retain order when a more complete path fills the middle', () => {
  const a = pathPoint(0, 2.33)
  const b = pathPoint(0, 2.34)
  const c = pathPoint(0, 2.35)
  const { data } = mergeTimelineFiles([walk([a, c])], [walk([a, b, c])])
  assert.deepEqual((data as ReturnType<typeof walk>[])[0].timelinePath, [a, b, c])
  const points = parseTimeline(data)
  assert.deepEqual(points.map(point => point.lng), [2.33, 2.34, 2.35])
  assert.equal(points[1].minutePathLink?.previousId, points[0].id)
  assert.equal(points[2].minutePathLink?.previousId, points[1].id)
})

test('new interleaved path samples remain chronological', () => {
  const a = [pathPoint(0, 2.33), pathPoint(10, 2.34), pathPoint(20, 2.35)]
  const b = [pathPoint(15, 2.345), pathPoint(30, 2.36)]
  const { data } = mergeTimelineFiles([walk(a)], [walk(b)])
  const path = (data as ReturnType<typeof walk>[])[0].timelinePath as ReturnType<typeof pathPoint>[]
  assert.deepEqual(path.map(point => point.durationMinutesOffsetFromStartTime), [0, 10, 15, 20, 30])
})

test('contradictory same-minute path order preserves both original segments', () => {
  const a = pathPoint(0, 2.33)
  const b = pathPoint(0, 2.34)
  const first = walk([a, b])
  const second = walk([b, a])
  const { data, summary } = mergeTimelineFiles([first], [second])
  assert.deepEqual(data, [first, second])
  assert.equal(summary.conflicts, 1)
})

test('different parent start times retain their original relative offsets', () => {
  const a = walk([pathPoint(10, 2.33)])
  const b = { ...walk([pathPoint(10, 2.34)]), startTime: '2025-06-07T08:30:00Z' }
  const { data } = mergeTimelineFiles([a], [b])
  assert.deepEqual(parseTimeline(data).map(point => point.timestamp), ['2025-06-07T08:10:00.000Z', '2025-06-07T08:40:00.000Z'])
})

test('keeps Android rawSignals and profile metadata when combining an iOS array with a wrapped export', () => {
  const first = [walk([pathPoint(0, 2.33)])]
  const second = { semanticSegments: [walk([pathPoint(0, 2.33)])], rawSignals: [{ position: { LatLng: '52.5°, 13.4°', timestamp: '2025-06-08T08:00:00Z' } }], userLocationProfile: { frequentPlaces: [1, 1, 2], known: false } }
  const { data, summary } = mergeTimelineFiles(first, second)
  assert.deepEqual(data, second)
  assert.equal(summary.duplicatesRemoved, 1)
  assert.equal(parseTimeline(data).length, 2)
})

test('merges legacy Takeout locations and semantic activities without losing travel modes', () => {
  const flight = { activitySegment: { startLocation: { latitudeE7: 488600000, longitudeE7: 23300000 }, endLocation: { latitudeE7: 525000000, longitudeE7: 134000000 }, duration: { startTimestamp: start, endTimestamp: end }, activityType: 'FLYING', distance: 800000 } }
  const old = { timelineObjects: [flight] }
  const raw = { latitudeE7: 525000000, longitudeE7: 134000000, timestampMs: String(Date.parse(end)) }
  const fresh = { timelineObjects: [flight], locations: [raw] }
  const result = mergeTimelineFiles(old, fresh)
  assert.deepEqual(result.data, fresh)
  const points = parseTimeline(result.data)
  assert.equal(points.length, 2)
  assert.equal(points[0].activities?.length, 1)
  assert.equal(points[0].activities?.[0].mode, 'flight')
  assert.deepEqual(mergeTimelineFiles(result.data, old).data, result.data)
})

test('conflicting file metadata is retained without archiving and reimporting whole duplicate timelines', () => {
  const segment = walk([pathPoint(0, 2.33)])
  const first = { semanticSegments: [segment], exportDate: 'old', note: { title: 'example' } }
  const second = { semanticSegments: [segment], exportDate: 'new', note: { title: 'example' } }
  const result = mergeTimelineFiles(first, second)
  const data = result.data as { semanticSegments: unknown[]; timelineExplorerMerge: { version: number; sourceMetadata: unknown[] } }
  assert.equal(data.semanticSegments.length, 1)
  assert.deepEqual(data.timelineExplorerMerge.sourceMetadata, [{ exportDate: 'old', note: { title: 'example' } }, { exportDate: 'new', note: { title: 'example' } }])
  assert.equal(parseTimeline(data).length, 1)
  assert.deepEqual(mergeTimelineFiles(data, first).data, data)
  assert.deepEqual(mergeTimelineFiles(data, second).data, data)
})

test('repeated merges of complementary nested records are idempotent after a JSON roundtrip', () => {
  const first = [walk([pathPoint(0, 2.33), pathPoint(20, 2.35)])]
  const second = [{ ...walk([pathPoint(0, 2.33), pathPoint(10, 2.34)]), modeHint: 'walking' }]
  const combined = JSON.parse(JSON.stringify(mergeTimelineFiles(first, second).data))
  assert.deepEqual(mergeTimelineFiles(combined, first).data, combined)
  assert.deepEqual(mergeTimelineFiles(combined, second).data, combined)
})

test('coordinates at the same timestamp are not collapsed into one observation', () => {
  const point = { latitudeE7: 488600000, longitudeE7: 23300000, timestamp: start }
  const result = mergeTimelineFiles({ locations: [point] }, { locations: [{ ...point, longitudeE7: 23400000 }] })
  assert.equal((result.data as { locations: unknown[] }).locations.length, 2)
  assert.equal(parseTimeline(result.data).length, 2)
})

test('accepted empty exports can contribute no records, and unrelated JSON gets an explicit error', () => {
  const valid = [walk([pathPoint(0, 2.33)])]
  assert.deepEqual(mergeTimelineFiles([], valid).data, valid)
  assert.deepEqual(mergeTimelineFiles({ semanticSegments: [] }, { semanticSegments: valid }).data, { semanticSegments: valid })
  for (const invalid of [null, {}, 'text', [1, 2], [{ message: 'unrelated' }], { locations: {} }]) {
    assert.throws(() => mergeTimelineFiles(invalid, valid), TimelineMergeError)
  }
})

test('prototype-named metadata remains inert own data and unknown arrays preserve repeated values', () => {
  const first = JSON.parse('{"semanticSegments":[],"__proto__":{"safe":true},"constructor":{"name":"data"},"pair":[1,1]}')
  const second = { semanticSegments: [walk([pathPoint(0, 2.33)])] }
  const { data } = mergeTimelineFiles(first, second)
  const output = data as Record<string, unknown>
  assert.equal(Object.hasOwn(output, '__proto__'), true)
  assert.deepEqual(output['__proto__'], { safe: true })
  assert.equal(Object.getPrototypeOf(output), Object.prototype)
  assert.deepEqual(output.constructor, { name: 'data' })
  assert.deepEqual(output.pair, [1, 1])
})

test('nested duplicate samples are removed even when the other input is empty or identical', () => {
  const a = pathPoint(0, 2.33)
  const b = pathPoint(0, 2.34)
  const first = [walk([a, a, b, b])]
  for (const other of [[], first]) {
    const { data } = mergeTimelineFiles(first, other)
    assert.deepEqual((data as ReturnType<typeof walk>[])[0].timelinePath, [a, b])
  }
})

test('absolute-time paths without startTime can combine partial overlap', () => {
  const a = { point: 'geo:48.86,2.33', time: start }
  const b = { point: 'geo:48.86,2.34', time: '2025-06-07T08:10:00Z' }
  const c = { point: 'geo:48.86,2.35', time: '2025-06-07T08:20:00Z' }
  const first = [{ timelinePath: [a, b] }]
  const second = [{ timelinePath: [b, c] }]
  const { data } = mergeTimelineFiles(first, second)
  assert.deepEqual(data, [{ timelinePath: [a, b, c] }])
  assert.deepEqual(mergeTimelineFiles(data, first).data, data)
  assert.deepEqual(mergeTimelineFiles(data, second).data, data)
})

test('absolute and offset samples use a common clock when combining paths', () => {
  const a = { point: 'geo:48.86,2.33', time: start }
  const b = pathPoint(5, 2.34)
  const c = pathPoint(10, 2.35)
  const { data } = mergeTimelineFiles([walk([a, c])], [walk([a, b, c])])
  assert.deepEqual((data as ReturnType<typeof walk>[])[0].timelinePath, [a, b, c])
})

test('fills an incomplete raw location or Android position only when its matching location is unambiguous', () => {
  const partial = { timestamp: start, latitudeE7: 488600000, longitudeE7: null, note: 'museum' }
  const full = { timestamp: start, latitudeE7: 488600000, longitudeE7: 23300000 }
  for (const [first, second] of [[partial, full], [full, partial]]) {
    const { data } = mergeTimelineFiles({ locations: [first] }, { locations: [second] })
    assert.deepEqual(data, { locations: [{ ...full, note: 'museum' }] })
  }
  const position = { timestampMs: String(Date.parse(start)), LatLng: '48.86°, 2.33°', accuracy: 5 }
  const result = mergeTimelineFiles({ rawSignals: [{ position: { ...position, LatLng: null } }] }, { rawSignals: [{ position }] })
  assert.deepEqual(result.data, { rawSignals: [{ position }] })
})

test('ambiguous incomplete locations remain separate and repeated merges stay idempotent', () => {
  const partial = { timestamp: start, latitudeE7: 488600000, longitudeE7: null, note: 'unsure' }
  const a = { timestamp: start, latitudeE7: 488600000, longitudeE7: 23300000 }
  const b = { ...a, longitudeE7: 23400000 }
  const first = { locations: [partial] }
  const second = { locations: [a, b] }
  const { data } = mergeTimelineFiles(first, second)
  assert.equal((data as typeof first).locations.length, 3)
  assert.deepEqual(mergeTimelineFiles(data, first).data, data)
  assert.deepEqual(mergeTimelineFiles(data, second).data, data)
})

test('unknown metadata points arrays preserve duplicate primitive data', () => {
  const first = [{ ...walk([pathPoint(0, 2.33)]), custom: { points: [1, 1] } }]
  const { data } = mergeTimelineFiles(first, [])
  assert.deepEqual(data, first)
})

test('invalid calendar strings cannot consume a valid observation through Date normalization', () => {
  const point = { latitudeE7: 488600000, longitudeE7: 23300000 }
  const invalid = { ...point, timestamp: '2025-02-30T08:00:00Z' }
  const valid = { ...point, timestamp: '2025-03-02T08:00:00Z' }
  const { data } = mergeTimelineFiles({ locations: [invalid] }, { locations: [valid] })
  assert.equal(parseTimeline(data).length, 1)
  assert.equal(parseTimeline(data)[0].timestamp, '2025-03-02T08:00:00.000Z')
  assert.equal((data as { locations: unknown[] }).locations.length, 2)
})

test('prototype-named fields also merge as own fields inside shared records', () => {
  const first = [walk([pathPoint(0, 2.33)])]
  const second = [{ ...first[0], custom: JSON.parse('{"__proto__":{"safe":true},"constructor":"museum","toString":0}') }]
  const { data } = mergeTimelineFiles(first, second)
  assert.deepEqual(data, second)
  const next = [{ ...first[0], custom: JSON.parse('{"__proto__":{"extra":false},"constructor":"museum","toString":0}') }]
  const result = mergeTimelineFiles(data, next).data as typeof second
  assert.deepEqual(result[0].custom.__proto__, { safe: true, extra: false })
  assert.equal(Object.getPrototypeOf(result[0].custom), Object.prototype)
})

test('a bridging absolute path coalesces every overlapping container in the first merge', () => {
  const p = (minute: number) => ({ point: `geo:48.86,${2.33 + minute / 100}`, time: `2025-06-07T08:0${minute}:00Z` })
  for (const metadata of [{}, { description: 'walk' }]) {
    const first = [{ ...metadata, timelinePath: [p(1), p(2)] }, { ...metadata, timelinePath: [p(4), p(5)] }]
    const second = [{ ...metadata, timelinePath: [p(2), p(3), p(4)] }]
    const { data } = mergeTimelineFiles(first, second)
    assert.deepEqual(data, [{ ...metadata, timelinePath: [p(1), p(2), p(3), p(4), p(5)] }])
    assert.deepEqual(mergeTimelineFiles(data, first).data, data)
    assert.deepEqual(mergeTimelineFiles(data, second).data, data)
  }
})

test('a bridge spanning many independent path fragments is complete after one merge', () => {
  const p = (minute: number) => ({ point: `geo:48.86,${2.33 + minute / 1000}`, time: new Date(Date.parse(start) + minute * 60000).toISOString() })
  const first = Array.from({ length: 40 }, (_, index) => ({ description: null, timelinePath: [p(index * 3), p(index * 3 + 1)] }))
  const second = [{ description: 'walk', timelinePath: Array.from({ length: 40 }, (_, index) => [p(index * 3 + 1), p(index * 3 + 2)]).flat() }]
  const { data } = mergeTimelineFiles(first, second)
  assert.equal((data as unknown[]).length, 1)
  assert.equal((data as typeof second)[0].timelinePath.length, 120)
  assert.deepEqual(mergeTimelineFiles(data, first).data, data)
  assert.deepEqual(mergeTimelineFiles(data, second).data, data)
})
