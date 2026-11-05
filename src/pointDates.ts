import tzLookup from 'tz-lookup'
import type { TimelinePoint } from './timeline.ts'

const formatters = new Map<string, Intl.DateTimeFormat>()
const zones = new Map<string, string>()
const MAX_ZONE_CACHE_SIZE = 4_096
const zoneCacheKeys: string[] = []
let nextZoneCacheSlot = 0
const MAX_VISIT_INTERVAL_MS = 100 * 366 * 24 * 60 * 60_000
const pointDates = new WeakMap<TimelinePoint, { lat: number; lng: number; timestamp: string; endTimestamp?: string; kind: TimelinePoint['kind']; dates: string[] }>()

function timeZoneAt(lat: number, lng: number): string {
  const key = `${lat}:${lng}`
  let zone = zones.get(key)
  if (!zone) {
    try { zone = tzLookup(lat, lng) } catch { zone = 'UTC' }
    const expired = zoneCacheKeys[nextZoneCacheSlot]
    if (expired !== undefined) zones.delete(expired)
    zoneCacheKeys[nextZoneCacheSlot] = key
    nextZoneCacheSlot = (nextZoneCacheSlot + 1) % MAX_ZONE_CACHE_SIZE
    zones.set(key, zone)
  }
  return zone
}

function dateInZone(timestamp: number, zone: string): string {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' })
    formatters.set(zone, formatter)
  }
  // Swedish ISO-style dates avoid allocating formatToParts objects for every GPS
  // fix. Keep a parts fallback for runtimes with reduced locale data.
  const formatted = formatter.format(timestamp)
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted
  let year = ''
  let month = ''
  let day = ''
  for (const part of formatter.formatToParts(timestamp)) {
    if (part.type === 'year') year = part.value.padStart(4, '0')
    else if (part.type === 'month') month = part.value
    else if (part.type === 'day') day = part.value
  }
  return `${year}-${month}-${day}`
}

// Only an explicitly recorded visit interval contributes intervening days.
// End times are exclusive, so a visit ending at midnight does not add a day.
export function pointDateKeys(point: TimelinePoint): string[] {
  const cached = pointDates.get(point)
  if (cached && cached.lat === point.lat && cached.lng === point.lng && cached.timestamp === point.timestamp && cached.endTimestamp === point.endTimestamp && cached.kind === point.kind) return cached.dates
  const start = Date.parse(point.timestamp)
  const startYear = new Date(start).getUTCFullYear()
  if (!Number.isFinite(start) || startYear < 1 || startYear > 9999) return []
  const zone = timeZoneAt(point.lat, point.lng)
  const first = dateInZone(start, zone)
  const end = point.kind === 'visit' && point.endTimestamp ? Date.parse(point.endTimestamp) : start
  // An impossible centuries-long interval must not allocate millions of dates.
  // Keep the valid start observation, just as for a malformed/reversed end time.
  const validEnd = Number.isFinite(end) && end > start && end - start <= MAX_VISIT_INTERVAL_MS
  const last = dateInZone(validEnd ? end - 1 : start, zone)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last)) return []
  const dates = [first]
  // Advance calendar dates in UTC to avoid DST shortening/lengthening a day.
  const cursor = new Date(first + 'T12:00:00Z')
  while (dates[dates.length - 1]! < last) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    dates.push(cursor.toISOString().slice(0, 10))
  }
  pointDates.set(point, { lat: point.lat, lng: point.lng, timestamp: point.timestamp, endTimestamp: point.endTimestamp, kind: point.kind, dates })
  return dates
}
