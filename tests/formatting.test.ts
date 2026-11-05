import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCalendarDate, formatDistance, formatPlaceDate, formatPointDateTime, formatPointInterval } from '../src/formatting.ts'
import type { TimelinePoint } from '../src/timeline.ts'

test('point formatting follows the recorded location timezone instead of the machine timezone', () => {
  const instant = '2025-01-01T23:30:00Z'
  assert.match(formatPointDateTime(instant, 28.46, -16.25, 'en-GB'), /1 Jan 2025.*23:30/)
  assert.match(formatPointDateTime(instant, 46.62, 14.3, 'en-GB'), /2 Jan 2025.*00:30/)
})

test('a recorded visit shows both arrival and departure dates', () => {
  const visit: TimelinePoint = { id: 'stay', kind: 'visit', label: 'Hotel', lat: 28.46, lng: -16.25, timestamp: '2025-01-10T12:00:00Z', endTimestamp: '2025-01-13T14:00:00Z' }
  const formatted = formatPointInterval(visit, 'en-GB')
  assert.match(formatted, /10 Jan 2025/)
  assert.match(formatted, /13 Jan 2025/)
  assert.match(formatted, /12:00/)
  assert.match(formatted, /14:00/)
  assert.equal(formatPointInterval({ ...visit, endTimestamp: 'invalid' }, 'en-GB'), formatPointDateTime(visit.timestamp, visit.lat, visit.lng, 'en-GB'))
})

test('empty or malformed calendar values do not crash rendering', () => {
  for (const date of ['', '2025-02-30', 'invalid']) {
    assert.equal(formatPlaceDate(date, 'en-GB'), '—')
    assert.equal(formatCalendarDate(date, 'nb-NO'), '—')
  }
  assert.equal(formatPointDateTime('invalid', 0, 0, 'en-GB'), '—')
  assert.match(formatCalendarDate('2025-01-01', 'en-GB'), /Wednesday.*1 January 2025/)
})

test('distance formatting respects locale and invalid values', () => {
  assert.equal(formatDistance(0.125, 'en-GB'), '125 m')
  assert.equal(formatDistance(1234.5, 'en-GB'), '1,234.5 km')
  assert.match(formatDistance(1.5, 'nb-NO'), /1,5 km/)
  assert.equal(formatDistance(NaN, 'en-GB'), '—')
})
