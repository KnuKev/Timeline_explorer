import { formatPointDateTime, formatPointInterval } from './formatting.ts'
import { locales, pointLabel, translations, type Language } from './i18n.ts'
import { longitudeNear } from './mapSpatial.ts'
import { buildRouteSegments, type RouteSegment } from './routes.ts'
import type { TimelinePoint } from './timeline.ts'

export const exportFormats = ['kml', 'gpx', 'geojson'] as const
export type ExportFormat = typeof exportFormats[number]

type Vertex = Pick<TimelinePoint, 'lat' | 'lng'> & { timestamp?: string }
type ExportRoute = { segment: RouteSegment; paths: Vertex[][] }
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n'
const mimeTypes: Record<ExportFormat, string> = {
  kml: 'application/vnd.google-earth.kml+xml',
  gpx: 'application/gpx+xml',
  geojson: 'application/geo+json',
}
const xmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

function escapeXml(value: string): string {
  // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters.
  return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '').replace(/[&<>"']/g, character => xmlEntities[character]!)
}

function splitAtDateLine(points: TimelinePoint[]): Vertex[][] {
  const paths: Vertex[][] = []
  let path: Vertex[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!
    const next = points[i]!
    const nearby = longitudeNear(next.lng, previous.lng)
    if (nearby !== next.lng) {
      const boundary = previous.lng >= 0 ? 180 : -180
      const span = nearby - previous.lng
      const fraction = span === 0 ? 1 : (boundary - previous.lng) / span
      const lat = previous.lat + (next.lat - previous.lat) * fraction
      if (fraction > 0) path.push({ lng: boundary, lat, timestamp: fraction === 1 ? next.timestamp : undefined })
      if (path.length >= 2) paths.push(path)
      path = fraction < 1 ? [{ lng: -boundary, lat, timestamp: fraction === 0 ? previous.timestamp : undefined }] : []
    }
    path.push(next)
  }
  if (path.length >= 2) paths.push(path)
  return paths
}

const coordinates = ({ lng, lat }: Vertex) => [lng, lat]
const routeName = (segment: RouteSegment, language: Language) =>
  segment.transport === 'flight' ? translations[language].flightRoute : translations[language].route

const kmlFolders = {
  nb: { route: 'Ruter', flight: 'Flyreiser', visit: 'Besøkte steder', point: 'Andre posisjonspunkter' },
  en: { route: 'Routes', flight: 'Flights', visit: 'Visited places', point: 'Other location points' },
}
const kmlMarkerIcon = 'https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png'

function* kml(routes: ExportRoute[], markers: TimelinePoint[], language: Language) {
  const folders = kmlFolders[language]
  const locale = locales[language]
  yield xmlHeader + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Timeline Explorer</name>\n'
  yield '<Style id="route"><LineStyle><color>ffe87418</color><width>3</width></LineStyle></Style>\n'
  yield '<Style id="flight"><LineStyle><color>bff266aa</color><width>2.5</width></LineStyle></Style>\n'
  if (markers.length) {
    yield `<Style id="visit"><IconStyle><scale>0.55</scale><Icon><href>${kmlMarkerIcon}</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>\n`
    yield `<Style id="point"><IconStyle><scale>0.4</scale><Icon><href>${kmlMarkerIcon}</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>\n`
  }

  for (const style of ['route', 'flight'] as const) {
    const group = routes.filter(({ segment }) => (segment.transport ?? 'route') === style)
    if (!group.length) continue
    yield `<Folder><name>${folders[style]}</name><open>0</open>\n`
    for (const { segment, paths } of group) {
      const first = segment.points[0]!
      const last = segment.points.at(-1)!
      const date = formatPointDateTime(first.timestamp, first.lat, first.lng, locale)
      yield `<Placemark><name>${escapeXml(`${routeName(segment, language)} · ${date}`)}</name><styleUrl>#${style}</styleUrl>`
      yield `<ExtendedData><Data name="start"><value>${first.timestamp}</value></Data><Data name="end"><value>${last.timestamp}</value></Data></ExtendedData><MultiGeometry>`
      for (const path of paths) {
        yield `<LineString><tessellate>1</tessellate><coordinates>${path.map(point => coordinates(point).join(',')).join(' ')}</coordinates></LineString>`
      }
      yield '</MultiGeometry></Placemark>\n'
    }
    yield '</Folder>\n'
  }

  for (const style of ['visit', 'point'] as const) {
    const group = markers.filter(point => (point.kind === 'visit' ? 'visit' : 'point') === style)
    if (!group.length) continue
    yield `<Folder><name>${folders[style]}</name><open>0</open>\n`
    for (const point of group) {
      const label = pointLabel(point, language)
      const date = formatPointDateTime(point.timestamp, point.lat, point.lng, locale)
      const interval = formatPointInterval(point, locale, true)
      const time = point.endTimestamp && point.endTimestamp > point.timestamp
        ? `<TimeSpan><begin>${point.timestamp}</begin><end>${point.endTimestamp}</end></TimeSpan>`
        : `<TimeStamp><when>${point.timestamp}</when></TimeStamp>`
      yield `<Placemark><name>${escapeXml(`${label} · ${date}`)}</name><description>${escapeXml(interval)}</description>${time}<styleUrl>#${style}</styleUrl><Point><coordinates>${coordinates(point).join(',')}</coordinates></Point></Placemark>\n`
    }
    yield '</Folder>\n'
  }
  yield '</Document></kml>\n'
}

function gpxPoint(point: Vertex, tag: 'wpt' | 'trkpt', name?: string): string {
  // GPX 1.1 excludes positive 180 and requires decimal notation.
  const longitude = Math.min(point.lng, 179.9999999999).toFixed(10)
  const latitude = point.lat.toFixed(10)
  const time = point.timestamp ? `<time>${point.timestamp}</time>` : ''
  return `<${tag} lat="${latitude}" lon="${longitude}">${time}${name ? `<name>${escapeXml(name)}</name>` : ''}</${tag}>`
}

function* gpx(routes: ExportRoute[], markers: TimelinePoint[], language: Language) {
  yield xmlHeader + '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Timeline Explorer">\n'
  for (const point of markers) yield gpxPoint(point, 'wpt', pointLabel(point, language)) + '\n'
  for (const { segment, paths } of routes) {
    yield `<trk><name>${routeName(segment, language)}</name>`
    for (const path of paths) yield '<trkseg>' + path.map(point => gpxPoint(point, 'trkpt')).join('') + '</trkseg>'
    yield '</trk>\n'
  }
  yield '</gpx>\n'
}

function* geojson(routes: ExportRoute[], markers: TimelinePoint[], language: Language) {
  yield '{"type":"FeatureCollection","features":[\n'
  let separator = ''
  for (const { segment, paths } of routes) {
    const lines = paths.map(path => path.map(coordinates))
    const times = paths.map(path => path.map(point => point.timestamp ?? null))
    const geometry = lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines }
    yield separator + JSON.stringify({
      type: 'Feature', geometry, properties: {
        name: routeName(segment, language), estimated: Boolean(segment.estimated),
        transport: segment.transport, timestamps: times.length === 1 ? times[0] : times,
      },
    })
    separator = ',\n'
  }
  for (const point of markers) {
    yield separator + JSON.stringify({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: coordinates(point) },
      properties: { name: pointLabel(point, language), kind: point.kind, timestamp: point.timestamp, endTimestamp: point.endTimestamp },
    })
    separator = ',\n'
  }
  yield '\n]}\n'
}

const serialize = { kml, gpx, geojson }

export function exportTimeline(format: ExportFormat, points: TimelinePoint[], source: TimelinePoint[], language: Language): Blob {
  const { segments } = buildRouteSegments(points, source)
  const connected = new Set<TimelinePoint>()
  const routes = segments.flatMap(segment => {
    const paths = splitAtDateLine(segment.points)
    if (!paths.length) return []
    for (const point of segment.points) connected.add(point)
    return [{ segment, paths }]
  })
  const markers = points.filter(point => point.kind === 'visit' || !connected.has(point))
  return new Blob([...serialize[format](routes, markers, language)], { type: mimeTypes[format] })
}
