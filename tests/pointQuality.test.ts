import assert from 'node:assert/strict'
import test from 'node:test'
import { analysePointQuality } from '../src/pointQuality.ts'
import type { TimelinePoint } from '../src/timeline.ts'

function point(id: string, timestamp: string, lat = 59.74, lng = 10.36): TimelinePoint {
  return { id, timestamp, lat, lng, kind: 'path', label: 'Rutepunkt' }
}

test('flags a distant instantaneous excursion while preserving the source objects for inspection', () => {
  const points = [
    point('before', '2025-01-01T11:03:00Z'),
    point('suspect', '2025-01-01T11:05:00Z', 4.73, -74.03),
    point('after', '2025-01-01T11:05:00Z', 59.74, 10.35),
    point('later', '2025-01-01T11:06:00Z'),
  ]
  const result = analysePointQuality(points)
  assert.deepEqual(result.points.map(point => point.id), ['before', 'after', 'later'])
  assert.equal(result.excluded[0]?.point, points[1])
  assert.equal(result.excluded[0]?.reason, 'implausible-excursion')
  assert.equal(result.excluded[0]?.previousPointId, 'before')
  assert.equal(result.excluded[0]?.nextPointId, 'after')
  assert.equal(points.length, 4, 'Source array must stay intact')
})

test('handles a short cluster of repeated faraway fixes', () => {
  const result = analysePointQuality([
    point('before', '2025-01-01T11:00:00Z'),
    point('bad-1', '2025-01-01T11:01:00Z', 4.73, -74.03),
    { ...point('bad-2', '2025-01-01T11:01:00Z', 4.731, -74.031), kind: 'visit' },
    point('bad-3', '2025-01-01T11:02:00Z', 4.732, -74.032),
    point('after', '2025-01-01T11:03:00Z'),
  ])
  assert.deepEqual(result.excluded.map(entry => entry.point.id), ['bad-1', 'bad-2', 'bad-3'])
})

test('keeps real intercontinental flights and destination visits', () => {
  const result = analysePointQuality([
    point('norway', '2025-01-01T06:00:00Z'),
    { ...point('colombia', '2025-01-01T18:00:00Z', 4.73, -74.03), kind: 'visit', endTimestamp: '2025-01-08T12:00:00Z' },
    point('return', '2025-01-09T06:00:00Z'),
  ])
  assert.equal(result.excluded.length, 0)
  assert.equal(result.points.length, 3)
})

test('does not reject a faraway recorded stay on conflicting nearby timestamps alone', () => {
  const result = analysePointQuality([
    point('before', '2025-01-01T11:00:00Z'),
    { ...point('stay', '2025-01-01T11:01:00Z', 4.73, -74.03), kind: 'visit', endTimestamp: '2025-01-04T12:00:00Z' },
    point('after', '2025-01-01T11:02:00Z'),
  ])
  assert.equal(result.excluded.length, 0, 'A conflicting long stay needs review, not automatic suppression')
})

test('preserves ambiguous one-way jumps and dataset endpoints', () => {
  for (const points of [
    [point('a', '2025-01-01T11:00:00Z'), point('b', '2025-01-01T11:01:00Z', 4.73, -74.03)],
    [point('a', '2025-01-01T11:00:00Z', 4.73, -74.03), point('b', '2025-01-01T11:01:00Z'), point('c', '2025-01-01T11:02:00Z')],
    [point('a', '2025-01-01T11:00:00Z'), point('b', '2025-01-01T11:01:00Z', 4.73, -74.03), point('c', '2025-01-02T11:02:00Z', 4.74, -74.04)],
  ]) assert.equal(analysePointQuality(points).excluded.length, 0)
})

test('retains a cluster with a recorded visit extending past the proposed return anchor', () => {
  const result = analysePointQuality([
    point('before', '2025-01-01T11:00:00Z'),
    { ...point('stay', '2025-01-01T11:01:00Z', 4.73, -74.03), kind: 'visit', endTimestamp: '2025-01-01T11:30:00Z' },
    point('same-place', '2025-01-01T11:02:00Z', 4.731, -74.031),
    point('after', '2025-01-01T11:03:00Z'),
  ])
  assert.equal(result.excluded.length, 0)
})

test('keeps local GPS jitter, ordinary road travel, and plausible long-distance short visits', () => {
  const nearby = analysePointQuality([
    point('a', '2025-01-01T11:00:00Z'),
    point('b', '2025-01-01T11:00:01Z', 59.741, 10.361),
    point('c', '2025-01-01T11:00:02Z'),
  ])
  assert.equal(nearby.excluded.length, 0)
  const flight = analysePointQuality([
    point('a', '2025-01-01T00:00:00Z'),
    point('b', '2025-01-01T11:00:00Z', 4.73, -74.03),
    point('c', '2025-01-01T22:00:00Z'),
  ])
  assert.equal(flight.excluded.length, 0)
})

test('does not use an implausible bridge as proof that the middle point is wrong', () => {
  const result = analysePointQuality([
    point('norway', '2025-01-01T11:00:00Z'),
    point('colombia', '2025-01-01T11:01:00Z', 4.73, -74.03),
    point('spain', '2025-01-01T11:02:00Z', 40.42, -3.7),
  ])
  assert.equal(result.excluded.length, 0)
})
