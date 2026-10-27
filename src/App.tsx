import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import tzLookup from 'tz-lookup'
import {
  distanceKm,
  localDateKey,
  parseTimeline,
  type TimelinePoint,
} from './timeline'
import { displayCountryName, displayPointLabel, formatDateKey, formatTimestamp, localeFor, readLanguage, strings, type Language } from './i18n'
import { type PlaceAnalysis, type CityReference, type PlaceEntry } from './places'
import './App.css'

type DateMode = 'day' | 'period'
type ActiveTab = 'map' | 'places'
type PlaceScope = { kind: 'country' | 'city'; name: string; key: string; pointIds: string[]; countryName?: string }

const MAX_VISIBLE_MARKERS = 8_000
const MAX_MARKERS_PER_GRID_CELL = 250
const GRID_CELL_METERS = 5_000
const MAX_ROUTE_INPUT_POINTS = 12_000
const MAX_ROUTE_POINTS_PER_GRID_CELL = 250

const demoPoints: TimelinePoint[] = [
  { id: 'demo-1', lat: 59.907716, lng: 10.590889, timestamp: '2026-10-13T17:04:00.000Z', kind: 'path', label: 'Rutepunkt' },
  { id: 'demo-2', lat: 59.902392, lng: 10.577196, timestamp: '2026-10-13T17:06:00.000Z', kind: 'path', label: 'Rutepunkt' },
  { id: 'demo-3', lat: 59.900471, lng: 10.575260, timestamp: '2026-10-13T17:07:00.000Z', kind: 'path', label: 'Rutepunkt' },
  { id: 'demo-4', lat: 59.902210, lng: 10.612880, timestamp: '2026-10-13T17:21:00.000Z', kind: 'path', label: 'Rutepunkt' },
  { id: 'demo-5', lat: 59.911420, lng: 10.651210, timestamp: '2026-10-13T17:43:00.000Z', kind: 'path', label: 'Rutepunkt' },
  { id: 'demo-6', lat: 59.914800, lng: 10.702100, timestamp: '2026-10-13T18:12:00.000Z', kind: 'path', label: 'Rutepunkt' },
  { id: 'demo-7', lat: 59.913100, lng: 10.746200, timestamp: '2026-10-13T18:31:00.000Z', kind: 'path', label: 'Rutepunkt' },
  { id: 'demo-8', lat: 59.920600, lng: 10.762900, timestamp: '2026-10-13T19:00:00.000Z', kind: 'path', label: 'Rutepunkt' },
]

function MapViewport({ points }: { points: TimelinePoint[] }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return
    let minLat = 90
    let maxLat = -90
    let minLng = 180
    let maxLng = -180
    for (const point of points) {
      minLat = Math.min(minLat, point.lat)
      maxLat = Math.max(maxLat, point.lat)
      minLng = Math.min(minLng, point.lng)
      maxLng = Math.max(maxLng, point.lng)
    }
    map.fitBounds([[minLat, minLng], [maxLat, maxLng]], {
      padding: [76, 76],
      maxZoom: points.length === 1 ? 14 : 15,
      animate: points.length < 5000,
    })
  }, [isDark, map, points])

  return null
}

function formatPlaceDate(dateKey: string, language: Language): string {
  return formatDateKey(dateKey, language, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatPointDateTime(timestamp: string, language: Language): string {
  return formatTimestamp(timestamp, language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatPointDateTimeAtLocation(timestamp: string, lat: number, lng: number, language: Language): string {
  let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    timeZone = tzLookup(lat, lng)
  } catch {
    // Keep the browser's local zone if the coordinate is outside the lookup data.
  }
  return formatTimestamp(timestamp, language, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }, timeZone)
}

function formatDistance(kilometers: number, language: Language): string {
  if (kilometers < 1) return Math.round(kilometers * 1000) + ' m'
  return kilometers.toLocaleString(localeFor[language], { maximumFractionDigits: 1 }) + ' km'
}

function samplePoints(points: TimelinePoint[], maximum: number): TimelinePoint[] {
  if (points.length <= maximum) return points
  if (maximum <= 1) return points.length > 0 ? [points[0]!] : []
  const lastIndex = points.length - 1
  const stride = lastIndex / (maximum - 1)
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * stride)]!).filter(Boolean)
}

function selectSpatiallyDistributedPoints(points: TimelinePoint[], maximum: number, perCellMaximum: number): TimelinePoint[] {
  const cells = new Map<string, TimelinePoint[]>()
  for (const point of points) {
    // Approximate a 5 km equirectangular grid, correcting longitude for latitude.
    const x = 6_378_137 * point.lng * Math.PI / 180 * Math.cos(point.lat * Math.PI / 180)
    const y = 6_378_137 * point.lat * Math.PI / 180
    const cellKey = `${Math.floor(x / GRID_CELL_METERS)}:${Math.floor(y / GRID_CELL_METERS)}`
    const cell = cells.get(cellKey) ?? []
    cell.push(point)
    cells.set(cellKey, cell)
  }

  // Limit dense areas, then take points evenly across each cell's timeline.
  const sampledCells = Array.from(cells.values(), (cell) => samplePoints(cell, perCellMaximum))
  const selected = new Set<TimelinePoint>()
  // Round-robin across cells so dense cities do not crowd out rural route sections.
  for (let offset = 0; selected.size < maximum; offset += 1) {
    let foundAtOffset = false
    for (const cell of sampledCells) {
      const point = cell[offset]
      if (!point) continue
      selected.add(point)
      foundAtOffset = true
      if (selected.size >= maximum) break
    }
    if (!foundAtOffset) break
  }

  return points.filter((point) => selected.has(point))
}

function selectVisibleMarkers(points: TimelinePoint[]): TimelinePoint[] {
  return selectSpatiallyDistributedPoints(points, MAX_VISIBLE_MARKERS, MAX_MARKERS_PER_GRID_CELL)
}

function smoothRoute(points: TimelinePoint[]): [number, number][] {
  if (points.length < 3) return points.map((point) => [point.lat, point.lng])
  const result: [number, number][] = [[points[0]!.lat, points[0]!.lng]]
  const steps = 3
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!
    const p1 = points[index]!
    const p2 = points[index + 1]!
    const p3 = points[Math.min(points.length - 1, index + 2)]!
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps
      const t2 = t * t
      const t3 = t2 * t
      const curve = (x: number, y: number, z: number, w: number) => 0.5 * ((2 * y) + (-x + z) * t + (2 * x - 5 * y + 4 * z - w) * t2 + (-x + 3 * y - 3 * z + w) * t3)
      const boundedCurve = (x: number, y: number, z: number, w: number) => Math.max(Math.min(y, z), Math.min(Math.max(y, z), curve(x, y, z, w)))
      result.push([boundedCurve(p0.lat, p1.lat, p2.lat, p3.lat), boundedCurve(p0.lng, p1.lng, p2.lng, p3.lng)])
    }
  }
  return result
}
function PointDots({ points, isDark }: { points: TimelinePoint[]; isDark: boolean }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return
    const canvas = L.DomUtil.create('canvas', 'timeline-point-canvas')
    const context = canvas.getContext('2d')
    if (!context) return
    map.getContainer().appendChild(canvas)

    const drawPoints = () => {
      const size = map.getSize()
      const pixelRatio = window.devicePixelRatio || 1
      canvas.width = Math.round(size.x * pixelRatio)
      canvas.height = Math.round(size.y * pixelRatio)
      canvas.style.width = size.x + 'px'
      canvas.style.height = size.y + 'px'
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, size.x, size.y)
      const bounds = map.getBounds().pad(0.04)
      const visiblePoints = points.filter((point) => bounds.contains([point.lat, point.lng]))
      const markerPoints = selectVisibleMarkers(visiblePoints)

      for (const point of markerPoints) {
        const pixel = map.latLngToContainerPoint([point.lat, point.lng])
        context.beginPath()
        context.arc(pixel.x, pixel.y, isDark ? 2.6 : 2.2, 0, Math.PI * 2)
        context.fillStyle = getComputedStyle(map.getContainer()).getPropertyValue('--point-color').trim() || (isDark ? '#4fd39a' : '#d9534f')
        context.fill()
        context.lineWidth = 1
        context.strokeStyle = '#fff'
        context.stroke()
      }
      canvas.style.visibility = 'visible'
    }

    const hidePointsDuringMovement = () => { canvas.style.visibility = 'hidden' }
    let pendingFrame = 0
    const drawAfterMovement = () => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame)
      pendingFrame = requestAnimationFrame(() => { pendingFrame = 0; drawPoints() })
    }

    map.on('movestart zoomstart', hidePointsDuringMovement)
    map.on('moveend zoomend resize', drawAfterMovement)
    drawPoints()
    return () => {
      map.off('movestart zoomstart', hidePointsDuringMovement)
      map.off('moveend zoomend resize', drawAfterMovement)
      if (pendingFrame) cancelAnimationFrame(pendingFrame)
      canvas.remove()
    }
  }, [isDark, map, points])

  return null
}
function App() {
  const [language, setLanguage] = useState<Language>(readLanguage)
  const ui = strings[language]
  const [points, setPoints] = useState<TimelinePoint[]>(demoPoints)
  const [activeTab, setActiveTab] = useState<ActiveTab>('map')
  const [placeMode, setPlaceMode] = useState<'countries' | 'cities'>('countries')
  const [cityReferences, setCityReferences] = useState<CityReference[]>([])
  const [countryCodes, setCountryCodes] = useState<Record<string, string>>({})
  const [placeAnalysis, setPlaceAnalysis] = useState<PlaceAnalysis | null>(null)
  const [placesLoading, setPlacesLoading] = useState(true)
  const [placesError, setPlacesError] = useState<'load' | 'analysis' | ''>('')
  const [placeScope, setPlaceScope] = useState<PlaceScope | null>(null)
  const [placeViewEnabled, setPlaceViewEnabled] = useState(false)
  const [isDemo, setIsDemo] = useState(true)
  const [isDark, setIsDark] = useState(false)
  const [isPointListExpanded, setIsPointListExpanded] = useState(false)
  const [dateMode, setDateMode] = useState<DateMode>('day')
  const [selectedDate, setSelectedDate] = useState('2026-10-13')
  const [fromDate, setFromDate] = useState('2026-10-13')
  const [toDate, setToDate] = useState('2026-10-13')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<'coordinates' | 'json' | ''>('')
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)

  useEffect(() => {
    try { localStorage.setItem('timeline-explorer-language', language) } catch { /* Storage may be unavailable in private browsing. */ }
    document.documentElement.lang = language === 'en' ? 'en' : 'no'
    document.title = language === 'en' ? 'Timeline Explorer' : 'Timeline Explorer — Tidslinjekart'
  }, [language])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/geonames-cities.json').then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<CityReference[]> }),
      fetch('/country-codes.json').then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Record<string, string>> }),
    ]).then(([cities, codes]) => {
      if (!cancelled) { setCityReferences(cities); setCountryCodes(codes); setPlacesLoading(false) }
    }).catch(() => {
      if (!cancelled) { setPlacesError('load'); setPlacesLoading(false) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (cityReferences.length === 0) return
    setPlacesLoading(true)
    const worker = new Worker(new URL('./places.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<PlaceAnalysis>) => { setPlaceAnalysis(event.data); setPlacesLoading(false) }
    worker.onerror = () => { setPlacesError('analysis'); setPlacesLoading(false); worker.terminate() }
    worker.postMessage({ points, cities: cityReferences, countryCodes })
    return () => worker.terminate()
  }, [cityReferences, countryCodes, points])

  const availableDays = useMemo(
    () => Array.from(new Set(points.map((point) => localDateKey(point.timestamp)))).sort(),
    [points],
  )

  const visiblePoints = useMemo(() => {
    return points.filter((point) => {
      const day = localDateKey(point.timestamp)
      return dateMode === 'day' ? day === selectedDate : day >= fromDate && day <= toDate
    })
  }, [dateMode, fromDate, points, selectedDate, toDate])

  const mapPoints = useMemo(() => {
    if (!placeScope || !placeViewEnabled) return visiblePoints
    const ids = new Set(placeScope.pointIds)
    return points.filter((point) => ids.has(point.id))
  }, [placeScope, placeViewEnabled, points, visiblePoints])
  const places = placeMode === 'countries' ? placeAnalysis?.countries ?? [] : placeAnalysis?.cities ?? []
  const mainPlaces = places.filter((place) => place.pointCount >= 10)
  const fewerPlaces = places.filter((place) => place.pointCount < 10)
  const renderPlaceCard = (place: PlaceEntry, index: number) => {
    const placeName = placeMode === 'countries' ? displayCountryName(place.countryCode, place.name, language) : place.name
    const placeCountry = displayCountryName(place.countryCode, place.countryName ?? '', language)
    return <button key={place.key} type="button" className="place-card" onClick={() => { setPlaceScope({ kind: placeMode === 'countries' ? 'country' : 'city', key: place.key, name: placeName, countryName: placeCountry, pointIds: place.pointIds }); setPlaceViewEnabled(true); setActiveTab('map'); setSelectedPointId(null) }}>
      <span className="place-rank">{String(index + 1).padStart(2, '0')}</span>
      <span className="place-card-copy"><strong>{placeName}</strong><small>{placeMode === 'cities' ? placeCountry : ui.country}</small></span>
      <span className="place-days"><strong>{place.days.toLocaleString(localeFor[language])}</strong><small>{ui.days}</small></span>
      <span className="place-dates"><small>{place.dates.length > 1 ? ui.recentDates : ui.date}</small><span>{place.dates.slice(0, 3).map((date) => formatPlaceDate(date, language)).join(' · ') + (place.dates.length > 3 ? ' · +' + (place.dates.length - 3) : '')}</span></span>
      <span className="place-card-footer">{place.pointCount.toLocaleString(localeFor[language])} {ui.positionPoints} <span>↗</span></span>
    </button>
  }
  const selectedPoint = mapPoints.find((point) => point.id === selectedPointId) ?? null
  const scopedPlaceName = placeScope ? (placeScope.kind === 'country' ? displayCountryName(placeScope.key, placeScope.name, language) : placeScope.name) : ''
  const routePoints = useMemo(
    () => selectSpatiallyDistributedPoints(mapPoints, MAX_ROUTE_INPUT_POINTS, MAX_ROUTE_POINTS_PER_GRID_CELL),
    [mapPoints],
  )
  const smoothPositions = useMemo(() => smoothRoute(routePoints), [routePoints])
  const mapDistance = useMemo(() => distanceKm(mapPoints), [mapPoints])
  const pointGroups = useMemo(() => {
    const groups = new Map<string, TimelinePoint[]>()
    for (const point of mapPoints) {
      const day = localDateKey(point.timestamp)
      const dayPoints = groups.get(day) ?? []
      dayPoints.push(point)
      groups.set(day, dayPoints)
    }
    return Array.from(groups, ([day, dayPoints]) => ({ day, points: dayPoints }))
  }, [mapPoints])
  const displayedDate = dateMode === 'day'
    ? formatDateKey(selectedDate, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : fromDate === toDate
      ? formatDateKey(fromDate, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : formatDateKey(fromDate, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' – ' + formatDateKey(toDate, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const handleFile = async (file?: File) => {
    if (!file) return
    setError('')
    try {
      const parsed = parseTimeline(JSON.parse(await file.text()))
      if (parsed.length === 0) {
        setError('coordinates')
        return
      }
      setPoints(parsed)
      setIsDemo(false)
      setFileName(file.name)
      const firstDay = localDateKey(parsed[0]!.timestamp)
      const lastDay = localDateKey(parsed[parsed.length - 1]!.timestamp)
      setSelectedDate(firstDay)
      const lastDate = new Date(lastDay + 'T12:00:00')
      lastDate.setDate(lastDate.getDate() - 6)
      const weekStart = [lastDate.getFullYear(), String(lastDate.getMonth() + 1).padStart(2, '0'), String(lastDate.getDate()).padStart(2, '0')].join('-')
      setFromDate(weekStart < firstDay ? firstDay : weekStart)
      setToDate(lastDay)
      setDateMode('day')
      setSelectedPointId(null)
      setPlaceScope(null)
      setPlaceViewEnabled(false)
      setActiveTab('map')
    } catch {
      setError('json')
    }
  }

  const shiftDay = (direction: -1 | 1) => {
    const currentIndex = availableDays.indexOf(selectedDate)
    const nextDay = availableDays[currentIndex + direction]
    if (nextDay) setSelectedDate(nextDay)
  }

  return (
    <main className={'app-shell' + (isDark ? ' dark' : '')}>
      <header className="topbar">
        <div className="topbar-title">
          <span className="eyebrow">{ui.history}</span>
          <strong>{ui.explorePlaces}</strong>
        </div>

        <nav className="main-nav" aria-label={language === 'en' ? 'Main navigation' : 'Hovedmeny'}>
          <button className={'nav-item' + (activeTab === 'map' ? ' is-current' : '')} type="button" onClick={() => setActiveTab('map')}>{ui.map}</button>
          <button className="nav-item" type="button" disabled title={ui.comingSoon}>{ui.trips}</button>
          <button className={'nav-item' + (activeTab === 'places' ? ' is-current' : '')} type="button" onClick={() => setActiveTab('places')}>{ui.places}</button>
          <button className="nav-item" type="button" disabled title={ui.comingSoon}>{ui.statistics}</button>
        </nav>

        <div className="topbar-right">
          <span className="privacy-pill"><span className="privacy-dot" /> {ui.localFile}</span>
          <div className="language-switch" role="group" aria-label={language === 'en' ? 'Language' : 'Språk'}>
            <button type="button" className={language === 'en' ? 'selected' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>ENG</button>
            <button type="button" className={language === 'no' ? 'selected' : ''} aria-pressed={language === 'no'} onClick={() => setLanguage('no')}>NOR</button>
          </div>
          <button className="theme-toggle" type="button" aria-label={isDark ? ui.switchToLight : ui.switchToDark} title={isDark ? ui.lightTheme : ui.darkTheme} onClick={() => setIsDark((current) => !current)}>{isDark ? '☀' : '☾'}</button>
        </div>
      </header>

      {activeTab === 'places' ? (
        <div className="places-page">
          <div className="places-page-heading"><div><span className="eyebrow">{ui.wholeTimeline}</span><h1>{ui.places}</h1><p>{ui.placesDescription}</p></div><div className="places-total"><strong>{places.length.toLocaleString(localeFor[language])}</strong><span>{placeMode === 'countries' ? ui.countriesRecorded : ui.citiesRecorded}</span></div></div>
          <div className="places-tabs" role="tablist" aria-label={ui.choosePlaceType}><button type="button" role="tab" aria-selected={placeMode === 'countries'} className={placeMode === 'countries' ? 'selected' : ''} onClick={() => setPlaceMode('countries')}>{ui.countries} <span>{placeAnalysis?.countries.length ?? '–'}</span></button><button type="button" role="tab" aria-selected={placeMode === 'cities'} className={placeMode === 'cities' ? 'selected' : ''} onClick={() => setPlaceMode('cities')}>{ui.cities} <span>{placeAnalysis?.cities.length ?? '–'}</span></button></div>
          {placesLoading && <div className="places-message"><span className="places-spinner" /> {ui.analyzing}</div>}
          {placesError && <div className="places-message places-error">{placesError === 'load' ? ui.placeDataError : ui.placeAnalysisError}</div>}
          {!placesLoading && !placesError && places.length === 0 && <div className="places-empty"><span>⌖</span><strong>{ui.noPlaces}</strong><p>{ui.importToAnalyze}</p><button type="button" className="primary-button" onClick={() => setActiveTab('map')}>{ui.goToMap}</button></div>}
          {!placesLoading && mainPlaces.length > 0 && <div className="places-grid">{mainPlaces.map(renderPlaceCard)}</div>}
          {!placesLoading && fewerPlaces.length > 0 && <details className="fewer-places"><summary><span>{ui.fewerPlaces}</span><span className="count-badge">{fewerPlaces.length.toLocaleString(localeFor[language])}</span></summary><p>{ui.fewerPlacesHint}</p><div className="places-grid">{fewerPlaces.map((place, index) => renderPlaceCard(place, mainPlaces.length + index))}</div></details>}
          <footer className="places-attribution">{ui.citySuggestions} <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0) · {ui.cityRules}</footer>
        </div>
      ) : (
      <div className="workspace">
        <aside className="sidebar">
          <section className="import-card">
            <div className="import-icon" aria-hidden="true">↑</div>
            <div className="import-copy">
              <strong>{fileName || ui.importTimeline}</strong>
              <span>{isDemo ? ui.tryExample : ui.jsonLoaded}</span>
            </div>
            <label className="import-button">
              {isDemo ? ui.chooseFile : ui.replaceFile}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
            </label>
          </section>
          {error && <p className="error-message" role="alert">{error === 'coordinates' ? ui.invalidCoordinates : ui.invalidJson}</p>}

          <section className="date-section">
            <div className="section-title-row">
              <h2>{ui.time}</h2>
              <button className="quiet-button" type="button" onClick={() => {
                if (availableDays.length) {
                  setDateMode('day')
                  setSelectedDate(availableDays[availableDays.length - 1]!)
                }
              }}>{ui.latestDay}</button>
            </div>

            <div className="segmented-control" role="tablist" aria-label={ui.chooseTimeRange}>
              <button
                type="button"
                role="tab"
                aria-selected={dateMode === 'day'}
                className={dateMode === 'day' ? 'selected' : ''}
                onClick={() => setDateMode('day')}
              >{ui.oneDay}</button>
              <button
                type="button"
                role="tab"
                aria-selected={dateMode === 'period'}
                className={dateMode === 'period' ? 'selected' : ''}
                onClick={() => {
                  if (availableDays.length) {
                    const lastDay = availableDays[availableDays.length - 1]!
                    const lastDate = new Date(lastDay + 'T12:00:00')
                    lastDate.setDate(lastDate.getDate() - 6)
                    const weekStart = [lastDate.getFullYear(), String(lastDate.getMonth() + 1).padStart(2, '0'), String(lastDate.getDate()).padStart(2, '0')].join('-')
                    setFromDate(weekStart < availableDays[0]! ? availableDays[0]! : weekStart)
                    setToDate(lastDay)
                  }
                  setDateMode('period')
                }}
              >{ui.period}</button>
            </div>

            {dateMode === 'day' ? (
              <div className="date-picker-wrap">
                <div className="date-nav">
                  <button type="button" aria-label={ui.previousDay} onClick={() => shiftDay(-1)} disabled={availableDays.indexOf(selectedDate) <= 0}>‹</button>
                  <label htmlFor="selected-day">{displayedDate}</label>
                  <button type="button" aria-label={ui.nextDay} onClick={() => shiftDay(1)} disabled={availableDays.indexOf(selectedDate) < 0 || availableDays.indexOf(selectedDate) >= availableDays.length - 1}>›</button>
                </div>
                <input
                  id="selected-day"
                  className="date-input"
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
                <div className="date-hint">{availableDays.length} {ui.daysWithRecords}</div>
              </div>
            ) : (
              <div className="period-fields">
                <label>{ui.from}<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
                <label>{ui.to}<input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} /></label>
                <p>{placeViewEnabled && placeScope ? mapPoints.length.toLocaleString(localeFor[language]) + ' ' + (placeScope.kind === 'country' ? ui.pointsInCountry : ui.pointsInCity) : mapPoints.length.toLocaleString(localeFor[language]) + ' ' + ui.pointsInRange}</p>
              </div>
            )}
          </section>

          <section className="summary-section">
            <div className="section-title-row">
              <h2>{ui.summary}</h2>
              <span className="summary-period">{placeViewEnabled && placeScope ? ui.allHistory : dateMode === 'day' ? ui.selectedDay : ui.selectedRange}</span>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <span className="summary-icon pin-icon">⌖</span>
                <div><strong>{mapPoints.length.toLocaleString(localeFor[language])}</strong><span>{ui.points}</span></div>
              </div>
              <div className="summary-card">
                <span className="summary-icon route-icon">↗</span>
                <div><strong>{formatDistance(mapDistance, language)}</strong><span>{ui.estimatedRoute}</span></div>
              </div>
            </div>
          </section>

          <section className="activity-section">
            <div className="point-list-card">
              <div className="point-list-card-header">
                <h2>{placeViewEnabled && placeScope ? ui.pointsIn + ' ' + scopedPlaceName : dateMode === 'day' ? ui.pointsToday : ui.pointsInPeriod}</h2>
                <span className="count-badge">{mapPoints.length}</span>
              </div>
              {isPointListExpanded && <div className="point-list" id="point-list">
                {pointGroups.map((group) => (
                  <details className="point-day-group" key={group.day} open={pointGroups.length === 1}>
                    <summary><strong>{formatDateKey(group.day, language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong><span className="count-badge">{group.points.length}</span></summary>
                    <div className="point-day-rows">
                      {group.points.slice(0, 80).map((point, index) => (
                        <button key={point.id} type="button" className={'point-row' + (point.id === selectedPointId ? ' active' : '')} onClick={() => setSelectedPointId(point.id)}>
                          <span className={'point-symbol ' + (point.kind === 'visit' ? 'visit' : '')}>{point.kind === 'visit' ? '•' : index + 1}</span>
                          <span className="point-copy"><strong>{displayPointLabel(point.label, language)}</strong><small>{formatPointDateTime(point.timestamp, language)} · {point.lat.toFixed(4)}, {point.lng.toFixed(4)}</small></span>
                          <span className="point-arrow">›</span>
                        </button>
                      ))}
                      {group.points.length > 80 && <p className="list-note">{ui.showing.replace('{count}', group.points.length.toLocaleString(localeFor[language]))}</p>}
                    </div>
                  </details>
                ))}
                {mapPoints.length === 0 && <div className="empty-list"><span>⌖</span><strong>{ui.noPoints}</strong><small>{ui.chooseDateOrPlace}</small></div>}
              </div>}
              <button className="point-list-disclosure" type="button" aria-expanded={isPointListExpanded} aria-controls="point-list" aria-label={isPointListExpanded ? ui.hidePoints : ui.showPoints} title={isPointListExpanded ? ui.hidePoints : ui.showPoints} onClick={() => setIsPointListExpanded((expanded) => !expanded)}>
                <svg className={'expand-chevron' + (isPointListExpanded ? ' expanded' : '')} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="M4 3 L47 13 L50 15 L53 13 L96 3 L96 8.25 L53 18.5 L50 20.5 L47 18.5 L4 8.25 Z" /></svg>
              </button>
            </div>
          </section>

          <footer className="sidebar-footer">
            <span className="shield-icon">◇</span>
            <span><strong>{ui.readLocally}</strong><small>{ui.mapTiles}</small></span>
          </footer>
        </aside>

        <section className="map-area" aria-label={ui.mapWithHistory}>
          <MapContainer className="map-view" center={[59.91, 10.72]} zoom={4} zoomControl={true} preferCanvas={true}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapViewport points={mapPoints} />
            {mapPoints.length > 1 && (
              <Polyline
                positions={smoothPositions}
                smoothFactor={0.35}
                pathOptions={{ color: isDark ? '#ff625f' : '#1a7c72', weight: isDark ? 4 : 3, opacity: 1, lineCap: 'round', lineJoin: 'round', className: isDark ? 'route-dark' : undefined }}
                eventHandlers={{
                  click: (event) => {
                    let nearest = mapPoints[0]!
                    let nearestDistance = Number.POSITIVE_INFINITY
                    for (const point of mapPoints) {
                      const latDistance = point.lat - event.latlng.lat
                      const lngDistance = (point.lng - event.latlng.lng) * Math.cos((event.latlng.lat * Math.PI) / 180)
                      const distance = latDistance * latDistance + lngDistance * lngDistance
                      if (distance < nearestDistance) {
                        nearest = point
                        nearestDistance = distance
                      }
                    }
                    setSelectedPointId(nearest.id)
                  },
                }}
              />
            )}
            <PointDots points={mapPoints} isDark={isDark} />
            {mapPoints[0] && (
              <CircleMarker
                center={[mapPoints[0].lat, mapPoints[0].lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 2, fillColor: '#157d73', fillOpacity: 1 }}
              >
                <Popup><strong>{ui.startPoint}</strong><br />{formatPointDateTimeAtLocation(mapPoints[0].timestamp, mapPoints[0].lat, mapPoints[0].lng, language)}</Popup>
              </CircleMarker>
            )}
            {mapPoints.length > 1 && (
              <CircleMarker
                center={[mapPoints[mapPoints.length - 1]!.lat, mapPoints[mapPoints.length - 1]!.lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 2, fillColor: '#e27a49', fillOpacity: 1 }}
              >
                <Popup><strong>{ui.endPoint}</strong><br />{formatPointDateTimeAtLocation(mapPoints[mapPoints.length - 1]!.timestamp, mapPoints[mapPoints.length - 1]!.lat, mapPoints[mapPoints.length - 1]!.lng, language)}</Popup>
              </CircleMarker>
            )}
            {selectedPoint && selectedPoint.id !== mapPoints[0]?.id && selectedPoint.id !== mapPoints[mapPoints.length - 1]?.id && (
              <CircleMarker
                center={[selectedPoint.lat, selectedPoint.lng]}
                radius={8}
                pathOptions={{ color: '#fff', weight: 3, fillColor: '#d88748', fillOpacity: 1 }}
              >
                <Popup><strong>{displayPointLabel(selectedPoint.label, language)}</strong><br />{formatPointDateTimeAtLocation(selectedPoint.timestamp, selectedPoint.lat, selectedPoint.lng, language)}</Popup>
              </CircleMarker>
            )}
          </MapContainer>

          <div className="map-top-overlay">
            <div className="map-context">
              <span className="context-kicker">{isDemo ? ui.exampleView : ui.timeline}</span>
              <strong>{placeViewEnabled && placeScope ? scopedPlaceName : displayedDate}</strong>
            </div>
            <div className="map-actions">
              {placeScope && <button className={'scope-toggle' + (placeViewEnabled ? ' active' : '')} type="button" onClick={() => setPlaceViewEnabled((enabled) => !enabled)}>{placeViewEnabled ? ui.showCalendar + ' · ' + scopedPlaceName + ' ×' : ui.showPlaceAgain.replace('{place}', scopedPlaceName)}</button>}
              {isDemo && <span className="demo-badge"><span /> {ui.sampleData}</span>}
            </div>
          </div>

          <div className="map-bottom-overlay">
            <div className="map-legend"><span className="legend-line" /> {ui.route} <span className="legend-dot" /> {ui.locationPoint}</div>
            <div className="map-zoom-controls">
              <button type="button" aria-label={ui.zoomIn} onClick={() => document.querySelector<HTMLElement>('.leaflet-control-zoom-in')?.click()}>+</button>
              <button type="button" aria-label={ui.zoomOut} onClick={() => document.querySelector<HTMLElement>('.leaflet-control-zoom-out')?.click()}>−</button>
            </div>
          </div>

          {selectedPoint && (
            <div className="selected-card">
              <button type="button" aria-label={ui.closePointDetails} onClick={() => setSelectedPointId(null)}>×</button>
              <span className="selected-kicker">{ui.selectedPoint}</span>
              <strong>{displayPointLabel(selectedPoint.label, language)}</strong>
              <span>{formatPointDateTimeAtLocation(selectedPoint.timestamp, selectedPoint.lat, selectedPoint.lng, language)} · {selectedPoint.lat.toFixed(5)}, {selectedPoint.lng.toFixed(5)}</span>
            </div>
          )}
        </section>
      </div>
      )}
    </main>
  )
}

export default App








