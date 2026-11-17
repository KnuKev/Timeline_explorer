import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalClock } from '../src/localClock.ts'

test('local clock preserves calendar boundaries and fractional-offset time zones', () => {
  const clock = createLocalClock()
  const time = Date.parse('2025-12-31T23:45:37.999Z')
  assert.deepEqual(clock(time, 'America/Los_Angeles'), { date: '2025-12-31', hour: 15, minute: 45, second: 37 })
  assert.deepEqual(clock(time, 'Asia/Tokyo'), { date: '2026-01-01', hour: 8, minute: 45, second: 37 })
  assert.deepEqual(clock(time, 'Asia/Kathmandu'), { date: '2026-01-01', hour: 5, minute: 30, second: 37 })
  assert.deepEqual(clock(Date.parse('2024-02-29T00:00:00Z'), 'UTC'), { date: '2024-02-29', hour: 0, minute: 0, second: 0 })
})

test('local clock handles skipped and repeated hours across daylight saving changes', () => {
  const clock = createLocalClock()
  assert.deepEqual(clock(Date.parse('2025-03-30T00:59:59Z'), 'Europe/Oslo'), { date: '2025-03-30', hour: 1, minute: 59, second: 59 })
  assert.deepEqual(clock(Date.parse('2025-03-30T01:00:00Z'), 'Europe/Oslo'), { date: '2025-03-30', hour: 3, minute: 0, second: 0 })
  for (const time of ['2025-10-26T00:30:00Z', '2025-10-26T01:30:00Z']) {
    assert.deepEqual(clock(Date.parse(time), 'Europe/Oslo'), { date: '2025-10-26', hour: 2, minute: 30, second: 0 })
  }
})

test('fast local clock matches Intl parts in every supported time zone, including fallback years', () => {
  const clock = createLocalClock()
  const instants = ['0024-01-02T03:04:05Z', '1969-12-31T23:59:59.999Z', '2024-02-29T23:45:00Z', '2025-06-30T00:00:00Z', '2025-12-31T23:59:59Z'].map(Date.parse)
  for (const zone of Intl.supportedValuesOf('timeZone')) {
    const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    for (const time of instants) {
      const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]))
      assert.deepEqual(clock(time, zone), { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) }, `${zone} at ${time}`)
    }
  }
})
