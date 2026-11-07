import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStatistics } from '../src/statistics.ts'
import { prepareTimeline } from '../src/timelineIndex.ts'
import { buildRouteSegments } from '../src/routes.ts'
import type { TimelineActivity, TimelinePoint } from '../src/timeline.ts'
import type { PlaceAnalysis } from '../src/places.ts'
import { pointDateKeys } from '../src/pointDates.ts'

const emptyPlaces: PlaceAnalysis = { countries: [], cities: [] }
const point = (id: string, timestamp: string, lat = 59.91, lng = 10.7): TimelinePoint => ({ id, timestamp, lat, lng, kind: 'path', source: 'timelinePath', label: 'Rutepunkt' })
const visit = (id: string, timestamp: string, endTimestamp: string, lat: number, lng: number, label = 'Besøkt sted'): TimelinePoint => ({ ...point(id, timestamp, lat, lng), kind: 'visit', source: 'visit', endTimestamp, label })
const analyse = (points: TimelinePoint[], selected = points, places = emptyPlaces) => buildStatistics(selected, points, prepareTimeline(points).days, places)
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const cityPlaces = (points: TimelinePoint[], assignments: { key: string; name: string; countryCode?: string; ids: string[] }[]): PlaceAnalysis => ({ countries: [], cities: assignments.map(city => {
  const assigned = points.filter(point => city.ids.includes(point.id))
  const dates = [...new Set(assigned.flatMap(pointDateKeys))].sort().reverse()
  return { key: city.key, name: city.name, countryCode: city.countryCode, days: dates.length, dates, pointCount: assigned.length, pointIds: assigned.map(point => point.id) }
}) })
const commuteCities = (points: TimelinePoint[]) => cityPlaces(points, [
  { key: 'NO:Oslo', name: 'Oslo', countryCode: 'NO', ids: points.filter(point => point.id.startsWith('home')).map(point => point.id) },
  { key: 'NO:Lillestrøm', name: 'Lillestrøm', countryCode: 'NO', ids: points.filter(point => point.id.startsWith('work')).map(point => point.id) },
])

test('daily, monthly and yearly distance reconcile using arrival-local dates at New Year', () => {
  const points = [point('a', '2024-12-31T22:50:00Z'), point('b', '2024-12-31T23:10:00Z', 59.93, 10.72)]
  const stats = analyse(points)
  const route = buildRouteSegments(points)
  assert.deepEqual(stats.years, [2025, 2024])
  assert.equal(stats.all.recordedDays, 2)
  assert.deepEqual(stats.all.daily.map(day => day.date), ['2024-12-31', '2025-01-01'])
  assert.equal(stats.byYear['2024']!.distanceKm, 0)
  close(stats.byYear['2025']!.distanceKm, route.distanceKm)
  close(sum(stats.all.monthly.map(month => month.distanceKm)), route.distanceKm)
  close(sum(stats.all.daily.map(day => day.distanceKm)), route.distanceKm)
  close(sum(Object.values(stats.byYear).map(year => year.distanceKm)), route.distanceKm)
  close(stats.all.hourlyMinutes[23]!, 10)
  close(stats.all.hourlyMinutes[0]!, 10)
  close(stats.byYear['2024']!.hourlyMinutes[23]!, 10)
  close(stats.byYear['2025']!.hourlyMinutes[0]!, 10)
})

test('recorded stationary visits include leap day without manufacturing travelled distance', () => {
  const stats = analyse([visit('stay', '2024-02-28T22:00:00Z', '2024-03-01T01:00:00Z', 59.91, 10.7)])
  assert.deepEqual(stats.all.daily, [
    { date: '2024-02-28', distanceKm: 0 }, { date: '2024-02-29', distanceKm: 0 }, { date: '2024-03-01', distanceKm: 0 },
  ])
  assert.equal(stats.all.monthly[1]!.recordedDays, 2)
  assert.equal(stats.all.monthly[2]!.recordedDays, 1)
  assert.equal(sum(stats.all.hourlyMinutes), 0)
})

test('the movement clock measures duration rather than the number of GPS samples', () => {
  const dense = Array.from({ length: 5 }, (_, index) => point(String(index), new Date(Date.parse('2025-04-01T10:10:00Z') + index * 5 * 60_000).toISOString(), 59.91 + index * 0.002, 10.7))
  const sparse = [dense[0]!, dense[4]!]
  const denseStats = analyse(dense)
  const sparseStats = analyse(sparse)
  close(sum(denseStats.all.hourlyMinutes), 20)
  assert.deepEqual(denseStats.all.hourlyMinutes, sparseStats.all.hourlyMinutes)
  assert.equal(denseStats.all.hourlyMinutes[12], 20, 'Clock follows Oslo summer time')
})

test('the movement clock handles skipped and repeated DST hours by elapsed time', () => {
  const spring = analyse([point('a', '2025-03-30T00:50:00Z'), point('b', '2025-03-30T01:10:00Z', 59.93, 10.72)])
  assert.equal(spring.all.hourlyMinutes[1], 10)
  assert.equal(spring.all.hourlyMinutes[2], 0)
  assert.equal(spring.all.hourlyMinutes[3], 10)
  const fall = analyse([point('a', '2025-10-26T00:50:00Z'), point('b', '2025-10-26T01:10:00Z', 59.93, 10.72)])
  assert.equal(fall.all.hourlyMinutes[2], 20)
  assert.equal(sum(fall.all.hourlyMinutes), 20)
})

test('long recording gaps and explicit short flights do not manufacture surface activity time', () => {
  const long = analyse([point('a', '2025-06-01T08:00:00Z'), point('b', '2025-06-01T20:00:00Z', 31.23, 121.47)])
  assert.ok(long.all.distanceKm > 7000)
  assert.equal(sum(long.all.hourlyMinutes), 0)
  const start = point('start', '2025-06-01T08:00:00Z')
  const end = point('end', '2025-06-01T08:20:00Z', 60.2, 11)
  const activity: TimelineActivity = { id: 'flight', mode: 'flight', startTimestamp: start.timestamp, endTimestamp: end.timestamp, distanceKm: 36 }
  start.activities = [activity]
  end.activities = [activity]
  const short = analyse([start, end])
  assert.ok(short.all.distanceKm > 30)
  assert.equal(sum(short.all.hourlyMinutes), 0)
})

test('place rankings filter dates per year and discoveries use first-ever recorded dates', () => {
  const points = [point('a', '2024-08-01T10:00:00Z'), point('b', '2025-06-01T10:00:00Z')]
  const places: PlaceAnalysis = {
    countries: [{ key: 'NO', name: 'Norge', countryCode: 'NO', days: 2, dates: ['2025-06-01', '2024-08-01'], pointCount: 2, pointIds: ['a', 'b'] }],
    cities: [{ key: 'NO:new', name: 'New city', countryCode: 'NO', days: 1, dates: ['2025-06-01'], pointCount: 1, pointIds: ['b'] }],
  }
  const stats = analyse(points, points, places)
  assert.equal(stats.all.countryCount, 1)
  assert.equal(stats.byYear['2024']!.countries[0]!.days, 1)
  assert.equal(stats.byYear['2024']!.cityCount, 0)
  assert.deepEqual(stats.byYear['2025']!.newPlaces.map(place => [place.kind, place.name]), [['city', 'New city']])
  assert.deepEqual(stats.byYear['2024']!.newPlaces.map(place => place.key), ['NO'])
})

function commute() {
  return [
    visit('home-1', '2025-01-01T06:00:00Z', '2025-01-01T08:00:00Z', 59.91, 10.7, 'HOME'),
    visit('work-1', '2025-01-01T09:00:00Z', '2025-01-01T16:00:00Z', 59.96, 10.78, 'WORK'),
    visit('home-2', '2025-01-01T17:00:00Z', '2025-01-02T08:00:00Z', 59.9108, 10.7008, 'HOME'),
    visit('work-2', '2025-01-02T09:00:00Z', '2025-01-02T16:00:00Z', 59.9608, 10.7808, 'WORK'),
  ]
}

test('repeated city routes combine local stops and both travel directions under stable city identities', () => {
  const points = commute()
  points[0]!.label = 'Besøkt sted'
  points.splice(1, 0, visit('home-cafe', '2025-01-01T08:10:00Z', '2025-01-01T08:30:00Z', 59.93, 10.72, 'Cafe'))
  const places = commuteCities(points)
  const stats = analyse(points, points, places)
  assert.equal(stats.all.patterns.length, 1)
  const pattern = stats.all.patterns[0]!
  assert.equal(pattern.count, 3)
  assert.deepEqual([pattern.from, pattern.to], [
    { key: 'NO:Lillestrøm', name: 'Lillestrøm', countryCode: 'NO' },
    { key: 'NO:Oslo', name: 'Oslo', countryCode: 'NO' },
  ])
  assert.equal(pattern.lastDate, '2025-01-02')
  assert.equal(stats.byYear['2025']!.patterns[0]!.count, 3)
  assert.deepEqual(analyse(points, points, { ...places, cities: [...places.cities].reverse() }).all.patterns, stats.all.patterns)
  const localOnly = cityPlaces(points, [{ key: 'NO:Oslo', name: 'Oslo', countryCode: 'NO', ids: points.map(point => point.id) }])
  assert.deepEqual(analyse(points, points, localOnly).all.patterns, [], 'Local stops never become same-city route rows')
})

test('filtered observations, invalid visit gaps and short stops cannot inflate repeated routes', () => {
  const visits = commute()
  const outlier = point('excluded', '2025-01-01T08:30:00Z', 4.7, -74)
  const points = [visits[0]!, outlier, ...visits.slice(1)]
  const filtered = analyse(points, visits, commuteCities(visits))
  assert.equal(filtered.all.patterns[0]!.count, 2, 'The journey spanning a hidden observation is not counted')
  const longGap = commute()
  longGap[1]!.timestamp = '2025-01-04T09:00:00Z'
  longGap[1]!.endTimestamp = '2025-01-04T16:00:00Z'
  assert.deepEqual(analyse(longGap.slice(0, 2), longGap.slice(0, 2), commuteCities(longGap)).all.patterns, [])
  const brief = commute().map(item => ({ ...item, endTimestamp: new Date(Date.parse(item.timestamp) + 5 * 60_000).toISOString() }))
  assert.deepEqual(analyse(brief, brief, commuteCities(brief)).all.patterns, [])
})

test('nested visits retain the full stay before counting a journey to another place', () => {
  const points = [
    visit('home-long', '2025-01-01T10:00:00Z', '2025-01-01T13:00:00Z', 59.91, 10.7, 'HOME'),
    visit('home-nested', '2025-01-01T11:00:00Z', '2025-01-01T11:30:00Z', 59.9105, 10.7005, 'HOME'),
    visit('work-overlap', '2025-01-01T12:00:00Z', '2025-01-01T12:30:00Z', 59.96, 10.78, 'WORK'),
    visit('home-later', '2025-01-01T14:00:00Z', '2025-01-01T15:00:00Z', 59.91, 10.7, 'HOME'),
    visit('work-later', '2025-01-01T16:00:00Z', '2025-01-01T17:00:00Z', 59.96, 10.78, 'WORK'),
  ]
  const before = structuredClone(points)
  const stats = analyse(points, points, commuteCities(points))
  assert.equal(stats.all.patterns.length, 1)
  assert.equal(stats.all.patterns[0]!.count, 2, 'Only the two later non-overlapping transitions are counted')
  assert.deepEqual(points, before, 'Merging for statistics must not modify source visit intervals')

  const afterStay = [points[0]!, points[1]!,
    visit('work-after', '2025-01-01T14:00:00Z', '2025-01-01T15:00:00Z', 59.96, 10.78, 'WORK'),
    visit('home-return', '2025-01-01T16:00:00Z', '2025-01-01T17:00:00Z', 59.91, 10.7, 'HOME')]
  assert.equal(analyse(afterStay, afterStay, commuteCities(afterStay)).all.patterns[0]!.count, 2, 'A departure after the complete stay remains valid')
})

test('unknown meaningful city stops break route chains while unmapped transit points do not', () => {
  const points = commute()
  points.splice(1, 0, visit('unknown-stop', '2025-01-01T08:10:00Z', '2025-01-01T08:25:00Z', 59.93, 10.73))
  const known = commuteCities(points)
  assert.equal(analyse(points, points, known).all.patterns[0]!.count, 2, 'No direct city journey is invented across an unknown stop')
  const transit = { ...points[1]!, kind: 'path' as const, source: 'timelinePath' as const, endTimestamp: undefined }
  const through = [points[0]!, transit, ...points.slice(2)]
  assert.equal(analyse(through, through, known).all.patterns[0]!.count, 3, 'Travel between city stays can naturally pass through unmapped areas')
})

test('different cities with the same name stay distinct and yearly route counts use the same pair key', () => {
  const points = [
    visit('a1', '2024-12-30T06:00:00Z', '2024-12-30T08:00:00Z', 59.91, 10.7),
    visit('b1', '2024-12-30T09:00:00Z', '2024-12-30T16:00:00Z', 59.96, 10.78),
    visit('a2', '2024-12-30T17:00:00Z', '2025-01-01T08:00:00Z', 59.91, 10.7),
    visit('b2', '2025-01-01T09:00:00Z', '2025-01-01T16:00:00Z', 59.96, 10.78),
    visit('a3', '2025-01-01T17:00:00Z', '2025-01-01T18:00:00Z', 59.91, 10.7),
  ]
  const places = cityPlaces(points, [
    { key: 'NO:Same:1', name: 'Same name', countryCode: 'NO', ids: ['a1', 'a2', 'a3'] },
    { key: 'SE:Same:2', name: 'Same name', countryCode: 'SE', ids: ['b1', 'b2'] },
  ])
  const stats = analyse(points, points, places)
  assert.equal(stats.all.patterns[0]!.count, 4)
  assert.notEqual(stats.all.patterns[0]!.from.key, stats.all.patterns[0]!.to.key)
  assert.deepEqual([stats.all.patterns[0]!.from.countryCode, stats.all.patterns[0]!.to.countryCode], ['NO', 'SE'])
  for (const year of ['2024', '2025']) {
    assert.equal(stats.byYear[year]!.patterns[0]!.count, 2)
    assert.equal(stats.byYear[year]!.patterns[0]!.key, stats.all.patterns[0]!.key)
  }
})

test('empty imports and malformed place dates return finite empty aggregates', () => {
  const stats = buildStatistics([], [], [], { countries: [{ key: 'empty', name: 'Empty', days: 0, dates: [], pointCount: 0, pointIds: [] }], cities: [] })
  assert.deepEqual(stats.years, [])
  assert.equal(stats.all.distanceKm, 0)
  assert.equal(stats.all.recordedDays, 0)
  assert.deepEqual(stats.all.newPlaces, [])
  assert.equal(stats.all.monthly.length, 12)
  assert.deepEqual(stats.all.hourlyMinutes, Array(24).fill(0))
})


test('transport distances reconcile with the overview and yearly filters, including unknown ground records', () => {
  const points = [point('a', '2024-12-31T22:50:00Z'), point('b', '2024-12-31T23:10:00Z', 59.93, 10.72)]
  const stats = analyse(points)
  for (const period of [stats.all, ...Object.values(stats.byYear)]) {
    close(sum(period.transport.map(row => row.distanceKm)), period.distanceKm)
  }
  close(sum(Object.values(stats.byYear).flatMap(period => period.transport.map(row => row.minutes))), sum(stats.all.transport.map(row => row.minutes)))
  assert.equal(stats.all.transport.find(row => row.category === 'unknown')!.minutes, 20)
  assert.ok(stats.all.transport.find(row => row.category === 'unknown')!.distanceKm > 0)
})
