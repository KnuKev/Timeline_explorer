import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Map as GlobeMap, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import worldAtlas from 'world-atlas/countries-110m.json' with { type: 'json' }
import type { TimelinePoint } from './timeline'
import type { RouteSegment } from './routes'
import { globeCountries, globePoints, globeRoutes } from './globeGeometry'
import { createPointSpatialIndex, shortestLongitudeRange, worldRectsForBounds } from './mapSpatial'
import { getMapColors, POINTS_MIN_ZOOM } from './mapAppearance'
import { translations, type Language } from './i18n'
import Icon from './Icon'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

type Props = {
  active: boolean
  points: TimelinePoint[]
  routeSegments: RouteSegment[]
  selectedPoint: TimelinePoint | undefined | null
  language: Language
  isDark: boolean
  onSelect: (id: string | null) => void
  onUnavailable: () => void
}

const atlas = worldAtlas as unknown as Topology<{ countries: GeometryCollection }>
const countries = globeCountries(feature(atlas, atlas.objects.countries))
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
// At a street-level scale, MapLibre uses 512-pixel world tiles and Leaflet
// uses 256. The same scale therefore has a one-level zoom offset.
const GLOBE_POINTS_MIN_ZOOM = POINTS_MIN_ZOOM - 1

function globeColors(isDark: boolean) {
  return {
    ocean: isDark ? '#14253a' : '#c4ddec',
    land: isDark ? '#344a48' : '#e4ead5',
    boundary: isDark ? '#526765' : '#9eae9d',
    ...getMapColors(isDark),
  }
}

function globeStyle(isDark: boolean): StyleSpecification {
  const colors = globeColors(isDark)
  return {
    version: 8,
    projection: { type: 'globe' },
    sky: { 'atmosphere-blend': 0 },
    sources: {
      countries: { type: 'geojson', data: countries },
      routes: { type: 'geojson', data: empty },
      observations: { type: 'geojson', data: empty },
      selected: { type: 'geojson', data: empty },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': colors.ocean } },
      { id: 'land', source: 'countries', type: 'fill', paint: { 'fill-color': colors.land } },
      { id: 'boundaries', source: 'countries', type: 'line', paint: { 'line-color': colors.boundary, 'line-width': .55 } },
      { id: 'ground', source: 'routes', type: 'line', filter: ['==', ['get', 'flight'], false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors.route, 'line-width': 2 } },
      { id: 'flights', source: 'routes', type: 'line', filter: ['==', ['get', 'flight'], true], paint: { 'line-color': colors.route, 'line-width': 2.4, 'line-dasharray': [2, 2] } },
      { id: 'points', source: 'observations', type: 'circle', minzoom: GLOBE_POINTS_MIN_ZOOM, paint: { 'circle-color': colors.point, 'circle-opacity': .65, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 1.3, 6, 2.8, 13, 3.5] } },
      { id: 'highlight', source: 'selected', type: 'circle', paint: { 'circle-color': colors.selected, 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': colors.ocean } },
    ],
  }
}

function selectionBounds(points: TimelinePoint[]): [[number, number], [number, number]] | undefined {
  if (!points.length) return
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity
  for (const point of points) {
    west = Math.min(west, point.lng)
    east = Math.max(east, point.lng)
    south = Math.min(south, point.lat)
    north = Math.max(north, point.lat)
  }
  const [left, right] = shortestLongitudeRange(points, west, east)
  return [[left, south], [right, north]]
}

export default function TimelineGlobe({ active, points, routeSegments, selectedPoint, language, isDark, onSelect, onUnavailable }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const initialDark = useRef(isDark)
  const [map, setMap] = useState<GlobeMap | null>(null)
  const t = translations[language]
  const routes = useMemo(() => globeRoutes(routeSegments), [routeSegments])
  const observationIndex = useMemo(() => createPointSpatialIndex(points), [points])
  const bounds = useMemo(() => selectionBounds(points), [points])

  useEffect(() => {
    if (!container.current) return
    let globe: GlobeMap
    try {
      setWorkerUrl(workerUrl)
      globe = new GlobeMap({
        container: container.current,
        style: globeStyle(initialDark.current),
        center: [0, 18],
        zoom: .2,
        minZoom: -1,
        maxZoom: 16,
        maxPitch: 60,
        attributionControl: false,
        trackResize: false,
      })
    } catch (error) {
      console.warn('Could not initialize globe view', error)
      onUnavailable()
      return
    }
    const lost = () => onUnavailable()
    const startupError = ({ error }: { error: { message: string } }) => {
      console.warn('Could not load globe view', error.message)
      onUnavailable()
    }
    globe.on('webglcontextlost', lost)
    globe.on('error', startupError)
    globe.once('load', () => { globe.off('error', startupError); setMap(globe) })
    return () => { globe.remove() }
  }, [onUnavailable])

  const fit = useCallback((overview = false, keepCenter = false) => {
    if (!map || !active) return
    const container = map.getContainer()
    const { clientWidth: width, clientHeight: height } = container
    if (!width || !height) return
    const sidebar = container.closest('.workspace')?.querySelector('.sidebar')
    const divider = (sidebar?.getBoundingClientRect().right ?? 0) - container.getBoundingClientRect().left
    const padding = width > 680
      ? { top: 60, bottom: 43, left: Math.min(divider + 24, width * .55), right: 62 }
      : { top: 26, bottom: Math.min(110, height * .25), left: 16, right: 16 }
    const [[west, south], [east, north]] = bounds ?? [[-180, -60], [180, 96]]
    if (overview || east - west > 135 || north - south > 100) {
      const available = Math.min(width - padding.left - padding.right, height - padding.top - padding.bottom)
      const zoom = Math.max(-1, Math.min(2.2, Math.log2(Math.max(1, available * .86) / 250)))
      map.jumpTo({
        center: keepCenter ? map.getCenter() : [(west + east) / 2, Math.max(-60, Math.min(60, (south + north) / 2))],
        zoom, padding, bearing: 0, pitch: 0,
      })
      return
    }
    if (west === east && south === north) {
      map.jumpTo({ center: [west, south], zoom: 12, padding, bearing: 0, pitch: 0 })
      return
    }
    map.fitBounds(bounds!, { padding, maxZoom: 13, duration: 0, bearing: 0, pitch: 0 })
  }, [map, bounds, active])

  const lastOverview = useRef<{ points: TimelinePoint[]; width: number; height: number; zoom: number } | null>(null)
  useEffect(() => {
    if (!map || !active || !container.current) return
    const resize = () => {
      if (!container.current) return
      const { clientWidth: width, clientHeight: height } = container.current
      if (!width || !height) return
      const previous = lastOverview.current
      const newSelection = !previous || previous.points !== points
      const resizeOverview = previous && (previous.width !== width || previous.height !== height) && Math.abs(map.getZoom() - previous.zoom) < .001
      map.resize()
      if (newSelection || resizeOverview) {
        fit(true, !newSelection)
        lastOverview.current = { points, width, height, zoom: map.getZoom() }
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container.current)
    resize()
    return () => observer.disconnect()
  }, [map, active, points, fit])

  useEffect(() => { map?.getSource<GeoJSONSource>('routes')?.setData(routes) }, [map, routes])
  useEffect(() => {
    if (!map || !active) return
    const source = map.getSource<GeoJSONSource>('observations')
    if (!source) return
    let hasObservations = true
    const update = () => {
      const zoom = map.getZoom()
      if (zoom < GLOBE_POINTS_MIN_ZOOM) {
        if (hasObservations) source.setData(empty)
        hasObservations = false
        return
      }
      const view = map.getBounds()
      const west = view.getWest()
      const east = view.getEast() < west ? view.getEast() + 360 : view.getEast()
      const padLng = (east - west) * .1
      const padLat = (view.getNorth() - view.getSouth()) * .1
      const rects = worldRectsForBounds({
        west: west - padLng,
        east: east + padLng,
        north: view.getNorth() + padLat,
        south: view.getSouth() - padLat,
      })
      const visible = observationIndex.sample(rects, 5 / (512 * 2 ** zoom))
      source.setData(globePoints(visible))
      hasObservations = visible.length > 0
    }
    // Refresh after camera motion to avoid rebuilding the GeoJSON on every frame.
    map.on('moveend', update)
    update()
    return () => { map.off('moveend', update) }
  }, [map, active, observationIndex])
  useEffect(() => {
    map?.getSource<GeoJSONSource>('selected')?.setData(selectedPoint ? globePoints([selectedPoint]) : empty)
    if (selectedPoint && active) map?.jumpTo({ center: [selectedPoint.lng, selectedPoint.lat] })
  }, [map, selectedPoint, active])
  useEffect(() => {
    if (!map) return
    const select = (event: { point: { x: number; y: number } }) => {
      if (map.getZoom() < GLOBE_POINTS_MIN_ZOOM) {
        onSelect(null)
        return
      }
      const { x, y } = event.point
      const features = map.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]], { layers: ['points'] })
      onSelect(features[0]?.properties.id ?? null)
    }
    map.on('click', select)
    return () => { map.off('click', select) }
  }, [map, onSelect])
  useEffect(() => {
    if (!map) return
    const colors = globeColors(isDark)
    map.setPaintProperty('ocean', 'background-color', colors.ocean)
    map.setPaintProperty('land', 'fill-color', colors.land)
    map.setPaintProperty('boundaries', 'line-color', colors.boundary)
    map.setPaintProperty('ground', 'line-color', colors.route)
    map.setPaintProperty('flights', 'line-color', colors.route)
    map.setPaintProperty('points', 'circle-color', colors.point)
    map.setPaintProperty('highlight', 'circle-color', colors.selected)
    map.setPaintProperty('highlight', 'circle-stroke-color', colors.ocean)
  }, [map, isDark])

  return <>
    <div ref={container} className="globe-view" />
    {!map && <p className="globe-status" role="status">{t.loadingGlobe}</p>}
    {map && <>
      <div className="map-zoom-controls globe-zoom-controls">
        <button type="button" aria-label={t.fitSelection} title={t.fitSelection} disabled={!bounds} onClick={() => fit()}><Icon name="fit" /></button>
        <button className="map-zoom-step" type="button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => map.zoomIn()}><Icon name="plus" /></button>
        <button className="map-zoom-step" type="button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => map.zoomOut()}><Icon name="minus" /></button>
      </div>
      <a className="globe-credit" href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>
    </>}
  </>
}
