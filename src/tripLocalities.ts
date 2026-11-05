export type TripLocalityReference = { id?: number; name: string; lat: number; lng: number; countryCode: string; region?: string }
export type TripLocalityMatch = Pick<TripLocalityReference, 'id' | 'name' | 'countryCode' | 'region'> & { distanceKm: number }
export type TripLocalityResolver = (point: { lat: number; lng: number }, countryCode?: string) => TripLocalityMatch | undefined

const EARTH_RADIUS_KM = 6371
const MAX_DISTANCE_KM = 30
// A sphere-based grid handles the dateline and poles without longitude special
// cases. Every reference within 30 km is in one of the 27 neighbouring cells.
const CELL = 2 * Math.sin(MAX_DISTANCE_KM / (2 * EARTH_RADIUS_KM))
type Reference = { locality: TripLocalityReference; position: [number, number, number]; order: string }

function positionAt(lat: number, lng: number): [number, number, number] {
  const latitude = lat * Math.PI / 180
  const longitude = lng * Math.PI / 180
  const horizontal = Math.cos(latitude)
  return [horizontal * Math.cos(longitude), horizontal * Math.sin(longitude), Math.sin(latitude)]
}

function validPosition(point: { lat: number; lng: number }): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
}

/** Nearby settlement context for an independently identified stay area. This
 * does not claim an exact address, venue, or administrative boundary. Country
 * must come from the existing polygon lookup; never infer it from a nearby town.
 * Build once in the worker and reuse for all stays. References remain immutable. */
export function createTripLocalityResolver(localities: readonly TripLocalityReference[]): TripLocalityResolver {
  const cells = new Map<string, Reference[]>()
  for (const locality of localities) {
    if (!locality.name || !/^[A-Z]{2}$/.test(locality.countryCode) || !validPosition(locality)) continue
    const position = positionAt(locality.lat, locality.lng)
    const key = `${locality.countryCode}:${position.map(value => Math.floor(value / CELL)).join(':')}`
    const bucket = cells.get(key) ?? []
    bucket.push({ locality, position, order: `${locality.name}:${locality.lat}:${locality.lng}:${locality.id ?? ''}` })
    cells.set(key, bucket)
  }

  return (point, countryCode) => {
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode) || !validPosition(point)) return undefined
    const position = positionAt(point.lat, point.lng)
    const [x, y, z] = position.map(value => Math.floor(value / CELL))
    let nearest: Reference | undefined
    let squaredDistance = CELL * CELL
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const bucket = cells.get(`${countryCode}:${x! + dx}:${y! + dy}:${z! + dz}`)
      for (const candidate of bucket ?? []) {
        const squared = position.reduce((sum, value, axis) => sum + (value - candidate.position[axis]!) ** 2, 0)
        if (squared < squaredDistance || (squared === squaredDistance && (!nearest || candidate.order < nearest.order))) {
          squaredDistance = squared
          nearest = candidate
        }
      }
    }
    if (!nearest) return undefined
    const { id, name, countryCode: code, region } = nearest.locality
    return { ...(id !== undefined ? { id } : {}), name, countryCode: code, ...(region ? { region } : {}), distanceKm: 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(squaredDistance) / 2)) }
  }
}
