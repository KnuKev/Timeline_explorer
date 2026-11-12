export const MIN_MAP_ZOOM = -4

export type MapBackground = 'map' | 'satellite'
export const mapBackgroundStorageKey = 'timeline-explorer-map-background'

export function getStoredMapBackground(): MapBackground {
  try { return localStorage.getItem(mapBackgroundStorageKey) === 'satellite' ? 'satellite' : 'map' }
  catch { return 'map' }
}

export const POINTS_MIN_ZOOM = 12
const lightColors = { route: '#1874e8', point: '#4257a5', border: '#ffffff', end: '#cb621d', selected: '#f3b539' }
const darkColors = { route: '#7cb7ff', point: '#becfff', border: '#172134', end: '#ffbd80', selected: '#ffe091' }
export const getMapColors = (isDark: boolean) => isDark ? darkColors : lightColors
