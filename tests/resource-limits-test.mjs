import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { mock } from 'node:test'
import { limits as sourceLimits } from '../server/config.ts'
import { limits, loadLimits } from '../dist-server/server/config.js'
import { RateLimiter } from '../dist-server/server/RateLimiter.js'
import { clientIp } from '../dist-server/server/clientIp.js'
import { GameManager } from '../dist-server/server/game/GameManager.js'

const defaults = JSON.parse(readFileSync('config/limits.json', 'utf8'))
assert.deepEqual(limits, defaults)
assert.deepEqual(sourceLimits, limits)
assert.ok(Object.isFrozen(limits))
const directory = mkdtempSync(join(tmpdir(), 'penjat-limits-')), path = join(directory, 'limits.json')
const variables = {
  maxRooms: ['PENJAT_MAX_ROOMS', 100_000], roomCreationRequests: ['PENJAT_ROOM_CREATION_REQUESTS', 1_000_000],
  roomCreationWindowSeconds: ['PENJAT_ROOM_CREATION_WINDOW_SECONDS', 86_400], roomPreviewRequests: ['PENJAT_ROOM_PREVIEW_REQUESTS', 1_000_000],
  roomPreviewWindowSeconds: ['PENJAT_ROOM_PREVIEW_WINDOW_SECONDS', 86_400], rateLimiterMaxEntries: ['PENJAT_RATE_LIMITER_MAX_ENTRIES', 1_000_000],
}
try {
  const save = (value) => writeFileSync(path, JSON.stringify(value))
  save(defaults)
  assert.deepEqual(loadLimits(path, {}), defaults)
  for (const [key, [variable, max]] of Object.entries(variables)) {
    for (const value of ['1', String(max)]) {
      save({ ...defaults, [key]: Number(value) })
      assert.equal(loadLimits(path, {})[key], Number(value))
      save(defaults)
      assert.equal(loadLimits(path, { [variable]: value })[key], Number(value))
    }
    for (const value of ['', ' ', ' 2', '2 ', '+2', '-1', '0', '1.5', '1e2', '0x10', 'Infinity', 'NaN', '2x', String(max + 1), '9007199254740993']) {
      assert.throws(() => loadLimits(path, { [variable]: value }), new RegExp(variable))
    }
    for (const value of [null, true, '2', 0, -1, 1.1, max + 1, {}, []]) {
      save({ ...defaults, [key]: value })
      assert.throws(() => loadLimits(path, { [variable]: '2' }), new RegExp(key))
    }
    const missing = { ...defaults }; delete missing[key]; save(missing)
    assert.throws(() => loadLimits(path, {}), new RegExp(key))
  }
  for (const value of [[], null, 2, { ...defaults, typo: 5 }]) { save(value); assert.throws(() => loadLimits(path, {}), /Invalid Penjat limits/) }
  writeFileSync(path, '{broken'); assert.throws(() => loadLimits(path, {}), /Invalid Penjat limits/)
  assert.throws(() => loadLimits(join(directory, 'missing'), {}), /Invalid Penjat limits.*ENOENT/)
  const startup = spawnSync(process.execPath, ['dist-server/server/server.js'], { env: { ...process.env, PENJAT_MAX_ROOMS: 'bad' }, encoding: 'utf8' })
  assert.notEqual(startup.status, 0); assert.match(startup.stderr, /PENJAT_MAX_ROOMS must contain/)
} finally { rmSync(directory, { recursive: true, force: true }) }

// Inclusive request boundary, exact expiry, per-IP separation, bounded storage, no eviction or extended rejection windows.
let now = 0
mock.timers.enable({ apis: ['setInterval'] })
const limiter = new RateLimiter(2, 1000, 2, () => now)
try {
  assert.equal(limiter.consume('a').allowed, true); assert.equal(limiter.consume('a').allowed, true)
  now = 999; assert.deepEqual(limiter.consume('a'), { allowed: false, retryAfterSeconds: 1 })
  assert.equal(limiter.consume('b').allowed, true)
  assert.equal(limiter.consume('c').allowed, false); assert.equal(limiter.size, 2)
  now = 1000; assert.equal(limiter.consume('c').allowed, true); assert.equal(limiter.size, 2)
  assert.equal(limiter.consume('b').allowed, true); assert.equal(limiter.consume('b').allowed, false)
  now = 2000; mock.timers.tick(1000)
  assert.equal(limiter.size, 0, 'automatic cleanup without new traffic')
  assert.equal(limiter.consume('a').allowed, true)
} finally { limiter.close(); mock.timers.reset() }

const request = (headers, remoteAddress = '::ffff:127.0.0.1') => ({ headers, socket: { remoteAddress } })
for (const headers of [{}, { 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '8.8.8.8', 'x-real-ip': '9.9.9.9' }]) {
  assert.equal(clientIp(request(headers), false), '127.0.0.1')
}
assert.equal(clientIp(request({ 'cf-connecting-ip': '203.0.113.2', 'x-forwarded-for': 'fake, 1.2.3.4' }), true), '203.0.113.2')
for (const value of [undefined, 'garbage', '1.2.3.4, 8.8.8.8', ['1.2.3.4'], 'fe80::1%eth0']) {
  assert.equal(clientIp(request({ 'cf-connecting-ip': value, 'x-forwarded-for': '8.8.8.8' }), true), '127.0.0.1')
}
assert.equal(clientIp(request({ 'cf-connecting-ip': '2001:0db8:0:0:0:0:0:1' }), true), '2001:db8::1')
assert.equal(clientIp(request({ 'cf-connecting-ip': '::ffff:c000:201' }), true), '192.0.2.1')

// Capacity rejects before releasing a seat. A solo replacement fits; retained rooms count until expiry.
let expire
const games = new GameManager(() => 0, { maxRooms: 1, scheduler: { setTimeout: (callback, ms) => { if (ms === 1000) expire = callback; return callback }, clearTimeout: () => {} }, emptyRoomTtlMs: 1000 })
const first = games.create('a', 'Ana', 'ca', 1)
const replacement = games.create('a', 'Ana', 'ca', 1)
assert.equal(games.rooms.size, 1); assert.equal(games.rooms.has(first.room.code), false)
const guest = games.join('b', 'Biel', replacement.room.code)
assert.throws(() => games.create('a', 'Ana', 'ca', 1), /room-capacity-reached/)
assert.equal(games.identityForSocket('a').playerId, replacement.playerId)
games.markReconnecting('a'); games.markReconnecting('b')
assert.throws(() => games.create('c', 'Cesc', 'ca', 1), /room-capacity-reached/)
games.resume('b2', replacement.room.code, guest.playerId, guest.reconnectToken)
assert.equal(games.rooms.size, 1)
games.markReconnecting('b2'); expire()
assert.equal(games.rooms.size, 0)
const next = games.create('c', 'Cesc', 'ca', 1)
games.leaveSocket('c'); assert.equal(games.rooms.size, 0)
assert.throws(() => games.resume('c2', next.room.code, next.playerId, next.reconnectToken), /room-not-found/)
console.log('Resource configuration, limiter, IP and room-capacity tests passed')
