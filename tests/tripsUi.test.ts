import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Trips from '../src/Trips.tsx'
import { groupTripHistory, selectTripHistory } from '../src/tripsView.ts'
import type { TimelineTrip, TripDestination, TripsAnalysis } from '../src/trips.ts'

const cabin: TripDestination = { key: 'stay:cabin', name: 'Fjord Cabin', locality: 'Øygarden', region: 'Vestland', countryCode: 'NO', kind: 'place' }
const madrid: TripDestination = { key: 'ES:Madrid', name: 'Madrid', countryCode: 'ES', kind: 'city' }
const barcelona: TripDestination = { key: 'ES:Barcelona', name: 'Barcelona', countryCode: 'ES', kind: 'city' }

function trip(id: string, destination = cabin, startDate = '2025-01-10', endDate = new Date(Date.parse(`${startDate}T12:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10)): TimelineTrip {
  return {
    id, destination, category: 'destination', scope: 'domestic', hasFlight: false, homeCountryCode: 'NO', countryCodes: ['NO'],
    startDate, endDate, startTimestamp: `${startDate}T10:00:00Z`, endTimestamp: `${endDate}T18:00:00Z`,
    nights: 5, distanceKm: 9000, places: [destination], pointIds: ['private-point-id'],
  }
}

function foreignTrip(id: string, city = madrid, startDate = '2025-01-10'): TimelineTrip {
  return { ...trip(id, city, startDate), scope: 'international', hasFlight: true, countryCodes: ['NO', city.countryCode!], places: [city] }
}

function analysis(trips: TimelineTrip[] = [trip('second', cabin, '2024-12-28', '2025-01-02'), trip('first')]): TripsAnalysis {
  return {
    homeStatus: 'detected', homeCount: 1, homeRadiusKm: 25,
    homes: [{ key: 'home', name: 'Home village', countryCode: 'NO', startDate: '2024-01-01', lat: 59.9, lng: 10.5, recordedNights: 32, explicit: false }],
    trips, groups: [],
  }
}

const callbacks = { onRetry() {}, onOpenTrip() {}, onHomeRadiusChange() {} }
function render(data: TripsAnalysis | null = analysis(), language: 'nb' | 'en' = 'en', homeRadiusKm = 25) {
  return renderToStaticMarkup(createElement(Trips, { ...callbacks, data, loading: false, language, homeRadiusKm }))
}

function recentRows(html: string): string[] {
  return html.match(/<li class="trips-recent-row">[\s\S]*?<\/li>/g) ?? []
}

function destinationCards(html: string): string[] {
  return html.match(/<button type="button" class="trips-destination-card(?: first)?"[^>]*>[\s\S]*?<\/button>/g) ?? []
}

test('Trips keeps three overview metrics, complete journey actions and radius controls without route distance UI', () => {
  const html = render()
  assert.equal((html.match(/class="trips-metric"/g) ?? []).length, 2)
  assert.equal((html.match(/class="trips-hero"/g) ?? []).length, 1)
  assert.match(html, /<strong>10<\/strong><span>Nights away/)
  assert.match(html, /<strong title="Fjord Cabin">Fjord Cabin<\/strong><small[^>]*>Øygarden · Vestland · Norway<\/small>/)
  assert.match(html, /aria-label="View on map: Fjord Cabin, 28 Dec 2024 – 2 Jan 2025"/)
  assert.match(html, /dateTime="2025-01-02"/)
  assert.match(html, /<option value="10">10 km<\/option><option value="25" selected="">25 km<\/option><option value="50">50 km<\/option>/)
  assert.doesNotMatch(html, /Estimated distance|9000|9,000 km|private-point-id|NaN|Infinity/)
})

test('domestic top five cards rank specific stays by count, preserving separate stays in one locality', () => {
  const trips = [1, 3, 5, 2, 7, 4, 6].flatMap(count => {
    const destination: TripDestination = { key: `stay-${count}`, name: `Stay ${count}`, locality: 'Same city', countryCode: 'NO', kind: 'place' }
    return Array.from({ length: count }, (_, index) => trip(`stay-${count}-${index}`, destination))
  })
  const itinerary: TripDestination = { key: 'road-tour', name: 'Oslo → Bergen', kind: 'itinerary' }
  trips.push(...Array.from({ length: 20 }, (_, index) => ({ ...trip(`road-${index}`, itinerary), category: 'roadtrip' as const })))
  const html = render(analysis(trips))
  const cards = destinationCards(html)
  assert.equal(cards.length, 5)
  assert.deepEqual(cards.map(card => card.match(/<strong title="(Stay \d+)">/)?.[1]), ['Stay 7', 'Stay 6', 'Stay 5', 'Stay 4', 'Stay 3'])
  assert.ok(cards.every(card => /aria-pressed="false"/.test(card) && /aria-controls="[^"]+"/.test(card)))
  assert.doesNotMatch(cards.join(''), /Oslo → Bergen/)
  assert.match(html, /<strong>7<\/strong><span>Destinations/)
  assert.equal(groupTripHistory(trips, 'domestic').length, 7)
})

test('country groups combine repeated city trips and deduplicate multi-country membership without inflating trips or nights', () => {
  const madridTrip = foreignTrip('madrid', madrid)
  const barcelonaTrip = foreignTrip('barcelona', barcelona, '2025-02-10')
  const lisbon: TripDestination = { key: 'PT:Lisbon', name: 'Lisbon', countryCode: 'PT', kind: 'city' }
  const multi = { ...foreignTrip('iberia'), countryCodes: ['NO', 'ES', 'PT', 'ES'], places: [madrid, madrid, lisbon], category: 'multi-stop' as const }
  const trips = [madridTrip, barcelonaTrip, multi]
  const groups = groupTripHistory(trips, 'international')
  assert.deepEqual(groups.map(group => [group.destination.countryCode, group.trips.length]), [['ES', 3], ['PT', 1]])
  assert.deepEqual(groups[0]!.cities.map(city => [city.destination.name, city.count]), [['Madrid', 2], ['Barcelona', 1]])
  assert.deepEqual(selectTripHistory(trips, { scope: 'international', countryCode: 'ES', cityKey: madrid.key }).map(item => item.id).sort(), ['iberia', 'madrid'])
  assert.equal(selectTripHistory(trips, { countryCode: 'PT', cityKey: madrid.key }).length, 0)
  assert.equal(selectTripHistory(trips, { countryCode: 'NO' }).length, 0)
  const html = render(analysis(trips))
  assert.equal(destinationCards(html).length, 2)
  assert.match(html, /Most visited countries/)
  assert.match(html, /<strong title="Spain">Spain<\/strong>/)
  assert.match(html, /<option value="country:ES">Spain \(3\)<\/option>/)
  assert.match(html, /<strong>15<\/strong><span>Nights away/)
  assert.match(html, /<strong>2<\/strong><span>Countries/)
  assert.equal(recentRows(html).length, 3)
  assert.doesNotMatch(destinationCards(html).join(''), /Fjord Cabin|title="Madrid"/)
})

test('scope, year and stay filters retain full cross-year journeys and distinguish domestic stays', () => {
  const otherStay = trip('different-cabin', { ...cabin, key: 'stay:other', name: 'Other cabin' }, '2024-12-20', '2024-12-23')
  const abroad = foreignTrip('abroad', madrid, '2024-12-01')
  const data = analysis()
  data.trips.push(otherStay, abroad)
  assert.deepEqual(selectTripHistory(data.trips, { year: '2024', scope: 'domestic', destinationKey: cabin.key }).map(item => item.id), ['second'])
  assert.deepEqual(selectTripHistory(data.trips, { year: '2024', scope: 'domestic' }).map(item => item.id), ['second', 'different-cabin'])
  assert.deepEqual(selectTripHistory(data.trips, { year: '2024', scope: 'international' }).map(item => item.id), ['abroad'])
  assert.equal(selectTripHistory(data.trips, { year: '2024', destinationKey: cabin.key })[0]!.endDate, '2025-01-02')
  assert.equal(selectTripHistory(data.trips, { destinationKey: 'unknown-stay' }).length, 0)
  const html = render(data)
  assert.match(html, /aria-pressed="true">Domestic<span>3<\/span>/)
  assert.match(html, /aria-pressed="false">International<span>1<\/span>/)
  assert.match(html, /<option value="all" selected="">All time<\/option><option value="2025">2025<\/option><option value="2024">2024<\/option>/)
})

test('recent journeys remain chronological and country-first, with city context', () => {
  const trips = [foreignTrip('old', madrid, '2024-02-10'), foreignTrip('new', barcelona, '2026-02-10'), foreignTrip('middle', madrid, '2025-02-10')]
  const rows = recentRows(render(analysis(trips)))
  assert.deepEqual(rows.map(row => row.match(/dateTime="([^"]+)"/)?.[1]), ['2026-02-10', '2025-02-10', '2024-02-10'])
  assert.match(rows[0]!, /<strong title="Spain">Spain<\/strong>/)
  assert.match(rows[0]!, /<small>Barcelona<\/small>/)
  assert.match(rows[0]!, /aria-label="View on map: Spain/)
})

test('a trip with any flight cannot display a road-trip badge even if a category is inconsistent', () => {
  const flying = { ...foreignTrip('flying'), category: 'roadtrip' as const }
  const html = render(analysis([flying]))
  assert.match(recentRows(html)[0]!, /trips-category">Multi-stop/)
  assert.doesNotMatch(recentRows(html)[0]!, /Road trip/)
  const driving = { ...trip('drive', { key: 'route', name: 'Bergen → Trondheim', kind: 'itinerary' }), category: 'roadtrip' as const }
  assert.match(recentRows(render(analysis([driving])))[0]!, /trips-category">Road trip/)
})

test('Norwegian controls explain the selected radius without showing the user’s home history', () => {
  const data = analysis()
  data.homes.unshift({ key: 'old-home', name: 'Old village', startDate: '2020-01-01', lat: 60, lng: 11, recordedNights: 14, explicit: true })
  const html = render(data, 'nb')
  assert.match(html, /Innlands/)
  assert.match(html, /Utlands/)
  assert.match(html, /innenfor 25 km/)
  assert.doesNotMatch(html, /Home village|Old village|32 registrerte netter|Senest registrerte hjemmebase/)
  assert.match(html, /30 registrerte netter[^<]*60 dager/)
  assert.match(html, /nettene trenger ikke være sammenhengende/)
  assert.match(html, /hjemmemerking gi en hjemmebase med færre netter/)
  assert.match(html, /aria-label="Vis på kartet: Fjord Cabin/)
})

test('changing radius hides stale trips while keeping configuration usable', () => {
  const html = render(analysis(), 'en', 50)
  assert.match(html, /role="status"/)
  assert.match(html, /<option value="50" selected="">50 km<\/option>/)
  assert.match(html, /within 50 km/)
  assert.doesNotMatch(html, /trips-overview|trips-recent-list/)
  const matching = { ...analysis(), homeRadiusKm: 50 }
  assert.equal(recentRows(render(matching, 'en', 50)).length, 2)
})

test('unresolved home-country trips stay accessible in an explicit unknown category', () => {
  const unknown = { ...trip('unknown'), scope: 'unknown' as const, homeCountryCode: undefined, countryCodes: [] }
  const html = render(analysis([unknown]))
  assert.match(html, /aria-pressed="true">Unclassified<span>1<\/span>/)
  assert.equal(recentRows(html).length, 1)
  assert.doesNotMatch(render(), /aria-pressed="[^"]+">Unclassified/)
})

test('small settlement destinations retain municipality context without repeating the place name', () => {
  const destination: TripDestination = { key: 'mountain-cabin', name: 'Skålsrudstølane', locality: 'Skålsrudstølane', region: 'Nesbyen, Buskerud', countryCode: 'NO', kind: 'place' }
  const html = render(analysis([trip('cabin-trip', destination)]), 'nb')
  assert.match(html, /<strong title="Skålsrudstølane">Skålsrudstølane<\/strong><small[^>]*>Nesbyen, Buskerud · Norge<\/small>/)
  assert.match(recentRows(html)[0]!, /<small>Nesbyen, Buskerud · Norge<\/small>/)
  assert.doesNotMatch(html, /Skålsrudstølane · Skålsrudstølane/)
})

test('large histories render five cards and ten recent trips without expanding every stop list', () => {
  const trips = Array.from({ length: 40 }, (_, index) => {
    const destination: TripDestination = { key: `place-${index}`, name: `Place ${index}`, countryCode: 'NO', kind: 'place' }
    return Array.from({ length: 15 }, (_, journey) => {
      const item = trip(`trip-${index}-${journey}`, destination)
      item.places = Array.from({ length: 1000 }, (_, stop) => ({ key: `stop-${stop}`, name: `Stop ${stop}`, kind: 'place' as const }))
      return item
    })
  }).flat()
  const html = render(analysis(trips))
  assert.equal(destinationCards(html).length, 5)
  assert.equal(recentRows(html).length, 10)
  assert.match(html, /aria-label="Trip pages"/)
  assert.match(html, /1–10 of 600 trips/)
  assert.doesNotMatch(html, /<span>Stop \d+<\/span>/)
})

test('missing home, no qualifying trips and no data are distinct states', () => {
  const missingHome = render({ ...analysis([]), homeStatus: 'missing', homeCount: 0, homes: [] })
  assert.match(missingHome, /No home found in this file/)
  assert.doesNotMatch(missingHome, /trips-overview|trips-recent-list/)
  assert.match(render(analysis([])), /No trips with two nights away yet/)
  assert.match(render(null), /Import a Timeline file/)
})

test('loading and errors hide old results while leaving radius settings and retry available', () => {
  const props = { ...callbacks, data: analysis(), language: 'en' as const, homeRadiusKm: 25 }
  const loading = renderToStaticMarkup(createElement(Trips, { ...props, loading: true }))
  assert.match(loading, /role="status"/)
  assert.match(loading, /Home area/)
  assert.doesNotMatch(loading, /trips-destination-card|trips-recent-list/)
  const error = renderToStaticMarkup(createElement(Trips, { ...props, loading: false, error: 'Please retry.' }))
  assert.match(error, /role="alert"/)
  assert.match(error, /Try again/)
  assert.doesNotMatch(error, /trips-destination-card|trips-recent-list/)
})
