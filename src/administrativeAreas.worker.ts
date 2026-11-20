import { analyseAdministrativeAreas, type AreaCountry } from './administrativeAreas'
import type { CountryFeature, PlaceEntry } from './places'
import type { TimelinePoint } from './timeline'

type AreaGroup = { country: AreaCountry; points: TimelinePoint[] }
export type AreaRequest = { groups: AreaGroup[] }
export type AreaResult = { entries: PlaceEntry[]; failedCountries: string[] } | { error: true }

async function loadAreas({ country, points }: AreaGroup) {
  const response = await fetch(`${import.meta.env.BASE_URL}areas/${country}.json.gz`)
  if (!response.ok) throw new Error(`Boundary download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // Vite can serve .gz files with Content-Encoding, so fetch may already
  // have decompressed the response. Check the body before inflating it.
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b
  const body = gzip ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')) : bytes
  const boundaries = await new Response(body).json() as CountryFeature[]
  return analyseAdministrativeAreas(points, country, boundaries)
}

self.onmessage = async ({ data }: MessageEvent<AreaRequest>) => {
  try {
    const entries: PlaceEntry[] = []
    const failedCountries: string[] = []
    for (const group of data.groups) {
      try {
        entries.push(...await loadAreas(group))
      } catch (error) {
        console.warn('Could not load boundaries for', group.country, error)
        failedCountries.push(group.country)
      }
    }
    entries.sort((a, b) => b.days - a.days || b.pointCount - a.pointCount || a.name.localeCompare(b.name))
    self.postMessage({ entries, failedCountries } satisfies AreaResult)
  } catch (error) {
    console.warn('Could not load administrative boundaries:', error)
    self.postMessage({ error: true } satisfies AreaResult)
  }
}
