import assert from 'node:assert/strict'
import test from 'node:test'
import { analysePlaces, type CityReference, type CountryFeature } from '../src/places.ts'
import { pointDateKeys } from '../src/pointDates.ts'
import { distanceKm, type TimelinePoint } from '../src/timeline.ts'

const world: CountryFeature[] = [{ id: '040', geometry: { type: 'Polygon', coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]] } }]
const codes = { '040': 'AT' }
const point = (id: string, lat: number, lng: number): TimelinePoint => ({ id, lat, lng, timestamp: '2025-01-01T12:00:00Z', kind: 'path', label: 'Rutepunkt' })

test('city index matches exhaustive spherical nearest-neighbour search', () => {
  let seed = 8359
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  const cities: CityReference[] = Array.from({ length: 1_000 }, (_, i) => ({ name: `City ${i}`, lat: random() * 140 - 70, lng: random() * 360 - 180, countryCode: 'AT' }))
  const points = Array.from({ length: 300 }, (_, i) => {
    const near = cities[i]!
    return point(`point-${i}`, near.lat + random() * 0.6 - 0.3, ((near.lng + random() * 0.6 - 0.3 + 540) % 360) - 180)
  })
  const result = analysePlaces(points, cities, codes, world)
  const actual = new Map(result.cities.flatMap(city => city.pointIds.map(id => [id, city.name] as const)))
  for (const observation of points) {
    let expected: CityReference | undefined
    let shortest = 30
    for (const city of cities) {
      const distance = distanceKm([observation, point('city', city.lat, city.lng)])
      if (distance < shortest) { shortest = distance; expected = city }
    }
    assert.equal(actual.get(observation.id), expected?.name, observation.id)
  }
})

test('nearest cities handle the dateline, polar locations, radius limits and country codes', () => {
  const cities: CityReference[] = [
    { name: 'Across dateline', lat: 0, lng: -179.95, countryCode: 'AT' },
    { name: 'Across pole', lat: 89.99, lng: 179, countryCode: 'AT' },
    { name: 'Outside radius', lat: 10, lng: 10.3, countryCode: 'AT' },
    { name: 'Wrong country', lat: 20, lng: 20, countryCode: 'SI' },
  ]
  const result = analysePlaces([point('date', 0, 179.95), point('polar', 89.99, -179), point('far', 10, 10), point('foreign', 20, 20)], cities, codes, world)
  assert.deepEqual(result.cities.map(city => city.name).sort(), ['Across dateline', 'Across pole'])
})

test('identical city coordinates retain reference ordering and caches do not retain old point coordinates', () => {
  const cities: CityReference[] = [
    { name: 'First', lat: 0, lng: 0, countryCode: 'AT' },
    { name: 'Second', lat: 0, lng: 0, countryCode: 'AT' },
    { name: 'Moved', lat: 20, lng: 20, countryCode: 'AT' },
  ]
  const observation = point('reused', 0, 0)
  assert.equal(analysePlaces([observation], cities, codes, world).cities[0]?.name, 'First')
  observation.lat = 20
  observation.lng = 20
  assert.equal(analysePlaces([observation], cities, codes, world).cities[0]?.name, 'Moved')
  assert.equal(analysePlaces([observation], cities, codes, world).cities[0]?.pointCount, 1)
})

test('date caching respects changed timestamps and safely rejects absurd visit intervals', () => {
  const observation = point('reused-date', 46.62, 14.3)
  assert.deepEqual(pointDateKeys(observation), ['2025-01-01'])
  observation.timestamp = '2025-01-01T23:30:00Z'
  assert.deepEqual(pointDateKeys(observation), ['2025-01-02'])
  observation.kind = 'visit'
  observation.endTimestamp = '9999-01-01T00:00:00Z'
  assert.deepEqual(pointDateKeys(observation), ['2025-01-02'])
  observation.endTimestamp = '2025-01-03T23:00:00Z'
  assert.deepEqual(pointDateKeys(observation), ['2025-01-02', '2025-01-03'])
  assert.deepEqual(pointDateKeys({ ...observation, timestamp: '+100000-01-01T00:00:00Z' }), [])
})

test('preindexed dates preserve local days and visit spans with fallback for missing points', () => {
  const cities: CityReference[] = [{ name: 'Klagenfurt', lat: 46.62, lng: 14.3, countryCode: 'AT' }]
  const localDay = { ...point('local-day', 46.62, 14.3), timestamp: '2025-01-01T23:30:00Z' }
  const visit: TimelinePoint = { ...point('visit', 46.62, 14.3), timestamp: '2025-01-02T23:00:00Z', endTimestamp: '2025-01-04T23:00:00Z', kind: 'visit' }
  const fallback = { ...point('fallback', 46.62, 14.3), timestamp: '2025-01-05T12:00:00Z' }
  const points = [localDay, visit, fallback]
  const datesByPoint: ReadonlyMap<TimelinePoint, readonly string[]> = new Map([
    [localDay, ['2025-01-02']],
    [visit, ['2025-01-03', '2025-01-04']],
  ])
  const normal = analysePlaces(points, cities, codes, world)
  assert.deepEqual(normal.countries[0]?.dates, ['2025-01-05', '2025-01-04', '2025-01-03', '2025-01-02'])
  assert.deepEqual(analysePlaces(points, cities, codes, world, datesByPoint), normal)
})
