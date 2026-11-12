import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Pane, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { type Language, locales, pointLabel, translations } from './i18n'
import { formatPointInterval } from './formatting'
import type { TimelinePoint } from './timeline'
import type { RouteSegment } from './routes'
import { createPointSpatialIndex, createRouteGeometry, longitudeNear, projectLocation, shortestLongitudeRange, worldRectsForBounds } from './mapSpatial'
import { MIN_MAP_ZOOM, POINTS_MIN_ZOOM, getMapColors, type MapBackground } from './mapAppearance'
import Icon from './Icon'
import MapLandCover from './MapLandCover'

type Props = {
  active?: boolean
  points: TimelinePoint[]
  routeSegments: RouteSegment[]
  selectedPointId: string | null
  isDark: boolean
  mapBackground: MapBackground
  language: Language
  onSelect: (id: string | null) => void
}

const WORLD_BOUNDS = L.latLngBounds([-85.05112878, -180], [85.05112878, 180])
const ZOOM_SNAP = 0.25
const mercator = L.Projection.SphericalMercator
const extendedMercator = { ...mercator, MAX_LATITUDE: 89.99999 }
const viewportCenters = new WeakSet<L.LatLng>()
// A world overview below the sidebar can put the viewport center north of the
// tile grid. Keep those centers projectable while using standard Mercator for
// recorded coordinates and keeping the standard world bounds for the tiles.
const VIEWPORT_CRS = {
  ...L.CRS.EPSG3857,
  projection: {
    ...mercator,
    unproject(point: L.Point) {
      const center = mercator.unproject(point)
      if (Math.abs(center.lat) > WORLD_BOUNDS.getNorth()) viewportCenters.add(center)
      return center
    },
    project(point: L.LatLng) {
      return viewportCenters.has(point) ? extendedMercator.project(point) : mercator.project(point)
    },
  },
}
const EOX_WMTS = 'https://tiles.maps.eox.at/wmts/1.0.0'
const OSM_CREDIT = '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
const SATELLITE_CREDIT = '<a href="https://cloudless.eox.at">EOxCloudless</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016)'
const EOX_LABEL_CREDIT = `© ${OSM_CREDIT} · <a href="https://maps.eox.at">EOX::Maps</a> / MapServer`

function hasVisibleSize(map: L.Map): boolean {
  const container = map.getContainer()
  return container.clientWidth > 0 && container.clientHeight > 0
}

function visibleWorldRects(map: L.Map, padding = 0.06) {
  const bounds = map.getBounds().pad(padding)
  return worldRectsForBounds({ west: bounds.getWest(), east: bounds.getEast(), north: bounds.getNorth(), south: bounds.getSouth() })
}

function mapPadding(map: L.Map): { paddingTopLeft: L.PointExpression; paddingBottomRight: L.PointExpression } {
  const container = map.getContainer()
  const mapRect = container.getBoundingClientRect()
  const sidebar = container.closest('.workspace')?.querySelector('.sidebar')?.getBoundingClientRect()
  if (!sidebar || sidebar.width === 0 || sidebar.height === 0) return { paddingTopLeft: [30, 70], paddingBottomRight: [50, 70] }
  if (mapRect.width <= 680) {
    return { paddingTopLeft: [24, Math.min(sidebar.bottom - mapRect.top + 18, mapRect.height - 100)], paddingBottomRight: [50, 70] }
  }
  return { paddingTopLeft: [Math.min(sidebar.right - mapRect.left + 24, mapRect.width * 0.55), 70], paddingBottomRight: [50, 70] }
}

const RouteLayer = memo(function RouteLayer({ segments, isDark, active }: { segments: RouteSegment[]; isDark: boolean; active: boolean }) {
  const map = useMap()
  const geometry = useMemo(() => ({
    ground: createRouteGeometry(segments.filter(segment => segment.transport !== 'flight')),
    flight: createRouteGeometry(segments.filter(segment => segment.transport === 'flight')),
  }), [segments])
  useEffect(() => {
    if (!active) return
    const colors = getMapColors(isDark)
    const pane = map.getPane('timeline-routes') ?? map.createPane('timeline-routes')
    pane.style.zIndex = '390'
    const flightCasing = isDark ? L.polyline([], { pane: 'timeline-routes', color: '#13233c', weight: 5.5, opacity: 0.9, dashArray: '7 6', interactive: false, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' }).addTo(map) : null
    const flightRoute = L.polyline([], { pane: 'timeline-routes', color: colors.route, weight: 2.5, opacity: 0.95, dashArray: '7 6', interactive: false, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' }).addTo(map)
    const casing = isDark ? L.polyline([], { pane: 'timeline-routes', color: '#13233c', weight: 6.5, opacity: 0.9, interactive: false, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' }).addTo(map) : null
    const route = L.polyline([], { pane: 'timeline-routes', color: colors.route, weight: isDark ? 3.5 : 3, opacity: 1, interactive: false, smoothFactor: 0, lineCap: 'round', lineJoin: 'round' }).addTo(map)
    const redraw = () => {
      if (!hasVisibleSize(map)) return
      const bounds = map.getBounds().pad(0.2)
      const northWest = projectLocation(bounds.getNorth(), bounds.getWest())
      const southEast = projectLocation(bounds.getSouth(), bounds.getEast())
      const visible = [{ west: northWest.x, east: southEast.x, north: northWest.y, south: southEast.y }]
      const positions = geometry.ground.visible(map.getZoom(), visible)
      const flights = geometry.flight.visible(map.getZoom(), visible)
      flightCasing?.setLatLngs(flights)
      flightRoute.setLatLngs(flights)
      casing?.setLatLngs(positions)
      route.setLatLngs(positions)
    }
    let pending = 0
    const schedule = () => {
      if (pending) cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => { pending = 0; redraw() })
    }
    map.on('moveend zoomend resize', schedule)
    redraw()
    return () => {
      map.off('moveend zoomend resize', schedule)
      if (pending) cancelAnimationFrame(pending)
      flightCasing?.remove()
      flightRoute.remove()
      casing?.remove()
      route.remove()
    }
  }, [map, geometry, isDark, active])
  return null
})

type PointIndex = ReturnType<typeof createPointSpatialIndex>
const PointLayer = memo(function PointLayer({ index, isDark, active }: { index: PointIndex; isDark: boolean; active: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (!active) return
    const canvas = L.DomUtil.create('canvas', 'timeline-point-canvas')
    const context = canvas.getContext('2d')
    if (!context) return
    const pane = map.getPane('timeline-points') ?? map.createPane('timeline-points')
    pane.style.zIndex = '450'
    pane.appendChild(canvas)
    const colors = getMapColors(isDark)
    const draw = () => {
      if (!hasVisibleSize(map) || map.getZoom() < POINTS_MIN_ZOOM) { canvas.style.visibility = 'hidden'; return }
      const size = map.getSize()
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(size.x * ratio)
      canvas.height = Math.round(size.y * ratio)
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, size.x, size.y)
      const markers = index.sample(visibleWorldRects(map), 5 / map.options.crs!.scale(map.getZoom()))
      context.fillStyle = colors.point
      context.strokeStyle = colors.border
      context.lineWidth = 1
      context.beginPath()
      const centerLng = map.getCenter().lng
      for (const point of markers) {
        const pixel = map.latLngToContainerPoint([point.lat, longitudeNear(point.lng, centerLng)])
        context.moveTo(pixel.x + 2.2, pixel.y)
        context.arc(pixel.x, pixel.y, 2.2, 0, Math.PI * 2)
      }
      context.fill()
      context.stroke()
      canvas.style.visibility = 'visible'
    }
    const hide = () => { canvas.style.visibility = 'hidden' }
    let pending = 0
    const schedule = () => {
      if (pending) cancelAnimationFrame(pending)
      pending = requestAnimationFrame(() => { pending = 0; draw() })
    }
    map.on('movestart zoomstart', hide)
    map.on('moveend zoomend resize', schedule)
    draw()
    return () => {
      map.off('movestart zoomstart', hide)
      map.off('moveend zoomend resize', schedule)
      if (pending) cancelAnimationFrame(pending)
      canvas.remove()
    }
  }, [map, index, isDark, active])
  return null
})

const PointSelection = memo(function PointSelection({ index, onSelect, active }: { index: PointIndex; onSelect: Props['onSelect']; active: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (!active) return
    const select = (event: L.LeafletMouseEvent) => {
      if (Math.abs(event.latlng.lat) > WORLD_BOUNDS.getNorth()) { onSelect(null); return }
      const position = projectLocation(event.latlng.lat, event.latlng.lng)
      const nearest = index.nearest(position, 12 / map.options.crs!.scale(map.getZoom()))
      onSelect(nearest?.id ?? null)
    }
    map.on('click', select)
    return () => { map.off('click', select) }
  }, [map, index, onSelect, active])
  return null
})

function ViewportAndControls({ points, selectedPoint, language, active }: { points: TimelinePoint[]; selectedPoint: TimelinePoint | null; language: Language; active: boolean }) {
  const map = useMap()
  const controls = useRef<HTMLDivElement>(null)
  const displayedPoints = useRef<TimelinePoint[] | null>(null)
  const focusedPoint = useRef<TimelinePoint | null>(null)
  const overview = useRef<{ zoom: number; center: L.LatLng } | null>(null)
  const synchronizeRef = useRef<() => void>(() => {})
  const bounds = useMemo(() => {
    if (!points.length) return null
    const result = L.latLngBounds([])
    for (const point of points) result.extend([point.lat, point.lng])
    const [west, east] = shortestLongitudeRange(points, result.getWest(), result.getEast())
    return L.latLngBounds([result.getSouth(), west], [result.getNorth(), east])
  }, [points])
  const fit = useCallback(() => {
    if (!active || !hasVisibleSize(map) || !bounds) return
    const midpoint = bounds.getCenter().lng
    const offset = longitudeNear(midpoint, map.getCenter().lng) - midpoint
    const nearby = L.latLngBounds([bounds.getSouth(), bounds.getWest() + offset], [bounds.getNorth(), bounds.getEast() + offset])
    map.fitBounds(nearby, { ...mapPadding(map), maxZoom: points.length === 1 ? 14 : 15, animate: false })
  }, [active, map, bounds, points.length])
  const centerOverview = useCallback(() => {
    const target = overview.current
    if (!active || !target || map.getZoom() !== target.zoom) return
    const current = map.project(map.getCenter())
    const targetY = map.project(target.center).y
    if (Math.abs(current.y - targetY) > 1) {
      map.setView(map.unproject([current.x, targetY]), target.zoom, { animate: false })
    }
  }, [active, map])
  const synchronize = useCallback(() => {
    if (!active || !hasVisibleSize(map)) return
    // Hidden tabs keep Leaflet's last nonzero size. On return, resize without
    // changing the geographic center, then fit only a genuinely new selection.
    const wasAtOverview = overview.current?.zoom === map.getZoom()
    map.invalidateSize({ pan: true, animate: false })
    const padding = mapPadding(map)
    const topLeft = L.point(padding.paddingTopLeft)
    const bottomRight = L.point(padding.paddingBottomRight)
    const available = map.getSize().subtract(topLeft).subtract(bottomRight)
    const snap = L.Browser.any3d ? ZOOM_SNAP : 1
    // Web Mercator's world is a square of 256 pixels at zoom zero.
    const fitZoom = map.getScaleZoom(Math.max(1, Math.min(available.x, available.y)) / 256, 0)
    const zoom = Math.max(MIN_MAP_ZOOM, Math.floor(fitZoom / snap) * snap)
    const center = map.unproject(map.project([0, map.getCenter().lng], zoom).add([0, (bottomRight.y - topLeft.y) / 2]), zoom)
    overview.current = { zoom, center }
    map.setMinZoom(zoom)
    if (displayedPoints.current !== points) {
      fit()
      displayedPoints.current = points
    } else if (wasAtOverview && map.getZoom() !== zoom) {
      map.setView(center, zoom, { animate: false })
    }
    // A selected marker may remain selected after the user pans away. Do not
    // bring it back merely because the tab or browser size changed.
    if (focusedPoint.current === selectedPoint) return
    focusedPoint.current = selectedPoint
    if (!selectedPoint || map.getZoom() === zoom) return
    const left = topLeft
    const right = map.getSize().subtract(bottomRight)
    const lng = longitudeNear(selectedPoint.lng, map.getCenter().lng)
    const position = map.latLngToContainerPoint([selectedPoint.lat, lng])
    if (position.x < left.x || position.x > right.x || position.y < left.y || position.y > right.y) {
      const target = left.add(right).divideBy(2)
      map.panBy(position.subtract(target), { animate: false })
    }
  }, [active, map, points, fit, selectedPoint])
  useEffect(() => {
    synchronizeRef.current = synchronize
    synchronize()
  }, [synchronize])
  useEffect(() => {
    if (controls.current) {
      L.DomEvent.disableClickPropagation(controls.current)
      L.DomEvent.disableScrollPropagation(controls.current)
    }
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(() => synchronizeRef.current())
    const container = map.getContainer()
    observer.observe(container)
    const sidebar = container.closest('.workspace')?.querySelector('.sidebar')
    if (sidebar) observer.observe(sidebar)
    return () => { observer.disconnect(); synchronizeRef.current = () => {} }
  }, [map])
  const t = translations[language]
  useEffect(() => {
    map.on('zoomend', centerOverview)
    return () => { map.off('zoomend', centerOverview) }
  }, [map, centerOverview])
  const fitLabel = t.fitSelection
  return <div ref={controls} className="map-zoom-controls">
    <button type="button" aria-label={fitLabel} title={fitLabel} onClick={fit} disabled={!points.length}><Icon name="fit" /></button>
    <button type="button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => {
      if (map.getZoom() === overview.current?.zoom) map.setView([0, map.getCenter().lng], map.getZoom() + 1)
      else map.zoomIn()
    }}><Icon name="plus" /></button>
    <button type="button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => map.zoomOut()}><Icon name="minus" /></button>
  </div>
}

const MapContents = memo(function MapContents(props: Props) {
  const { points, routeSegments, selectedPointId, isDark, mapBackground, language, onSelect, active = true } = props
  const highContrast = isDark || mapBackground === 'satellite'
  const index = useMemo(() => createPointSpatialIndex(points), [points])
  const selected = useMemo(() => points.find(point => point.id === selectedPointId) ?? null, [points, selectedPointId])
  const colors = getMapColors(highContrast)
  const t = translations[language]
  const locale = locales[language]
  const first = points[0]
  const last = points.length > 1 ? points[points.length - 1] : undefined
  const map = useMap()
  const [centerLng, setCenterLng] = useState(() => map.getCenter().lng)
  useEffect(() => {
    if (!active) return
    const update = () => setCenterLng(map.getCenter().lng)
    update()
    map.on('moveend', update)
    return () => { map.off('moveend', update) }
  }, [active, map])
  return <>
    <ViewportAndControls points={points} selectedPoint={selected} language={language} active={active} />
    <RouteLayer segments={routeSegments} isDark={highContrast} active={active} />
    <PointLayer index={index} isDark={highContrast} active={active} />
    <PointSelection index={index} onSelect={onSelect} active={active} />
    <Pane name="timeline-markers" style={{ zIndex: 460 }}>
    {first && <CircleMarker center={[first.lat, longitudeNear(first.lng, centerLng)]} radius={7} pathOptions={{ color: colors.border, weight: 2, fillColor: colors.route, fillOpacity: 1 }}>
      <Popup><strong>{t.startPoint}</strong><br />{formatPointInterval(first, locale, true)}</Popup>
    </CircleMarker>}
    {last && <CircleMarker center={[last.lat, longitudeNear(last.lng, centerLng)]} radius={7} pathOptions={{ color: colors.border, weight: 2, fillColor: colors.end, fillOpacity: 1 }}>
      <Popup><strong>{t.endPoint}</strong><br />{formatPointInterval(last, locale, true)}</Popup>
    </CircleMarker>}
    {selected && selected.id !== first?.id && selected.id !== last?.id && <CircleMarker center={[selected.lat, longitudeNear(selected.lng, centerLng)]} radius={8} pathOptions={{ color: colors.border, weight: 3, fillColor: colors.selected, fillOpacity: 1 }}>
      <Popup><strong>{pointLabel(selected, language)}</strong><br />{formatPointInterval(selected, locale, true)}</Popup>
    </CircleMarker>}
    </Pane>
  </>
})

const TimelineMap = memo(function TimelineMap(props: Props) {
  const first = props.points[0]
  return <MapContainer className="map-view" center={first ? [first.lat, first.lng] : [0, 0]} zoom={first ? 15 : 2}
    crs={VIEWPORT_CRS} minZoom={MIN_MAP_ZOOM} maxZoom={18} zoomSnap={ZOOM_SNAP} zoomControl={false} trackResize={false} preferCanvas>
    {props.mapBackground === 'satellite' ? <>
      <TileLayer key="satellite" minZoom={MIN_MAP_ZOOM} minNativeZoom={0} maxNativeZoom={14}
        attribution={SATELLITE_CREDIT} url={`${EOX_WMTS}/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg`} />
      <TileLayer key="satellite-labels" minZoom={MIN_MAP_ZOOM} minNativeZoom={0} zIndex={2}
        attribution={EOX_LABEL_CREDIT} url={`${EOX_WMTS}/overlay_bright_3857/default/g/{z}/{y}/{x}.png`} />
    </> : <>
      <TileLayer key="street" minZoom={MIN_MAP_ZOOM} minNativeZoom={0}
        attribution={`© ${OSM_CREDIT}`} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapLandCover />
    </>}
    <MapContents {...props} />
  </MapContainer>
})

export { TimelineMap }
export default TimelineMap
