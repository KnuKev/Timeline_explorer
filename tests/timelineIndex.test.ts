import assert from 'node:assert/strict'
import test from 'node:test'
import type { TimelinePoint } from '../src/timeline.ts'
import { pointDateKeys } from '../src/pointDates.ts'
import { adjacentRecordedDay, groupTimelineSelection, prepareTimeline, selectTimelineRange } from '../src/timelineIndex.ts'

const point = (id: string, timestamp: string, lat = 59.74, lng = 10.36): TimelinePoint => ({ id, timestamp, lat, lng, kind: 'path', label: 'Rutepunkt' })

test('indexed date selection matches location-local calendar dates and visit intervals', () => {
  const points: TimelinePoint[] = [
    { ...point('stay', '2025-01-01T10:00:00Z', 28.46, -16.25), kind: 'visit', endTimestamp: '2025-01-04T00:00:00Z' },
    point('tenerife', '2025-01-01T23:30:00Z', 28.46, -16.25),
    point('austria', '2025-01-01T23:30:00Z', 46.62, 14.3),
    point('later', '2025-01-03T12:00:00Z', 46.62, 14.3),
  ]
  const dataset = prepareTimeline(points)
  for (const [from, to] of [['2025-01-01', '2025-01-01'], ['2025-01-02', '2025-01-02'], ['2025-01-01', '2025-01-04'], ['2025-01-04', '2025-01-05']]) {
    const expected = points.filter(observation => pointDateKeys(observation).some(day => day >= from! && day <= to!))
    assert.deepEqual(selectTimelineRange(dataset, from!, to!, true), expected)
  }
  assert.deepEqual(selectTimelineRange(dataset, '', '2025-01-02'), [])
  assert.deepEqual(selectTimelineRange(dataset, '2025-01-03', '2025-01-02'), [])
})

test('multi-day visits occur once in a range but appear in every covered day group', () => {
  const visit: TimelinePoint = { ...point('visit', '2025-01-01T10:00:00Z'), kind: 'visit', endTimestamp: '2025-01-03T23:00:00Z' }
  const dataset = prepareTimeline([visit])
  const selection = selectTimelineRange(dataset, '2025-01-01', '2025-01-03')
  assert.deepEqual(selection, [visit])
  const groups = groupTimelineSelection(dataset, selection, '2025-01-02', '2025-01-03')
  assert.deepEqual(groups.map(group => group.day), ['2025-01-02', '2025-01-03'])
  assert.ok(groups.every(group => group.points.length === 1 && group.points[0] === visit))
  assert.equal(dataset.days.find(day => day.day === '2025-01-04'), undefined)
})

test('suspected-point filtering matches clean counts and can be reversed', () => {
  const points = [
    point('before', '2025-01-01T23:58:00Z'),
    point('suspect', '2025-01-01T23:59:00Z', 4.73, -74.03),
    point('after', '2025-01-01T23:59:00Z'),
  ]
  const dataset = prepareTimeline(points)
  assert.equal(dataset.excluded.length, 1)
  assert.deepEqual(dataset.days.map(day => [day.day, day.cleanCount]), [['2025-01-01', 0], ['2025-01-02', 2]])
  assert.deepEqual(selectTimelineRange(dataset, '2025-01-01', '2025-01-02').map(observation => observation.id), ['before', 'after'])
  assert.deepEqual(selectTimelineRange(dataset, '2025-01-01', '2025-01-02', true), points)
  assert.deepEqual(groupTimelineSelection(dataset, dataset.cleanPoints).map(group => group.day), ['2025-01-02'])
})

test('day navigation skips gaps and works when the selected calendar day has no records', () => {
  const days = ['2025-01-01', '2025-01-04', '2025-01-10']
  assert.equal(adjacentRecordedDay(days, '2025-01-04', -1), '2025-01-01')
  assert.equal(adjacentRecordedDay(days, '2025-01-04', 1), '2025-01-10')
  assert.equal(adjacentRecordedDay(days, '2025-01-07', -1), '2025-01-04')
  assert.equal(adjacentRecordedDay(days, '2025-01-07', 1), '2025-01-10')
  assert.equal(adjacentRecordedDay(days, '2025-01-01', -1), undefined)
  assert.equal(adjacentRecordedDay(days, '2025-01-10', 1), undefined)
  assert.equal(adjacentRecordedDay([], '2025-01-01', 1), undefined)
})

test('worker-style transfer preserves shared point identities and usable typed day indices', () => {
  const dataset = prepareTimeline([point('first', '2025-01-01T12:00:00Z'), point('second', '2025-01-02T12:00:00Z')])
  const received = structuredClone(dataset, { transfer: dataset.days.map(day => day.indices.buffer as ArrayBuffer) })
  assert.ok(received.days[0]!.indices instanceof Uint32Array)
  assert.equal(received.cleanPoints[0], received.points[0])
  assert.equal(selectTimelineRange(received, '2025-01-01', '2025-01-01')[0], received.points[0])
  assert.equal(dataset.days[0]!.indices.byteLength, 0)
})
