import { localDateKey, type TimelinePoint } from './timeline'

type CityReference = { name: string; lat: number; lng: number; countryCode: string }
export type CountryFeature = { id?: string | number; properties?: { name?: string }; geometry: { type: string; coordinates: unknown } }
type PlaceEntry = { key: string; name: string; countryName?: string; countryCode?: string; days: number; dates: string[]; pointCount: number; pointIds: string[] }
type PlaceAnalysis = { countries: PlaceEntry[]; cities: PlaceEntry[] }

type Ring = [number, number][]
type Polygon = Ring[]
type MultiPolygon = Polygon[]
type PointInPolygonGeometry = { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: MultiPolygon }

const displayNames = new Intl.DisplayNames(['no'], { type: 'region' })

function inRing(lat: number, lng: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    const crosses = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

function pointInGeometry(lat: number, lng: number, geometry: PointInPolygonGeometry): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.some((polygon) => inRing(lat, lng, polygon[0]!) && !polygon.slice(1).some((hole) => inRing(lat, lng, hole)))
}

function findCountry(lat: number, lng: number, countryFeatures: CountryFeature[]): CountryFeature | undefined {
  return countryFeatures.find((entry) => {
    const geometry = entry.geometry as PointInPolygonGeometry
    return pointInGeometry(lat, lng, geometry)
  })
}

function kilometersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (degrees: number) => degrees * Math.PI / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function gridCell(lat: number, lng: number): string {
  return `${Math.floor(lat)}:${Math.floor(lng)}`
}

export function analysePlaces(points: TimelinePoint[], cities: CityReference[], countryCodes: Record<string, string>, countryFeatures: CountryFeature[]): PlaceAnalysis {
  const countryAggregates = new Map<string, { ids: string[]; days: Set<string>; name: string; countryCode?: string }>()
  const cityAggregates = new Map<string, { ids: string[]; days: Set<string>; name: string; countryCode: string; countryName?: string }>()
  const cityGrid = new Map<string, CityReference[]>()

  for (const city of cities) {
    const key = gridCell(city.lat, city.lng)
    const cell = cityGrid.get(key) ?? []
    cell.push(city)
    cityGrid.set(key, cell)
  }

  for (const point of points) {
    const country = findCountry(point.lat, point.lng, countryFeatures)
    if (!country) continue
    const numericCode = String(country.id ?? '')
    const countryCode = countryCodes[numericCode]
    const countryName = countryCode ? displayNames.of(countryCode) ?? country.properties?.name ?? 'Ukjent land' : country.properties?.name ?? 'Ukjent land'
    const countryKey = countryCode ?? countryName

    const countryAggregate = countryAggregates.get(countryKey) ?? { ids: [], days: new Set<string>(), name: countryName, countryCode }
    countryAggregate.ids.push(point.id)
    countryAggregate.days.add(localDateKey(point.timestamp))
    countryAggregates.set(countryKey, countryAggregate)

    const longitudeCells = Math.min(180, Math.ceil(30 / (111 * Math.max(0.05, Math.cos(point.lat * Math.PI / 180)))) + 1)
    const latitudeCell = Math.floor(point.lat)
    const longitudeCell = Math.floor(point.lng)
    let nearest: CityReference | undefined
    let nearestDistance = 30
    for (let latCell = latitudeCell - 1; latCell <= latitudeCell + 1; latCell += 1) {
      for (let lonOffset = -longitudeCells; lonOffset <= longitudeCells; lonOffset += 1) {
        const cellLng = ((longitudeCell + lonOffset + 540) % 360) - 180
        for (const city of cityGrid.get(`${latCell}:${cellLng}`) ?? []) {
          if (city.countryCode !== countryCode) continue
          const distance = kilometersBetween(point.lat, point.lng, city.lat, city.lng)
          if (distance < nearestDistance) {
            nearest = city
            nearestDistance = distance
          }
        }
      }
    }
    if (!nearest) continue
    const cityKey = `${countryCode ?? countryKey}:${nearest.name}:${nearest.lat.toFixed(3)}:${nearest.lng.toFixed(3)}`
    const cityAggregate = cityAggregates.get(cityKey) ?? { ids: [], days: new Set<string>(), name: nearest.name, countryCode: nearest.countryCode, countryName }
    cityAggregate.ids.push(point.id)
    cityAggregate.days.add(localDateKey(point.timestamp))
    cityAggregates.set(cityKey, cityAggregate)
  }

  const countries = Array.from(countryAggregates, ([key, value]) => ({ key, name: value.name, countryCode: value.countryCode, days: value.days.size, dates: Array.from(value.days).sort().reverse(), pointCount: value.ids.length, pointIds: value.ids }))
    .sort((a, b) => b.days - a.days || b.pointCount - a.pointCount || a.name.localeCompare(b.name, 'no'))
  const rankedCities = Array.from(cityAggregates, ([key, value]) => ({ key, name: value.name, countryCode: value.countryCode, countryName: value.countryName, days: value.days.size, dates: Array.from(value.days).sort().reverse(), pointCount: value.ids.length, pointIds: value.ids }))
    .sort((a, b) => b.days - a.days || b.pointCount - a.pointCount || a.name.localeCompare(b.name, 'no'))

  return { countries, cities: rankedCities }
}

export type { CityReference, PlaceAnalysis, PlaceEntry }

