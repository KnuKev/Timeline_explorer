import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import { demoTimeline, demoHistoryStartDate, demoStartDate, demoEndDate } from '../src/demoTimeline.ts'
import { parseTimeline, distanceKm } from '../src/timeline.ts'
import { prepareTimeline } from '../src/timelineIndex.ts'
import { buildRouteSegments } from '../src/routes.ts'
import { analysePlaces, type CountryFeature } from '../src/places.ts'
import { buildStatistics } from '../src/statistics.ts'
import { buildTrips } from '../src/trips.ts'

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const points = parseTimeline(demoTimeline)
const dataset = prepareTimeline(points)
const topology = readJson('../node_modules/world-atlas/countries-10m.json') as Topology
const countries = (feature(topology, topology.objects.countries!) as unknown as { features: CountryFeature[] }).features
const places = analysePlaces(points, readJson('../public/geonames-cities.json'), readJson('../public/country-codes.json'), countries)
const statistics = buildStatistics(dataset.cleanPoints, points, dataset.days, places)

test('the downloadable example has a month of single-point home days and a five-day journey across a month boundary', () => {
  const downloaded = readJson('../src/data/fictional-timeline.json')
  assert.deepEqual(parseTimeline(downloaded), points, 'The download and the built-in example must use identical import semantics')
  const homeDays = dataset.days.filter(day => day.day < demoStartDate)
  assert.equal(homeDays.length, 30)
  assert.ok(homeDays.every(day => day.indices.length === 1), 'The home-history month needs only one location record per day')
  assert.ok(homeDays.every(day => points[day.indices[0]!]!.kind === 'visit' && points[day.indices[0]!]!.label === 'Home'))
  assert.deepEqual(dataset.days.filter(day => day.day >= demoStartDate).map(day => day.day), ['2025-04-29', '2025-04-30', '2025-05-01', '2025-05-02', '2025-05-03'])
  assert.equal(dataset.days[0]!.day, demoHistoryStartDate)
  assert.equal(dataset.days.at(-1)!.day, demoEndDate)
  assert.equal(dataset.excluded.length, 0, 'The fictional journey should not trigger the GPS-error banner')
  let previousEnd = 0
  for (const segment of downloaded.semanticSegments) {
    const start = Date.parse(segment.startTime)
    const end = Date.parse(segment.endTime)
    assert.ok(start >= previousEnd && end > start, 'Trips and overnight visits must not overlap or run backwards')
    previousEnd = end
  }
})

test('the London run covers approximately a marathon and all three flights draw as continuous flight legs', () => {
  const running = demoTimeline.semanticSegments.find(segment => segment.activity?.topCandidate.type === 'RUNNING')!
  const run = parseTimeline({ semanticSegments: [running] })
  const runKm = distanceKm(run)
  assert.ok(runKm >= 41 && runKm <= 43, `Approximate marathon: ${runKm} km`)
  assert.equal(run[0]!.activities?.[0]!.mode, 'walking', 'The normal importer groups running with travel on foot')
  const route = buildRouteSegments(dataset.cleanPoints, points)
  const flights = route.segments.filter(segment => segment.transport === 'flight')
  assert.equal(flights.length, 3)
  assert.ok(distanceKm(flights[0]!.points) > 300 && distanceKm(flights[0]!.points) < 400, 'Heathrow–Paris')
  assert.ok(distanceKm(flights[1]!.points) > 900 && distanceKm(flights[1]!.points) < 1100, 'Schiphol–Gardermoen')
  assert.ok(distanceKm(flights[2]!.points) > 1100 && distanceKm(flights[2]!.points) < 1300, 'Gardermoen–Heathrow')
  assert.ok(route.distanceKm > 3200 && route.distanceKm < 3400)
  assert.ok(route.segments.every(segment => !segment.estimated), 'The supplied times support every connection without a gap estimate')
})

test('the example separates zero-distance home days from travel and exposes countries, movement time and repeated routes', () => {
  assert.deepEqual(places.countries.map(country => country.countryCode).sort(), ['BE', 'FR', 'GB', 'NL', 'NO'])
  assert.ok(places.countries.every(country => country.pointCount >= 10), 'Countries should appear in the main Places grid')
  assert.equal(statistics.all.recordedDays, 35)
  assert.equal(statistics.all.countryCount, 5)
  assert.deepEqual(statistics.all.monthly.filter(month => month.distanceKm > 0).map(month => month.month), [4, 5])
  assert.ok(statistics.all.daily.filter(day => day.date < demoStartDate).every(day => day.distanceKm === 0))
  assert.ok(statistics.all.daily.filter(day => day.date >= demoStartDate).every(day => day.distanceKm > 0))
  assert.ok(statistics.all.hourlyMinutes.reduce((sum, minutes) => sum + minutes, 0) > 1000)
  assert.ok(statistics.all.patterns.some(pattern => pattern.count >= 2), 'Schiphol–Amsterdam and the return share a repeated-city row')
})

test('the example creates a real detected London home and one completed international trip with three nights away', () => {
  const trips = buildTrips(dataset.cleanPoints, points, places)
  assert.equal(trips.homeStatus, 'detected')
  assert.equal(trips.homes.length, 1)
  assert.equal(trips.homes[0]!.countryCode, 'GB')
  assert.equal(trips.homes[0]!.recordedNights, 30)
  assert.equal(trips.trips.length, 1)
  const trip = trips.trips[0]!
  assert.equal(trip.scope, 'international')
  assert.equal(trip.category, 'multi-stop')
  assert.equal(trip.hasFlight, true)
  assert.equal(trip.nights, 3)
  assert.equal(trip.startDate, '2025-04-30', 'The local marathon remains within the London home area')
  assert.equal(trip.endDate, demoEndDate)
  assert.ok(['FR', 'BE', 'NL', 'NO'].every(code => trip.countryCodes.includes(code)))
  assert.ok(['FR', 'NL', 'NO'].every(code => trip.places.some(place => place.countryCode === code)))
})

test('every fictional movement preserves its stated transport type and selected-candidate probability', () => {
  const activities = demoTimeline.semanticSegments.flatMap(segment => segment.activity ? [segment.activity] : [])
  assert.deepEqual([...new Set(activities.map(activity => activity.topCandidate.type))].sort(), ['FLYING', 'IN_PASSENGER_VEHICLE', 'IN_SUBWAY', 'IN_TRAIN', 'RUNNING', 'WALKING'])
  assert.ok(activities.every(activity => activity.topCandidate.probability === 1 && activity.distanceMeters > 0))
  assert.equal(activities.filter(activity => activity.topCandidate.type === 'FLYING').length, 3)
  assert.ok(points.some(point => point.activities?.some(activity => activity.mode === 'rail')))
  assert.ok(points.some(point => point.activities?.some(activity => activity.mode === 'road')))
})
