import { createCountryLookup } from './geography.ts'
import { pointDateKeys } from './pointDates.ts'
import type { CountryFeature, PlaceEntry } from './places.ts'
import type { TimelinePoint } from './timeline.ts'

import datasets from './data/area-datasets.json' with { type: 'json' }

type AreaDataset = { source: string; url: string; level: string; year: string; license: string }
export const areaDatasets: Readonly<Record<string, AreaDataset>> = datasets

export type AreaCountry = keyof typeof areaDatasets

export function hasAreaDataset(code: string): code is AreaCountry {
  return Object.hasOwn(areaDatasets, code)
}

export function analyseAdministrativeAreas(points: readonly TimelinePoint[], countryCode: AreaCountry, boundaries: CountryFeature[]): PlaceEntry[] {
  // Index local boundaries and require polygon containment.
  const lookup = createCountryLookup(boundaries, 1, 0)
  const groups = new Map<string, { name: string; boundary: CountryFeature; days: Set<string>; pointIds: string[] }>()
  for (const point of points) {
    const boundary = lookup(point.lat, point.lng)
    if (boundary?.id == null || !boundary.properties?.name) continue
    const dates = pointDateKeys(point)
    if (!dates.length) continue
    const key = `${countryCode}:${boundary.id}`
    let group = groups.get(key)
    if (!group) {
      group = { name: boundary.properties.name, boundary, days: new Set(), pointIds: [] }
      groups.set(key, group)
    }
    group.pointIds.push(point.id)
    for (const date of dates) group.days.add(date)
  }
  return Array.from(groups, ([key, group]) => ({
    key, countryCode, boundary: group.boundary, name: group.name, days: group.days.size, dates: [...group.days].sort().reverse(),
    pointCount: group.pointIds.length, pointIds: group.pointIds,
  })).sort((a, b) => b.days - a.days || b.pointCount - a.pointCount || a.name.localeCompare(b.name))
}
