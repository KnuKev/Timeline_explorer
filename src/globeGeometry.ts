import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson'
import { longitudeNear } from './mapSpatial'
import type { RouteSegment } from './routes'
import type { TimelinePoint } from './timeline'

type Coordinate = [number, number]
type Vector = [number, number, number]
const radians = Math.PI / 180

function unitVector([lng, lat]: Coordinate): Vector {
  const radius = Math.cos(lat * radians)
  return [radius * Math.cos(lng * radians), radius * Math.sin(lng * radians), Math.sin(lat * radians)]
}

function flightArc(from: Coordinate, to: Coordinate): Coordinate[] {
  const start = unitVector(from)
  const end = unitVector(to)
  const dot = Math.max(-1, Math.min(1, start[0] * end[0] + start[1] * end[1] + start[2] * end[2]))
  const angle = Math.acos(dot)
  const steps = Math.ceil(angle / (2 * radians))
  if (steps <= 1) return [to]
  // Compute a tangent on the great circle. At antipodes choose one of the
  // equally short arcs deterministically so the interpolation still has a plane.
  let tangent: Vector = [end[0] - dot * start[0], end[1] - dot * start[1], end[2] - dot * start[2]]
  if (Math.hypot(...tangent) < 1e-10) {
    tangent = Math.abs(start[2]) < .9 ? [-start[1], start[0], 0] : [0, -start[2], start[1]]
  }
  const length = Math.hypot(...tangent)
  const intermediate: Coordinate[] = []
  for (let step = 1; step < steps; step++) {
    const offset = angle * step / steps
    const along = Math.cos(offset)
    const across = Math.sin(offset) / length
    const x = start[0] * along + tangent[0] * across
    const y = start[1] * along + tangent[1] * across
    const z = start[2] * along + tangent[2] * across
    intermediate.push([Math.atan2(y, x) / radians, Math.atan2(z, Math.hypot(x, y)) / radians])
  }
  return [...intermediate, to]
}

function splitAtDateline(coordinates: Coordinate[]): Coordinate[][] {
  const lines: Coordinate[][] = []
  let line = [coordinates[0]!]
  for (const coordinate of coordinates.slice(1)) {
    const [fromLng, fromLat] = line[line.length - 1]!
    const [toLng, toLat] = coordinate
    const nearby = longitudeNear(toLng, fromLng)
    if (nearby > 180 || nearby < -180) {
      const seam = nearby > 180 ? 180 : -180
      const latitude = fromLat + (toLat - fromLat) * (seam - fromLng) / (nearby - fromLng)
      line.push([seam, latitude])
      lines.push(line)
      line = [[-seam, latitude]]
    } else if (nearby !== toLng) {
      // A point already at the seam can be represented in either hemisphere.
      line.push([nearby, toLat])
      continue
    }
    line.push(coordinate)
  }
  if (line.length > 1) lines.push(line)
  return lines
}

export function globeRoutes(segments: readonly RouteSegment[]): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = []
  for (const segment of segments) {
    if (segment.points.length < 2) continue
    const flight = segment.transport === 'flight'
    const coordinates: Coordinate[] = [[segment.points[0]!.lng, segment.points[0]!.lat]]
    for (let index = 1; index < segment.points.length; index++) {
      const point = segment.points[index]!
      const next: Coordinate = [point.lng, point.lat]
      if (flight) coordinates.push(...flightArc(coordinates[coordinates.length - 1]!, next))
      else coordinates.push(next)
    }
    for (const line of splitAtDateline(coordinates)) {
      features.push({ type: 'Feature', properties: { flight }, geometry: { type: 'LineString', coordinates: line } })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function globePoints(points: readonly TimelinePoint[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: points.map(point => ({
      type: 'Feature',
      properties: { id: point.id },
      geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
    })),
  }
}

function clipRing(ring: Position[], seam: number, direction: number): Position[] {
  if (!ring.length) return []
  const clipped: Position[] = []
  let previous = ring[ring.length - 1]!
  for (const current of ring) {
    const nextInside = (current[0]! - seam) * direction >= 0
    const wasInside = (previous[0]! - seam) * direction >= 0
    if (nextInside !== wasInside) {
      const fraction = (seam - previous[0]!) / (current[0]! - previous[0]!)
      clipped.push([seam, previous[1]! + (current[1]! - previous[1]!) * fraction])
    }
    if (nextInside) clipped.push(current)
    previous = current
  }
  return clipped
}

function splitCountryPolygon(polygon: Position[][]): Position[][][] {
  const exterior = polygon[0]
  const first = exterior?.[0]
  const last = exterior?.at(-2)
  // Natural Earth's Antarctic coast closes with a world-spanning edge at
  // roughly 85° south. Extend it to the pole and tile the cap in quadrants.
  if (first?.[0] === -180 && last?.[0] === 180 && first[1] === last[1] && first[1]! < -80 && exterior) {
    const cap = [...exterior.slice(0, -1), [180, -90], [-180, -90]]
    return [-180, -90, 0, 90].flatMap(west => {
      const ring = clipRing(clipRing(cap, west, 1), west + 90, -1)
      return ring.length >= 3 ? [[[...ring, ring[0]!]]] : []
    })
  }
  if (!exterior?.some((coordinate, index) => {
    if (!index) return false
    const distance = Math.abs(coordinate[0]! - exterior[index - 1]![0]!)
    return distance > 180 && distance < 360
  })) return [polygon]

  const reference = exterior[0]![0]!
  const rings = polygon.map(ring => {
    let previous = reference
    return ring.slice(0, -1).map(([lng, lat]) => {
      previous = longitudeNear(lng!, previous)
      return [previous, lat!]
    })
  })
  const longitudes = rings[0]!.map(([lng]) => lng!)
  const firstStrip = Math.floor((Math.min(...longitudes) + 180) / 360)
  const lastStrip = Math.floor((Math.max(...longitudes) + 180) / 360)
  const parts: Position[][][] = []
  for (let strip = firstStrip; strip <= lastStrip; strip++) {
    const offset = strip * 360
    const clipped = rings.map(ring => clipRing(clipRing(ring, offset - 180, 1), offset + 180, -1))
    if (clipped[0]!.length < 3) continue
    parts.push(clipped.filter(ring => ring.length >= 3).map(ring => {
      const shifted = ring.map(([lng, lat]) => [lng! - offset, lat!])
      return [...shifted, shifted[0]!]
    }))
  }
  return parts
}

/** World Atlas includes a few land rings crossing the dateline. Split them
 * into GeoJSON polygons on each side so tiling cannot stretch land over the sea. */
export function globeCountries(collection: FeatureCollection): FeatureCollection {
  return { ...collection, features: collection.features.map(country => {
    const geometry = country.geometry
    if (geometry.type === 'Polygon') {
      return { ...country, geometry: { type: 'MultiPolygon', coordinates: splitCountryPolygon(geometry.coordinates) } }
    }
    if (geometry.type === 'MultiPolygon') {
      return { ...country, geometry: { ...geometry, coordinates: geometry.coordinates.flatMap(splitCountryPolygon) } }
    }
    return country
  }) }
}
