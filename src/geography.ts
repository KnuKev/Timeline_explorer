import type { CountryFeature } from './places.ts'

type Ring = [number, number][]
type Polygon = Ring[]
type IndexedRing = { points: Ring; bands: Map<number, number[]> }
type IndexedPolygon = { country: CountryFeature; rings: IndexedRing[]; west: number; east: number; south: number; north: number }

const CELL_DEGREES = 5
const LATITUDE_BAND_DEGREES = 0.25
const COAST_TOLERANCE_KM = 2
const MAX_COORDINATE_CACHE_SIZE = 8_192
const cellKey = (lat: number, lng: number) => `${Math.floor(lat / CELL_DEGREES)}:${Math.floor(lng / CELL_DEGREES)}`

function indexRing(points: Ring): IndexedRing {
  const bands = new Map<number, number[]>()
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const firstBand = Math.floor(Math.min(points[i]![1], points[j]![1]) / LATITUDE_BAND_DEGREES)
    const lastBand = Math.floor(Math.max(points[i]![1], points[j]![1]) / LATITUDE_BAND_DEGREES)
    for (let band = firstBand; band <= lastBand; band++) {
      const edges = bands.get(band) ?? []
      edges.push(i)
      bands.set(band, edges)
    }
  }
  return { points, bands }
}

function inRing(lat: number, lng: number, ring: IndexedRing): boolean {
  let inside = false
  // Only edges that span this latitude can cross the eastward ray. Keep the
  // original coordinates, including horizontal edges for exact boundary hits.
  for (const i of ring.bands.get(Math.floor(lat / LATITUDE_BAND_DEGREES)) ?? []) {
    const [x, y] = ring.points[i]!
    const [previousX, previousY] = ring.points[i === 0 ? ring.points.length - 1 : i - 1]!
    const cross = (lng - x) * (previousY - y) - (lat - y) * (previousX - x)
    if (Math.abs(cross) < 1e-12 && lng >= Math.min(x, previousX) && lng <= Math.max(x, previousX) && lat >= Math.min(y, previousY) && lat <= Math.max(y, previousY)) return true
    if ((y > lat) !== (previousY > lat) && lng < (previousX - x) * (lat - y) / (previousY - y) + x) inside = !inside
  }
  return inside
}

function boundaryDistanceKm(lat: number, lng: number, ring: IndexedRing, maximum: number): number {
  const longitudeScale = 111.195 * Math.cos(lat * Math.PI / 180)
  const latitudePadding = maximum / 111.195
  const longitudePadding = Math.min(180, maximum / Math.max(0.001, longitudeScale))
  const edges = new Set<number>()
  for (let band = Math.floor((lat - latitudePadding) / LATITUDE_BAND_DEGREES); band <= Math.floor((lat + latitudePadding) / LATITUDE_BAND_DEGREES); band++) {
    for (const edge of ring.bands.get(band) ?? []) edges.add(edge)
  }
  let best = maximum
  for (const i of edges) {
    const a = ring.points[i === 0 ? ring.points.length - 1 : i - 1]!
    const b = ring.points[i]!
    if (lng < Math.min(a[0], b[0]) - longitudePadding || lng > Math.max(a[0], b[0]) + longitudePadding || lat < Math.min(a[1], b[1]) - latitudePadding || lat > Math.max(a[1], b[1]) + latitudePadding) continue
    const ax = (a[0] - lng) * longitudeScale
    const ay = (a[1] - lat) * 111.195
    const dx = (b[0] - a[0]) * longitudeScale
    const dy = (b[1] - a[1]) * 111.195
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

// Index each island separately: an overseas island must not enlarge the mainland's
// search box. Exact land matches always win over the small coastal GPS tolerance.
export function createCountryLookup(features: CountryFeature[]) {
  const grid = new Map<string, IndexedPolygon[]>()
  const cache = new Map<string, CountryFeature | undefined>()
  const cacheKeys: string[] = []
  let nextCacheSlot = 0
  const remember = (key: string, country: CountryFeature | undefined) => {
    const expired = cacheKeys[nextCacheSlot]
    if (expired !== undefined) cache.delete(expired)
    cacheKeys[nextCacheSlot] = key
    nextCacheSlot = (nextCacheSlot + 1) % MAX_COORDINATE_CACHE_SIZE
    cache.set(key, country)
  }
  for (const country of features) {
    const { type, coordinates } = country.geometry
    if (type !== 'Polygon' && type !== 'MultiPolygon') continue
    const polygons = (type === 'Polygon' ? [coordinates] : coordinates) as Polygon[]
    for (const rings of polygons) {
      if (!rings[0]?.length) continue
      const bounds: IndexedPolygon = { country, rings: rings.map(indexRing), west: Infinity, east: -Infinity, south: Infinity, north: -Infinity }
      for (const [lng, lat] of rings[0]) {
        bounds.west = Math.min(bounds.west, lng)
        bounds.east = Math.max(bounds.east, lng)
        bounds.south = Math.min(bounds.south, lat)
        bounds.north = Math.max(bounds.north, lat)
      }
      for (let y = Math.floor(bounds.south / CELL_DEGREES); y <= Math.floor(bounds.north / CELL_DEGREES); y++) {
        for (let x = Math.floor(bounds.west / CELL_DEGREES); x <= Math.floor(bounds.east / CELL_DEGREES); x++) {
          const key = `${y}:${x}`
          const cell = grid.get(key) ?? []
          cell.push(bounds)
          grid.set(key, cell)
        }
      }
    }
  }

  return (lat: number, lng: number): CountryFeature | undefined => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined
    const key = `${lat}:${lng}`
    if (cache.has(key)) return cache.get(key)
    const candidates = grid.get(cellKey(lat, lng)) ?? []
    for (const polygon of candidates) {
      if (lng < polygon.west || lng > polygon.east || lat < polygon.south || lat > polygon.north) continue
      if (inRing(lat, lng, polygon.rings[0]!) && !polygon.rings.slice(1).some(ring => inRing(lat, lng, ring))) {
        remember(key, polygon.country)
        return polygon.country
      }
    }

    // Simplified shorelines and GPS drift can place a coastal point just offshore.
    // Do not assign open water or override a point already inside another country.
    const latitudePadding = COAST_TOLERANCE_KM / 111.195
    const longitudePadding = Math.min(180, latitudePadding / Math.max(0.001, Math.cos(lat * Math.PI / 180)))
    const nearby = new Set<IndexedPolygon>()
    for (let y = Math.floor((lat - latitudePadding) / CELL_DEGREES); y <= Math.floor((lat + latitudePadding) / CELL_DEGREES); y++) {
      for (let x = Math.floor((lng - longitudePadding) / CELL_DEGREES); x <= Math.floor((lng + longitudePadding) / CELL_DEGREES); x++) {
        for (const polygon of grid.get(`${y}:${x}`) ?? []) nearby.add(polygon)
      }
    }
    let best = COAST_TOLERANCE_KM
    let country: CountryFeature | undefined
    for (const polygon of nearby) {
      if (lng < polygon.west - longitudePadding || lng > polygon.east + longitudePadding || lat < polygon.south - latitudePadding || lat > polygon.north + latitudePadding) continue
      const distance = Math.min(...polygon.rings.map(ring => boundaryDistanceKm(lat, lng, ring, best)))
      if (distance < best) { best = distance; country = polygon.country }
    }
    remember(key, country)
    return country
  }
}
