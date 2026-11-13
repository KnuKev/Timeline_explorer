import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareTimeline } from '../src/timelineIndex.ts'
import { buildTrips } from '../src/trips.ts'
import { buildRouteSegments } from '../src/routes.ts'
import type { TimelinePoint } from '../src/timeline.ts'
import type { PlaceAnalysis } from '../src/places.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const point = (id: string, timestamp: string, lat = 59.91, lng = 10.7): TimelinePoint => ({ id, timestamp, lat, lng, kind: 'path', source: 'timelinePath', label: 'Rutepunkt' })
const visit = (id: string, timestamp: string, endTimestamp: string, lat = 59.91, lng = 10.7, label = 'Besøkt sted'): TimelinePoint => ({ ...point(id, timestamp, lat, lng), kind: 'visit', source: 'visit', endTimestamp, label })
const home = (id: string, start: string, end: string) => visit(id, start, end, 59.91, 10.7, 'Home')
const sorted = (points: TimelinePoint[]) => [...points].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
const iso = (time: number) => new Date(time).toISOString()
function placesFor(points: TimelinePoint[], cities: { key: string; name: string; countryCode: string; ids: string[] }[] = []): PlaceAnalysis {
  const entries = cities.map(city => ({ ...city, dates: [], days: 0, pointCount: city.ids.length, pointIds: city.ids }))
  const countries = new Map<string, string[]>()
  for (const city of cities) countries.set(city.countryCode, [...(countries.get(city.countryCode) ?? []), ...city.ids])
  const homeIds = points.filter(item => item.lat === 59.91 && item.lng === 10.7).map(item => item.id)
  countries.set('NO', [...new Set([...(countries.get('NO') ?? []), ...homeIds])])
  return { cities: entries, countries: [...countries].map(([code, ids]) => ({ key: code, name: code, countryCode: code, dates: [], days: 0, pointCount: ids.length, pointIds: ids })) }
}
const analyse = (points: TimelinePoint[], places = placesFor(points), selected = points) => buildTrips(selected, points, places)
function weekend(start = '2025-03-07T14:00:00Z', lat = 60.4, lng = 11.2) {
  const time = Date.parse(start)
  return [home('home-out', iso(time - DAY), iso(time)), visit('hotel', iso(time + 2 * HOUR), iso(time + 42 * HOUR), lat, lng, 'Hotel'), home('home-in', iso(time + 46 * HOUR), iso(time + 64 * HOUR))]
}

test('Friday to Sunday is two nights; selection uses original home anchors and matching route distance', () => {
  const points = weekend()
  const before = JSON.stringify(points)
  const result = analyse(points)
  assert.equal(result.homeStatus, 'detected')
  assert.equal(result.homeCount, 1)
  assert.equal(result.trips.length, 1)
  const trip = result.trips[0]!
  assert.equal(trip.nights, 2)
  assert.equal(trip.startTimestamp, points[1]!.timestamp)
  assert.equal(trip.endTimestamp, points[2]!.timestamp)
  assert.deepEqual(trip.pointIds, points.map(item => item.id))
  assert.equal(trip.distanceKm, buildRouteSegments(points, points).distanceKm)
  assert.equal(JSON.stringify(points), before)
})

test('a selected home detects trips without inferred home visits and supplies the home country', () => {
  const points = weekend().map(item => item.label === 'Home' ? { ...item, label: 'Visited place' } : item)
  const places = placesFor(points, [{ key: 'NO:hotel', name: 'Hotel', countryCode: 'NO', ids: ['hotel'] }])
  assert.equal(analyse(points, places).homeStatus, 'missing')

  const homeLocation = { lat: 59.9102, lng: 10.7001 }
  const result = buildTrips(points, points, places, undefined, { homes: [{ ...homeLocation, from: '', countryCode: 'NO' }] })
  assert.equal(result.homes[0]?.lat, homeLocation.lat)
  assert.equal(result.trips[0]?.scope, 'domestic')
  assert.deepEqual(result.trips[0]?.pointIds, points.map(point => point.id))

  const differentHome = buildTrips(points, points, places, undefined, { homes: [{ lat: 51.5, lng: 0, from: '', countryCode: 'GB' }] })
  assert.equal(differentHome.trips.length, 0)
})

test('dated home locations switch at local midnight and preserve automatically detected earlier trips', () => {
  const earlier = weekend()
  const makeTrip = (prefix: string, start: string, lat: number, lng: number) =>
    weekend(start, 60.4, 11.2).map((item, index) => ({
      ...item, id: `${prefix}-${index}`, label: index === 1 ? 'Hotel' : 'Visited place',
      ...(index === 1 ? {} : { lat, lng }),
    }))
  const spring = makeTrip('spring', '2025-04-02T14:00:00Z', 59.1, 10.2)
  spring[0]!.timestamp = '2025-03-31T22:00:00.000Z' // Midnight in Oslo on the move date.
  const summer = makeTrip('summer', '2025-07-04T14:00:00Z', 58.1, 8)
  const points = sorted([...earlier, ...spring, ...summer])
  const places = placesFor(points, [{ key: 'hotel', name: 'Hotel', countryCode: 'NO', ids: ['hotel', 'spring-1', 'summer-1'] }])
  const result = buildTrips(points, points, places, undefined, { homes: [
    { lat: 59.1, lng: 10.2, from: '2025-04-01', countryCode: 'NO' },
    { lat: 58.1, lng: 8, from: '2025-07-01', countryCode: 'NO' },
  ] })

  assert.deepEqual(result.trips.map(trip => trip.pointIds[0]), ['summer-0', 'spring-0', 'home-out'])
  assert.deepEqual(result.homes.map(home => home.startDate), ['2025-03-06', '2025-04-01', '2025-07-01'])
})

test('two calendar nights survive DST and a configurable radius controls nearby destinations', () => {
  const points = weekend('2025-03-28T14:00:00Z', 59.918, 10.7)
  assert.equal(analyse(points).trips.length, 0)
  const trip = buildTrips(points, points, placesFor(points), undefined, { homeRadiusKm: 0.3 }).trips[0]!
  assert.equal(trip.nights, 2)
  assert.equal(trip.startDate, '2025-03-28')
  assert.equal(trip.endDate, '2025-03-30')
  assert.ok(Date.parse(trip.endTimestamp) - Date.parse(trip.startTimestamp) < 48 * HOUR)
})

test('one-night stays, missing-home data and incomplete trip boundaries stay out of the list', () => {
  const points = weekend()
  const oneNight = [points[0]!, { ...points[1]!, endTimestamp: '2025-03-08T08:00:00Z' }, { ...points[2]!, timestamp: '2025-03-08T10:00:00Z', endTimestamp: '2025-03-09T08:00:00Z' }]
  assert.equal(analyse(oneNight).trips.length, 0)
  assert.equal(analyse([points[1]!]).homeStatus, 'missing')
  const secondHome = home('earlier-home', '2025-03-05T10:00:00Z', '2025-03-06T08:00:00Z')
  assert.equal(analyse([secondHome, ...points.slice(0, 2)]).trips.length, 0)
  assert.equal(analyse([points[1]!, points[2]!, home('later-home', '2025-03-11T10:00:00Z', '2025-03-12T08:00:00Z')]).trips.length, 0)
})

test('repeated trips group by stable destination identity and retain disjoint exact map selections', () => {
  const first = weekend()
  const second = weekend('2025-03-14T14:00:00Z').map(item => ({ ...item, id: `${item.id}-2` }))
  const points = [...first, ...second]
  const places = placesFor(points, [{ key: 'NO:hotel-city', name: 'Destination', countryCode: 'NO', ids: ['hotel', 'hotel-2'] }])
  const result = analyse(points, places)
  assert.equal(result.trips.length, 2)
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0]!.totalNights, 4)
  assert.deepEqual(result.trips.map(trip => trip.startDate), ['2025-03-14', '2025-03-07'])
  for (const trip of result.trips) assert.equal(trip.distanceKm, buildRouteSegments(points.filter(item => trip.pointIds.includes(item.id)), points).distanceKm)
})

function gapTrip(gapHours: number, foreign = false, overnight = true) {
  const departure = Date.parse('2025-03-07T10:00:00Z')
  const location = foreign ? [55.68, 12.57] : [60.4, 11.2]
  const first = point('away-first', iso(departure + HOUR), location[0], location[1])
  const secondTime = Date.parse(first.timestamp) + gapHours * HOUR
  const second = overnight ? visit('away-last', iso(secondTime), iso(secondTime + 16 * HOUR), location[0]!, location[1]!, 'Hotel') : point('away-last', iso(secondTime), location[0], location[1])
  const points = [home('home-out', iso(departure - DAY), iso(departure)), first, second, home('home-in', iso(secondTime + 18 * HOUR), iso(secondTime + 36 * HOUR))]
  const places = placesFor(points, [{ key: foreign ? 'DK:city' : 'NO:city', name: 'Away', countryCode: foreign ? 'DK' : 'NO', ids: ['away-first', 'away-last'] }])
  return { points, places }
}

test('36-hour gaps are bounded while explicit stays cover their own longer intervals', () => {
  const boundary = gapTrip(36)
  assert.equal(analyse(boundary.points, boundary.places).trips.length, 1)
  const over = gapTrip(36.001)
  assert.equal(analyse(over.points, over.places).trips.length, 0)
  const points = weekend()
  points[1]!.endTimestamp = '2025-03-17T08:00:00Z'
  points[2]!.timestamp = '2025-03-17T10:00:00Z'
  points[2]!.endTimestamp = '2025-03-18T08:00:00Z'
  assert.equal(analyse(points).trips[0]!.nights, 10)
  points[1]!.endTimestamp = '2425-03-17T08:00:00Z'
  assert.equal(analyse(points).trips.length, 0)
})

test('bounded sparse foreign stays need nearby matching-country evidence and a recorded overnight', () => {
  const foreign = gapTrip(74, true)
  assert.equal(analyse(foreign.points, foreign.places).trips.length, 1)
  const domestic = gapTrip(74)
  assert.equal(analyse(domestic.points, domestic.places).trips.length, 0)
  const long = gapTrip(169, true)
  assert.equal(analyse(long.points, long.places).trips.length, 0)
  const noNight = gapTrip(74, true, false)
  assert.equal(analyse(noNight.points, noNight.places).trips.length, 0)
  const far = gapTrip(74, true)
  far.points[2]!.lat += 2
  assert.equal(analyse(far.points, far.places).trips.length, 0)
})

test('an impossible regional jump into the home area cannot end a trip early', () => {
  const points = weekend()
  const homeReturn = points.pop()!
  points.push(
    point('on-road-before', '2025-03-09T10:28:00Z', 60.5624, 9.9958),
    point('false-return', '2025-03-09T10:29:00Z', 59.9336, 10.4384),
    point('on-road-after', '2025-03-09T10:29:00Z', 60.56, 9.998),
    point('real-return', '2025-03-09T11:30:00Z', 60.12, 10.7),
    homeReturn,
  )

  const dataset = prepareTimeline(points)
  assert.deepEqual(dataset.excluded.map(({ point }) => point.id), ['false-return'])
  const trip = analyse(points, placesFor(points), dataset.cleanPoints).trips[0]!
  assert.equal(trip.endTimestamp, '2025-03-09T11:30:00.000Z')
  assert.ok(trip.pointIds.includes('on-road-after'))
  assert.ok(!trip.pointIds.includes('false-return'))
  assert.equal(trip.mapPointIds?.at(-1), 'home-in')
})

test('one inside-radius fix ends a trip immediately without requiring a confirmed home stay', () => {
  const points = weekend()
  points[2] = point('home-single', points[2]!.timestamp)
  points.push(point('home-days-later', '2025-03-11T10:00:00Z'))
  points.unshift(home('previous-home', '2025-03-04T10:00:00Z', '2025-03-05T08:00:00Z'))
  assert.equal(analyse(points).trips.length, 1)
  points.pop()
  points.push(point('home-confirmed', '2025-03-09T12:10:00Z'))
  const trip = analyse(points).trips[0]!
  assert.equal(trip.endTimestamp, '2025-03-09T12:00:00.000Z')
  assert.equal(trip.pointIds.at(-1), 'home-single')
})

test('path drift during a known home visit cannot manufacture away nights', () => {
  const points = [home('home-1', '2025-03-06T12:00:00Z', '2025-03-10T08:00:00Z'), point('home-path', '2025-03-06T13:00:00Z'), point('drift-1', '2025-03-06T13:20:00Z', 59.914, 10.7), point('drift-2', '2025-03-07T08:00:00Z', 59.914, 10.7), point('home-path-2', '2025-03-07T09:00:00Z'), point('drift-3', '2025-03-07T10:00:00Z', 59.914, 10.7), point('drift-4', '2025-03-08T08:00:00Z', 59.914, 10.7), home('home-2', '2025-03-08T09:00:00Z', '2025-03-09T08:00:00Z')]
  assert.equal(analyse(points).trips.length, 0)
})

test('a long holiday with a return to the established home is not inferred as moving home', () => {
  const start = Date.parse('2025-02-01T10:00:00Z')
  const points = [home('home-before', iso(start - DAY), iso(start)), visit('long-holiday', iso(start + HOUR), iso(start + 45 * DAY), 28.3, -16.5, 'Hotel'), home('home-after', iso(start + 45 * DAY + 6 * HOUR), iso(start + 100 * DAY))]
  const result = analyse(points)
  assert.equal(result.homeCount, 1)
  assert.equal(result.trips.length, 1)
  assert.equal(result.trips[0]!.nights, 45)
})

test('sustained unlabeled residence evidence follows a move and detects later trips from the new home', () => {
  const start = Date.parse('2025-01-01T12:00:00Z')
  const points = [home('old-home-1', iso(start), iso(start + DAY)), home('old-home-2', iso(start + 2 * DAY), iso(start + 3 * DAY))]
  const move = start + 10 * DAY
  for (let day = 0; day <= 75; day += 2) points.push(visit(`new-home-${day}`, iso(move + day * DAY), iso(move + day * DAY + 20 * HOUR), 59.95, 10.55))
  const tripStart = move + 76 * DAY
  points.push(visit('new-home-out', iso(tripStart), iso(tripStart + 4 * HOUR), 59.95, 10.55), visit('hotel', iso(tripStart + 6 * HOUR), iso(tripStart + 45 * HOUR), 60.4, 11.2, 'Hotel'), visit('new-home-in', iso(tripStart + 48 * HOUR), iso(tripStart + 65 * HOUR), 59.95, 10.55))
  const result = analyse(sorted(points))
  assert.equal(result.homeCount, 2)
  assert.equal(result.trips.length, 1)
  assert.equal(result.trips[0]!.pointIds[0], 'new-home-out')
  assert.equal(result.trips[0]!.pointIds.at(-1), 'new-home-in')
})

test('main destination favors recorded nights and excludes nearby port stops for cruises', () => {
  const departure = Date.parse('2025-03-07T12:00:00Z')
  const points = [home('home-out', iso(departure - DAY), iso(departure)), visit('port-out', iso(departure + HOUR), iso(departure + 6 * HOUR), 59.9, 10.8, 'Port'), visit('destination', iso(departure + 22 * HOUR), iso(departure + 26 * HOUR), 55.68, 12.57, 'Destination'), visit('port-in', iso(departure + 44 * HOUR), iso(departure + 48 * HOUR), 59.9, 10.8, 'Port'), home('home-in', iso(departure + 49 * HOUR), iso(departure + 65 * HOUR))]
  points.splice(2, 0, point('ferry-outside', iso(departure + 7 * HOUR), 59.5, 10.7))
  const places = placesFor(points, [{ key: 'NO:Oslo', name: 'Oslo', countryCode: 'NO', ids: ['port-out', 'port-in'] }, { key: 'DK:Copenhagen', name: 'Copenhagen', countryCode: 'DK', ids: ['destination'] }])
  assert.equal(analyse(points, places).trips[0]!.destination.name, 'Copenhagen')
  const hotel = weekend()
  hotel.splice(2, 0, visit('airport', '2025-03-09T09:00:00Z', '2025-03-09T10:00:00Z', 60.2, 11.1, 'Airport'))
  const hotelPlaces = placesFor(hotel, [{ key: 'NO:Hotel', name: 'Overnight destination', countryCode: 'NO', ids: ['hotel'] }, { key: 'NO:Airport', name: 'Airport', countryCode: 'NO', ids: ['airport'] }])
  assert.equal(analyse(hotel, hotelPlaces).trips[0]!.destination.name, 'Overnight destination')
})

test('home-area arrival excludes every subsequent local errand from the finished trip', () => {
  const points = weekend()
  points[2] = point('home-return', points[2]!.timestamp, 59.911, 10.7)
  points.push(point('home-settled', '2025-03-09T12:04:00Z'), point('home-next-morning', '2025-03-10T07:00:00Z'), point('errands', '2025-03-10T08:00:00Z', 59.93, 10.72))
  points.unshift(home('previous-home', '2025-03-04T10:00:00Z', '2025-03-05T08:00:00Z'))
  const result = analyse(points)
  assert.equal(result.trips.length, 1)
  assert.equal(result.trips[0]!.endDate, '2025-03-09')
  assert.equal(result.trips[0]!.pointIds.at(-1), 'home-return')
  points[points.length - 2]!.timestamp = '2025-03-10T12:00:01Z'
  assert.equal(analyse(sorted(points)).trips[0]!.pointIds.at(-1), 'home-return')
})

test('the map includes both recorded legs inside the radius without changing trip boundaries', () => {
  const points = weekend()
  const homeReturn = points.pop()!
  points.splice(1, 0,
    point('outbound-near-home', '2025-03-07T14:10:00Z', 59.92, 10.7),
    point('outbound-edge', '2025-03-07T14:45:00Z', 60.12, 10.7),
  )
  points.push(
    point('inbound-edge', '2025-03-09T11:00:00Z', 60.12, 10.7),
    point('inbound-near-home', '2025-03-09T11:45:00Z', 59.92, 10.7),
    homeReturn,
    point('later-errand', '2025-03-10T12:00:00Z', 59.95, 10.7),
  )

  const trip = analyse(points).trips[0]!
  assert.equal(trip.startTimestamp, '2025-03-07T16:00:00.000Z')
  assert.equal(trip.endTimestamp, '2025-03-09T11:00:00.000Z')
  assert.equal(trip.nights, 2)
  assert.deepEqual(trip.pointIds, ['outbound-edge', 'hotel', 'inbound-edge'])
  assert.deepEqual(trip.mapPointIds, points.slice(0, -1).map(point => point.id))
  assert.ok(buildRouteSegments(points.slice(0, -1), points).distanceKm > trip.distanceKm)

  homeReturn.timestamp = '2025-03-09T22:00:00.000Z'
  const withGap = analyse(points).trips[0]!
  assert.equal(withGap.mapPointIds?.at(-1), 'inbound-edge')
})

test('map selection excludes drift during the departure home visit while retaining its original anchor', () => {
  const points = weekend()
  points.splice(1, 0, point('home-path', '2025-03-07T12:00:00Z'), point('before-departure-drift', '2025-03-07T13:00:00Z', 59.914, 10.7))
  const trip = analyse(points).trips[0]!
  assert.deepEqual(trip.pointIds, ['before-departure-drift', 'hotel', 'home-in'])
  assert.equal(trip.startTimestamp, '2025-03-07T16:00:00.000Z')
  assert.equal(trip.distanceKm, buildRouteSegments(points.filter(item => trip.pointIds.includes(item.id)), points).distanceKm)
})

test('destination scoring clips overlapping semantic stay nights to the actual return', () => {
  const points = weekend()
  points.splice(2, 0, visit('stale-long-visit', '2025-03-09T09:00:00Z', '2025-03-17T10:00:00Z', 60.2, 11.1, 'Stale airport stay'))
  const places = placesFor(points, [{ key: 'NO:Hotel', name: 'Actual overnight destination', countryCode: 'NO', ids: ['hotel'] }, { key: 'NO:Airport', name: 'Airport', countryCode: 'NO', ids: ['stale-long-visit'] }])
  assert.equal(analyse(points, places).trips[0]!.destination.name, 'Actual overnight destination')
})

test('recurring stay identities tolerate local jitter and separate distant stays with the same city label', () => {
  const first = weekend()
  const second = weekend('2025-03-14T14:00:00Z', 60.4045, 11.2).map(item => ({ ...item, id: `${item.id}-2` }))
  const third = weekend('2025-03-21T14:00:00Z', 60.43, 11.2).map(item => ({ ...item, id: `${item.id}-3` }))
  const points = [...first, ...second, ...third]
  const places = placesFor(points, [{ key: 'NO:broad-city', name: 'Broad city', countryCode: 'NO', ids: ['hotel', 'hotel-2', 'hotel-3'] }])
  const result = buildTrips(points, points, places, () => ({ name: 'Small locality', countryCode: 'NO' }))
  assert.equal(result.trips.length, 3)
  assert.equal(result.groups.length, 2)
  assert.deepEqual(result.groups.map(group => group.trips.length).sort(), [1, 2])
  assert.ok(result.groups.every(group => group.destination.kind === 'place' && group.destination.locality === 'Small locality'))
  assert.equal(new Set(result.groups.map(group => group.destination.name)).size, 2, 'Different sites sharing a locality have distinct visible names')
  const firstDestination = result.trips.find(trip => trip.startDate === '2025-03-07')!.destination
  const secondDestination = result.trips.find(trip => trip.startDate === '2025-03-14')!.destination
  assert.equal(firstDestination.key, secondDestination.key)
  const selected = points.filter(item => !first.some(original => original === item))
  const filtered = buildTrips(selected, points, places, () => ({ name: 'Small locality', countryCode: 'NO' }))
  assert.equal(filtered.trips.find(trip => trip.startDate === '2025-03-14')!.destination.key, firstDestination.key, 'Keys use complete-import anchors despite selected-trip changes')
})

test('fixed stay anchors cannot merge a chain of neighbouring stops into an entire town', () => {
  const points = [0, 1, 2].flatMap(index => weekend(iso(Date.parse('2025-03-07T14:00:00Z') + index * 7 * DAY), 60.4 + index * 0.008, 11.2).map(item => ({ ...item, id: `${item.id}-${index}` })))
  const result = analyse(points)
  assert.equal(result.groups.length, 2)
  assert.deepEqual(result.groups.map(group => group.trips.length).sort(), [1, 2])
  const nearby = weekend('2025-03-28T14:00:00Z', 59.918, 10.7)
  assert.equal(buildTrips(nearby, nearby, placesFor(nearby), undefined, { homeRadiusKm: 0.3 }).trips[0]!.destination.lat, 59.918, 'Nearby overnight stays outside the selected radius are not clustered into the home anchor')
})

function twoStopTrip(firstNights = 2, secondNights = 2, mode?: 'road' | 'flight') {
  const departure = Date.parse('2025-03-07T14:00:00Z')
  const change = departure + firstNights * DAY - 4 * HOUR
  const first = visit('stay-a', iso(departure + 2 * HOUR), iso(change), 60.4, 11.2, 'Lakeside Lodge')
  const second = visit('stay-b', iso(change + 4 * HOUR), iso(change + secondNights * DAY), 61.4, 11.2, 'Mountain Lodge')
  if (mode) {
    const activity = { id: 'connecting-travel', mode, startTimestamp: iso(change), endTimestamp: iso(change + 4 * HOUR), distanceKm: 140 }
    first.activities = [activity]
    second.activities = [activity]
  }
  const points = [home('home-out', iso(departure - DAY), iso(departure)), first, second, home('home-in', iso(change + secondNights * DAY + 4 * HOUR), iso(change + secondNights * DAY + 20 * HOUR))]
  return points
}

test('comparable overnight destinations produce an itinerary instead of an arbitrary city winner', () => {
  const points = twoStopTrip()
  const trip = analyse(points).trips[0]!
  assert.equal(trip.category, 'multi-stop')
  assert.equal(trip.destination.kind, 'itinerary')
  assert.equal(trip.destination.name, 'Lakeside Lodge → Mountain Lodge')
  assert.equal(trip.nights, 4)
  assert.deepEqual(trip.pointIds, points.map(item => item.id))
  assert.equal(trip.distanceKm, buildRouteSegments(points, points).distanceKm)
  const dominant = analyse(twoStopTrip(4, 1)).trips[0]!
  assert.equal(dominant.category, 'destination')
  assert.equal(dominant.destination.name, 'Lakeside Lodge')
})

test('roadtrip classification requires explicit connecting road evidence; flights and short taxis do not suffice', () => {
  assert.equal(analyse(twoStopTrip(2, 2, 'road')).trips[0]!.category, 'roadtrip')
  assert.equal(analyse(twoStopTrip(2, 2, 'flight')).trips[0]!.category, 'multi-stop')
  const shortTaxi = twoStopTrip(2, 2, 'road')
  for (const item of shortTaxi) for (const activity of item.activities ?? []) activity.distanceKm = 3
  assert.equal(analyse(shortTaxi).trips[0]!.category, 'multi-stop')
  const returnFlight = twoStopTrip(2, 2, 'road')
  returnFlight[3]!.activities = [{ id: 'flight-home', mode: 'flight', startTimestamp: returnFlight[2]!.endTimestamp!, endTimestamp: returnFlight[3]!.timestamp, distanceKm: 180 }]
  assert.equal(analyse(returnFlight).trips[0]!.category, 'multi-stop', 'Any flight, including the return home, vetoes roadtrip classification')
  assert.equal(analyse(returnFlight).trips[0]!.hasFlight, true)
})

test('short nearby venue names do not rename a recurring overnight accommodation', () => {
  const points = weekend()
  points.splice(1, 0, visit('cafe', '2025-03-07T15:00:00Z', '2025-03-07T15:40:00Z', 60.4002, 11.2, 'Station Café'))
  const trip = buildTrips(points, points, placesFor(points), () => ({ name: 'Local village', countryCode: 'NO' })).trips[0]!
  assert.equal(trip.destination.name, 'Local village')
})

test('generic Google semantic aliases use local names and preserve municipality context', () => {
  const points = weekend()
  points[1]!.label = 'AliasedLocation'
  const trip = buildTrips(points, points, placesFor(points), (_point, countryCode) => ({ name: 'Local hamlet', countryCode: countryCode ?? 'NO', region: 'Municipality, County' })).trips[0]!
  assert.equal(trip.destination.name, 'Local hamlet')
  assert.equal(trip.destination.region, 'Municipality, County')
})

function measuredStayWeekends() {
  const first = weekend()
  const second = weekend('2025-03-14T14:00:00Z', 60.44, 11.2).map(item => ({ ...item, id: `${item.id}-2` }))
  const points = [...first, ...second]
  for (const [suffix, day] of [['first', '07'], ['second', '14']] as const) {
    const start = Date.parse(`2025-03-${day}T23:00:00Z`)
    points.push(point(`night-${suffix}-a`, iso(start), 60.42, 11.2), point(`night-${suffix}-b`, iso(start + HOUR), 60.4201, 11.2), point(`night-${suffix}-c`, iso(start + DAY), 60.4199, 11.2))
  }
  return sorted(points)
}

test('recurring measured night positions reconcile stale semantic stay anchors without changing trip points', () => {
  const points = measuredStayWeekends()
  const before = JSON.stringify(points)
  const result = analyse(points)
  assert.equal(result.trips.length, 2)
  assert.equal(result.groups.length, 1, 'Semantic anchors4km apart share strong repeated measured evidence at the same actual stay')
  assert.ok(Math.abs(result.groups[0]!.destination.lat! - 60.42) < 0.001)
  for (const trip of result.trips) {
    const selected = points.filter(item => trip.pointIds.includes(item.id))
    assert.equal(trip.distanceKm, buildRouteSegments(selected, points).distanceKm)
    assert.equal(trip.nights, 2)
  }
  assert.equal(JSON.stringify(points), before, 'Destination correction never edits source coordinates')
})

test('one night or competing night-position clusters cannot relocate a semantic stay', () => {
  const insufficient = measuredStayWeekends().filter(item => item.id !== 'night-first-c')
  assert.equal(analyse(insufficient).groups.length, 2, 'Two samples from one night do not establish a recurring position')
  const competing = measuredStayWeekends()
  const firstNight = Date.parse('2025-03-07T23:30:00Z')
  competing.push(point('competing-a', iso(firstNight), 60.38, 11.2), point('competing-b', iso(firstNight + HOUR), 60.3801, 11.2), point('competing-c', iso(firstNight + DAY), 60.3799, 11.2))
  assert.equal(analyse(sorted(competing)).groups.length, 2, 'Comparable observed bases retain the semantic identity instead of guessing')
})

test('every inside-radius observation splits the journey and no interior map point remains inside', () => {
  const points = twoStopTrip()
  points.splice(2, 0, point('brief-area-return', '2025-03-09T12:00:00Z', 60.05, 10.7))
  const result = analyse(points)
  assert.equal(result.homeRadiusKm, 25)
  assert.equal(result.trips.length, 2)
  for (const trip of result.trips) {
    assert.equal(trip.nights, 2)
    assert.ok(result.homes.some(home => home.key === trip.homeKey))
    const interior = trip.pointIds.slice(1, -1).map(id => points.find(item => item.id === id)!)
    assert.ok(interior.every(item => item.id !== 'brief-area-return'))
    assert.equal(trip.distanceKm, buildRouteSegments(points.filter(item => trip.pointIds.includes(item.id)), points).distanceKm)
  }
  const smaller = buildTrips(points, points, placesFor(points), undefined, { homeRadiusKm: 10 })
  assert.equal(smaller.trips.length, 1)
  assert.equal(smaller.trips[0]!.nights, 4)
})

test('unobserved time before the first outside fix cannot supply a second away night', () => {
  const points = weekend()
  points[1]!.timestamp = '2025-03-08T16:00:00Z'
  assert.equal(analyse(points).trips.length, 0)
  const nearby = weekend('2025-03-07T14:00:00Z', 60.05, 10.7)
  assert.equal(analyse(nearby).trips.length, 0)
  assert.equal(buildTrips(nearby, nearby, placesFor(nearby), undefined, { homeRadiusKm: 10 }).trips.length, 1)
})

test('international stays aggregate by city across different hotels while domestic stays retain their area identity', () => {
  const first = weekend('2025-03-07T14:00:00Z', 55.68, 12.57)
  first[1]!.label = 'First Hotel Name'
  const second = weekend('2025-03-14T14:00:00Z', 55.72, 12.59).map(item => ({ ...item, id: `${item.id}-2` }))
  second[1]!.label = 'Second Hotel Name'
  const points = [...first, ...second]
  const places = placesFor(points, [{ key: 'DK:Copenhagen', name: 'Copenhagen', countryCode: 'DK', ids: ['hotel', 'hotel-2'] }])
  const result = analyse(points, places)
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0]!.destination.name, 'Copenhagen')
  assert.equal(result.groups[0]!.destination.kind, 'city')
  for (const trip of result.trips) {
    assert.equal(trip.scope, 'international')
    assert.equal(trip.homeCountryCode, 'NO')
    assert.deepEqual(trip.countryCodes, ['NO', 'DK'])
    assert.ok(trip.places.every(place => place.kind === 'city'))
  }
  const domesticPlaces = placesFor(points, [{ key: 'NO:Example', name: 'Example city', countryCode: 'NO', ids: ['hotel', 'hotel-2'] }])
  const domestic = analyse(points, domesticPlaces)
  assert.equal(domestic.groups.length, 2)
  assert.ok(domestic.trips.every(trip => trip.scope === 'domestic' && trip.destination.kind === 'place'))
})

test('foreign flyover coordinates do not change a domestic destination into an international visit', () => {
  const points = weekend()
  points.splice(1, 0, point('flyover', '2025-03-07T15:00:00Z', 60.5, 12.2))
  const places = placesFor(points, [{ key: 'NO:Stay', name: 'Domestic stay', countryCode: 'NO', ids: ['hotel'] }, { key: 'SE:Overflight', name: 'Airspace', countryCode: 'SE', ids: ['flyover'] }])
  const trip = analyse(points, places).trips[0]!
  assert.equal(trip.scope, 'domestic')
  assert.deepEqual(trip.countryCodes, ['NO'])
})

test('outbound explicit and inferred flights veto roadtrip even when every inter-stop leg is by road', () => {
  const explicit = twoStopTrip(2, 2, 'road')
  explicit[0]!.activities = [{ id: 'outbound-flight', mode: 'flight', startTimestamp: explicit[0]!.endTimestamp!, endTimestamp: explicit[1]!.timestamp, distanceKm: 60 }]
  const explicitTrip = analyse(explicit).trips[0]!
  assert.equal(explicitTrip.hasFlight, true)
  assert.equal(explicitTrip.category, 'multi-stop')
  const inferred = twoStopTrip(2, 2, 'road')
  inferred[1]!.lat = 55
  inferred[1]!.lng = 10.7
  inferred[1]!.timestamp = '2025-03-07T15:00:00Z'
  inferred[2]!.lat = 54
  inferred[2]!.lng = 10.7
  inferred.splice(1, 0, point('flight-sample', '2025-03-07T14:30:00Z', 57.5, 10.7))
  const inferredTrip = analyse(inferred).trips[0]!
  assert.equal(inferredTrip.hasFlight, true)
  assert.equal(inferredTrip.category, 'multi-stop')
})

test('home inference needs thirty distinct nights in sixty days or strong explicit Home records', () => {
  const residence = (count: number) => {
    const start = Date.parse('2025-01-01T12:00:00Z')
    return [...Array.from({ length: count }, (_, day) => visit(`night-${day}`, iso(start + day * DAY), iso(start + day * DAY + 20 * HOUR))), ...[70, 72, 74].map(day => visit(`later-${day}`, iso(start + day * DAY), iso(start + day * DAY + 20 * HOUR)))]
  }
  assert.equal(analyse(residence(29)).homeStatus, 'missing')
  const inferred = analyse(residence(30))
  assert.equal(inferred.homeStatus, 'detected')
  assert.equal(inferred.homes[0]!.recordedNights, 30)
  assert.equal(inferred.homes[0]!.explicit, false)
  const short = analyse(weekend())
  assert.equal(short.homes[0]!.explicit, true)
  assert.ok(short.homes[0]!.recordedNights < 30)
})

test('domestic and international scope follows the contemporaneous home country after a move', () => {
  const old = [home('old-home-1', '2025-01-01T12:00:00Z', '2025-01-02T08:00:00Z'), home('old-home-2', '2025-01-03T12:00:00Z', '2025-01-04T08:00:00Z')]
  const points = [...old, visit('new-home-out', '2025-03-06T14:00:00Z', '2025-03-07T14:00:00Z', 55.68, 12.57, 'Home'), visit('hotel', '2025-03-07T16:00:00Z', '2025-03-09T08:00:00Z', 56.2, 12.57, 'Hotel'), visit('new-home-in', '2025-03-09T12:00:00Z', '2025-03-10T08:00:00Z', 55.68, 12.57, 'Home')]
  const places = placesFor(points, [{ key: 'DK:Home', name: 'New home city', countryCode: 'DK', ids: ['new-home-out', 'new-home-in'] }, { key: 'DK:Destination', name: 'Destination', countryCode: 'DK', ids: ['hotel'] }])
  const result = analyse(points, places)
  assert.equal(result.homeCount, 2)
  assert.equal(result.trips.length, 1)
  assert.equal(result.trips[0]!.homeCountryCode, 'DK')
  assert.equal(result.trips[0]!.scope, 'domestic')
  assert.deepEqual(result.trips[0]!.countryCodes, ['DK'])
})
