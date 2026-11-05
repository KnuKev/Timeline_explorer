import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PointList, { type PointGroup } from '../src/PointList.tsx'
import type { TimelinePoint } from '../src/timeline.ts'

const points: TimelinePoint[] = Array.from({ length: 200 }, (_, index) => ({
  id: `point-${index}`, kind: 'path', label: 'Rutepunkt', lat: 59.9, lng: 10.7,
  timestamp: new Date(Date.UTC(2025, 0, 1, 12, index)).toISOString(),
}))
const render = (groups: PointGroup[], expanded = true, selectedPointId: string | null = null) => renderToStaticMarkup(createElement(PointList, {
  groups, expanded, selectedPointId, onSelect: () => {}, language: 'en',
}))
const rows = (html: string) => (html.match(/class="point-row\b/g) ?? []).length

test('opening a years-long point list mounts bounded headers and no collapsed point rows', () => {
  const groups = Array.from({ length: 2_000 }, (_, day) => ({ day: new Date(Date.UTC(2020, 0, day + 1)).toISOString().slice(0, 10), points }))
  const html = render(groups)
  assert.equal((html.match(/<details\b/g) ?? []).length, 30)
  assert.equal(rows(html), 0)
  assert.ok(html.includes('Browse days'))
  assert.ok(html.includes('Next'))
})

test('one day opens immediately with a bounded, navigable page and selection state', () => {
  const html = render([{ day: '2025-01-01', points }], true, 'point-5')
  assert.equal(rows(html), 80)
  assert.ok(html.includes('Browse points'))
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1)
})

test('collapsing the outer list unmounts point rows while preserving its disclosure target', () => {
  const html = render([{ day: '2025-01-01', points }], false)
  assert.ok(html.includes('id="point-list"'))
  assert.ok(html.includes('hidden'))
  assert.equal(rows(html), 0)
  assert.ok(!html.includes('<details'))
})

test('visit rows show both ends of a multi-day visit, including when grouped under a later day', () => {
  const visit: TimelinePoint = { ...points[0]!, kind: 'visit', label: 'Hotel', timestamp: '2025-01-01T12:00:00Z', endTimestamp: '2025-01-03T12:00:00Z' }
  const html = render([{ day: '2025-01-02', points: [visit] }])
  assert.equal(rows(html), 1)
  assert.match(html, /1 Jan 2025/)
  assert.match(html, /3 Jan 2025/)
})
