import { feature } from 'topojson-client'
import worldAtlas from 'world-atlas/countries-10m.json'
import type { Topology } from 'topojson-specification'
import { analysePlaces, countryCodeAt, type CountryFeature, type CityReference, type PlaceAnalysis } from './places'
import type { TimelinePoint } from './timeline'
import type { IndexedDay } from './timelineIndex'
import { buildStatistics, type StatisticsAnalysis } from './statistics'
import { buildTrips, type TripsAnalysis, type TripLocalityResolver } from './trips'
import { createTripLocalityResolver, type TripLocalityReference } from './tripLocalities'
import { normalizeHomeRadius, type DatedHomeLocation } from './tripSettings'

const topology = worldAtlas as unknown as Topology
const countries = (feature(topology, topology.objects.countries) as unknown as { features: CountryFeature[] }).features
let references: Promise<[CityReference[], Record<string, string>]> | null = null
let tripLocalities: Promise<TripLocalityResolver> | null = null
let dataset: { points: TimelinePoint[]; cleanPoints: TimelinePoint[]; days: IndexedDay[]; datesByPoint: Map<TimelinePoint, string[]>; results: Map<boolean, PlaceAnalysis>; statistics: Map<boolean, StatisticsAnalysis>; trips: Map<string, TripsAnalysis> } | null = null
let latestRequest = 0

function loadReferences() {
  references ??= Promise.all([
    fetch(`${import.meta.env.BASE_URL}geonames-cities.json`).then(response => { if (!response.ok) throw new Error('Reference data unavailable'); return response.json() as Promise<CityReference[]> }),
    fetch(`${import.meta.env.BASE_URL}country-codes.json`).then(response => { if (!response.ok) throw new Error('Reference data unavailable'); return response.json() as Promise<Record<string, string>> }),
  ]).catch(error => { references = null; throw error })
  return references
}

function loadTripLocalities(cities: CityReference[]) {
  tripLocalities ??= fetch(`${import.meta.env.BASE_URL}trip-localities.json`)
    .then(response => { if (!response.ok) throw new Error('Trip locality data unavailable'); return response.json() as Promise<TripLocalityReference[]> })
    .then(additional => createTripLocalityResolver([...cities, ...additional]))
    .catch(error => { tripLocalities = null; throw error })
  return tripLocalities
}

type Request = { type: 'dataset'; points: TimelinePoint[]; days?: IndexedDay[]; excludedIds: string[] } | { type: 'analyse'; requestId: number; includeSuspect: boolean; includeStatistics?: boolean; includeTrips?: boolean; homeRadiusKm?: number; homeLocations?: DatedHomeLocation[] }
self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data
  if (message.type === 'dataset') {
    const excluded = new Set(message.excludedIds)
    const datesByPoint = new Map<TimelinePoint, string[]>()
    for (const entry of message.days ?? []) {
      for (const index of entry.indices) {
        const point = message.points[index]!
        const dates = datesByPoint.get(point) ?? []
        dates.push(entry.day)
        datesByPoint.set(point, dates)
      }
    }
    dataset = { points: message.points, cleanPoints: message.points.filter(point => !excluded.has(point.id)), days: message.days ?? [], datesByPoint, results: new Map(), statistics: new Map(), trips: new Map() }
    return
  }
  latestRequest = message.requestId
  const current = dataset
  if (!current) return
  let refs: [CityReference[], Record<string, string>]
  let resolveTripLocality: TripLocalityResolver | undefined
  try {
    refs = await loadReferences()
    if (message.includeTrips) resolveTripLocality = await loadTripLocalities(refs[0])
  } catch {
    if (current === dataset && latestRequest === message.requestId) self.postMessage({ requestId: message.requestId, error: 'placesLoadError' })
    return
  }
  if (current !== dataset || latestRequest !== message.requestId) return
  try {
    let data = current.results.get(message.includeSuspect)
    if (!data) {
      data = analysePlaces(message.includeSuspect ? current.points : current.cleanPoints, refs[0], refs[1], countries, current.datesByPoint)
      current.results.set(message.includeSuspect, data)
    }
    let statistics: StatisticsAnalysis | undefined
    if (message.includeStatistics) {
      statistics = current.statistics.get(message.includeSuspect)
      if (!statistics) {
        statistics = buildStatistics(message.includeSuspect ? current.points : current.cleanPoints, current.points, current.days, data)
        current.statistics.set(message.includeSuspect, statistics)
      }
    }
    let trips: TripsAnalysis | undefined
    if (message.includeTrips) {
      const homeRadiusKm = normalizeHomeRadius(message.homeRadiusKm)
      const { homeLocations = [] } = message
      const cacheKey = `${message.includeSuspect}:${homeRadiusKm}:${JSON.stringify(homeLocations)}`
      trips = current.trips.get(cacheKey)
      if (!trips) {
        const homes = homeLocations.map(home => ({
          ...home,
          countryCode: countryCodeAt({ ...home, id: '', label: '', timestamp: '', kind: 'visit' }, ...refs, countries),
        }))
        trips = buildTrips(message.includeSuspect ? current.points : current.cleanPoints, current.points, data, resolveTripLocality, { homeRadiusKm, homes })
        if (current.trips.size >= 6) current.trips.delete(current.trips.keys().next().value!)
        current.trips.set(cacheKey, trips)
      }
    }
    self.postMessage({ requestId: message.requestId, data, ...(statistics ? { statistics } : {}), ...(trips ? { trips } : {}) })
  } catch {
    self.postMessage({ requestId: message.requestId, error: 'placesAnalysisError' })
  }
}
