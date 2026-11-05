import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_HOME_RADIUS_KM, HOME_RADIUS_OPTIONS, normalizeHomeRadius } from '../src/tripSettings.ts'

test('home-area settings preserve valid preset and detailed analysis radii', () => {
  for (const radius of HOME_RADIUS_OPTIONS) assert.equal(normalizeHomeRadius(radius), radius)
  assert.equal(normalizeHomeRadius('25'), 25)
  assert.equal(normalizeHomeRadius(0.3), 0.3)
  assert.equal(normalizeHomeRadius(100), 100)
})

test('invalid radius values cannot silently remove or infinitely expand the home area', () => {
  for (const value of [undefined, null, '', '   ', 'invalid', false, NaN, Infinity, -5, 0, 0.29, 101, {}, []]) {
    assert.equal(normalizeHomeRadius(value), DEFAULT_HOME_RADIUS_KM)
  }
})
