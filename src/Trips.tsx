import { memo, useId, useMemo, useState } from 'react'
import type { TripDestination, TimelineTrip, TripsAnalysis } from './trips'
import { locales, type Language } from './i18n'
import { formatLargeDistance, formatPlaceDate, type DistanceUnits } from './formatting'
import { tripsTranslations } from './tripsI18n'
import { foreignCountryCodes, groupTripHistory, selectTripHistory, type TripScope, type TripViewGroup } from './tripsView'
import { homeRadiusOptionsKm } from './tripSettings'
import Icon from './Icon'
import './Trips.css'

type Props = {
  data: TripsAnalysis | null
  loading: boolean
  error?: string
  language: Language
  isDemo?: boolean
  distanceUnits?: DistanceUnits
  hasManualHome?: boolean
  onEditHome?: () => void
  homeRadiusKm: number
  onHomeRadiusChange: (radius: number) => void
  onRetry: () => void
  onOpenTrip: (trip: TimelineTrip) => void
}
type Copy = typeof tripsTranslations.nb
type DisplayProps = { locale: string; t: Copy; regionNames: Intl.DisplayNames }

const TRIP_PAGE_SIZE = 10
const PLACE_PAGE_SIZE = 6

function countryName(code: string | undefined, regionNames: Intl.DisplayNames): string {
  return code && /^[A-Z]{2}$/.test(code) ? regionNames.of(code) ?? code : ''
}

function placeName(place: TripDestination, regionNames: Intl.DisplayNames): string {
  return place.kind === 'country' ? countryName(place.countryCode, regionNames) || place.name : place.name
}

function placeContext(place: TripDestination, regionNames: Intl.DisplayNames): string {
  const locality = place.locality && place.locality !== place.name ? place.locality : ''
  const country = place.kind === 'country' ? '' : countryName(place.countryCode, regionNames)
  return [...new Set([locality, place.region, country].filter(Boolean))].join(' · ')
}

function Pagination({ page, pages, onChange, t }: { page: number; pages: number; onChange: (page: number) => void; t: Copy }) {
  if (pages <= 1) return null
  return <nav className="trips-pagination" aria-label={t.tripPages}>
    <button type="button" disabled={page === 0} aria-label={t.previous} onClick={() => onChange(page - 1)}><Icon name="left" /></button>
    <span aria-label={`${t.page} ${page + 1} ${t.of} ${pages}`}>{page + 1} / {pages}</span>
    <button type="button" disabled={page >= pages - 1} aria-label={t.next} onClick={() => onChange(page + 1)}><Icon name="right" /></button>
  </nav>
}

function RecordedPlaces({ places, regionNames, t }: Pick<DisplayProps, 'regionNames' | 't'> & { places: TripDestination[] }) {
  const [requestedPage, setPage] = useState(0)
  const pages = Math.ceil(places.length / PLACE_PAGE_SIZE)
  const page = Math.min(requestedPage, Math.max(0, pages - 1))
  if (!places.length) return null
  return <div className="trips-recorded-places">
    <span className="trips-places-label">{t.recordedPlaces}</span>
    <ul>{places.slice(page * PLACE_PAGE_SIZE, (page + 1) * PLACE_PAGE_SIZE).map((place, index) => {
      const context = placeContext(place, regionNames)
      return <li key={`${place.key}-${index}`}><span>{placeName(place, regionNames)}</span>{context && <small>{context}</small>}</li>
    })}</ul>
    {pages > 1 && <div className="trips-place-pages"><span>{page * PLACE_PAGE_SIZE + 1}–{Math.min((page + 1) * PLACE_PAGE_SIZE, places.length)} {t.of} {places.length}</span><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={t.previousPlaces}><Icon name="left" /></button><button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label={t.nextPlaces}><Icon name="right" /></button></div>}
  </div>
}

const TripRow = memo(function TripRow({ trip, onOpenTrip, locale, t, regionNames }: DisplayProps & { trip: TimelineTrip; onOpenTrip: Props['onOpenTrip'] }) {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const start = formatPlaceDate(trip.startDate, locale)
  const end = formatPlaceDate(trip.endDate, locale)
  const foreign = foreignCountryCodes(trip)
  const name = trip.scope === 'international' ? foreign.map(code => countryName(code, regionNames)).join(' · ') || placeName(trip.destination, regionNames) : placeName(trip.destination, regionNames)
  const cities = trip.scope === 'international' ? [...new Set(trip.places.filter(place => place.kind === 'city' && foreign.includes(place.countryCode ?? '')).map(place => place.name))] : []
  const context = trip.scope === 'international' ? cities.slice(0, 3).join(' · ') + (cities.length > 3 ? ` · +${cities.length - 3}` : '') : placeContext(trip.destination, regionNames)
  const category = trip.category === 'roadtrip' && !trip.hasFlight ? t.roadtrip : trip.category === 'multi-stop' || (trip.category === 'roadtrip' && trip.hasFlight) ? t.multiStop : ''
  return <li className="trips-recent-row">
    <div className="trips-recent-main">
      <span className={'trips-recent-icon' + (category ? ' itinerary' : '')}><Icon name={category ? 'route' : 'pin'} /></span>
      <div className="trips-recent-destination"><strong title={name}>{name}</strong><span>{category && <small className="trips-category">{category}</small>}{context && <small>{context}</small>}</span></div>
      <div className="trips-recent-dates" role="group" aria-label={`${t.departure}: ${start}. ${t.returnHome}: ${end}`}><time dateTime={trip.startDate}>{start}</time><span aria-hidden="true">–</span><time dateTime={trip.endDate}>{end}</time></div>
      <span className="trips-recent-nights"><strong>{trip.nights.toLocaleString(locale)}</strong> {trip.nights === 1 ? t.night : t.nightsShort}</span>
      <button type="button" className="trips-open-map" aria-label={`${t.openMap}: ${name}, ${start} – ${end}`} onClick={() => onOpenTrip(trip)}><Icon name="map" /><span>{t.openMap}</span><Icon name="right" /></button>
      {trip.places.length > 0 && <button type="button" className="trips-details-toggle" aria-expanded={expanded} aria-controls={detailId} aria-label={`${expanded ? t.hideStops : t.showStops}: ${name}, ${start}`} onClick={() => setExpanded(current => !current)}><Icon name="down" /></button>}
    </div>
    {trip.places.length > 0 && <div id={detailId} hidden={!expanded} className="trips-recent-details">{expanded && <RecordedPlaces places={trip.places} regionNames={regionNames} t={t} />}</div>}
  </li>
})

function TripHistory({ trips, groups, scope, locale, t, regionNames, onOpenTrip }: DisplayProps & { trips: TimelineTrip[]; groups: TripViewGroup[]; scope: TripScope; onOpenTrip: Props['onOpenTrip'] }) {
  const [selectedDestination, setDestination] = useState<string | null>(null)
  const [selectedCity, setCity] = useState<string | null>(null)
  const [requestedPage, setPage] = useState(0)
  const recentId = useId()
  const group = groups.find(candidate => candidate.destination.key === selectedDestination)
  const destination = group?.destination
  const city = group?.cities.find(entry => entry.destination.key === selectedCity)?.destination
  const isInternational = scope === 'international'
  const destinationKey = destination?.key
  const countryCode = destination?.countryCode
  const cityKey = city?.key
  const recentTrips = selectTripHistory(trips, isInternational ? { countryCode, cityKey } : { destinationKey })
  const topDestinations = groups.slice(0, 5)
  const pages = Math.ceil(recentTrips.length / TRIP_PAGE_SIZE)
  const page = Math.min(requestedPage, Math.max(0, pages - 1))
  const revealHistory = () => document.getElementById(`${recentId}-heading`)?.scrollIntoView({ block: 'start' })
  const changePage = (nextPage: number) => { setPage(nextPage); revealHistory() }
  const filterDestination = (key: string | null) => { setDestination(key); setCity(null); setPage(0); revealHistory() }
  const filterCity = (key: string | null) => { setCity(key); setPage(0) }
  const mostVisited = isInternational ? t.mostVisitedCountries : t.mostVisited
  return <>
    {topDestinations.length > 0 && <section className="trips-favourites" aria-label={mostVisited}>
      <div className="trips-section-heading"><div><h2>{mostVisited}</h2><p>{isInternational ? t.countriesIntro : t.mostVisitedIntro}</p></div></div>
      <div className="trips-destination-cards">{topDestinations.map((item, index) => {
        const name = placeName(item.destination, regionNames)
        const context = isInternational ? item.cities.slice(0, 3).map(entry => entry.destination.name).join(' · ') || t.country : placeContext(item.destination, regionNames)
        const count = `${item.trips.length.toLocaleString(locale)} ${item.trips.length === 1 ? t.trip : t.trips}`
        return <button type="button" key={item.destination.key} className={'trips-destination-card' + (index === 0 ? ' first' : '')} aria-pressed={destination?.key === item.destination.key} aria-controls={recentId} aria-label={`${t.filterDestination}: ${name}${context ? `, ${context}` : ''}. ${count}`} onClick={() => filterDestination(destination?.key === item.destination.key ? null : item.destination.key)}>
          <span className="trips-card-top"><Icon name={item.destination.kind === 'country' ? 'globe' : 'pin'} /><span>{String(index + 1).padStart(2, '0')}</span></span>
          <span className="trips-card-place"><strong title={name}>{name}</strong><small title={context || undefined}>{context || t.destination}</small></span>
          <span className="trips-card-visits"><strong>{item.trips.length.toLocaleString(locale)}</strong><span>{item.trips.length === 1 ? t.trip : t.trips}</span><Icon name="arrow" /></span>
          <span className="trips-card-last">{t.lastVisit} <time dateTime={item.lastStartDate}>{formatPlaceDate(item.lastStartDate, locale)}</time></span>
        </button>
      })}</div>
    </section>}
    <section className="trips-recents" id={recentId} aria-label={t.recents}>
      <div className="trips-section-heading"><div><h2 id={`${recentId}-heading`}>{t.recents} <span>{recentTrips.length.toLocaleString(locale)}</span></h2><p aria-live="polite">{destination ? `${t.showingDestination} ${placeName(destination, regionNames)}${city ? ` · ${city.name}` : ''}` : t.recentsIntro}</p></div><div className="trips-history-controls">{destination && <button type="button" className="trips-clear-filter" onClick={() => filterDestination(null)}>{t.showAllTrips}<Icon name="close" /></button>}<Pagination page={page} pages={pages} onChange={changePage} t={t} /></div></div>
      {isInternational && groups.length > 0 && <div className="trips-country-filters">
        <label className="trips-select compact"><span>{t.country}</span><select value={destination?.key ?? ''} onChange={event => filterDestination(event.target.value || null)}><option value="">{t.allCountries}</option>{groups.map(item => <option key={item.destination.key} value={item.destination.key}>{placeName(item.destination, regionNames)} ({item.trips.length})</option>)}</select></label>
        {group && group.cities.length > 0 && <label className="trips-select compact"><span>{t.city}</span><select value={city?.key ?? ''} onChange={event => filterCity(event.target.value || null)}><option value="">{t.allCities}</option>{group.cities.map(entry => <option key={entry.destination.key} value={entry.destination.key}>{entry.destination.name} ({entry.count})</option>)}</select></label>}
        <span>{t.countryFilterHint}</span>
      </div>}
      <ol className="trips-recent-list">{recentTrips.slice(page * TRIP_PAGE_SIZE, (page + 1) * TRIP_PAGE_SIZE).map(trip => <TripRow key={trip.id} trip={trip} locale={locale} t={t} regionNames={regionNames} onOpenTrip={onOpenTrip} />)}</ol>
      {pages > 1 && <div className="trips-list-footer"><span>{page * TRIP_PAGE_SIZE + 1}–{Math.min((page + 1) * TRIP_PAGE_SIZE, recentTrips.length)} {t.of} {recentTrips.length.toLocaleString(locale)} {t.trips}</span><Pagination page={page} pages={pages} onChange={changePage} t={t} /></div>}
    </section>
  </>
}

export default function Trips({ data, loading, error, language, isDemo = false, distanceUnits = 'metric', homeRadiusKm, hasManualHome, onEditHome, onHomeRadiusChange, onRetry, onOpenTrip }: Props) {
  const [selectedYear, setYear] = useState('all')
  const radiusHintId = useId()
  const [selectedScope, setScope] = useState<TripScope | null>(null)
  const locale = locales[language]
  const t = tripsTranslations[language]
  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale])
  const presets = homeRadiusOptionsKm[distanceUnits]
  const radiusOptions = presets.includes(homeRadiusKm) ? presets : [...presets, homeRadiusKm].sort((a, b) => a - b)
  const currentData = data?.homeRadiusKm === homeRadiusKm ? data : null
  const pending = loading || (!error && data !== null && currentData === null)
  const years = useMemo(() => [...new Set(currentData?.trips.map(trip => trip.startDate.slice(0, 4)) ?? [])].sort((a, b) => Number(b) - Number(a)), [currentData])
  const year = years.includes(selectedYear) ? selectedYear : 'all'
  const yearTrips = useMemo(() => selectTripHistory(currentData?.trips ?? [], { year }), [currentData, year])
  const counts = useMemo(() => yearTrips.reduce((result, trip) => { result[trip.scope]++; return result }, { domestic: 0, international: 0, unknown: 0 }), [yearTrips])
  const defaultScope: TripScope = counts.domestic ? 'domestic' : counts.international ? 'international' : counts.unknown ? 'unknown' : 'domestic'
  const scope = selectedScope === null || (selectedScope === 'unknown' && !counts.unknown) ? defaultScope : selectedScope
  const trips = useMemo(() => selectTripHistory(yearTrips, { scope }), [yearTrips, scope])
  const groups = useMemo(() => groupTripHistory(trips, scope), [trips, scope])
  const totalNights = useMemo(() => trips.reduce((sum, trip) => sum + trip.nights, 0), [trips])
  const ready = !pending && !error && currentData !== null
  const scopeLabels = { domestic: t.domestic, international: t.international, unknown: t.unknownScope }

  return <section className="trips-page" aria-label={t.title}><div className="trips-container">
    <header className="trips-heading report-heading">
      <h1>{t.title}{isDemo && <span className="trips-sample">{t.sample}</span>}</h1>
      {years.length > 0 && <label className="report-period"><span>{t.year}</span><select value={year} onChange={event => setYear(event.target.value)}><option value="all">{t.all}</option>{years.map(candidate => <option key={candidate} value={candidate}>{Number(candidate)}</option>)}</select></label>}
    </header>
    <p className="trips-intro">{t.intro}</p>
    <div className="trips-settings">
      <p className="trips-radius-hint" id={radiusHintId}>{t.radiusHint.replace('{radius}', formatLargeDistance(homeRadiusKm, locale, distanceUnits))}</p>
      <div className="trips-scope-switch" role="group" aria-label={t.tripScope}>{(['domestic', 'international', ...(counts.unknown ? ['unknown'] : [])] as TripScope[]).map(candidate => <button type="button" key={candidate} disabled={!ready} aria-pressed={scope === candidate} onClick={() => setScope(candidate)}>{scopeLabels[candidate]}{ready && <span>{counts[candidate].toLocaleString(locale)}</span>}</button>)}</div>
      <div className="trips-home-controls">
        <label className="trips-select compact trips-radius"><span>{t.homeRadius}</span><select aria-describedby={radiusHintId} value={homeRadiusKm} onChange={event => onHomeRadiusChange(Number(event.target.value))}>{radiusOptions.map(radius => <option key={radius} value={radius}>{formatLargeDistance(radius, locale, distanceUnits)}</option>)}</select></label>
        {onEditHome && <button type="button" className="trips-home-button" aria-haspopup="dialog" onClick={onEditHome}>
          <Icon name="pin" />{hasManualHome ? t.editHomeLocation : t.setHomeLocation}
        </button>}
      </div>
    </div>
    {pending ? <div className="trips-state" role="status"><span className="trips-spinner" /><h2>{t.loading}</h2><p>{t.loadingHint}</p></div> : error ? <div className="trips-state" role="alert"><Icon name="route" /><h2>{t.error}</h2><p>{error}</p><button type="button" className="primary-button" onClick={onRetry}>{t.retry}</button></div> : !currentData ? <div className="trips-state"><Icon name="route" /><h2>{t.noData}</h2><p>{t.noDataHint}</p></div> : currentData.homeStatus === 'missing' ? <div className="trips-state trips-empty"><Icon name="pin" /><h2>{t.homeMissing}</h2><p>{t.homeMissingHint}</p></div> : yearTrips.length === 0 ? <div className="trips-state trips-empty"><Icon name="route" /><h2>{t.noTrips}</h2><p>{t.noTripsHint}</p></div> : <>
      <div className="trips-overview" aria-label={`${t.overview}: ${scopeLabels[scope]}`}>
        <div className="trips-hero"><span><Icon name="route" />{t.completedTrips}</span><strong>{trips.length.toLocaleString(locale)}</strong><small>{t.completedHint}</small></div>
        <div className="trips-metric"><Icon name="moon" /><strong>{totalNights.toLocaleString(locale)}</strong><span>{t.nights}</span></div>
        <div className="trips-metric" title={scope === 'international' ? t.countriesHint : t.destinationsHint}><Icon name="globe" /><strong>{groups.length.toLocaleString(locale)}</strong><span>{scope === 'international' ? t.countries : t.destinations}</span></div>
      </div>
      {trips.length > 0 ? <TripHistory key={`${year}:${scope}:${homeRadiusKm}`} trips={trips} groups={groups} scope={scope} locale={locale} t={t} regionNames={regionNames} onOpenTrip={onOpenTrip} /> : <div className="trips-state trips-empty"><Icon name="route" /><h2>{t.noScopeTrips.replace('{scope}', scopeLabels[scope].toLowerCase())}</h2><p>{t.noScopeTripsHint}</p></div>}
    </>}
    <details className="trips-method"><summary>{t.howItWorks}<Icon name="down" /></summary><p>{t.detectionHint}</p><p>{t.homeDetectionHint}</p><p>{t.destinationHint}</p><p>{t.yearHint}</p><p className="trips-attribution">{t.placeNames} <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0).</p></details>
  </div></section>
}
