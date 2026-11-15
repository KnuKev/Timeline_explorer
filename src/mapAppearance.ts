export const MIN_MAP_ZOOM = -4

export type MapView = 'map' | 'globe'
export const mapViewStorageKey = 'timeline-explorer-map-background'

export function getStoredMapView(): MapView {
  try { return localStorage.getItem(mapViewStorageKey) === 'globe' ? 'globe' : 'map' }
  catch { return 'map' }
}

export const POINTS_MIN_ZOOM = 12
const lightColors = { route: '#1874e8', point: '#4257a5', border: '#ffffff', end: '#cb621d', selected: '#f3b539' }
const darkColors = { route: '#7cb7ff', point: '#becfff', border: '#172134', end: '#ffbd80', selected: '#ffe091' }
export const getMapColors = (isDark: boolean) => isDark ? darkColors : lightColors
