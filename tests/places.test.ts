import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import { analysePlaces, type CountryFeature } from '../src/places.ts'
import { createCountryLookup } from '../src/geography.ts'
import { pointDateKeys } from '../src/pointDates.ts'
import { parseTimeline, type TimelinePoint } from '../src/timeline.ts'

const topology = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/countries-10m.json', import.meta.url), 'utf8')) as Topology
const countries = (feature(topology, topology.objects.countries!) as unknown as { features: CountryFeature[] }).features
const codes = JSON.parse(readFileSync(new URL('../public/country-codes.json', import.meta.url), 'utf8'))
const lookup = createCountryLookup(countries)
const countryAt = (lat: number, lng: number) => codes[String(lookup(lat, lng)?.id)]
const point = (id: string, lat: number, lng: number, timestamp: string): TimelinePoint => ({ id, lat, lng, timestamp, kind: 'path', label: 'Rutepunkt' })

test('Spanish mainland, islands and African enclaves all count as Spain', () => {
  const locations: [string, number, number][] = [
    ['Madrid', 40.4168, -3.7038], ['Tenerife / Santa Cruz', 28.4636, -16.2518],
    ['Tenerife / Costa Adeje', 28.0918, -16.7266], ['Tenerife South Airport', 28.0445, -16.5725],
    ['Gran Canaria', 28.1235, -15.4363], ['La Palma', 28.6835, -17.7642],
    ['La Gomera', 28.0916, -17.1133], ['El Hierro', 27.8063, -17.9158],
    ['Lanzarote', 28.963, -13.5477], ['Fuerteventura', 28.5004, -13.8627],
    ['La Graciosa', 29.231, -13.503], ['Mallorca', 39.5696, 2.6502],
    ['Menorca', 39.8885, 4.2658], ['Ibiza', 38.9067, 1.4206], ['Formentera', 38.7054, 1.4281],
    ['Ceuta', 35.8894, -5.3213], ['Melilla', 35.2923, -2.9381], ['Llivia', 42.464, 1.982],
  ]
  for (const [name, lat, lng] of locations) assert.equal(countryAt(lat, lng), 'ES', name)
})

test('Klagenfurt and the Red Bull Ring count as Austria; nearby countries stay separate', () => {
  assert.equal(countryAt(46.6247, 14.3053), 'AT', 'Klagenfurt')
  assert.equal(countryAt(47.2197, 14.7647), 'AT', 'Red Bull Ring')
  assert.equal(countryAt(46.52694, 14.30194), 'AT', 'Ferlach on the Austrian side of the southern route')
  assert.equal(countryAt(46.3637, 14.3097), 'SI', 'Trzic in Slovenia')
  assert.equal(countryAt(45.6495, 13.7768), 'IT', 'Trieste')
  assert.equal(countryAt(35.5785, -5.3684), 'MA', 'Tetouan near Ceuta')
  assert.equal(countryAt(36.1408, -5.3536), 'GI', 'Gibraltar')
  assert.equal(countryAt(0, -30), undefined, 'Open Atlantic')
})

test('coastal tolerance is bounded and never overrides another country', () => {
  const square = (id: string, west: number, east: number): CountryFeature => ({ id, geometry: { type: 'Polygon', coordinates: [[[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]]] } })
  const find = createCountryLookup([square('A', 4, 5), square('B', 5, 6)])
  assert.equal(find(0.5, 5.005)?.id, 'B')
  assert.equal(find(-0.005, 4.5)?.id, 'A')
  assert.equal(find(-0.05, 4.5), undefined)
  assert.equal(find(0.5, 5)?.id, 'A', 'Points on a boundary are not dropped')
})

test('country days include recorded visit duration, deduplicate overlaps, and do not fill travel gaps', () => {
  const visit: TimelinePoint = { ...point('visit', 28.4636, -16.2518, '2025-01-05T00:00:00Z'), kind: 'visit', endTimestamp: '2025-01-20T00:00:00Z' }
  const result = analysePlaces([
    visit,
    point('overlap', 28.4636, -16.2518, '2025-01-10T12:00:00Z'),
    point('later', 28.4636, -16.2518, '2025-01-25T12:00:00Z'),
    point('austria', 46.6247, 14.3053, '2024-07-01T12:00:00Z'),
  ], [{ name: 'Santa Cruz', lat: 28.4636, lng: -16.2518, countryCode: 'ES' }], codes, countries)
  const spain = result.countries.find(country => country.countryCode === 'ES')!
  assert.equal(spain.days, 16)
  assert.equal(spain.pointCount, 3)
  assert.ok(spain.dates.includes('2025-01-19'))
  assert.ok(!spain.dates.includes('2025-01-20'))
  assert.equal(result.cities[0]?.days, 16)
  assert.equal(result.countries.find(country => country.countryCode === 'AT')?.days, 1)
})

test('recorded days follow location time zones and handle daylight-saving changes', () => {
  assert.deepEqual(pointDateKeys(point('tenerife', 28.4636, -16.2518, '2025-01-01T23:30:00Z')), ['2025-01-01'])
  assert.deepEqual(pointDateKeys(point('austria', 46.6247, 14.3053, '2025-01-01T23:30:00Z')), ['2025-01-02'])
  assert.deepEqual(pointDateKeys({ ...point('dst', 46.6247, 14.3053, '2025-03-28T23:00:00Z'), kind: 'visit', endTimestamp: '2025-03-30T22:00:00Z' }), ['2025-03-29', '2025-03-30'])
})

test('mobile export import feeds Tenerife and Austrian activity days into country analysis', () => {
  const points = parseTimeline({ semanticSegments: [
    { startTime: '2025-01-10T12:00:00Z', endTime: '2025-01-13T12:00:00Z', visit: { topCandidate: { placeLocation: { latLng: '28.4636°, -16.2518°' } } } },
    { startTime: '2024-07-01T10:00:00+02:00', endTime: '2024-07-01T12:00:00+02:00', activity: { start: { latLng: '46.6247°, 14.3053°' }, end: { latLng: '47.2197°, 14.7647°' } } },
  ] })
  const result = analysePlaces(points, [], codes, countries)
  assert.deepEqual(result.countries.find(country => country.countryCode === 'ES')?.dates, ['2025-01-13', '2025-01-12', '2025-01-11', '2025-01-10'])
  assert.equal(result.countries.find(country => country.countryCode === 'AT')?.days, 1)
})
