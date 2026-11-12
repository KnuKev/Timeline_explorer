import assert from 'node:assert/strict'
import test from 'node:test'
import type { TimelinePoint } from '../src/timeline.ts'
import { exportTimeline } from '../src/timelineExport.ts'

test('exports preserve disconnected observations and split a flight at the date line', async () => {
  const origin: TimelinePoint = { id: 'LAX', kind: 'path', label: 'Route point', lat: 33.94, lng: -118.41, timestamp: '2025-01-01T18:00:00.000Z' }
  const destination: TimelinePoint = { ...origin, id: 'HND', lat: 35.55, lng: 139.78, timestamp: '2025-01-02T05:30:00.000Z' }
  const visit: TimelinePoint = { ...destination, id: 'visit', kind: 'visit', label: 'Café & <tea>\u0000', timestamp: '2025-01-05T09:00:00.000Z', endTimestamp: '2025-01-05T10:00:00.000Z' }
  const points = [origin, destination, visit]

  const geojson = JSON.parse(await exportTimeline('geojson', points, points, 'en').text())
  const [flight, stay] = geojson.features
  assert.equal(flight.properties.transport, 'flight')
  assert.equal(flight.geometry.type, 'MultiLineString')
  const [west, east] = flight.geometry.coordinates
  assert.deepEqual(west[0], [origin.lng, origin.lat])
  assert.equal(west[1][0], -180)
  assert.deepEqual(east[0], [180, west[1][1]])
  assert.deepEqual(east[1], [destination.lng, destination.lat])
  assert.deepEqual(flight.properties.timestamps, [[origin.timestamp, null], [null, destination.timestamp]])
  assert.equal(stay.geometry.type, 'Point')
  assert.equal(stay.properties.endTimestamp, visit.endTimestamp)

  const kml = await exportTimeline('kml', points, points, 'en').text()
  assert.match(kml, /<styleUrl>#flight<\/styleUrl>/)
  assert.equal(kml.split('<LineString>').length - 1, 2)
  assert.match(kml, /<Folder><name>Flights<\/name><open>0<\/open>/)
  assert.match(kml, /<name>Flight · 1 Jan 2025/)
  assert.match(kml, /<Folder><name>Visited places<\/name><open>0<\/open>/)
  assert.match(kml, /Café &amp; &lt;tea&gt; · [^<]+<\/name><description>[^<]+<\/description><TimeSpan>/)
  assert.match(kml, /<Point><coordinates>139.78,35.55<\/coordinates><\/Point>/)

  const gpx = await exportTimeline('gpx', points, points, 'en').text()
  assert.equal(gpx.split('<trkseg>').length - 1, 2)
  assert.match(gpx, /lon="179\.9999999999"/)
  assert.match(gpx, /<time>2025-01-02T05:30:00.000Z<\/time>/)
  assert.match(gpx, /<wpt[^>]+><time>[^<]+<\/time><name>Café &amp; &lt;tea&gt;<\/name>/)
})

test('the export does not bridge unselected points', async () => {
  const points: TimelinePoint[] = [1, 2, 3].map(hour => ({
    id: String(hour), kind: 'path', label: 'Route point', lat: 59, lng: 10 + hour / 100,
    timestamp: `2025-01-01T0${hour}:00:00.000Z`,
  }))
  const file = JSON.parse(await exportTimeline('geojson', [points[0]!, points[2]!], points, 'en').text())
  assert.deepEqual(file.features.map((feature: { geometry: { type: string } }) => feature.geometry.type), ['Point', 'Point'])
})
