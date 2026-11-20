import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { analyseAdministrativeAreas, areaDatasets, hasAreaDataset } from '../src/administrativeAreas.ts'
import type { TimelinePoint } from '../src/timeline.ts'

const point = (id: string, lat: number, lng: number, timestamp = '2025-06-01T12:00:00Z'): TimelinePoint =>
  ({ id, lat, lng, timestamp, kind: 'path', label: '' })

test('each published administrative dataset exists and retains source and licence metadata', () => {
  for (const [code, entry] of Object.entries(areaDatasets)) {
    assert.ok(existsSync(new URL(`../public/areas/${code}.json.gz`, import.meta.url)), code)
    assert.ok(entry.source && entry.url && entry.level && entry.license, code)
    assert.equal(hasAreaDataset(code), true)
  }
  assert.equal(hasAreaDataset('ZZ'), false)
})

test('Norwegian passing points count once per local day inside their actual municipality', () => {
  const boundaries = JSON.parse(gunzipSync(readFileSync(new URL('../public/areas/NO.json.gz', import.meta.url))).toString())
  const points = [point('sandvika', 59.89, 10.525), point('lysaker', 59.913, 10.639),
    point('skoyen', 59.923, 10.681), point('next-day', 59.89, 10.525, '2025-06-01T23:00:00Z')]
  const result = analyseAdministrativeAreas(points, 'NO', boundaries)
  assert.deepEqual(result.map(entry => [entry.name, entry.days, entry.pointIds]), [
    ['Bærum', 2, ['sandvika', 'lysaker', 'next-day']], ['Oslo', 1, ['skoyen']],
  ])
})

test('local areas require polygon containment and break ties at shared borders deterministically', () => {
  const square = (id: string, west: number, east: number) => ({
    id, properties: { name: id }, geometry: { type: 'Polygon', coordinates: [[[west, 0], [east, 0], [east, 1], [west, 1], [west, 0]]] },
  })
  const result = analyseAdministrativeAreas([point('edge', .5, 1), point('outside', -.001, .5)], 'GB', [square('A', 0, 1), square('B', 1, 2)])
  assert.deepEqual(result.map(entry => [entry.name, entry.pointIds]), [['A', ['edge']]])
})
