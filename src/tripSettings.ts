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
