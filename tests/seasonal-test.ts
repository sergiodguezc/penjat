import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { getSeason } from '../src/seasonal/config'
import { installSeason } from '../src/seasonal/runtime'

for (const [instant, expected] of [
  ['2026-10-24T22:00:00Z', null], // Before the autumn DST change.
  ['2026-10-25T22:59:59.999Z', null],
  ['2026-10-25T23:00:00Z', 'spooky'], // October 26, 00:00 Madrid (CET).
  ['2026-10-31T12:00:00Z', 'spooky'],
  ['2026-11-08T22:59:59.999Z', 'spooky'],
  ['2026-11-08T23:00:00Z', null], // November 9, 00:00 Madrid.
  ['2027-10-31T12:00:00Z', null], // This campaign is explicitly for 2026.
] as const) assert.equal(getSeason(new Date(instant)), expected, instant)
assert.equal(getSeason(new Date('2026-07-01'), 'spooky'), 'spooky')
assert.equal(getSeason(new Date('2026-10-31'), 'none'), null)
assert.equal(getSeason(new Date('2026-10-31'), 'unknown'), 'spooky')
assert.equal(getSeason(new Date('2026-07-01'), 'auto'), null)

// An already-open tab must switch at midnight and catch up after being suspended.
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-10-25T22:59:59Z') })
const browserWindow = Object.assign(new EventTarget(), { setTimeout, clearTimeout })
const browserDocument = Object.assign(new EventTarget(), { documentElement: { dataset: {} as Record<string, string> } })
Object.defineProperty(globalThis, 'window', { configurable: true, value: browserWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: browserDocument })
try {
  const dispose = installSeason()
  assert.equal(browserDocument.documentElement.dataset.season, undefined)
  mock.timers.tick(1000)
  assert.equal(browserDocument.documentElement.dataset.season, 'spooky')
  mock.timers.setTime(new Date('2026-11-08T23:00:00Z').getTime())
  browserDocument.dispatchEvent(new Event('visibilitychange'))
  assert.equal(browserDocument.documentElement.dataset.season, undefined)
  mock.timers.setTime(new Date('2026-10-31T12:00:00Z').getTime())
  browserWindow.dispatchEvent(new Event('focus'))
  assert.equal(browserDocument.documentElement.dataset.season, 'spooky')
  dispose()
  mock.timers.setTime(new Date('2026-11-09T12:00:00Z').getTime())
  mock.timers.tick(60_000)
  browserWindow.dispatchEvent(new Event('focus'))
  assert.equal(browserDocument.documentElement.dataset.season, 'spooky', 'disposal removes timers and listeners')
  const disable = installSeason('none')
  assert.equal(browserDocument.documentElement.dataset.season, undefined)
  disable()
  mock.timers.setTime(new Date('2026-11-08T22:59:59Z').getTime())
  const endCampaign = installSeason()
  assert.equal(browserDocument.documentElement.dataset.season, 'spooky')
  mock.timers.tick(1000)
  assert.equal(browserDocument.documentElement.dataset.season, undefined, 'an open tab restores the default at midnight on November 9')
  endCampaign()
} finally {
  mock.timers.reset()
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
  else Reflect.deleteProperty(globalThis, 'document')
}
console.log('Madrid seasonal boundaries, overrides, live rollover and cleanup passed')
