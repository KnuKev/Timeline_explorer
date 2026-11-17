import assert from 'node:assert/strict'
import test from 'node:test'
import { globeCountries, globePoints, globeRoutes } from '../src/globeGeometry.ts'
import { createPointSpatialIndex, worldRectsForBounds } from '../src/mapSpatial.ts'
import type { TimelinePoint } from '../src/timeline.ts'

function point(id: string, lng: number, lat: number): TimelinePoint {
  return { id, lng, lat, kind: 'path', label: '', timestamp: '2025-01-01T12:00:00Z' }
}

test('the globe splits routes at the dateline without drawing around the world', () => {
  const route = { id: 'seam', points: [point('a', 179, 45), point('b', -179, 46)] }
  const lines = globeRoutes([route]).features.map(feature => feature.geometry.coordinates)
  assert.deepEqual(lines, [[[179, 45], [180, 45.5]], [[-180, 45.5], [-179, 46]]])
})

test('an LA to Tokyo flight takes the North Pacific arc and stays split at the dateline', () => {
  const route = { id: 'flight', transport: 'flight' as const, points: [point('la', -118.41, 33.94), point('tokyo', 139.78, 35.55)] }
  const features = globeRoutes([route]).features
  assert.equal(features.length, 2)
  const coordinates = features.flatMap(feature => {
    assert.equal(feature.properties?.flight, true)
    const line = feature.geometry.coordinates
    assert(line.every((position, index) => index === 0 || Math.abs(position[0]! - line[index - 1]![0]!) <= 180))
    return line
  })
  assert(coordinates.some(position => position[1]! > 45))
  assert.deepEqual(coordinates[0], [-118.41, 33.94])
  assert.deepEqual(coordinates.at(-1), [139.78, 35.55])
})

test('globe viewport sampling retains local observation IDs across the date line', () => {
  const distant = Array.from({ length: 24_001 }, (_, index) => point(String(index), 10, 30))
  const points = [...distant, point('west', 179.99, 40), point('east', -179.99, 40)]
  const index = createPointSpatialIndex(points)
  const rects = worldRectsForBounds({ west: 179.9, east: 180.1, north: 40.1, south: 39.9 })
  const data = globePoints(index.sample(rects, 5 / (512 * 2 ** 12)))
  assert.deepEqual(data.features.map(feature => feature.properties?.id).sort(), ['east', 'west'])
})

test('land crossing the dateline is split into closed polygons along the seam', () => {
  const map = globeCountries({ type: 'FeatureCollection', features: [{
    type: 'Feature', properties: {}, geometry: {
      type: 'Polygon', coordinates: [[[179, 64], [-179, 64], [-179, 66], [179, 66], [179, 64]]],
    },
  }] })
  const geometry = map.features[0]?.geometry
  assert.equal(geometry?.type, 'MultiPolygon')
  if (geometry.type !== 'MultiPolygon') return
  assert.equal(geometry.coordinates.length, 2)
  for (const [ring] of geometry.coordinates) {
    assert.deepEqual(ring?.[0], ring?.at(-1))
    assert(ring?.every(([lng], index) => index === 0 || Math.abs(lng! - ring[index - 1]![0]!) <= 2))
  }
})

test('the Antarctic coastline closes at the South Pole without spanning the globe in one ring', () => {
  const map = globeCountries({ type: 'FeatureCollection', features: [{
    type: 'Feature', properties: {}, geometry: {
      type: 'Polygon', coordinates: [[[-180, -84], [-90, -74], [0, -69], [90, -72], [180, -84], [-180, -84]]],
    },
  }] })
  const geometry = map.features[0]?.geometry
  assert.equal(geometry?.type, 'MultiPolygon')
  if (geometry.type !== 'MultiPolygon') return
  assert.equal(geometry.coordinates.length, 4)
  for (const [ring] of geometry.coordinates) {
    assert(ring?.some(([, lat]) => lat === -90))
    assert(ring?.every(([lng], index) => index === 0 || Math.abs(lng! - ring[index - 1]![0]!) <= 90))
  }
})
