import type { TimelinePoint } from './timeline.ts'
import { pointDateKeys } from './pointDates.ts'
import { createCountryLookup } from './geography.ts'

type CityReference = { name: string; lat: number; lng: number; countryCode: string }
export type CountryFeature = { id?: string | number; properties?: { name?: string }; geometry: { type: string; coordinates: unknown } }
type PlaceEntry = { key: string; name: string; countryName?: string; countryCode?: string; days: number; dates: string[]; pointCount: number; pointIds: string[] }
type PlaceAnalysis = { countries: PlaceEntry[]; cities: PlaceEntry[] }
type PlaceIdentity = { key: string; name: string; countryCode?: string; countryName?: string }
type PlaceMatch = { country: PlaceIdentity; city?: PlaceIdentity }
type CityNode = { city: CityReference; position: [number, number, number]; index: number; axis: number; left?: CityNode; right?: CityNode }
type CityCandidate = Pick<CityNode, 'city' | 'position' | 'index'>

const displayNames = new Intl.DisplayNames(['no'], { type: 'region' })
const EARTH_RADIUS_KM = 6371
const CITY_RADIUS_KM = 30
const cityIndexes = new WeakMap<CityReference[], Map<string, CityNode>>()
const matchers = new WeakMap<CityReference[], WeakMap<CountryFeature[], WeakMap<Record<string, string>, (point: TimelinePoint) => PlaceMatch | undefined>>>()

function kilometersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (degrees: number) => degrees * Math.PI / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function unitPosition(lat: number, lng: number): [number, number, number] {
  const latitude = lat * Math.PI / 180
  const longitude = lng * Math.PI / 180
  const horizontal = Math.cos(latitude)
  return [horizontal * Math.cos(longitude), horizontal * Math.sin(longitude), Math.sin(latitude)]
}

function buildCityTree(cities: CityCandidate[], depth = 0): CityNode | undefined {
  if (!cities.length) return undefined
  const axis = depth % 3
  cities.sort((a, b) => a.position[axis]! - b.position[axis]! || a.index - b.index)
  const middle = Math.floor(cities.length / 2)
  return { ...cities[middle]!, axis, left: buildCityTree(cities.slice(0, middle), depth + 1), right: buildCityTree(cities.slice(middle + 1), depth + 1) }
}

function getCityIndex(cities: CityReference[]): Map<string, CityNode> {
  const cached = cityIndexes.get(cities)
  if (cached) return cached
  const grouped = new Map<string, CityCandidate[]>()
  cities.forEach((city, index) => {
    if (!Number.isFinite(city.lat) || !Number.isFinite(city.lng) || Math.abs(city.lat) > 90 || Math.abs(city.lng) > 180) return
    const group = grouped.get(city.countryCode) ?? []
    group.push({ city, index, position: unitPosition(city.lat, city.lng) })
    grouped.set(city.countryCode, group)
  })
  const trees = new Map<string, CityNode>()
  for (const [code, group] of grouped) {
    const tree = buildCityTree(group)
    if (tree) trees.set(code, tree)
  }
  cityIndexes.set(cities, trees)
  return trees
}

// Preserve the former grid scan's deterministic choice for equidistant references.
function earlierCandidate(a: CityNode, b: CityNode, queryLng: number): boolean {
  const latitudeOrder = Math.floor(a.city.lat) - Math.floor(b.city.lat)
  if (latitudeOrder) return latitudeOrder < 0
  const relativeLongitude = (city: CityReference) => ((Math.floor(city.lng) - Math.floor(queryLng) + 540) % 360) - 180
  const longitudeOrder = relativeLongitude(a.city) - relativeLongitude(b.city)
  return longitudeOrder ? longitudeOrder < 0 : a.index < b.index
}

function nearestCity(tree: CityNode | undefined, lat: number, lng: number): CityReference | undefined {
  const position = unitPosition(lat, lng)
  let best: CityNode | undefined
  let bestKm = CITY_RADIUS_KM
  let maximumChordSquared = (2 * Math.sin(bestKm / (2 * EARTH_RADIUS_KM))) ** 2
  const visit = (node: CityNode | undefined) => {
    if (!node) return
    const offset = position[node.axis]! - node.position[node.axis]!
    const near = offset < 0 ? node.left : node.right
    const far = offset < 0 ? node.right : node.left
    visit(near)
    const squared = position.reduce((sum, coordinate, axis) => sum + (coordinate - node.position[axis]!) ** 2, 0)
    if (squared <= maximumChordSquared + 1e-14) {
      const distance = kilometersBetween(lat, lng, node.city.lat, node.city.lng)
      if (distance < bestKm || (best && distance === bestKm && earlierCandidate(node, best, lng))) {
        best = node
        bestKm = distance
        maximumChordSquared = (2 * Math.sin(bestKm / (2 * EARTH_RADIUS_KM))) ** 2
      }
    }
    if (offset * offset <= maximumChordSquared + 1e-14) visit(far)
  }
  visit(tree)
  return best?.city
}

function getMatcher(cities: CityReference[], countryCodes: Record<string, string>, countryFeatures: CountryFeature[]) {
  let byFeatures = matchers.get(cities)
  if (!byFeatures) { byFeatures = new WeakMap(); matchers.set(cities, byFeatures) }
  let byCodes = byFeatures.get(countryFeatures)
  if (!byCodes) { byCodes = new WeakMap(); byFeatures.set(countryFeatures, byCodes) }
  const cached = byCodes.get(countryCodes)
  if (cached) return cached
  const findCountry = createCountryLookup(countryFeatures)
  const cityTrees = getCityIndex(cities)
  const countryMatches = new Map<CountryFeature, PlaceMatch>()
  const pointMatches = new WeakMap<TimelinePoint, { lat: number; lng: number; match: PlaceMatch | undefined }>()
  const cityMatches = new WeakMap<CityReference, PlaceMatch>()
  const match = (point: TimelinePoint): PlaceMatch | undefined => {
    const previous = pointMatches.get(point)
    if (previous && previous.lat === point.lat && previous.lng === point.lng) return previous.match
    const country = findCountry(point.lat, point.lng)
    let result: PlaceMatch | undefined
    if (country) {
      let countryMatch = countryMatches.get(country)
      if (!countryMatch) {
        const numericCode = String(country.id ?? '')
        const countryCode = countryCodes[numericCode] ?? countryCodes[numericCode.padStart(3, '0')]
        const name = countryCode ? displayNames.of(countryCode) ?? country.properties?.name ?? 'Ukjent land' : country.properties?.name ?? 'Ukjent land'
        countryMatch = { country: { key: countryCode ?? name, name, countryCode } }
        countryMatches.set(country, countryMatch)
      }
      const identity = countryMatch.country
      result = countryMatch
      const nearest = identity.countryCode ? nearestCity(cityTrees.get(identity.countryCode), point.lat, point.lng) : undefined
      if (nearest) {
        let cityMatch = cityMatches.get(nearest)
        if (!cityMatch) {
          cityMatch = { country: identity, city: { key: `${identity.countryCode ?? identity.key}:${nearest.name}:${nearest.lat.toFixed(3)}:${nearest.lng.toFixed(3)}`, name: nearest.name, countryCode: nearest.countryCode, countryName: identity.name } }
          cityMatches.set(nearest, cityMatch)
        }
        result = cityMatch
      }
    }
    pointMatches.set(point, { lat: point.lat, lng: point.lng, match: result })
    return result
  }
  byCodes.set(countryCodes, match)
  return match
}

/** Reference arrays are immutable. Reuse them to retain the spatial indexes;
 * point caches are weak so replacing an imported file releases its observations. */
export function analysePlaces(points: TimelinePoint[], cities: CityReference[], countryCodes: Record<string, string>, countryFeatures: CountryFeature[], datesByPoint?: ReadonlyMap<TimelinePoint, readonly string[]>): PlaceAnalysis {
  const match = getMatcher(cities, countryCodes, countryFeatures)
  type Aggregate = { identity: PlaceIdentity; ids: string[]; days: Set<string> }
  const countryAggregates = new Map<string, Aggregate>()
  const cityAggregates = new Map<string, Aggregate>()
  const append = (aggregates: Map<string, Aggregate>, identity: PlaceIdentity, point: TimelinePoint, dates: readonly string[]) => {
    const aggregate = aggregates.get(identity.key) ?? { identity, ids: [], days: new Set<string>() }
    aggregate.ids.push(point.id)
    for (const day of dates) aggregate.days.add(day)
    aggregates.set(identity.key, aggregate)
  }
  for (const point of points) {
    const places = match(point)
    if (!places) continue
    const dates = datesByPoint?.get(point) ?? pointDateKeys(point)
    append(countryAggregates, places.country, point, dates)
    if (places.city) append(cityAggregates, places.city, point, dates)
  }
  const entries = (aggregates: Map<string, Aggregate>): PlaceEntry[] => Array.from(aggregates.values(), ({ identity, ids, days }) => ({
    key: identity.key, name: identity.name, countryCode: identity.countryCode,
    ...(identity.countryName === undefined ? {} : { countryName: identity.countryName }),
    days: days.size, dates: Array.from(days).sort().reverse(), pointCount: ids.length, pointIds: ids,
  })).sort(comparePlaces)
  return { countries: entries(countryAggregates), cities: entries(cityAggregates) }
}

function comparePlaces(a: PlaceEntry, b: PlaceEntry): number {
  return b.days - a.days || b.pointCount - a.pointCount || a.name.localeCompare(b.name, 'no')
}

export function selectPlacesYear(analysis: PlaceAnalysis, year: string, selectedPointIds: ReadonlySet<string>): PlaceAnalysis {
  const select = (entries: PlaceEntry[]) => entries.flatMap(entry => {
    const dates = entry.dates.filter(date => date.startsWith(year + '-'))
    if (!dates.length) return []
    const pointIds = entry.pointIds.filter(id => selectedPointIds.has(id))
    if (!pointIds.length) return []
    return [{ ...entry, dates, days: dates.length, pointIds, pointCount: pointIds.length }]
  }).sort(comparePlaces)
  return { countries: select(analysis.countries), cities: select(analysis.cities) }
}

export type { CityReference, PlaceAnalysis, PlaceEntry }
