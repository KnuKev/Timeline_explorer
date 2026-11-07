import tzLookup from 'tz-lookup'
import { distanceKm, type TimelinePoint } from './timeline.ts'
import { buildRouteSegments } from './routes.ts'
import { buildTransportStatistics, type TransportTotal } from './transportStatistics.ts'
import { pointDateKeys } from './pointDates.ts'
import type { IndexedDay } from './timelineIndex.ts'
import type { PlaceAnalysis, PlaceEntry } from './places.ts'

export type StatisticsDay = { date: string; distanceKm: number }
export type StatisticsMonth = { month: number; distanceKm: number; recordedDays: number }
export type StatisticsPlace = { key: string; name: string; countryCode?: string; days: number }
export type StatisticsNewPlace = { key: string; name: string; countryCode?: string; kind: 'country' | 'city'; date: string }
export type StatisticsEndpoint = { key: string; name: string; countryCode?: string }
export type StatisticsPattern = { key: string; from: StatisticsEndpoint; to: StatisticsEndpoint; count: number; lastDate: string }
export type StatisticsPeriod = {
  distanceKm: number
  recordedDays: number
  countryCount: number
  cityCount: number
  monthly: StatisticsMonth[]
  daily: StatisticsDay[]
  hourlyMinutes: number[]
  transport: TransportTotal[]
  humanPoweredDistanceKm: number
  countries: StatisticsPlace[]
  cities: StatisticsPlace[]
  newPlaces: StatisticsNewPlace[]
  patterns: StatisticsPattern[]
}
export type StatisticsAnalysis = { years: number[]; all: StatisticsPeriod; byYear: Record<string, StatisticsPeriod> }

type PeriodBuilder = { days: Map<string, number>; hourlyMinutes: number[]; patterns: Map<string, StatisticsPattern> }
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const MAX_SHORT_EDGE_MS = 30 * MINUTE_MS
const MAX_PATTERN_GAP_MS = 24 * HOUR_MS
const MIN_VISIT_MS = 10 * MINUTE_MS
const validDay = (day: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  const monthDays = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && date >= 1 && date <= monthDays[month - 1]!
}
const newPeriod = (): PeriodBuilder => ({ days: new Map(), hourlyMinutes: Array(24).fill(0), patterns: new Map() })

function placesForPeriod(entries: PlaceEntry[], year?: string): StatisticsPlace[] {
  return entries.map(place => ({ key: place.key, name: place.name, countryCode: place.countryCode,
    days: year ? place.dates.filter(day => Number(day.slice(0, 4)) === Number(year)).length : place.days }))
    .filter(place => place.days > 0)
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

/** Pure worker-side aggregation. Distances belong to the arrival's local date;
 * no distance or activity is invented for an unobserved day between recordings.
 * The clock sums short surface-travel intervals, rather than GPS point density.
 * Repeat routes group meaningful recorded stops by the existing city identity;
 * local stops collapse into one city stay and both travel directions share a row. */
export function buildStatistics(points: TimelinePoint[], allPoints: TimelinePoint[], days: IndexedDay[], places: PlaceAnalysis): StatisticsAnalysis {
  const selected = new Set(points)
  const all = newPeriod()
  const periods = new Map<string, PeriodBuilder>()
  const ensureYear = (date: string) => {
    const year = String(Number(date.slice(0, 4)))
    let period = periods.get(year)
    if (!period) { period = newPeriod(); periods.set(year, period) }
    return period
  }
  const pointDates = new Map<TimelinePoint, string>()
  // Reuse the import's calendar index, including visits spanning midnight.
  for (const day of days) {
    if (!validDay(day.day)) continue
    let recorded = false
    for (const index of day.indices) {
      const point = allPoints[index]!
      if (!selected.has(point)) continue
      recorded = true
      const previous = pointDates.get(point)
      if (!previous || day.day < previous) pointDates.set(point, day.day)
    }
    if (recorded) { all.days.set(day.day, 0); ensureYear(day.day).days.set(day.day, 0) }
  }
  const localDate = (point: TimelinePoint): string | undefined => pointDates.get(point) ?? pointDateKeys(point)[0]

  const clockFormatters = new Map<string, Intl.DateTimeFormat>()
  const zoneByCoordinate = new Map<string, string>()
  const zoneAt = (point: TimelinePoint) => {
    const key = `${point.lat}:${point.lng}`
    let zone = zoneByCoordinate.get(key)
    if (!zone) {
      try { zone = tzLookup(point.lat, point.lng) } catch { zone = 'UTC' }
      if (zoneByCoordinate.size >= 4096) zoneByCoordinate.clear()
      zoneByCoordinate.set(key, zone)
    }
    return zone
  }
  const clockAt = (time: number, zone: string) => {
    let formatter = clockFormatters.get(zone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      clockFormatters.set(zone, formatter)
    }
    const fields: Record<string, string> = {}
    for (const part of formatter.formatToParts(time)) if (part.type !== 'literal') fields[part.type] = part.value
    return { date: `${fields.year}-${fields.month}-${fields.day}`, hour: Number(fields.hour),
      remaining: HOUR_MS - (Number(fields.minute) * MINUTE_MS + Number(fields.second) * 1000 + ((time % 1000) + 1000) % 1000) }
  }
  const addMovement = (start: number, end: number, point: TimelinePoint) => {
    const zone = zoneAt(point)
    let cursor = start
    while (cursor < end) {
      const local = clockAt(cursor, zone)
      if (!validDay(local.date) || !Number.isInteger(local.hour) || local.hour < 0 || local.hour > 23 || local.remaining <= 0) break
      const next = Math.min(end, cursor + local.remaining)
      const minutes = (next - cursor) / MINUTE_MS
      all.hourlyMinutes[local.hour]! += minutes
      ensureYear(local.date).hourlyMinutes[local.hour]! += minutes
      cursor = next
    }
  }

  const route = buildRouteSegments(points, allPoints)
  const transport = buildTransportStatistics(points, allPoints, route)
  for (const year of Object.keys(transport.byYear)) ensureYear(`${year.padStart(4, '0')}-01-01`)
  for (const segment of route.segments) {
    for (let index = 1; index < segment.points.length; index++) {
      const previous = segment.points[index - 1]!
      const current = segment.points[index]!
      const distance = distanceKm([previous, current])
      const date = localDate(current)
      if (!date || !validDay(date) || !Number.isFinite(distance)) continue
      const period = ensureYear(date)
      all.days.set(date, (all.days.get(date) ?? 0) + distance)
      period.days.set(date, (period.days.get(date) ?? 0) + distance)
      let start = Date.parse(previous.timestamp)
      const end = Date.parse(current.timestamp)
      const visitEnd = previous.kind === 'visit' && previous.endTimestamp ? Date.parse(previous.endTimestamp) : NaN
      if (Number.isFinite(visitEnd) && visitEnd >= start && visitEnd <= end) start = visitEnd
      const elapsed = end - start
      // Recovered/gap connections support distance but contain no continuous
      // movement observations, so they do not contribute clock minutes.
      if (segment.transport !== 'flight' && !segment.estimated && elapsed > 0 && elapsed <= MAX_SHORT_EDGE_MS
        && distance >= 0.03 && distance * HOUR_MS / elapsed >= 1) addMovement(start, end, previous)
    }
  }

  // A filtered observation must not turn two unrelated visits into a pattern.
  const missing = new Uint32Array(allPoints.length + 1)
  for (let index = 0; index < allPoints.length; index++) missing[index + 1] = missing[index]! + (selected.has(allPoints[index]!) ? 0 : 1)
  const cityForPoint = new Map<string, PlaceEntry>()
  for (const city of places.cities) for (const id of city.pointIds) cityForPoint.set(id, city)
  const cityEndpoints = new Map(places.cities.map(city => [city.key, { key: city.key, name: city.name, countryCode: city.countryCode }]))
  let previousVisit: { point: TimelinePoint; index: number; city: PlaceEntry; end: number } | undefined
  const addPattern = (period: PeriodBuilder, from: PlaceEntry, to: PlaceEntry, date: string) => {
    const ordered = from.key < to.key ? [from, to] as const : [to, from] as const
    const key = JSON.stringify([ordered[0].key, ordered[1].key])
    const existing = period.patterns.get(key)
    if (existing) { existing.count++; if (date > existing.lastDate) existing.lastDate = date }
    else period.patterns.set(key, { key, from: cityEndpoints.get(ordered[0].key)!, to: cityEndpoints.get(ordered[1].key)!, count: 1, lastDate: date })
  }
  for (let index = 0; index < allPoints.length; index++) {
    const point = allPoints[index]!
    if (!selected.has(point) || point.kind !== 'visit' || !point.endTimestamp) continue
    const start = Date.parse(point.timestamp)
    const end = Date.parse(point.endTimestamp)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_VISIT_MS) continue
    const city = cityForPoint.get(point.id)
    if (!city) {
      // A real stop outside the available city reference is a boundary, not a
      // licence to turn the cities on either side into a direct journey.
      previousVisit = undefined
      continue
    }
    const continuous = previousVisit && missing[index] === missing[previousVisit.index + 1]
    if (previousVisit && continuous && previousVisit.city.key === city.key && start <= previousVisit.end) {
      // Overlapping stops inside one city retain the full occupied interval.
      // The latest-ending stop supplies the departure coordinate, while the
      // first source index keeps the omitted-observation guard intact.
      if (end > previousVisit.end) { previousVisit.end = end; previousVisit.point = point }
      continue
    }
    if (previousVisit && previousVisit.city.key !== city.key && continuous) {
      const elapsed = start - previousVisit.end
      const distance = distanceKm([previousVisit.point, point])
      const date = localDate(point)
      if (date && validDay(date) && elapsed > 0 && elapsed <= MAX_PATTERN_GAP_MS && Number.isFinite(distance) && distance * HOUR_MS / elapsed <= 1300) {
        addPattern(all, previousVisit.city, city, date)
        addPattern(ensureYear(date), previousVisit.city, city, date)
      }
    }
    previousVisit = { point, index, city, end }
  }

  const discoveries: StatisticsNewPlace[] = []
  for (const [kind, entries] of [['country', places.countries], ['city', places.cities]] as const) {
    for (const place of entries) {
      const date = place.dates.reduce((earliest, next) => next < earliest ? next : earliest, '9999-99-99')
      if (validDay(date)) discoveries.push({ key: place.key, name: place.name, countryCode: place.countryCode, kind, date })
    }
  }
  discoveries.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  const finish = (builder: PeriodBuilder, year?: string): StatisticsPeriod => {
    const daily = Array.from(builder.days, ([date, distanceKm]) => ({ date, distanceKm })).sort((a, b) => a.date.localeCompare(b.date))
    const monthly = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, distanceKm: 0, recordedDays: 0 }))
    let total = 0
    for (const day of daily) {
      const month = monthly[Number(day.date.slice(5, 7)) - 1]
      if (!month) continue
      month.distanceKm += day.distanceKm
      month.recordedDays++
      total += day.distanceKm
    }
    const countries = placesForPeriod(places.countries, year)
    const cities = placesForPeriod(places.cities, year)
    return { distanceKm: total, recordedDays: daily.length, countryCount: countries.length, cityCount: cities.length, monthly, daily,
      hourlyMinutes: builder.hourlyMinutes, transport: year ? transport.byYear[year] ?? [] : transport.all,
      humanPoweredDistanceKm: year ? transport.humanPoweredByYear[year] ?? 0 : transport.humanPoweredDistanceKm, countries, cities,
      newPlaces: year ? discoveries.filter(place => Number(place.date.slice(0, 4)) === Number(year)) : discoveries,
      patterns: [...builder.patterns.values()].filter(pattern => pattern.count >= 2).sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.key.localeCompare(b.key)).slice(0, 10) }
  }
  const years = [...periods.keys()].map(Number).sort((a, b) => b - a)
  const byYear: Record<string, StatisticsPeriod> = {}
  for (const year of years) byYear[String(year)] = finish(periods.get(String(year))!, String(year))
  return { years, all: finish(all), byYear }
}
