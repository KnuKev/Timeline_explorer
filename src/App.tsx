import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseTimeline, type TimelinePoint } from './timeline'
import { demoTimeline, demoStartDate, demoEndDate } from './demoTimeline'
import { selectPlacesYear, type PlaceEntry } from './places'
import type { TimelineTrip } from './trips'
import { demoHomeLocationStorageKey, getStoredHomeLocations, homeLocationStorageKey, type DatedHomeLocation, getStoredHomeRadius, homeRadiusForUnits, homeRadiusStorageKey, normalizeHomeRadius } from './tripSettings'
import { getStoredLanguage, languageStorageKey, locales, pointLabel, translations, type Language } from './i18n'
import { buildRouteSegments } from './routes'
import { prepareTimeline, selectTimelineRange, groupTimelineSelection, adjacentRecordedDay, type TimelineDataset } from './timelineIndex'
import { useTimelineImport } from './useTimelineImport'
import { usePlaces } from './usePlaces'
import TimelineMap from './TimelineMap'
import { getMapColors, getStoredMapBackground, mapBackgroundStorageKey } from './mapAppearance'
import PointList from './PointList'
import Icon from './Icon'
import SettingsMenu from './SettingsMenu'
import HomeLocationDialog from './HomeLocationDialog'
import { distanceUnitsStorageKey, formatCalendarDate, formatPlaceDate, formatPointInterval, formatDistance, formatLargeDistance, getStoredDistanceUnits } from './formatting'
import './App.css'

type SheetSize = 'compact' | 'half' | 'expanded'
const sheetSizes: SheetSize[] = ['compact', 'half', 'expanded']

type DateMode = 'day' | 'period'
type ActiveTab = 'map' | 'trips' | 'places' | 'statistics'
type PlaceScope = { kind: 'country' | 'city'; name: string; key: string; countryName?: string; countryCode?: string }
const Statistics = lazy(() => import('./Statistics.tsx'))
const Trips = lazy(() => import('./Trips.tsx'))
const MergeDialog = lazy(() => import('./MergeDialog.tsx'))
const ExportDialog = lazy(() => import('./ExportDialog.tsx'))

const demoTimelineUrl = new URL('./data/fictional-timeline.json', import.meta.url).href

function App() {
  const [language, setLanguage] = useState<Language>(getStoredLanguage)
  const [distanceUnits, setDistanceUnits] = useState(getStoredDistanceUnits)
  const t = translations[language]
  const locale = locales[language]
  const regionNames = useMemo(() => new Intl.DisplayNames([locale], { type: 'region' }), [locale])
  const countryName = (code?: string, fallback?: string) => code ? regionNames.of(code) ?? fallback ?? t.unknownCountry : fallback ?? t.unknownCountry

  useEffect(() => {
    document.documentElement.lang = language
    try { localStorage.setItem(languageStorageKey, language) } catch { /* Language switching also works when storage is unavailable. */ }
  }, [language])
  useEffect(() => { try { localStorage.setItem(distanceUnitsStorageKey, distanceUnits) } catch { /* Storage is optional. */ } }, [distanceUnits])
  const [dataset, setDataset] = useState(() => prepareTimeline(parseTimeline(demoTimeline)))
  const importedPoints = dataset.points
  const [showSuspectPoints, setShowSuspectPoints] = useState(false)
  const [qualityDismissed, setQualityDismissed] = useState(false)
  const pointQuality = dataset
  const pointsById = useMemo(() => new Map(importedPoints.map(point => [point.id, point])), [importedPoints])
  const suspectPointIds = useMemo(() => new Set(dataset.excluded.map(entry => entry.point.id)), [dataset])
  const [activeTab, setActiveTab] = useState<ActiveTab>('map')
  const [sheetSize, setSheetSize] = useState<SheetSize>('half')
  const shell = useRef<HTMLElement>(null)
  const sheet = useRef<HTMLElement>(null)
  const sheetContent = useRef<HTMLDivElement>(null)
  const lastSheetWheel = useRef<{ time: number; direction: number } | null>(null)
  const ignoreSheetClick = useRef(false)

  useEffect(() => {
    const panel = sheet.current
    const content = sheetContent.current
    const element = shell.current
    if (!panel || !content || !element) return
    const mobile = window.matchMedia('(max-width: 680px)')
    let gesture: {
      id: number
      x: number
      y: number
      fromHandle: boolean
      height: number
      stops: [number, number, number]
      samples: { y: number; time: number }[]
      dragging: boolean
    } | undefined

    function begin(id: number, x: number, y: number, time: number, fromHandle: boolean) {
      if (!panel || !element) return
      const style = getComputedStyle(panel)
      const min = parseFloat(style.minHeight)
      const max = Math.max(min, parseFloat(style.maxHeight))
      const middle = Math.max(min, Math.min(max, element.clientHeight * .48))
      gesture = { id, x, y, fromHandle, height: panel.getBoundingClientRect().height,
        stops: [min, middle, max], samples: [{ y, time }], dragging: false }
    }

    function move(id: number, x: number, y: number, time: number, event: PointerEvent | TouchEvent) {
      const drag = gesture
      if (!drag || drag.id !== id || !element || !content) return
      const distance = drag.y - y
      if (!drag.dragging) {
        if (Math.max(Math.abs(distance), Math.abs(x - drag.x)) < 5) return
        if (Math.abs(x - drag.x) > Math.abs(distance)
          || (!drag.fromHandle && sheetSize === 'expanded' && (distance > 0 || content.scrollTop > 1))) {
          gesture = undefined
          return
        }
        if (event instanceof PointerEvent) panel?.setPointerCapture(id)
        drag.dragging = true
        ignoreSheetClick.current = true
        element.dataset.sheetDragging = 'true'
      }
      if (event.cancelable) event.preventDefault()
      drag.samples = drag.samples.filter(sample => time - sample.time <= 100)
      drag.samples.push({ y, time })
      const height = drag.height + distance
      element.style.setProperty('--sheet-drag-height', `${height}px`)
      if (!drag.fromHandle) {
        element.toggleAttribute('data-sheet-at-top', height >= drag.stops[2])
        content.scrollTop = Math.max(0, height - drag.stops[2])
      }
    }

    function finish(id: number, y: number, time: number, cancelled: boolean) {
      const drag = gesture
      if (!drag || drag.id !== id || !element) return
      gesture = undefined
      if (!drag.dragging) return
      if (!cancelled) {
        const distance = drag.y - y
        const height = drag.height + distance
        const [compact, middle, expanded] = drag.stops
        const sample = drag.samples.find(entry => time - entry.time <= 100)
        const velocity = sample ? (sample.y - y) / Math.max(1, time - sample.time) : 0
        const current = sheetSizes.indexOf(sheetSize)
        const flick = Math.abs(velocity) >= .45 && Math.abs(distance) >= 14
        const next = height >= expanded ? 2 : height <= compact ? 0
          : flick ? Math.max(0, Math.min(2, current + Math.sign(velocity)))
            : height < middle - (middle - compact) * .66 ? 0
              : height > middle + (expanded - middle) * .66 ? 2 : 1
        setSheetSize(sheetSizes[next]!)
      }
      delete element.dataset.sheetDragging
      element.style.removeProperty('--sheet-drag-height')
      requestAnimationFrame(() => {
        if (!element.hasAttribute('data-sheet-dragging')) element.removeAttribute('data-sheet-at-top')
        panel?.dispatchEvent(new Event('sheetsettle'))
      })
    }

    function onPointerDown(event: PointerEvent) {
      if (!mobile.matches || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return
      ignoreSheetClick.current = false
      const handle = event.target.closest('.sheet-handle')
      if (!handle && (event.pointerType === 'touch' || sheetSize === 'expanded' || event.target.closest('input, select, textarea'))) return
      begin(event.pointerId, event.clientX, event.clientY, event.timeStamp, Boolean(handle))
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerType === 'touch' && !gesture?.fromHandle) return
      move(event.pointerId, event.clientX, event.clientY, event.timeStamp, event)
    }

    function onPointerEnd(event: PointerEvent) {
      if (event.pointerType === 'touch' && !gesture?.fromHandle) return
      finish(event.pointerId, event.clientY, event.timeStamp, event.type !== 'pointerup')
    }

    function onTouchStart(event: TouchEvent) {
      ignoreSheetClick.current = false
      if (!mobile.matches || event.touches.length !== 1 || !(event.target instanceof Element)
        || event.target.closest('input, select, textarea')) return
      const touch = event.touches[0]!
      begin(touch.identifier, touch.clientX, touch.clientY, event.timeStamp, false)
    }

    function onTouchMove(event: TouchEvent) {
      if (!gesture || gesture.fromHandle) return
      const touch = Array.from(event.changedTouches).find(entry => entry.identifier === gesture?.id)
      if (!touch) return
      if (event.touches.length !== 1 || !event.cancelable) {
        finish(touch.identifier, touch.clientY, event.timeStamp, true)
        return
      }
      move(touch.identifier, touch.clientX, touch.clientY, event.timeStamp, event)
    }

    function onTouchEnd(event: TouchEvent) {
      if (!gesture || gesture.fromHandle) return
      const touch = Array.from(event.changedTouches).find(entry => entry.identifier === gesture?.id)
      if (touch) finish(touch.identifier, touch.clientY, event.timeStamp, event.type === 'touchcancel')
    }

    panel.addEventListener('pointerdown', onPointerDown)
    panel.addEventListener('pointermove', onPointerMove)
    panel.addEventListener('pointerup', onPointerEnd)
    panel.addEventListener('pointercancel', onPointerEnd)
    panel.addEventListener('lostpointercapture', onPointerEnd)
    content.addEventListener('touchstart', onTouchStart, { passive: true })
    content.addEventListener('touchmove', onTouchMove, { passive: false })
    content.addEventListener('touchend', onTouchEnd)
    content.addEventListener('touchcancel', onTouchEnd)
    return () => {
      panel.removeEventListener('pointerdown', onPointerDown)
      panel.removeEventListener('pointermove', onPointerMove)
      panel.removeEventListener('pointerup', onPointerEnd)
      panel.removeEventListener('pointercancel', onPointerEnd)
      panel.removeEventListener('lostpointercapture', onPointerEnd)
      content.removeEventListener('touchstart', onTouchStart)
      content.removeEventListener('touchmove', onTouchMove)
      content.removeEventListener('touchend', onTouchEnd)
      content.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [sheetSize])

  useEffect(() => {
    if (sheetSize !== 'expanded' && sheetContent.current) sheetContent.current.scrollTop = 0
  }, [sheetSize])

  useEffect(() => {
    const panel = sheet.current
    if (!panel) return
    const onWheel = (event: WheelEvent) => {
      if (!window.matchMedia('(max-width: 680px)').matches || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const direction = Math.sign(event.deltaY)
      const previous = lastSheetWheel.current
      const continued = previous?.direction === direction && event.timeStamp - previous.time < 180
      const reachedTop = sheetSize === 'expanded' && panel.getBoundingClientRect().height >= parseFloat(getComputedStyle(panel).maxHeight) - 1
      if (reachedTop && direction > 0) return
      if (continued) {
        event.preventDefault()
        lastSheetWheel.current = { time: event.timeStamp, direction }
        return
      }
      if (sheetSize === 'expanded' && (direction > 0 || (sheetContent.current?.scrollTop ?? 0) > 0)) return
      event.preventDefault()
      lastSheetWheel.current = { time: event.timeStamp, direction }
      const next = Math.max(0, Math.min(2, sheetSizes.indexOf(sheetSize) + direction))
      setSheetSize(sheetSizes[next]!)
    }
    panel.addEventListener('wheel', onWheel, { passive: false })
    return () => panel.removeEventListener('wheel', onWheel)
  }, [sheetSize])

  const mainNav = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const nav = mainNav.current
    const current = nav?.querySelector<HTMLButtonElement>('[aria-current="page"]')
    if (!nav || !current) return

    function positionIndicator() {
      if (!nav || !current) return
      const navBounds = nav.getBoundingClientRect()
      const tabBounds = current.getBoundingClientRect()
      nav.style.setProperty('--nav-indicator-x', `${tabBounds.left - navBounds.left - nav.clientLeft}px`)
      nav.style.setProperty('--nav-indicator-width', `${tabBounds.width}px`)
    }

    positionIndicator()
    const observer = new ResizeObserver(positionIndicator)
    for (const button of nav.children) observer.observe(button)
    return () => observer.disconnect()
  }, [activeTab, language])
  const [fileDialog, setFileDialog] = useState<'merge' | 'export' | null>(null)
  const [placeMode, setPlaceMode] = useState<'countries' | 'cities'>('countries')
  const [placeYear, setPlaceYear] = useState('all')
  const [placesRequested, setPlacesRequested] = useState(false)
  const [statisticsRequested, setStatisticsRequested] = useState(false)
  const [tripsRequested, setTripsRequested] = useState(false)
  const [tripScope, setTripScope] = useState<TimelineTrip | null>(null)
  const [storedRadiusKm, setHomeRadiusKm] = useState(getStoredHomeRadius)
  const homeRadiusKm = homeRadiusForUnits(storedRadiusKm, distanceUnits)
  const [placeScope, setPlaceScope] = useState<PlaceScope | null>(null)
  const [placeViewEnabled, setPlaceViewEnabled] = useState(false)
  const [isDemo, setIsDemo] = useState(true)
  const [storedHome, setStoredHome] = useState(getStoredHomeLocations)
  const [demoHome, setDemoHome] = useState(() => getStoredHomeLocations(demoHomeLocationStorageKey))
  const [homeDialogOpen, setHomeDialogOpen] = useState(false)
  const homeLocations = isDemo ? demoHome : storedHome
  const [isDark, setIsDark] = useState(() => { try { return localStorage.getItem('timeline-explorer-dark') === 'true' } catch { return false } })
  const [mapBackground, setMapBackground] = useState(getStoredMapBackground)
  const mapColors = getMapColors(isDark || mapBackground === 'satellite')
  const [isPointListExpanded, setIsPointListExpanded] = useState(false)
  const [dateMode, setDateMode] = useState<DateMode>('period')
  const [selectedDate, setSelectedDate] = useState(demoStartDate)
  const [fromDate, setFromDate] = useState(demoStartDate)
  const [toDate, setToDate] = useState(demoEndDate)
  const [fileName, setFileName] = useState('')
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)
  const { data: placeAnalysis, statistics, trips, loading: placesLoading, statisticsLoading, tripsLoading, error: placesError, retry: retryPlaces } = usePlaces(dataset, showSuspectPoints, placesRequested, statisticsRequested, tripsRequested, homeRadiusKm, homeLocations)
  useEffect(() => { try { localStorage.setItem('timeline-explorer-dark', String(isDark)) } catch { /* Storage is optional. */ } }, [isDark])
  useEffect(() => { try { localStorage.setItem(mapBackgroundStorageKey, mapBackground) } catch { /* Storage is optional. */ } }, [mapBackground])
  useEffect(() => { try { localStorage.setItem(homeRadiusStorageKey, String(storedRadiusKm)) } catch { /* The radius also works without storage. */ } }, [storedRadiusKm])

  const availableDays = useMemo(() => dataset.days.filter(day => showSuspectPoints || day.cleanCount > 0).map(day => day.day), [dataset, showSuspectPoints])
  const visiblePoints = useMemo(() => selectTimelineRange(dataset, dateMode === 'day' ? selectedDate : fromDate, dateMode === 'day' ? selectedDate : toDate, showSuspectPoints), [dataset, dateMode, selectedDate, fromDate, toDate, showSuspectPoints])

  const placeYears = useMemo(() => [...new Set(dataset.days.map(day => day.day.slice(0, 4)))].reverse(), [dataset])
  const selectedPlaces = useMemo(() => {
    if (!placeAnalysis || placeYear === 'all') return placeAnalysis
    const points = selectTimelineRange(dataset, `${placeYear}-01-01`, `${placeYear}-12-31`, showSuspectPoints)
    return selectPlacesYear(placeAnalysis, placeYear, new Set(points.map(point => point.id)))
  }, [dataset, placeAnalysis, placeYear, showSuspectPoints])

  const mapPoints = useMemo(() => {
    if (tripScope) return (tripScope.mapPointIds ?? tripScope.pointIds).map(id => pointsById.get(id)).filter((point): point is TimelinePoint => Boolean(point))
    if (!placeScope || !placeViewEnabled) return visiblePoints
    const scopedPlaces = placeScope.kind === 'country' ? selectedPlaces?.countries : selectedPlaces?.cities
    const ids = scopedPlaces?.find(place => place.key === placeScope.key)?.pointIds ?? []
    return ids.map(id => pointsById.get(id)).filter((point): point is TimelinePoint => Boolean(point))
  }, [tripScope, selectedPlaces, placeScope, placeViewEnabled, pointsById, visiblePoints])
  const places = placeMode === 'countries' ? selectedPlaces?.countries ?? [] : selectedPlaces?.cities ?? []
  const mainPlaces = places.filter((place) => place.pointCount >= 10)
  const fewerPlaces = places.filter((place) => place.pointCount < 10)
  const placeName = (place: PlaceEntry) => placeMode === 'countries' ? countryName(place.countryCode, place.name) : place.name
  const scopeName = placeScope?.kind === 'country' ? countryName(placeScope.countryCode, placeScope.name) : placeScope?.name ?? ''
  const tripName = tripScope?.destination.kind === 'country' ? countryName(tripScope.destination.countryCode, tripScope.destination.name) : tripScope?.destination.name ?? ''
  const tripCategoryName = tripScope?.category === 'roadtrip' && !tripScope.hasFlight ? t.roadTrip : tripScope?.category === 'multi-stop' || tripScope?.category === 'roadtrip' ? t.multiStopTrip : t.trips
  const renderPlaceCard = (place: PlaceEntry, index: number) => (
    <button key={place.key} type="button" className="place-card" onClick={() => {
      setPlaceScope({ kind: placeMode === 'countries' ? 'country' : 'city', key: place.key, name: place.name, countryName: place.countryName, countryCode: place.countryCode })
      if (placeYear !== 'all') {
        const dates = availableDays.filter(day => day.startsWith(placeYear + '-'))
        setFromDate(dates[0]!)
        setToDate(dates.at(-1)!)
        setSelectedDate(dates[0]!)
        setDateMode('period')
      }
      setPlaceViewEnabled(true)
      setTripScope(null)
      setSheetSize('compact')
      setActiveTab('map')
      setSelectedPointId(null)
    }}>
      <span className="place-rank">{String(index + 1).padStart(2, '0')}</span>
      <span className="place-card-copy"><strong title={placeName(place)}>{placeName(place)}</strong><small>{placeMode === 'cities' ? countryName(place.countryCode, place.countryName) : t.country}</small></span>
      <span className="place-days"><strong>{place.days.toLocaleString(locale)}</strong><small>{t.days}</small></span>
      <span className="place-dates"><small>{place.dates.length > 1 ? t.recentDates : t.date}</small><span>{place.dates.slice(0, 3).map((date) => formatPlaceDate(date, locale)).join(' · ') + (place.dates.length > 3 ? ' · +' + (place.dates.length - 3) : '')}</span></span>
      <span className="place-card-footer">{place.pointCount.toLocaleString(locale)} {t.locationPoints} <Icon name="arrow" /></span>
    </button>
  )
  const selectedPoint = useMemo(() => selectedPointId === null ? null : mapPoints.find(point => point.id === selectedPointId) ?? null, [mapPoints, selectedPointId])
  const route = useMemo(() => buildRouteSegments(mapPoints, importedPoints), [mapPoints, importedPoints])
  const hasFlights = useMemo(() => route.segments.some(segment => segment.transport === 'flight'), [route])
  const mapDistance = route.distanceKm
  const distanceLabel = formatDistance(mapDistance, locale, distanceUnits)
  const distanceSeparator = distanceLabel.lastIndexOf(' ')
  const distanceValue = distanceSeparator < 0 ? distanceLabel : distanceLabel.slice(0, distanceSeparator)
  const distanceUnit = distanceSeparator < 0 ? '' : distanceLabel.slice(distanceSeparator + 1)
  const pointGroups = useMemo(() => isPointListExpanded ? groupTimelineSelection(dataset, mapPoints,
    placeScope && placeViewEnabled ? (placeYear === 'all' ? undefined : `${placeYear}-01-01`) : dateMode === 'day' ? selectedDate : fromDate,
    placeScope && placeViewEnabled ? (placeYear === 'all' ? undefined : `${placeYear}-12-31`) : dateMode === 'day' ? selectedDate : toDate) : [],
    [dataset, mapPoints, isPointListExpanded, placeYear, placeScope, placeViewEnabled, dateMode, selectedDate, fromDate, toDate])
  const handleLoaded = useCallback((next: TimelineDataset, filename: string) => {
    const days = next.days.filter(day => day.cleanCount > 0)
    if (!days.length) throw new Error('No supported calendar dates in this import')
    const firstDay = days[0]!.day
    const lastDay = days[days.length - 1]!.day
    const weekStartDate = new Date(lastDay + 'T12:00:00Z')
    weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 6)
    const weekStart = weekStartDate.toISOString().slice(0, 10)
    setDataset(next)
    setPlaceYear('all')
    setShowSuspectPoints(false)
    setQualityDismissed(false)
    setIsDemo(false)
    setFileName(filename)
    setSelectedDate(firstDay)
    setFromDate(weekStart < firstDay ? firstDay : weekStart)
    setToDate(lastDay)
    setDateMode('day')
    setSelectedPointId(null)
    setPlaceScope(null)
    setPlaceViewEnabled(false)
    setTripScope(null)
    setActiveTab('map')
  }, [])
  const { importFile, cancelImport, stage: importStage, error } = useTimelineImport(handleLoaded)
  const previousDay = adjacentRecordedDay(availableDays, selectedDate, -1)
  const nextDay = adjacentRecordedDay(availableDays, selectedDate, 1)
  const changeDay = (day: string) => {
    if (!day) return
    setSelectedDate(day)
    setPlaceViewEnabled(false)
    setTripScope(null)
    setSelectedPointId(null)
  }
  const shiftDay = (direction: -1 | 1) => {
    const day = direction === -1 ? previousDay : nextDay
    if (day) changeDay(day)
  }
  const openStatisticsRange = useCallback((from: string, to: string) => {
    setFromDate(from)
    setToDate(to)
    setSelectedDate(from)
    setDateMode(from === to ? 'day' : 'period')
    setPlaceViewEnabled(false)
    setTripScope(null)
    setSelectedPointId(null)
    setSheetSize('compact')
    setActiveTab('map')
  }, [])
  const openTrip = useCallback((trip: TimelineTrip) => {
    setTripScope(trip)
    setPlaceScope(null)
    setPlaceViewEnabled(false)
    setFromDate(trip.startDate)
    setToDate(trip.endDate)
    setSelectedDate(trip.startDate)
    setDateMode('period')
    setSelectedPointId(null)
    setSheetSize('compact')
    setActiveTab('map')
  }, [])
  const changeHomeRadius = useCallback((radius: number) => {
    setHomeRadiusKm(normalizeHomeRadius(radius))
    setTripScope(null)
    setSelectedPointId(null)
  }, [])

  function saveHomeLocations(homes: DatedHomeLocation[]) {
    if (isDemo) setDemoHome(homes)
    else setStoredHome(homes)
    const key = isDemo ? demoHomeLocationStorageKey : homeLocationStorageKey
    try {
      if (homes.length) localStorage.setItem(key, JSON.stringify(homes))
      else localStorage.removeItem(key)
    } catch { /* The selection still works for this session. */ }
    setTripScope(null)
    setSelectedPointId(null)
    setHomeDialogOpen(false)
  }

  const qualityNotice = pointQuality.excluded.length > 0 && (qualityDismissed ? (
    <button className="quality-reopen quiet-button" type="button" onClick={() => setQualityDismissed(false)}>{t.showLocationQuality}</button>
  ) : (
    <section className="quality-notice" aria-label={t.locationQuality}>
      <button className="quality-dismiss" type="button" aria-label={t.dismissQualityNotice} title={t.dismissQualityNotice} onClick={() => setQualityDismissed(true)}><Icon name="close" /></button>
      <strong>{pointQuality.excluded.length.toLocaleString(locale)} {t.suspectPoints}</strong>
      <p>{showSuspectPoints ? t.suspectPointsIncluded : t.suspectPointsHidden}</p>
      <label><input type="checkbox" checked={showSuspectPoints} onChange={event => {
        setShowSuspectPoints(event.target.checked)
        setTripScope(null)
        setSelectedPointId(null)
      }} />{t.showSuspectPoints}</label>
      <small>{t.suspectPointsExplanation}</small>
    </section>
  ))

  return (
    <main ref={shell} data-sheet={sheetSize} className={'app-shell' + (isDark ? ' dark' : '')} data-view={activeTab}>
      <header className="floating-toolbar">
        <nav ref={mainNav} className="main-nav" aria-label={t.navigation}>
          <button className={'nav-item' + (activeTab === 'map' ? ' is-current' : '')} aria-current={activeTab === 'map' ? 'page' : undefined} type="button" onClick={() => setActiveTab('map')}><Icon name="map" /><span>{t.map}</span></button>
          <button className={'nav-item' + (activeTab === 'trips' ? ' is-current' : '')} aria-current={activeTab === 'trips' ? 'page' : undefined} type="button" onClick={() => { setPlacesRequested(true); setTripsRequested(true); setActiveTab('trips') }}><Icon name="route" /><span>{t.trips}</span></button>
          <button className={'nav-item' + (activeTab === 'places' ? ' is-current' : '')} aria-current={activeTab === 'places' ? 'page' : undefined} type="button" onClick={() => { setPlacesRequested(true); setActiveTab('places') }}><Icon name="globe" /><span>{t.places}</span></button>
          <button className={'nav-item' + (activeTab === 'statistics' ? ' is-current' : '')} aria-current={activeTab === 'statistics' ? 'page' : undefined} type="button" onClick={() => { setPlacesRequested(true); setStatisticsRequested(true); setActiveTab('statistics') }}><Icon name="chart" /><span>{t.statistics}</span></button>
        </nav>

        <SettingsMenu language={language} distanceUnits={distanceUnits} isDark={isDark}
          mapBackground={mapBackground} onMapBackgroundChange={setMapBackground}
          onLanguageChange={setLanguage} onDistanceUnitsChange={setDistanceUnits}
          onToggleTheme={() => setIsDark(current => !current)} onMerge={() => setFileDialog('merge')} onExport={() => setFileDialog('export')} />
      </header>

      {homeDialogOpen && <HomeLocationDialog language={language} saved={homeLocations} suggested={trips?.homes.at(-1)} overview={dataset.cleanPoints.at(-1)}
        isDemo={isDemo} onSave={saveHomeLocations} onClose={() => setHomeDialogOpen(false)} />}

      {fileDialog && <Suspense fallback={null}>
        {fileDialog === 'merge'
          ? <MergeDialog language={language} onClose={() => setFileDialog(null)} />
          : <ExportDialog dataset={dataset} language={language}
            initialFrom={dateMode === 'day' ? selectedDate : fromDate} initialTo={dateMode === 'day' ? selectedDate : toDate}
            onClose={() => setFileDialog(null)} />}
      </Suspense>}

      {activeTab === 'places' && (
        <div className="places-page">
          <header className="places-page-heading">
            <div className="report-heading">
              <h1>{t.places}</h1>
              <label className="report-period">
                <span>{t.reportPeriod}</span>
                <select value={placeYear} onChange={event => {
                  setPlaceYear(event.target.value)
                  setPlaceScope(null)
                  setPlaceViewEnabled(false)
                  setSelectedPointId(null)
                }}>
                  <option value="all">{t.allTime}</option>
                  {placeYears.map(year => <option key={year} value={year}>{Number(year)}</option>)}
                </select>
              </label>
            </div>
            <p>{t.placesIntro}</p>
          </header>
          <div className="places-controls">
            <div className="places-tabs" role="tablist" aria-label={t.placeType}>
              <button type="button" role="tab" aria-selected={placeMode === 'countries'} className={placeMode === 'countries' ? 'selected' : ''} onClick={() => setPlaceMode('countries')}>{t.countries} <span>{selectedPlaces?.countries.length.toLocaleString(locale) ?? '–'}</span></button>
              <button type="button" role="tab" aria-selected={placeMode === 'cities'} className={placeMode === 'cities' ? 'selected' : ''} onClick={() => setPlaceMode('cities')}>{t.cities} <span>{selectedPlaces?.cities.length.toLocaleString(locale) ?? '–'}</span></button>
            </div>
            {selectedPlaces && <div className="places-total">
              <strong>{places.length.toLocaleString(locale)}</strong>
              <span>{placeMode === 'countries' ? t.countriesRegistered : t.citiesRegistered}</span>
            </div>}
          </div>
          {qualityNotice}
          {placesLoading && <div className="places-message"><span className="places-spinner" /> {t.analysing}</div>}{placesError && <div className="places-message places-error" role="alert">{t[placesError]}<button type="button" className="primary-button" onClick={retryPlaces}>{t.retry}</button></div>}
          {!placesLoading && !placesError && places.length === 0 && <div className="places-empty"><Icon name="globe" /><strong>{placeYear === 'all' ? t.noPlaces : t.noPlacesForYear}</strong>{placeYear === 'all' && <><p>{t.importForPlaces}</p><button type="button" className="primary-button" onClick={() => setActiveTab('map')}>{t.goToMap}</button></>}</div>}
          {!placesLoading && !placesError && mainPlaces.length > 0 && <div className="places-grid">{mainPlaces.map(renderPlaceCard)}</div>}
          {!placesLoading && !placesError && fewerPlaces.length > 0 && <details key={placeMode} className="fewer-places"><summary><span>{placeMode === 'countries' ? t.fewerCountries : t.fewerPlaces}</span><span className="count-badge">{fewerPlaces.length.toLocaleString(locale)}</span></summary><p>{t.fewerPlacesHint}</p><div className="places-grid">{fewerPlaces.map((place, index) => renderPlaceCard(place, mainPlaces.length + index))}</div></details>}
          <footer className="places-attribution"><span className="mobile-hide-copy">{t.citySuggestions} </span><a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0)<span className="mobile-hide-copy"> · {t.geodataDetails.replace('{distance}', formatLargeDistance(30, locale, distanceUnits))}</span></footer>
        </div>
      )}
      {tripsRequested && <div className="trips-workspace" hidden={activeTab !== 'trips'}>
        <Suspense fallback={<div className="places-message" role="status"><span className="places-spinner" />{t.analysing}</div>}>
          <Trips distanceUnits={distanceUnits} data={trips} loading={tripsLoading} error={placesError ? t[placesError] : undefined} language={language} isDemo={isDemo} homeRadiusKm={homeRadiusKm} hasManualHome={homeLocations.length > 0} onEditHome={() => setHomeDialogOpen(true)} onHomeRadiusChange={changeHomeRadius} onRetry={retryPlaces} onOpenTrip={openTrip} />
        </Suspense>
      </div>}
      {statisticsRequested && <div className="statistics-workspace" hidden={activeTab !== 'statistics'}>
        <Suspense fallback={<div className="places-message" role="status"><span className="places-spinner" />{t.analysing}</div>}>
          <Statistics distanceUnits={distanceUnits} data={statistics} loading={statisticsLoading} error={placesError ? t[placesError] : undefined} language={language} isDemo={isDemo} onRetry={retryPlaces} onOpenRange={openStatisticsRange} />
        </Suspense>
      </div>}
      <div className="workspace" hidden={activeTab !== 'map'}>
        <aside ref={sheet} className="sidebar"
          onClickCapture={event => {
            if (event.detail && ignoreSheetClick.current) {
              event.preventDefault()
              event.stopPropagation()
            }
          }}>
          <button type="button" className="sheet-handle" aria-expanded={sheetSize !== 'compact'} aria-controls="map-sheet-content"
            aria-label={sheetSize === 'compact' ? t.expandMapPanel : t.collapseMapPanel}
            onClick={() => setSheetSize(size => size === 'compact' ? 'half' : 'compact')}
            onKeyDown={event => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
              event.preventDefault()
              const step = event.key === 'ArrowUp' ? 1 : -1
              setSheetSize(size => sheetSizes[Math.max(0, Math.min(2, sheetSizes.indexOf(size) + step))]!)
            }}>
            <span className="sheet-grip" />
            {sheetSize === 'compact' && <span className="sheet-peek"><strong>{dateMode === 'day' ? formatPlaceDate(selectedDate, locale) : `${formatPlaceDate(fromDate, locale)} – ${formatPlaceDate(toDate, locale)}`}</strong><span>{distanceLabel}</span></span>}
          </button>
          <div ref={sheetContent} className="sheet-content" id="map-sheet-content">
            <div className="sheet-import">
              <div className="sidebar-heading"><h1>{t.myTimeline}</h1><span className="sidebar-status"><span />{isDemo ? t.exampleData : t.localFile}</span></div>
              <section className="import-card">
                <div className="import-icon"><Icon name="upload" /></div>
                <div className="import-copy">
                  <strong title={fileName || t.importTimeline}>{fileName || t.importTimeline}</strong>
                  <span className={isDemo ? "mobile-hide-copy" : undefined}>{isDemo ? t.sampleHint : t.fileLoaded}</span>
                </div>
                <label className="import-button">
                  {isDemo ? t.chooseFile : t.changeFile}
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={event => { importFile(event.target.files?.[0]); event.target.value = '' }}
                  />
                </label>
              </section>
              {isDemo && <a className="sample-download" href={demoTimelineUrl} download="Timeline-example.json">{t.downloadSample}</a>}
              {importStage && <div className="import-progress" role="status" aria-live="polite"><span className="places-spinner" /><span>{t[importStage]}</span><button type="button" onClick={cancelImport}>{t.cancel}</button></div>}
              {error && <p className="error-message" role="alert">{t[error]}</p>}
              {qualityNotice}
            </div>

            <section className="date-section" data-date-mode={dateMode}>
              <div className="section-title-row">
                <h2>{t.time}</h2>
                <button className="quiet-button" type="button" onClick={() => {
                  if (availableDays.length) {
                    setDateMode('day')
                    changeDay(availableDays[availableDays.length - 1]!)
                  }
                }}>{t.lastDay}</button>
              </div>

              <div className="segmented-control" role="tablist" aria-label={t.selectPeriod}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dateMode === 'day'}
                  className={dateMode === 'day' ? 'selected' : ''}
                  onClick={() => { setDateMode('day'); setPlaceViewEnabled(false); setTripScope(null) }}
                >{t.oneDay}</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={dateMode === 'period'}
                  className={dateMode === 'period' ? 'selected' : ''}
                  onClick={() => { setDateMode('period'); setPlaceViewEnabled(false); setTripScope(null) }}
                >{t.period}</button>
              </div>

              {dateMode === 'day' ? (
                <div className="date-picker-wrap">
                  <div className="date-nav">
                    <button type="button" aria-label={t.previousDay} onClick={() => shiftDay(-1)} disabled={!previousDay}><Icon name="left" /></button>
                    <label htmlFor="selected-day">{formatCalendarDate(selectedDate, locale)}</label>
                    <button type="button" aria-label={t.nextDay} onClick={() => shiftDay(1)} disabled={!nextDay}><Icon name="right" /></button>
                  </div>
                  <input
                    id="selected-day"
                    className="date-input"
                    type="date"
                    value={selectedDate}
                    min={availableDays[0]} max={availableDays[availableDays.length - 1]}
                    onChange={event => changeDay(event.target.value)}
                  />
                  <div className="date-hint">{availableDays.length.toLocaleString(locale)} {t.recordedDays}</div>
                </div>
              ) : (
                <div className="period-fields">
                  <label>{t.from}<input type="date" value={fromDate} min={availableDays[0]} max={availableDays[availableDays.length - 1]} onChange={event => { const date = event.target.value; if (!date) return; setFromDate(date); if (date > toDate) setToDate(date); setPlaceViewEnabled(false); setTripScope(null); setSelectedPointId(null) }} /></label>
                  <label>{t.to}<input type="date" value={toDate} min={fromDate} max={availableDays[availableDays.length - 1]} onChange={event => { const date = event.target.value; if (!date) return; setToDate(date); if (date < fromDate) setFromDate(date); setPlaceViewEnabled(false); setTripScope(null); setSelectedPointId(null) }} /></label>
                  <p>{placeViewEnabled && placeScope ? mapPoints.length.toLocaleString(locale) + ' ' + (placeScope.kind === 'country' ? t.pointsInCountry : t.pointsInCity) : mapPoints.length.toLocaleString(locale) + ' ' + t.pointsInPeriod}</p>
                </div>
              )}
            </section>

            {(tripScope || placeScope) && <div className="scope-actions">
              {tripScope && <>
                <strong>{tripCategoryName} · {tripName}</strong>
                <button className="scope-toggle" type="button" onClick={() => setActiveTab('trips')}>{t.backToTrips}</button>
                <button className="scope-toggle active" type="button" onClick={() => { setTripScope(null); setSelectedPointId(null) }}>{t.showDateRange} ×</button>
              </>}
              {placeScope && <button className={'scope-toggle' + (placeViewEnabled ? ' active' : '')} type="button" onClick={() => setPlaceViewEnabled(enabled => !enabled)}>{placeViewEnabled ? t.showCalendar + ' · ' + scopeName + ' ×' : t.showAgain + ' · ' + scopeName}</button>}
            </div>}

            <section className="summary-section">
              <div className="section-title-row">
                <h2>{t.summary}</h2>
                <span className="summary-period">{tripScope ? t.selectedTrip : placeViewEnabled && placeScope ? (placeYear === 'all' ? t.wholeHistory : placeYear) : dateMode === 'day' ? t.selectedDay : t.selectedPeriod}</span>
              </div>
              <div className="summary-grid">
                <div className="summary-card">
                  <span className="summary-metric-label"><Icon name="pin" />{t.points}</span>
                  <strong>{mapPoints.length.toLocaleString(locale)}</strong>
                </div>
                <div className="summary-card">
                  <span className="summary-metric-label"><Icon name="route" />{t.estimatedRoute}</span>
                  <strong className={'summary-distance' + (distanceValue.length > 9 ? ' compact' : '')} title={distanceLabel}>{distanceValue}<small> {distanceUnit}</small></strong>
                </div>
              </div>
            </section>

            <section className="activity-section">
              <div className="point-list-card">
                <div className="point-list-card-header">
                  <h2>{tripScope ? t.tripPoints : placeViewEnabled && placeScope ? `${t.pointsAt} ${scopeName}` : dateMode === 'day' ? t.dayPoints : t.periodPoints}</h2>
                  <span className="count-badge">{mapPoints.length.toLocaleString(locale)}</span>
                </div>
                <PointList groups={pointGroups} selectedPointId={selectedPointId} onSelect={setSelectedPointId} language={language} expanded={isPointListExpanded} />
                <button className="point-list-disclosure" type="button" aria-expanded={isPointListExpanded} aria-controls="point-list" aria-label={isPointListExpanded ? t.hidePoints : t.showPoints} title={isPointListExpanded ? t.hidePoints : t.showPoints} onClick={() => setIsPointListExpanded((expanded) => !expanded)}>
                  <span>{isPointListExpanded ? t.hidePoints : t.showPoints}</span><Icon name="down" className={'expand-chevron' + (isPointListExpanded ? ' expanded' : '')} />
                </button>
              </div>
            </section>
          </div>
        </aside>

        <section className="map-area" data-background={mapBackground} aria-label={t.mapLabel}>
          <TimelineMap mapBackground={mapBackground} points={mapPoints} routeSegments={route.segments} selectedPointId={selectedPointId} isDark={isDark} language={language} onSelect={setSelectedPointId} active={activeTab === 'map'} />

          <div className="map-bottom-overlay">
            <div className="map-legend">
              <span className="legend-item"><span className="legend-line" style={{ background: mapColors.route }} />{t.route}</span>
              {hasFlights && <span className="legend-item" title={t.flightRouteHint}><span className="legend-line flight" style={{ borderColor: mapColors.route }} />{t.flightRoute}</span>}
              <span className="legend-item" title={t.zoomHint}><span className="legend-dot" style={{ background: mapColors.point }} />{t.positionPoint}</span>
            </div>

          </div>

          {selectedPoint && (
            <div className="selected-card">
              <button type="button" aria-label={t.closeDetails} onClick={() => setSelectedPointId(null)}><Icon name="close" /></button>
              <span className="selected-kicker">{t.selectedPoint}</span>
              <strong>{pointLabel(selectedPoint, language)}</strong>
              {suspectPointIds.has(selectedPoint.id) && <small className="suspect-point-label">{t.suspectPointLabel}</small>}
              <span>{formatPointInterval(selectedPoint, locale, true)} · {selectedPoint.lat.toFixed(5)}, {selectedPoint.lng.toFixed(5)}</span>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default App
