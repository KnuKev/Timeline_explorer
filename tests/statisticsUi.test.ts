import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Statistics from '../src/Statistics.tsx'
import type { StatisticsAnalysis, StatisticsPeriod } from '../src/statistics.ts'

function fixture(): StatisticsAnalysis {
  const period: StatisticsPeriod = {
    distanceKm: 325, recordedDays: 3, countryCount: 2, cityCount: 3, humanPoweredDistanceKm: 5,
    monthly: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, distanceKm: index === 1 ? 325 : 0, recordedDays: index === 1 ? 3 : 0 })),
    daily: [{ date: '2024-02-27', distanceKm: 0 }, { date: '2024-02-28', distanceKm: 25 }, { date: '2024-02-29', distanceKm: 300 }],
    hourlyMinutes: Array.from({ length: 24 }, (_, hour) => hour === 17 ? 120 : hour === 8 ? 30 : 0),
    transport: [{ category: 'flight', distanceKm: 200, minutes: 90 }, { category: 'road', distanceKm: 100, minutes: 45 }, { category: 'rail', distanceKm: 20, minutes: 20 }, { category: 'unknown', distanceKm: 5, minutes: 10 }],
    countries: [{ key: 'NO', name: 'Norge', countryCode: 'NO', days: 3 }],
    cities: [{ key: 'oslo', name: 'Oslo', countryCode: 'NO', days: 2 }],
    newPlaces: Array.from({ length: 30 }, (_, index) => ({ key: `place-${index}`, kind: 'country' as const, name: `Place ${index}`, date: '2024-02-29' })),
    patterns: [{ key: 'route', from: { key: 'NO:Oslo', name: 'Oslo', countryCode: 'NO' }, to: { key: 'NO:Bergen', name: 'Bergen', countryCode: 'NO' }, count: 4, lastDate: '2024-02-29' }],
  }
  return { years: [2024], all: period, byYear: { '2024': period } }
}

const render = (data = fixture(), language: 'nb' | 'en' = 'en') => renderToStaticMarkup(createElement(Statistics, {
  data, loading: false, language, onRetry() {}, onOpenRange() {},
}))

test('statistics calendar includes leap day and distinguishes missing records from recorded zero distance', () => {
  const html = render()
  assert.equal((html.match(/data-date="2024-/g) ?? []).length, 366)
  assert.match(html, /data-date="2024-02-27" class="statistics-calendar-day level-0"[^>]*aria-label="[^"]*0 m/)
  assert.match(html, /data-date="2024-02-29" class="statistics-calendar-day level-5"/)
  assert.match(html, /data-date="2024-03-01" class="statistics-calendar-day level-unknown"[^>]*disabled=""/)
  assert.doesNotMatch(html, /NaN|Infinity/)
})

test('statistics exposes the real hourly peak and bounded lists in both languages', () => {
  const english = render()
  assert.match(english, /MOST ACTIVE: 17–18/)
  assert.match(english, /Oslo <span class="statistics-bidirectional"/)
  assert.match(english, /Norway · /)
  assert.equal((english.match(/class="statistics-new-place"/g) ?? []).length, 8)
  assert.match(english, /Choose a year to open/)
  const norwegian = render(fixture(), 'nb')
  assert.match(norwegian, /MEST AKTIV: 17–18/)
  assert.match(norwegian, /Strekningene du gjentar/)
  assert.match(norwegian, /Oslo <span class="statistics-bidirectional"/)
  assert.match(norwegian, /Norge · /)
})

test('statistics keeps monthly distance while removing the days toggle and duplicate place rankings', () => {
  const html = render()
  const monthly = html.match(/<article class="statistics-card statistics-monthly">([\s\S]*?)<\/article>/)?.[1]
  assert.ok(monthly)
  assert.match(monthly, /325 km/)
  assert.match(monthly, /statistics-chart-unit[^>]*>km/)
  assert.doesNotMatch(monthly, /role="group"|aria-pressed|>Days</)
  assert.doesNotMatch(html, /statistics-place-row|statistics-places"|Most visited places/)
  assert.match(html, /statistics-new-places/)
})

test('a leap year beginning on Sunday keeps its final day in the 54th calendar column', () => {
  const data = fixture()
  data.years = [2012]
  data.all.daily = [{ date: '2012-01-01', distanceKm: 1 }, { date: '2012-12-31', distanceKm: 2 }]
  data.byYear = { '2012': data.all }
  const html = render(data)
  assert.match(html, /--calendar-weeks:54/)
  assert.equal((html.match(/data-date="2012-/g) ?? []).length, 366)
  assert.match(html, /data-date="2012-12-31"[^>]*grid-column:55;grid-row:2/)
})

test('same-name cities remain distinguishable by country without stop coordinates or home labels', () => {
  const data = fixture()
  data.all.patterns = [
    { key: 'france-route', from: { key: 'FR:Paris', name: 'Paris', countryCode: 'FR' }, to: { key: 'DE:Berlin', name: 'Berlin', countryCode: 'DE' }, count: 4, lastDate: '2024-02-29' },
    { key: 'texas-route', from: { key: 'US:Paris', name: 'Paris', countryCode: 'US' }, to: { key: 'DE:Berlin', name: 'Berlin', countryCode: 'DE' }, count: 2, lastDate: '2024-02-28' },
  ]
  const html = render(data)
  assert.equal((html.match(/class="statistics-pattern-row"/g) ?? []).length, 2)
  assert.match(html, /France ↔ Germany/)
  assert.match(html, /United States ↔ Germany/)
  assert.doesNotMatch(html, /statistics-pattern-coordinates|>Home</)
})

test('statistics loading and errors do not present stale charts as current results', () => {
  const props = { data: fixture(), language: 'en' as const, onRetry() {}, onOpenRange() {} }
  const loading = renderToStaticMarkup(createElement(Statistics, { ...props, loading: true }))
  assert.match(loading, /role="status"/)
  assert.doesNotMatch(loading, /statistics-calendar-day/)
  const error = renderToStaticMarkup(createElement(Statistics, { ...props, loading: false, error: 'Please retry.' }))
  assert.match(error, /role="alert"/)
  assert.match(error, /Try again/)
  assert.doesNotMatch(error, /statistics-calendar-day/)
})


test('transport shows recognised categories and makes incomplete coverage explicit', () => {
  const english = render().match(/<article class="statistics-card statistics-transport">([\s\S]*?)<\/article>/)?.[1]
  assert.ok(english)
  assert.equal((english.match(/class="statistics-transport-row /g) ?? []).length, 3)
  assert.match(english, /aria-label="Show transport by distance or time"/)
  assert.match(english, /aria-pressed="true"[^>]*>km/)
  assert.match(english, /aria-pressed="false"[^>]*>Hours/)
  for (const label of ['Flights', 'Car / bus', 'Train / tram / metro', '200 km', '98% of estimated distance', '5 km is outside this breakdown']) assert.ok(english.includes(label), label)
  assert.match(english, /<details[^>]*><summary>About the categories/)
  assert.doesNotMatch(english, /transport-unknown/);
  assert.match(english, /not your total travel/)
  const norwegian = render(fixture(), 'nb')
  for (const label of ['Bil / buss', 'Tog / trikk / metro', 'utenfor fordelingen', '>Timer<']) assert.ok(norwegian.includes(label), label)
})

test('transport handles a stationary period without NaN bars or implied travel', () => {
  const data = fixture()
  data.all.transport = data.all.transport.map(entry => ({ ...entry, distanceKm: 0, minutes: 0 }))
  const html = render(data).match(/<article class="statistics-card statistics-transport">([\s\S]*?)<\/article>/)?.[1]
  assert.ok(html)
  assert.match(html, /No travel distance recorded in this period/)
  assert.equal((html.match(/style="width:0%"/g) ?? []).length, 3)
  assert.doesNotMatch(html, /NaN|Infinity/)
})


test('unclassified-only travel is still disclosed without claiming there was no travel', () => {
  const data = fixture()
  data.all.transport = [{ category: 'unknown', distanceKm: 325, minutes: 120 }]
  const html = render(data).match(/<article class="statistics-card statistics-transport">([\s\S]*?)<\/article>/)?.[1]
  assert.ok(html)
  assert.match(html, /Transport types could not be recognised/)
  assert.match(html, /0% of estimated distance/)
  assert.match(html, /325 km is outside this breakdown/)
  assert.doesNotMatch(html, /No travel distance recorded|NaN|Infinity/)
})

test('human-powered comparison preserves small positive distances and translates the combined activity label', () => {
  const html = render()
  const card = html.match(/<article class="statistics-card statistics-human-powered [^"]+">([\s\S]*?)<\/article>/)?.[1]
  assert.ok(card)
  assert.match(card, /Walking, running and cycling/)
  assert.match(card, /&lt;0\.01×/)
  assert.match(card, /<strong>5 km<\/strong>/)
  assert.match(card, /One lap ≈ 10,916 km/)
  assert.match(card, /around the Moon/)
  assert.match(card, /class="statistics-power-moon"/)
  assert.doesNotMatch(card, /<select|<option|around Earth|around Mars/)
  assert.ok(html.indexOf('statistics-calendar"') < html.indexOf('statistics-transport"'))
  assert.ok(html.indexOf('statistics-transport"') < html.indexOf('statistics-human-powered'))
  const nb = render(fixture(), 'nb')
  assert.match(nb, /Egen kraft/)
  assert.match(nb, /Gåing, løping og sykling/)
  assert.match(nb, /&lt;0,01×/)
})

test('human-powered comparison distinguishes missing recognised activity and distances above a complete lap', () => {
  const data = fixture()
  data.all.humanPoweredDistanceKm = 0
  const empty = render(data).match(/<article class="statistics-card statistics-human-powered [^"]+">([\s\S]*?)<\/article>/)?.[1]
  assert.ok(empty)
  assert.match(empty, /No such journeys were recognised/)
  assert.match(empty, /stroke-dasharray="0 100"[^>]*style="opacity:0"/)
  assert.match(empty, />0×<\/text>/)
  assert.doesNotMatch(empty, /NaN|Infinity/)
  data.all.humanPoweredDistanceKm = 1.5 * 2 * Math.PI * 1737.4
  const complete = render(data).match(/<article class="statistics-card statistics-human-powered [^"]+">([\s\S]*?)<\/article>/)?.[1]
  assert.ok(complete)
  assert.match(complete, />1\.5×<\/text>/)
  assert.match(complete, /stroke-dasharray="100 100"/)
  assert.doesNotMatch(complete, /No such journeys were recognised|NaN|Infinity/)
})
