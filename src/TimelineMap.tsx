import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { CircleMarker, MapContainer, Pane, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { type Language, locales, pointLabel, translations } from './i18n'
import { formatPointInterval } from './formatting'
import type { TimelinePoint } from './timeline'
import type { RouteSegment } from './routes'
import { createPointSpatialIndex, createRouteGeometry, projectLocation, worldRectsForBounds } from './mapSpatial'
import { POINTS_MIN_ZOOM, getMapColors } from './mapAppearance'
import Icon from './Icon'
const initialCenter: L.LatLngExpression = [59.91, 10.72]

type Props = {
  active?: boolean
  points: TimelinePoint[]
  routeSegments: RouteSegment[]
  selectedPointId: string | null
  isDark: boolean
  language: Language
  onSelect: (id: string | null) => void
}

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
    return { paddingTopLeft: [24, Math.min(sidebar.bottom - mapRect.top + 18, mapRect.height * 0.6)], paddingBottomRight: [50, 70] }
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
      const bounds = visibleWorldRects(map, 0.2)
      const positions = geometry.ground.visible(map.getZoom(), bounds)
      const flights = geometry.flight.visible(map.getZoom(), bounds)
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
      const center = map.getCenter().lng
      context.fillStyle = colors.point
      context.strokeStyle = colors.border
      context.lineWidth = 1
      context.beginPath()
      for (const point of markers) {
        const lng = point.lng + 360 * Math.round((center - point.lng) / 360)
        const pixel = map.latLngToContainerPoint([point.lat, lng])
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
  const synchronizeRef = useRef<() => void>(() => {})
  const bounds = useMemo(() => {
    if (!points.length) return null
    const result = L.latLngBounds([])
    for (const point of points) result.extend([point.lat, point.lng])
    return result
  }, [points])
  const fit = useCallback(() => {
    if (active && hasVisibleSize(map) && bounds) map.fitBounds(bounds, { ...mapPadding(map), maxZoom: points.length === 1 ? 14 : 15, animate: false })
  }, [active, map, bounds, points.length])
  const synchronize = useCallback(() => {
    if (!active || !hasVisibleSize(map)) return
    // Hidden tabs keep Leaflet's last nonzero size. On return, resize without
    // changing the geographic center, then fit only a genuinely new selection.
    map.invalidateSize({ pan: true, animate: false })
    if (displayedPoints.current !== points) {
      fit()
      displayedPoints.current = points
    }
    // A selected marker may remain selected after the user pans away. Do not
    // bring it back merely because the tab or browser size changed.
    if (focusedPoint.current === selectedPoint) return
    focusedPoint.current = selectedPoint
    if (!selectedPoint) return
    const padding = mapPadding(map)
    const left = L.point(padding.paddingTopLeft)
    const right = map.getSize().subtract(L.point(padding.paddingBottomRight))
    const position = map.latLngToContainerPoint([selectedPoint.lat, selectedPoint.lng])
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
    observer.observe(map.getContainer())
    return () => { observer.disconnect(); synchronizeRef.current = () => {} }
  }, [map])
  const t = translations[language]
  const fitLabel = t.fitSelection
  return <div ref={controls} className="map-zoom-controls">
    <button type="button" aria-label={fitLabel} title={fitLabel} onClick={fit} disabled={!points.length}><Icon name="fit" /></button>
    <button type="button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => map.zoomIn()}><Icon name="plus" /></button>
    <button type="button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => map.zoomOut()}><Icon name="minus" /></button>
  </div>
}

const MapContents = memo(function MapContents(props: Props) {
  const { points, routeSegments, selectedPointId, isDark, language, onSelect, active = true } = props
  const index = useMemo(() => createPointSpatialIndex(points), [points])
  const selected = useMemo(() => points.find(point => point.id === selectedPointId) ?? null, [points, selectedPointId])
  const colors = getMapColors(isDark)
  const t = translations[language]
  const locale = locales[language]
  const first = points[0]
  const last = points.length > 1 ? points[points.length - 1] : undefined
  return <>
    <ViewportAndControls points={points} selectedPoint={selected} language={language} active={active} />
    <RouteLayer segments={routeSegments} isDark={isDark} active={active} />
    <PointLayer index={index} isDark={isDark} active={active} />
    <PointSelection index={index} onSelect={onSelect} active={active} />
    <Pane name="timeline-markers" style={{ zIndex: 460 }}>
    {first && <CircleMarker center={[first.lat, first.lng]} radius={7} pathOptions={{ color: colors.border, weight: 2, fillColor: colors.route, fillOpacity: 1 }}>
      <Popup><strong>{t.startPoint}</strong><br />{formatPointInterval(first, locale, true)}</Popup>
    </CircleMarker>}
    {last && <CircleMarker center={[last.lat, last.lng]} radius={7} pathOptions={{ color: colors.border, weight: 2, fillColor: colors.end, fillOpacity: 1 }}>
      <Popup><strong>{t.endPoint}</strong><br />{formatPointInterval(last, locale, true)}</Popup>
    </CircleMarker>}
    {selected && selected.id !== first?.id && selected.id !== last?.id && <CircleMarker center={[selected.lat, selected.lng]} radius={8} pathOptions={{ color: colors.border, weight: 3, fillColor: colors.selected, fillOpacity: 1 }}>
      <Popup><strong>{pointLabel(selected, language)}</strong><br />{formatPointInterval(selected, locale, true)}</Popup>
    </CircleMarker>}
    </Pane>
  </>
})

const TimelineMap = memo(function TimelineMap(props: Props) {
  return <MapContainer className="map-view" center={initialCenter} zoom={4} zoomControl={false} trackResize={false} preferCanvas worldCopyJump>
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <MapContents {...props} />
  </MapContainer>
})

export { TimelineMap }
export default TimelineMap
