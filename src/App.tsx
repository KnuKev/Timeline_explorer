import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import tzLookup from 'tz-lookup'
import {
  distanceKm,
  formatLongDate,
  localDateKey,
  parseTimeline,
  type TimelinePoint,
} from './timeline'
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
  }, [map, points])

  return null
}

function formatPlaceDate(dateKey: string): string {
  return new Intl.DateTimeFormat('no-NO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateKey + 'T12:00:00'))
}

function formatPointDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat('no-NO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp))
}

function formatPointDateTimeAtLocation(timestamp: string, lat: number, lng: number): string {
  let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  try {
    timeZone = tzLookup(lat, lng)
  } catch {
    // Keep the browser's local zone if the coordinate is outside the lookup data.
  }
  return new Intl.DateTimeFormat('no-NO', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatDistance(kilometers: number): string {
  if (kilometers < 1) return Math.round(kilometers * 1000) + ' m'
  return kilometers.toLocaleString('no-NO', { maximumFractionDigits: 1 }) + ' km'
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
function PointDots({ points }: { points: TimelinePoint[] }) {
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
        context.arc(pixel.x, pixel.y, 2.2, 0, Math.PI * 2)
        context.fillStyle = '#d9534f'
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
  }, [map, points])

  return null
}
function App() {
  const [points, setPoints] = useState<TimelinePoint[]>(demoPoints)
  const [activeTab, setActiveTab] = useState<ActiveTab>('map')
  const [placeMode, setPlaceMode] = useState<'countries' | 'cities'>('countries')
  const [cityReferences, setCityReferences] = useState<CityReference[]>([])
  const [countryCodes, setCountryCodes] = useState<Record<string, string>>({})
  const [placeAnalysis, setPlaceAnalysis] = useState<PlaceAnalysis | null>(null)
  const [placesLoading, setPlacesLoading] = useState(true)
  const [placesError, setPlacesError] = useState('')
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
  const [error, setError] = useState('')
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/geonames-cities.json').then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<CityReference[]> }),
      fetch('/country-codes.json').then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Record<string, string>> }),
    ]).then(([cities, codes]) => {
      if (!cancelled) { setCityReferences(cities); setCountryCodes(codes); setPlacesLoading(false) }
    }).catch(() => {
      if (!cancelled) { setPlacesError('Stedsdataene kunne ikke lastes. Prøv å laste siden på nytt.'); setPlacesLoading(false) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (cityReferences.length === 0) return
    setPlacesLoading(true)
    const worker = new Worker(new URL('./places.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<PlaceAnalysis>) => { setPlaceAnalysis(event.data); setPlacesLoading(false) }
    worker.onerror = () => { setPlacesError('Punktene kunne ikke sorteres geografisk. Prøv å laste Timeline-filen på nytt.'); setPlacesLoading(false); worker.terminate() }
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
  const renderPlaceCard = (place: PlaceEntry, index: number) => <button key={place.key} type="button" className="place-card" onClick={() => { setPlaceScope({ kind: placeMode === 'countries' ? 'country' : 'city', key: place.key, name: place.name, countryName: place.countryName, pointIds: place.pointIds }); setPlaceViewEnabled(true); setActiveTab('map'); setSelectedPointId(null) }}><span className="place-rank">{String(index + 1).padStart(2, '0')}</span><span className="place-card-copy"><strong>{place.name}</strong><small>{placeMode === 'cities' ? place.countryName : 'Land'}</small></span><span className="place-days"><strong>{place.days.toLocaleString('no-NO')}</strong><small>dager</small></span><span className="place-dates"><small>{place.dates.length > 1 ? 'Siste datoer' : 'Dato'}</small><span>{place.dates.slice(0, 3).map(formatPlaceDate).join(' · ') + (place.dates.length > 3 ? ' · +' + (place.dates.length - 3) : '')}</span></span><span className="place-card-footer">{place.pointCount.toLocaleString('no-NO')} posisjonspunkter <span>↗</span></span></button>
  const selectedPoint = mapPoints.find((point) => point.id === selectedPointId) ?? null
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
    ? formatLongDate(selectedDate)
    : fromDate === toDate
      ? formatLongDate(fromDate)
      : formatLongDate(fromDate) + ' – ' + formatLongDate(toDate)

  const handleFile = async (file?: File) => {
    if (!file) return
    setError('')
    try {
      const parsed = parseTimeline(JSON.parse(await file.text()))
      if (parsed.length === 0) {
        setError('Fant ingen gjenkjennelige koordinater. Kontroller at dette er en Google Timeline JSON-fil.')
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
      setError('Filen kunne ikke leses som gyldig JSON.')
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
          <span className="eyebrow">DIN HISTORIKK</span>
          <strong>Utforsk steder</strong>
        </div>

        <nav className="main-nav" aria-label="Hovedmeny">
          <button className={'nav-item' + (activeTab === 'map' ? ' is-current' : '')} type="button" onClick={() => setActiveTab('map')}>Kart</button>
          <button className="nav-item" type="button" disabled title="Kommer senere">Reiser</button>
          <button className={'nav-item' + (activeTab === 'places' ? ' is-current' : '')} type="button" onClick={() => setActiveTab('places')}>Steder</button>
          <button className="nav-item" type="button" disabled title="Kommer senere">Statistikk</button>
        </nav>

        <div className="topbar-right">
          <span className="privacy-pill"><span className="privacy-dot" /> Lokal fil</span>
          <button className="theme-toggle" type="button" aria-label={isDark ? 'Bytt til lyst tema' : 'Bytt til mørkt tema'} title={isDark ? 'Lyst tema' : 'Mørkt tema'} onClick={() => setIsDark((current) => !current)}>{isDark ? '☀' : '☾'}</button>
        </div>
      </header>

      {activeTab === 'places' ? (
        <div className="places-page">
          <div className="places-page-heading"><div><span className="eyebrow">HELE TIDSLINJEN</span><h1>Steder</h1><p>Utforsk hvor du har vært, sortert etter antall dager med registreringer.</p></div><div className="places-total"><strong>{places.length.toLocaleString('no-NO')}</strong><span>{placeMode === 'countries' ? 'land registrert' : 'byer registrert'}</span></div></div>
          <div className="places-tabs" role="tablist" aria-label="Velg stedstype"><button type="button" role="tab" aria-selected={placeMode === 'countries'} className={placeMode === 'countries' ? 'selected' : ''} onClick={() => setPlaceMode('countries')}>Land <span>{placeAnalysis?.countries.length ?? '–'}</span></button><button type="button" role="tab" aria-selected={placeMode === 'cities'} className={placeMode === 'cities' ? 'selected' : ''} onClick={() => setPlaceMode('cities')}>Byer <span>{placeAnalysis?.cities.length ?? '–'}</span></button></div>
          {placesLoading && <div className="places-message"><span className="places-spinner" /> Analyserer registreringene dine lokalt …</div>}{placesError && <div className="places-message places-error">{placesError}</div>}
          {!placesLoading && !placesError && places.length === 0 && <div className="places-empty"><span>⌖</span><strong>Ingen steder å vise ennå</strong><p>Importer Timeline-filen din fra Kart-fanen for å analysere flere steder.</p><button type="button" className="primary-button" onClick={() => setActiveTab('map')}>Gå til kartet</button></div>}
          {!placesLoading && mainPlaces.length > 0 && <div className="places-grid">{mainPlaces.map(renderPlaceCard)}</div>}
          {!placesLoading && fewerPlaces.length > 0 && <details className="fewer-places"><summary><span>Vis steder med færre enn 10 punkter</span><span className="count-badge">{fewerPlaces.length}</span></summary><p>Disse stedene kan være korte overflygninger eller unøyaktige GPS-treff.</p><div className="places-grid">{fewerPlaces.map((place, index) => renderPlaceCard(place, mainPlaces.length + index))}</div></details>}
          <footer className="places-attribution">Byforslag fra <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0) · GeoNames-steder fra 2&nbsp;500 innbyggere + Stabekk · nærmeste sted innen 30 km. All posisjonsanalyse skjer lokalt.</footer>
        </div>
      ) : (
      <div className="workspace">
        <aside className="sidebar">
          <section className="import-card">
            <div className="import-icon" aria-hidden="true">↑</div>
            <div className="import-copy">
              <strong>{fileName || 'Importer Timeline'}</strong>
              <span>{isDemo ? 'Prøv med eksempeldatasett' : 'JSON-filen er lastet inn'}</span>
            </div>
            <label className="import-button">
              {isDemo ? 'Velg fil' : 'Bytt fil'}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
            </label>
          </section>
          {error && <p className="error-message" role="alert">{error}</p>}

          <section className="date-section">
            <div className="section-title-row">
              <h2>Tidspunkt</h2>
              <button className="quiet-button" type="button" onClick={() => {
                if (availableDays.length) {
                  setDateMode('day')
                  setSelectedDate(availableDays[availableDays.length - 1]!)
                }
              }}>Siste dag</button>
            </div>

            <div className="segmented-control" role="tablist" aria-label="Velg tidsrom">
              <button
                type="button"
                role="tab"
                aria-selected={dateMode === 'day'}
                className={dateMode === 'day' ? 'selected' : ''}
                onClick={() => setDateMode('day')}
              >En dag</button>
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
              >Periode</button>
            </div>

            {dateMode === 'day' ? (
              <div className="date-picker-wrap">
                <div className="date-nav">
                  <button type="button" aria-label="Forrige dag" onClick={() => shiftDay(-1)} disabled={availableDays.indexOf(selectedDate) <= 0}>‹</button>
                  <label htmlFor="selected-day">{displayedDate}</label>
                  <button type="button" aria-label="Neste dag" onClick={() => shiftDay(1)} disabled={availableDays.indexOf(selectedDate) < 0 || availableDays.indexOf(selectedDate) >= availableDays.length - 1}>›</button>
                </div>
                <input
                  id="selected-day"
                  className="date-input"
                  type="date"
                  value={selectedDate}
                  onChange={(event) => setSelectedDate(event.target.value)}
                />
                <div className="date-hint">{availableDays.length} dager med registreringer</div>
              </div>
            ) : (
              <div className="period-fields">
                <label>Fra<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
                <label>Til<input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} /></label>
                <p>{placeViewEnabled && placeScope ? mapPoints.length.toLocaleString('no-NO') + ' punkter i hele ' + (placeScope.kind === 'country' ? 'landet' : 'byen') : mapPoints.length.toLocaleString('no-NO') + ' punkter i valgt periode'}</p>
              </div>
            )}
          </section>

          <section className="summary-section">
            <div className="section-title-row">
              <h2>Oppsummering</h2>
              <span className="summary-period">{placeViewEnabled && placeScope ? 'HELE HISTORIKKEN' : dateMode === 'day' ? 'VALGT DAG' : 'VALGT PERIODE'}</span>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <span className="summary-icon pin-icon">⌖</span>
                <div><strong>{mapPoints.length.toLocaleString('no-NO')}</strong><span>punkter</span></div>
              </div>
              <div className="summary-card">
                <span className="summary-icon route-icon">↗</span>
                <div><strong>{formatDistance(mapDistance)}</strong><span>estimert rute</span></div>
              </div>
            </div>
          </section>

          <section className="activity-section">
            <div className="point-list-card">
              <div className="point-list-card-header">
                <h2>{placeViewEnabled && placeScope ? `Punkter i ${placeScope.name}` : dateMode === 'day' ? 'Punkter denne dagen' : 'Punkter i perioden'}</h2>
                <span className="count-badge">{mapPoints.length}</span>
              </div>
              {isPointListExpanded && <div className="point-list" id="point-list">
                {pointGroups.map((group) => (
                  <details className="point-day-group" key={group.day} open={pointGroups.length === 1}>
                    <summary><strong>{formatLongDate(group.day)}</strong><span className="count-badge">{group.points.length}</span></summary>
                    <div className="point-day-rows">
                      {group.points.slice(0, 80).map((point, index) => (
                        <button key={point.id} type="button" className={'point-row' + (point.id === selectedPointId ? ' active' : '')} onClick={() => setSelectedPointId(point.id)}>
                          <span className={'point-symbol ' + (point.kind === 'visit' ? 'visit' : '')}>{point.kind === 'visit' ? '•' : index + 1}</span>
                          <span className="point-copy"><strong>{point.label}</strong><small>{formatPointDateTime(point.timestamp)} · {point.lat.toFixed(4)}, {point.lng.toFixed(4)}</small></span>
                          <span className="point-arrow">›</span>
                        </button>
                      ))}
                      {group.points.length > 80 && <p className="list-note">Viser 80 av {group.points.length.toLocaleString('no-NO')} punkter denne dagen.</p>}
                    </div>
                  </details>
                ))}
                {mapPoints.length === 0 && <div className="empty-list"><span>⌖</span><strong>Ingen punkter i dette utvalget</strong><small>Velg en dato eller et sted med registreringer.</small></div>}
              </div>}
              <button className="point-list-disclosure" type="button" aria-expanded={isPointListExpanded} aria-controls="point-list" aria-label={isPointListExpanded ? 'Skjul punkter' : 'Vis punkter'} title={isPointListExpanded ? 'Skjul punkter' : 'Vis punkter'} onClick={() => setIsPointListExpanded((expanded) => !expanded)}>
                <svg className={'expand-chevron' + (isPointListExpanded ? ' expanded' : '')} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="M4 3 L47 13 L50 15 L53 13 L96 3 L96 8.25 L53 18.5 L50 20.5 L47 18.5 L4 8.25 Z" /></svg>
              </button>
            </div>
          </section>

          <footer className="sidebar-footer">
            <span className="shield-icon">◇</span>
            <span><strong>Historikken leses lokalt</strong><small>Kartfliser lastes fra OpenStreetMap.</small></span>
          </footer>
        </aside>

        <section className="map-area" aria-label="Kart med posisjonshistorikk">
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
                pathOptions={{ color: '#1a7c72', weight: 3, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
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
            <PointDots points={mapPoints} />
            {mapPoints[0] && (
              <CircleMarker
                center={[mapPoints[0].lat, mapPoints[0].lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 2, fillColor: '#157d73', fillOpacity: 1 }}
              >
                <Popup><strong>Startpunkt</strong><br />{formatPointDateTimeAtLocation(mapPoints[0].timestamp, mapPoints[0].lat, mapPoints[0].lng)}</Popup>
              </CircleMarker>
            )}
            {mapPoints.length > 1 && (
              <CircleMarker
                center={[mapPoints[mapPoints.length - 1]!.lat, mapPoints[mapPoints.length - 1]!.lng]}
                radius={7}
                pathOptions={{ color: '#fff', weight: 2, fillColor: '#e27a49', fillOpacity: 1 }}
              >
                <Popup><strong>Sluttpunkt</strong><br />{formatPointDateTimeAtLocation(mapPoints[mapPoints.length - 1]!.timestamp, mapPoints[mapPoints.length - 1]!.lat, mapPoints[mapPoints.length - 1]!.lng)}</Popup>
              </CircleMarker>
            )}
            {selectedPoint && selectedPoint.id !== mapPoints[0]?.id && selectedPoint.id !== mapPoints[mapPoints.length - 1]?.id && (
              <CircleMarker
                center={[selectedPoint.lat, selectedPoint.lng]}
                radius={8}
                pathOptions={{ color: '#fff', weight: 3, fillColor: '#d88748', fillOpacity: 1 }}
              >
                <Popup><strong>{selectedPoint.label}</strong><br />{formatPointDateTimeAtLocation(selectedPoint.timestamp, selectedPoint.lat, selectedPoint.lng)}</Popup>
              </CircleMarker>
            )}
          </MapContainer>

          <div className="map-top-overlay">
            <div className="map-context">
              <span className="context-kicker">{isDemo ? 'EKSEMPELVISNING' : 'TIDSLINJE'}</span>
              <strong>{placeViewEnabled && placeScope ? placeScope.name : displayedDate}</strong>
            </div>
            <div className="map-actions">
              {placeScope && <button className={'scope-toggle' + (placeViewEnabled ? ' active' : '')} type="button" onClick={() => setPlaceViewEnabled((enabled) => !enabled)}>{placeViewEnabled ? 'Vis kalender · ' + placeScope.name + ' ×' : 'Vis ' + placeScope.name + ' igjen'}</button>}
              {isDemo && <span className="demo-badge"><span /> Eksempeldata</span>}
            </div>
          </div>

          <div className="map-bottom-overlay">
            <div className="map-legend"><span className="legend-line" /> Rute <span className="legend-dot" /> Posisjonspunkt</div>
            <div className="map-zoom-controls">
              <button type="button" aria-label="Zoom inn" onClick={() => document.querySelector<HTMLElement>('.leaflet-control-zoom-in')?.click()}>+</button>
              <button type="button" aria-label="Zoom ut" onClick={() => document.querySelector<HTMLElement>('.leaflet-control-zoom-out')?.click()}>−</button>
            </div>
          </div>

          {selectedPoint && (
            <div className="selected-card">
              <button type="button" aria-label="Lukk punktdetaljer" onClick={() => setSelectedPointId(null)}>×</button>
              <span className="selected-kicker">VALGT PUNKT</span>
              <strong>{selectedPoint.label}</strong>
              <span>{formatPointDateTimeAtLocation(selectedPoint.timestamp, selectedPoint.lat, selectedPoint.lng)} · {selectedPoint.lat.toFixed(5)}, {selectedPoint.lng.toFixed(5)}</span>
            </div>
          )}
        </section>
      </div>
      )}
    </main>
  )
}

export default App








