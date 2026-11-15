import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCityHeatCells } from '../src/cityHeatmap.ts'
import type { TimelinePoint } from '../src/timeline.ts'

const point = (id: string, timestamp: string, lng = 10.75): TimelinePoint => ({
  id, timestamp, lat: 59.92, lng, kind: 'path', label: 'Route point',
})

test('heatmap counts distinct local days per area and honors the selected period', () => {
  const points = [
    point('one', '2024-12-31T22:30:00Z'),
    point('two', '2024-12-31T23:30:00Z'),
    point('three', '2025-01-01T00:30:00Z'),
    point('another area', '2025-01-01T00:30:00Z', 10.85),
  ]
  const days = ['2024-12-31', '2025-01-01']
  assert.deepEqual(buildCityHeatCells(points, days).map(cell => cell.days), [2, 1])
  assert.deepEqual(buildCityHeatCells(points, ['2025-01-01']).map(cell => cell.days), [1, 1])
  assert.deepEqual(buildCityHeatCells(points, ['2025-01-02']), [])
})

test('heatmap counts all included days of a recorded stay, even with one coordinate', () => {
  const stay: TimelinePoint = {
    ...point('stay', '2024-12-31T18:00:00Z'),
    kind: 'visit',
    endTimestamp: '2025-01-02T14:00:00Z',
  }
  assert.equal(buildCityHeatCells([stay], ['2024-12-31', '2025-01-01', '2025-01-02'])[0]?.days, 3)
  assert.equal(buildCityHeatCells([stay], ['2025-01-01', '2025-01-02'])[0]?.days, 2)
})
