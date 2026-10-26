import { feature } from 'topojson-client'
import worldAtlas from 'world-atlas/countries-50m.json'
import type { Topology } from 'topojson-specification'
import { analysePlaces, type CountryFeature } from './places'
import type { TimelinePoint } from './timeline'
import type { CityReference } from './places'

const topology = worldAtlas as unknown as Topology
const countries = feature(topology, topology.objects.countries) as unknown as { features: CountryFeature[] }

self.onmessage = (event: MessageEvent<{ points: TimelinePoint[]; cities: CityReference[]; countryCodes: Record<string, string> }>) => {
  const { points, cities, countryCodes } = event.data
  self.postMessage(analysePlaces(points, cities, countryCodes, countries.features))
}
