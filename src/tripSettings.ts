export const DEFAULT_HOME_RADIUS_KM = 25
export const HOME_RADIUS_OPTIONS = [10, 25, 50] as const
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
