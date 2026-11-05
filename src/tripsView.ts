import type { TimelineTrip, TripDestination } from './trips'

export type TripScope = TimelineTrip['scope']
export type TripViewFilters = { year?: string; scope?: TripScope; destinationKey?: string; countryCode?: string; cityKey?: string }
export type TripViewGroup = { destination: TripDestination; trips: TimelineTrip[]; lastStartDate: string; cities: { destination: TripDestination; count: number }[] }

export function foreignCountryCodes(trip: TimelineTrip): string[] {
  return [...new Set(trip.countryCodes.filter(code => code !== trip.homeCountryCode))]
}

/** Keep complete journeys and filter exact stays, or countries and their cities. */
export function selectTripHistory(trips: TimelineTrip[], { year = 'all', scope, destinationKey, countryCode, cityKey }: TripViewFilters = {}): TimelineTrip[] {
  return trips.filter(trip => (year === 'all' || trip.startDate.startsWith(`${year}-`))
      && (!scope || trip.scope === scope)
      && (!destinationKey || trip.destination.key === destinationKey)
      && (!countryCode || foreignCountryCodes(trip).includes(countryCode))
      && (!cityKey || trip.places.some(place => place.key === cityKey && (!countryCode || place.countryCode === countryCode))))
    .toSorted((a, b) => b.startTimestamp.localeCompare(a.startTimestamp))
}

/** A multi-country journey belongs to each country, once per country. */
export function groupTripHistory(trips: TimelineTrip[], scope: TripScope): TripViewGroup[] {
  const groups = new Map<string, TripViewGroup>()
  const cityCounts = new Map<string, Map<string, { destination: TripDestination; count: number }>>()
  for (const trip of trips) {
    if (trip.scope !== scope) continue
    const destinations: TripDestination[] = scope === 'international'
      ? foreignCountryCodes(trip).map(code => ({ key: `country:${code}`, name: code, countryCode: code, kind: 'country' }))
      : trip.destination.kind === 'itinerary' ? [] : [trip.destination]
    for (const destination of destinations) {
      let group = groups.get(destination.key)
      if (!group) {
        group = { destination, trips: [], lastStartDate: trip.startDate, cities: [] }
        groups.set(destination.key, group)
      }
      group.trips.push(trip)
      if (trip.startDate > group.lastStartDate) group.lastStartDate = trip.startDate
      if (scope !== 'international') continue
      const cities = cityCounts.get(destination.key) ?? new Map<string, { destination: TripDestination; count: number }>()
      const seen = new Set<string>()
      for (const city of trip.places) {
        if (city.kind !== 'city' || city.countryCode !== destination.countryCode || seen.has(city.key)) continue
        seen.add(city.key)
        const entry = cities.get(city.key) ?? { destination: city, count: 0 }
        entry.count++
        cities.set(city.key, entry)
      }
      cityCounts.set(destination.key, cities)
    }
  }
  return [...groups.values()].map(group => ({ ...group, cities: [...(cityCounts.get(group.destination.key)?.values() ?? [])].sort((a, b) => b.count - a.count || a.destination.name.localeCompare(b.destination.name)) }))
    .sort((a, b) => b.trips.length - a.trips.length || b.lastStartDate.localeCompare(a.lastStartDate) || a.destination.key.localeCompare(b.destination.key))
}
