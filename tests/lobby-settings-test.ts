// Lobby match settings against the built server (run `npm run build:server` first): a room created with only a name
// gets the defaults; only the current host changes settings, only before the match; every member receives each change;
// the match starts with the confirmed settings; a new host can edit and a returning player sees the current values.
import assert from 'node:assert/strict'
import { io, type Socket } from 'socket.io-client'
import { DEFAULT_VOLTES, type PlayerGameView, type RoomSession } from '../shared/protocol'

const PORT = 3231
process.env.PORT = String(PORT); process.env.HOST = '127.0.0.1'
const { httpServer, games } = await import('../dist-server/server/server.js')
await new Promise((resolve) => httpServer.listening ? resolve(null) : httpServer.once('listening', resolve))

type Reply<T = undefined> = { ok: true; data: T } | { ok: false; error: string }
type Entry = { view: PlayerGameView; session: RoomSession }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string) {
  const started = Date.now()
  while (!check()) { if (Date.now() - started > 4_000) assert.fail(`timed out: ${label}`); await sleep(20) }
}
/** A connected member that remembers the latest room state it was sent. */
async function member() {
  const socket = io(`http://127.0.0.1:${PORT}`, { forceNew: true, reconnection: false }) as Socket
  const states: PlayerGameView[] = []
  socket.on('room:state', (view: PlayerGameView) => states.push(view))
  await new Promise((resolve) => socket.once('connect', resolve))
  const emit = <T = undefined>(event: string, ...payload: unknown[]) => socket.timeout(3_000).emitWithAck(event, ...payload) as Promise<Reply<T>>
  return { socket, states, emit, latest: () => states.at(-1) }
}
async function lobby(createPayload: object = { name: 'Ana' }) {
  const host = await member(), guest = await member()
  const created = await host.emit<Entry>('room:create', createPayload)
  assert.ok(created.ok)
  const joined = await guest.emit<Entry>('room:join', { name: 'Biel', code: created.data.session.roomCode })
  assert.ok(joined.ok)
  return { host, guest, code: created.data.session.roomCode, hostSession: created.data.session, guestSession: joined.data.session }
}

// 1. Creating with only a name uses the default settings; an explicit language is still honoured; bad values are refused.
{
  const host = await member()
  const plain = await host.emit<Entry>('room:create', { name: 'Ana' })
  assert.ok(plain.ok)
  assert.equal(plain.data.view.gameLanguage, 'ca'); assert.equal(plain.data.view.voltes, DEFAULT_VOLTES)
  const spanish = await host.emit<Entry>('room:create', { name: 'Ana', gameLanguage: 'es' })
  assert.ok(spanish.ok); assert.equal(spanish.data.view.gameLanguage, 'es'); assert.equal(spanish.data.view.voltes, DEFAULT_VOLTES)
  for (const payload of [{ name: 'Ana', gameLanguage: 'fr' }, { name: 'Ana', voltes: 2 }, { name: 'Ana', gameLanguage: 'toString' }, { name: '' }]) {
    assert.deepEqual(await host.emit('room:create', payload), { ok: false, error: 'invalid-details' }, JSON.stringify(payload))
  }
  host.socket.disconnect()
}

// 2. Host-only changes, synchronized to every member at once; invalid settings and non-hosts are refused unchanged.
{
  const { host, guest, code } = await lobby()
  const room = () => games.rooms.get(code)!
  assert.deepEqual(await guest.emit('room:update-settings', { voltes: 5 }), { ok: false, error: 'not-host' })
  for (const payload of [{}, { voltes: 2 }, { voltes: '5' }, { gameLanguage: 'en' }, { gameLanguage: 'es', voltes: 4 }, null]) {
    assert.deepEqual(await host.emit('room:update-settings', payload), { ok: false, error: 'invalid-settings' }, JSON.stringify(payload))
  }
  assert.equal(room().voltes, DEFAULT_VOLTES); assert.equal(room().language, 'ca')
  assert.ok((await host.emit('room:update-settings', { voltes: 1 })).ok)
  assert.ok((await host.emit('room:update-settings', { gameLanguage: 'es' })).ok)
  await until(() => guest.latest()?.voltes === 1 && guest.latest()?.gameLanguage === 'es', 'guest sees both changes')
  assert.equal(host.latest()?.voltes, 1); assert.equal(host.latest()?.gameLanguage, 'es')

  // 3. Starting uses the confirmed settings; afterwards nothing can change them.
  assert.ok((await host.emit('room:start')).ok)
  await until(() => guest.latest()?.roomStatus === 'active', 'started')
  const started = guest.latest()!
  assert.equal(started.gameLanguage, 'es'); assert.equal(started.voltes, 1)
  assert.equal(started.match.totalTurns, 2, 'two players × one round')
  assert.deepEqual(await host.emit('room:update-settings', { voltes: 5 }), { ok: false, error: 'match-started' })
  assert.equal(room().voltes, 1)
  host.socket.disconnect(); guest.socket.disconnect()
}

// 4. Host transfer: when the host leaves, the new host edits and the others follow; the old host's seat cannot.
{
  const { host, guest, code } = await lobby()
  const third = await member()
  assert.ok((await third.emit('room:join', { name: 'Cesc', code })).ok)
  host.socket.emit('room:leave')
  await until(() => guest.latest()?.hostId === guest.latest()?.players.find((player) => player.name === 'Biel')?.id, 'Biel hosts')
  assert.deepEqual(await third.emit('room:update-settings', { voltes: 5 }), { ok: false, error: 'not-host' })
  assert.ok((await guest.emit('room:update-settings', { voltes: 5 })).ok)
  await until(() => third.latest()?.voltes === 5, 'third sees the new host change')
  host.socket.disconnect(); guest.socket.disconnect(); third.socket.disconnect()
}

// 5. Reconnection: a member returning to the lobby receives the current settings; a host who went away and came back
// after the role moved on is no longer allowed to edit, and a reconnecting host cannot edit until resumed.
{
  const { host, guest, code, hostSession, guestSession } = await lobby()
  guest.socket.disconnect()
  await until(() => games.rooms.get(code)?.player(guestSession.playerId)?.connectionState === 'reconnecting', 'guest reconnecting')
  assert.ok((await host.emit('room:update-settings', { voltes: 1, gameLanguage: 'es' })).ok)
  const returning = await member()
  const resumed = await returning.emit<PlayerGameView>('room:resume', guestSession)
  assert.ok(resumed.ok)
  assert.equal(resumed.data.voltes, 1); assert.equal(resumed.data.gameLanguage, 'es')
  // The host drops and is marked away (what the grace timer does; timing is covered by test:absence): Biel hosts.
  host.socket.disconnect()
  await until(() => games.rooms.get(code)?.player(hostSession.playerId)?.connectionState === 'reconnecting', 'host reconnecting')
  assert.equal(games.rooms.get(code)!.markAway(hostSession.playerId), true)
  assert.equal(games.rooms.get(code)!.hostId, guestSession.playerId)
  const formerHost = await member()
  const back = await formerHost.emit<PlayerGameView>('room:resume', hostSession)
  assert.ok(back.ok); assert.equal(back.data.hostId, guestSession.playerId); assert.equal(back.data.voltes, 1)
  assert.deepEqual(await formerHost.emit('room:update-settings', { voltes: 3 }), { ok: false, error: 'not-host' })
  assert.ok((await returning.emit('room:update-settings', { voltes: 3 })).ok)
  await until(() => formerHost.latest()?.voltes === 3, 'former host follows the new host')
  formerHost.socket.disconnect(); returning.socket.disconnect()
}

// 6. Rematch keeps the room's settings (they are fixed once a match has started).
{
  const { host, guest, code } = await lobby()
  assert.ok((await host.emit('room:update-settings', { voltes: 1 })).ok)
  assert.ok((await host.emit('room:start')).ok)
  const room = games.rooms.get(code)!
  room.disconnect(room.players[1].id) // a departure ends a two-player match
  assert.equal(room.roomStatus, 'match-over')
  assert.equal(room.voltes, 1)
  host.socket.disconnect(); guest.socket.disconnect()
}

httpServer.close()
console.log('Lobby settings checks passed: defaults on create, host-only and lobby-only changes, invalid settings, sync to members, start with confirmed settings, host transfer and reconnection')
process.exit(0)
