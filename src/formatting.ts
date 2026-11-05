import tzLookup from 'tz-lookup'
import type { TimelinePoint } from './timeline.ts'

type DateStyle = 'date' | 'longDate' | 'point' | 'detailedPoint'
const formatters = new Map<string, Intl.DateTimeFormat>()
const numberFormatters = new Map<string, Intl.NumberFormat>()
const coordinateZones = new Map<string, string>()
const MAX_FORMATTERS = 128
const MAX_COORDINATE_ZONES = 4_096

function remember<K, V>(cache: Map<K, V>, key: K, value: V, maximum: number): V {
  if (cache.size >= maximum) cache.delete(cache.keys().next().value!)
  cache.set(key, value)
  return value
}

function timeZoneAt(lat: number, lng: number): string {
  const key = `${lat}:${lng}`
  const cached = coordinateZones.get(key)
  if (cached) return cached
  let zone = 'UTC'
  try { zone = tzLookup(lat, lng) } catch { /* Match the calendar's UTC fallback. */ }
  return remember(coordinateZones, key, zone, MAX_COORDINATE_ZONES)
}

function dateFormatter(style: DateStyle, locale: string, timeZone: string): Intl.DateTimeFormat {
  const key = `${style}:${locale}:${timeZone}`
  const cached = formatters.get(key)
  if (cached) return cached
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    day: 'numeric',
    month: style === 'longDate' || style === 'detailedPoint' ? 'long' : 'short',
    year: 'numeric',
    ...(style === 'longDate' || style === 'detailedPoint' ? { weekday: 'long' } : {}),
    ...(style === 'point' || style === 'detailedPoint' ? { hour: '2-digit', minute: '2-digit' } : {}),
  }
  return remember(formatters, key, new Intl.DateTimeFormat(locale, options), MAX_FORMATTERS)
}

function calendarDate(dateKey: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null
  const date = new Date(dateKey + 'T12:00:00Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === dateKey ? date : null
}

export function formatPlaceDate(dateKey: string, locale: string): string {
  const date = calendarDate(dateKey)
  return date ? dateFormatter('date', locale, 'UTC').format(date) : '—'
}

export function formatCalendarDate(dateKey: string, locale: string): string {
  const date = calendarDate(dateKey)
  return date ? dateFormatter('longDate', locale, 'UTC').format(date) : '—'
}

export function formatPointDateTime(timestamp: string, lat: number, lng: number, locale: string): string {
  const time = Date.parse(timestamp)
  return Number.isFinite(time) ? dateFormatter('point', locale, timeZoneAt(lat, lng)).format(time) : '—'
}

export function formatPointDateTimeAtLocation(timestamp: string, lat: number, lng: number, locale: string): string {
  const time = Date.parse(timestamp)
  return Number.isFinite(time) ? dateFormatter('detailedPoint', locale, timeZoneAt(lat, lng)).format(time) : '—'
}

export function formatPointInterval(point: TimelinePoint, locale: string, detailed = false): string {
  const start = Date.parse(point.timestamp)
  if (!Number.isFinite(start)) return '—'
  const formatter = dateFormatter(detailed ? 'detailedPoint' : 'point', locale, timeZoneAt(point.lat, point.lng))
  const end = point.kind === 'visit' && point.endTimestamp ? Date.parse(point.endTimestamp) : NaN
  return Number.isFinite(end) && end > start ? formatter.formatRange(start, end) : formatter.format(start)
}

export function formatDistance(kilometers: number, locale: string): string {
  if (!Number.isFinite(kilometers) || kilometers < 0) return '—'
  const key = `${locale}:${kilometers < 1 ? 'meters' : 'kilometers'}`
  let formatter = numberFormatters.get(key)
  if (!formatter) formatter = remember(numberFormatters, key, new Intl.NumberFormat(locale, { maximumFractionDigits: kilometers < 1 ? 0 : 1 }), 16)
  return kilometers < 1 ? formatter.format(kilometers * 1_000) + ' m' : formatter.format(kilometers) + ' km'
}
