import assert from 'node:assert/strict'
import test from 'node:test'
import { createPointSpatialIndex, createRouteGeometry, projectLocation, shortestLongitudeRange, worldRectsForBounds, type WorldRect } from '../src/mapSpatial.ts'
import type { TimelinePoint } from '../src/timeline.ts'

const point = (id: string, lat: number, lng: number): TimelinePoint => ({ id, lat, lng, timestamp: '2025-01-01T12:00:00Z', kind: 'path', label: 'Rutepunkt' })
function randomPoints(count: number) {
  let seed = 387
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  return Array.from({ length: count }, (_, index) => point(String(index), random() * 160 - 80, random() * 360 - 180))
}
const allWorld: WorldRect[] = [{ west: 0, east: 1, north: 0, south: 1 }]

test('spatial viewport queries match exact brute force across deterministic rectangles', () => {
  const points = randomPoints(2000)
  const index = createPointSpatialIndex(points)
  for (let iteration = 0; iteration < 20; iteration++) {
    const rect = { west: iteration / 40, east: iteration / 40 + 0.25, north: 0.2, south: 0.65 }
    const expected = points.filter(point => {
      const p = projectLocation(point.lat, point.lng)
      return p.x >= rect.west && p.x <= rect.east && p.y >= rect.north && p.y <= rect.south
    }).map(point => point.id).sort()
    assert.deepEqual(index.query(rect).map(point => point.id).sort(), expected)
  }
})

test('indexed clicks preserve pixel radius and nearest-point result without scanning the world', () => {
  const points = randomPoints(2000)
  const index = createPointSpatialIndex(points)
  const radius = 12 / (256 * 2 ** 4)
  for (let iteration = 0; iteration < 100; iteration++) {
    const anchor = projectLocation(points[iteration]!.lat, points[iteration]!.lng)
    const pointer = { x: anchor.x + radius / 3, y: anchor.y - radius / 4 }
    let expected: TimelinePoint | null = null
    let best = radius * radius
    for (const candidate of points) {
      const p = projectLocation(candidate.lat, candidate.lng)
      const distance = (p.x - pointer.x) ** 2 + (p.y - pointer.y) ** 2
      if (distance <= best) { best = distance; expected = candidate }
    }
    assert.equal(index.nearest(pointer, radius)?.id ?? null, expected?.id ?? null)
  }
  assert.equal(index.nearest({ x: 0.5, y: -1 }, radius), null)
})

test('duplicate display coordinates choose the latest original point and world-wrap clicks stay local', () => {
  const first = point('first', 59, 10)
  const last = point('last', 59, 10)
  const dateline = point('dateline', 0, -179.9)
  const index = createPointSpatialIndex([first, last, dateline])
  assert.equal(index.size, 2)
  assert.equal(index.nearest(projectLocation(59, 10), 0)?.id, 'last')
  assert.equal(index.nearest(projectLocation(0, 180.1), 0.00001)?.id, 'dateline')
  const rects = worldRectsForBounds({ west: 170, east: 190, north: 20, south: -20 })
  assert.equal(rects.length, 2)
  assert.deepEqual(rects.flatMap(rect => index.query(rect)).map(point => point.id), ['dateline'])
})

test('display sampling stays bounded, inside viewport, and only uses original points', () => {
  const points = randomPoints(5000)
  const index = createPointSpatialIndex(points)
  const rect = { west: 0.2, east: 0.8, north: 0.2, south: 0.8 }
  const sampled = index.sample([rect], 0.001, 50)
  assert.equal(sampled.length, 50)
  assert.ok(sampled.every(sample => points.includes(sample)))
  assert.ok(sampled.every(sample => {
    const p = projectLocation(sample.lat, sample.lng)
    return p.x >= rect.west && p.x <= rect.east && p.y >= rect.north && p.y <= rect.south
  }))
  assert.deepEqual(index.sample([rect], 0), [])
  assert.equal(createPointSpatialIndex([]).nearest({ x: 0.5, y: 0.5 }, 1), null)
})

test('zoom simplification preserves segment ends and real corners without synthetic vertices', () => {
  const points = [point('a', 59, 10), point('b', 59.000001, 10.01), point('c', 59, 10.02), point('corner', 59.2, 10.02), point('d', 59.2, 10.1)]
  const second = [point('e', 30, 20), point('f', 30.1, 20.1)]
  const geometry = createRouteGeometry([{ id: 'first', points }, { id: 'second', points: second }])
  const positions = geometry.visible(10, allWorld)
  assert.equal(positions.length, 2)
  assert.deepEqual(positions[0]![0], [points[0]!.lat, points[0]!.lng])
  assert.deepEqual(positions[0]!.at(-1), [points.at(-1)!.lat, points.at(-1)!.lng])
  assert.ok(positions[0]!.some(p => p[0] === 59.2 && p[1] === 10.02))
  assert.ok(positions[0]!.length < points.length)
  assert.ok(positions[0]!.every(p => points.some(source => source.lat === p[0] && source.lng === p[1])))
  assert.equal(geometry.visible(10, allWorld)[0], positions[0], 'Cached arrays are reused on panning')
  assert.deepEqual(geometry.visible(10, [{ west: 0, east: 0.1, north: 0, south: 0.1 }]), [])
  assert.ok(geometry.visible(22, allWorld)[0]!.length >= positions[0]!.length)
})


test('a Pacific route uses nearby world copies and fits around the date line', () => {
  const origin = point('LAX', 33.94, -118.41)
  const destination = point('HND', 35.55, 139.78)
  const points = [origin, destination]
  const [west, east] = shortestLongitudeRange(points, origin.lng, destination.lng)
  assert.equal(west, destination.lng)
  assert.equal(east, origin.lng + 360)

  const geometry = createRouteGeometry([{ id: 'pacific', points, transport: 'flight' }])
  assert.deepEqual(geometry.visible(4, [{ west: 0.85, east: 1.2, north: 0, south: 1 }]), [
    [[origin.lat, origin.lng + 360], [destination.lat, destination.lng]],
  ])
  assert.deepEqual(geometry.visible(4, [{ west: -0.15, east: 0.2, north: 0, south: 1 }]), [
    [[origin.lat, origin.lng], [destination.lat, destination.lng - 360]],
  ])
  assert.deepEqual(geometry.visible(4, [{ west: 0.35, east: 0.65, north: 0, south: 1 }]), [])
})
