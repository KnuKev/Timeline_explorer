import { KM_PER_MILE, type DistanceUnits } from './formatting.ts'

export const DEFAULT_HOME_RADIUS_KM = 25
export const HOME_RADIUS_OPTIONS = [10, 25, 50] as const
export const homeRadiusOptionsKm: Record<DistanceUnits, readonly number[]> = {
  metric: HOME_RADIUS_OPTIONS,
  imperial: [5, 15, 30].map(miles => miles * KM_PER_MILE),
}

export function homeRadiusForUnits(radiusKm: number, units: DistanceUnits): number {
  const otherUnits = units === 'metric' ? 'imperial' : 'metric'
  const presetIndex = homeRadiusOptionsKm[otherUnits].indexOf(radiusKm)
  return homeRadiusOptionsKm[units][presetIndex] ?? radiusKm
}

export const homeRadiusStorageKey = 'timeline-explorer-trip-home-radius-km'

/** Engine callers may use smaller radii for detailed analyses; the UI offers
 * three practical presets. Invalid values must never disable the home area. */
export function normalizeHomeRadius(value: unknown): number {
  const radius = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(radius) && radius >= 0.3 && radius <= 100 ? radius : DEFAULT_HOME_RADIUS_KM
}

export function getStoredHomeRadius(): number {
  try { return normalizeHomeRadius(localStorage.getItem(homeRadiusStorageKey)) }
  catch { return DEFAULT_HOME_RADIUS_KM }
}

export type HomeLocation = { lat: number; lng: number }
export const homeLocationStorageKey = 'timeline-explorer-trip-home-location'

export const demoHomeLocationStorageKey = 'timeline-explorer-demo-home-location'

export type DatedHomeLocation = HomeLocation & { from: string }

export function isHomeStartDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const time = Date.parse(date)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date
}

export function getStoredHomeLocations(key = homeLocationStorageKey): DatedHomeLocation[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    const locations = new Map<string, DatedHomeLocation>()
    // The original single pin applied to the entire history.
    const entries = Array.isArray(stored) ? stored : [{ ...(stored as HomeLocation | null), from: '' }]
    for (const entry of entries) {
      if (!entry || !Number.isFinite(entry.lat) || !Number.isFinite(entry.lng) || Math.abs(entry.lat) > 90 || Math.abs(entry.lng) > 180) continue
      if (entry.from !== '' && (typeof entry.from !== 'string' || !isHomeStartDate(entry.from))) continue
      locations.set(entry.from, { lat: entry.lat, lng: entry.lng, from: entry.from })
    }
    return [...locations.values()].sort((a, b) => a.from.localeCompare(b.from))
  } catch { return [] }
}
