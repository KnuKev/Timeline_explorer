import assert from 'node:assert/strict'
import test from 'node:test'
import { createTripLocalityResolver, type TripLocalityReference } from '../src/tripLocalities.ts'

const reference = (name: string, lat = 60, lng = 10, countryCode = 'NO'): TripLocalityReference => ({ name, lat, lng, countryCode })

test('trip locality context uses the nearest settlement in the independently known country', () => {
  const resolve = createTripLocalityResolver([reference('Across the border', 60, 10, 'SE'), reference('Local village', 60, 10.1)])
  const result = resolve({ lat: 60, lng: 10 }, 'NO')!
  assert.equal(result.name, 'Local village')
  assert.equal(result.countryCode, 'NO')
  assert.ok(result.distanceKm > 5 && result.distanceKm < 6)
  assert.equal(resolve({ lat: 60, lng: 10 }), undefined, 'A nearby settlement must not guess an unknown country')
  assert.equal(resolve({ lat: 60, lng: 10 }, 'FI'), undefined)
})

test('smaller nearby settlements provide region context without mutating references', () => {
  const references = [reference('Larger town', 60.1, 10), { ...reference('Small settlement', 60, 10.001), id: 123, region: 'Municipality, County' }]
  const before = JSON.stringify(references)
  const result = createTripLocalityResolver(references)({ lat: 60, lng: 10 }, 'NO')!
  assert.equal(result.name, 'Small settlement')
  assert.equal(result.region, 'Municipality, County')
  assert.equal(result.id, 123)
  assert.ok(result.distanceKm < 0.1)
  assert.equal(JSON.stringify(references), before)
})

test('invalid coordinates and unbounded distant matches cannot produce locality names', () => {
  const resolve = createTripLocalityResolver([reference('Valid'), reference('Invalid latitude', 91), reference('Invalid longitude', 60, 181), reference('Not finite', NaN), { ...reference(''), id: 1 }])
  for (const point of [{ lat: NaN, lng: 10 }, { lat: Infinity, lng: 10 }, { lat: 91, lng: 10 }, { lat: 60, lng: -181 }]) assert.equal(resolve(point, 'NO'), undefined)
  assert.equal(resolve({ lat: 60.4, lng: 10 }, 'NO'), undefined, 'Names farther than 30 km are omitted')
  assert.equal(resolve({ lat: 60.2, lng: 10 }, 'NO')?.name, 'Valid')
})

test('the locality grid finds nearby settlements across the dateline', () => {
  const resolve = createTripLocalityResolver([reference('Nearby settlement', 65, -179.9, 'RU')])
  const result = resolve({ lat: 65, lng: 179.9 }, 'RU')!
  assert.equal(result.name, 'Nearby settlement')
  assert.ok(result.distanceKm < 10)
})

test('equal-distance reference names are deterministic regardless of input order', () => {
  const references = [reference('Zed'), reference('Alpha')]
  assert.equal(createTripLocalityResolver(references)({ lat: 60, lng: 10 }, 'NO')?.name, 'Alpha')
  assert.equal(createTripLocalityResolver([...references].reverse())({ lat: 60, lng: 10 }, 'NO')?.name, 'Alpha')
})
