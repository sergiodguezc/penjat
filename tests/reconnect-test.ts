// Room restoration regressions against the built server (run `npm run build:server` first): stored credentials and
// legacy migration, restoring after a refresh/reopened tab or long absence, transient failure and retry, invalid
// sessions, explicit leave and duplicates. Server-side timing (grace period, room expiry) is in test:absence.
import assert from 'node:assert/strict'
import net from 'node:net'
import { io, type Socket } from 'socket.io-client'
import type { PlayerGameView, RoomSession } from '../shared/protocol'
import {
  clearRoomSession, createRoomRestorer, loadRoomSession, ROOM_SESSION_KEY, saveRoomSession,
  type RestoreSocket, type RestoreStatus, type SessionStorage,
} from '../src/multiplayer/roomSession'

const PORT = 3221, FLAKY = 3222
process.env.PORT = String(PORT); process.env.HOST = '127.0.0.1'
const { httpServer, games } = await import('../dist-server/server/server.js')
await new Promise((resolve) => httpServer.listening ? resolve(null) : httpServer.once('listening', resolve))

class MemoryStorage implements SessionStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
const throwing: SessionStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string, ms = 4_000) {
  const started = Date.now()
  while (!check()) { if (Date.now() - started > ms) assert.fail(`timed out: ${label}`); await sleep(20) }
}
const client = (port = PORT) => io(`http://127.0.0.1:${port}`, { autoConnect: false, timeout: 1_000, reconnectionDelay: 100, reconnectionDelayMax: 200 }) as Socket
const connected = async (socket: Socket) => { socket.connect(); await until(() => socket.connected, 'connected') }
type Entry = { ok: true; data: { view: PlayerGameView; session: RoomSession } }
const emit = <T,>(socket: Socket, event: string, payload: object) => socket.timeout(3_000).emitWithAck(event, payload) as Promise<T>
const activePlayers = (code: string) => games.rooms.get(code)?.activePlayers.length ?? 0

/** A tab: its own socket and a restorer, sharing `storage` with any other tab of the same browser profile. */
function tab(storage: SessionStorage, port = PORT, invitation: string | null = null, legacy: SessionStorage | null = null) {
  const socket = client(port)
  const statuses: RestoreStatus[] = [], restored: PlayerGameView[] = [], invalid: string[] = []
  let resumes = 0
  socket.onAnyOutgoing((event) => { if (event === 'room:resume') resumes++ })
  const restorer = createRoomRestorer({
    socket: socket as unknown as RestoreSocket,
    storage: () => storage, legacyStorage: () => legacy, invitation: () => invitation, timeoutMs: 1_000,
    onStatus: (status) => statuses.push(status), onRestored: (_, view) => restored.push(view), onInvalid: (error) => invalid.push(error),
  })
  return { socket, restorer, statuses, restored, invalid, resumes: () => resumes, status: () => statuses.at(-1) ?? 'idle' }
}
async function room() {
  const host = client(); await connected(host)
  const created = await emit<Entry>(host, 'room:create', { name: 'Ana', gameLanguage: 'ca', voltes: 1 })
  const guest = client(); await connected(guest)
  const joined = await emit<Entry>(guest, 'room:join', { name: 'Biel', code: created.data.session.roomCode })
  return { host, guest, code: created.data.session.roomCode, session: joined.data.session }
}

// 1. Storage: unavailable, malformed or other-version data is ignored without throwing; valid data never expires.
{
  const storage = new MemoryStorage(), session = { roomCode: 'ABCDE', playerId: 'p', reconnectToken: 't' }
  assert.equal(loadRoomSession(null, null), null)
  assert.equal(loadRoomSession(throwing, throwing), null)
  assert.doesNotThrow(() => { saveRoomSession(session, throwing); clearRoomSession(throwing, throwing) })
  for (const raw of ['{', '"text"', 'null', '[]', JSON.stringify(session), JSON.stringify({ ...session, version: 0 }), JSON.stringify({ ...session, version: 2 }),
    JSON.stringify({ ...session, version: 1, roomCode: 'abc' }), JSON.stringify({ ...session, version: 1, reconnectToken: 3 })]) {
    storage.setItem(ROOM_SESSION_KEY, raw)
    assert.equal(loadRoomSession(storage, null), null, `rejects ${raw}`)
  }
  // An entry written long ago (the former format carried `savedAt`) is still valid: only the server decides.
  storage.setItem(ROOM_SESSION_KEY, JSON.stringify({ version: 1, savedAt: 0, ...session }))
  assert.deepEqual(loadRoomSession(storage, null), session, 'no client-side expiry')
  saveRoomSession(session, storage)
  assert.deepEqual(loadRoomSession(storage, null), session)
  // A throwing storage never breaks the restorer: it simply has nothing to restore.
  const socket = client(); const statuses: RestoreStatus[] = []
  const restorer = createRoomRestorer({ socket: socket as unknown as RestoreSocket, storage: () => throwing, legacyStorage: () => throwing, invitation: () => null, timeoutMs: 500, onStatus: (s) => statuses.push(s), onRestored: () => assert.fail(), onInvalid: () => assert.fail() })
  restorer.resume(); assert.deepEqual(statuses, ['idle']); restorer.dispose(); socket.disconnect()
}

// 1b. Legacy sessionStorage credentials move to localStorage once, only when localStorage holds nothing valid.
{
  const session = { roomCode: 'ABCDE', playerId: 'p', reconnectToken: 't' }, other = { roomCode: 'FGHJK', playerId: 'q', reconnectToken: 'u' }
  for (const current of [null, '{', JSON.stringify({ ...other, version: 0 })]) {
    const local = new MemoryStorage(), legacy = new MemoryStorage()
    if (current) local.setItem(ROOM_SESSION_KEY, current)
    legacy.setItem(ROOM_SESSION_KEY, JSON.stringify(session))
    assert.deepEqual(loadRoomSession(local, legacy), session, `migrates over ${current}`)
    assert.deepEqual(JSON.parse(local.getItem(ROOM_SESSION_KEY)!), { version: 1, ...session }, 'stored in the new format')
    assert.equal(legacy.getItem(ROOM_SESSION_KEY), null, 'legacy entry removed')
  }
  const local = new MemoryStorage(), legacy = new MemoryStorage()
  saveRoomSession(other, local); legacy.setItem(ROOM_SESSION_KEY, JSON.stringify(session))
  assert.deepEqual(loadRoomSession(local, legacy), other, 'a valid localStorage session wins')
  for (const raw of ['{', JSON.stringify({ ...session, roomCode: 'bad' }), JSON.stringify({ roomCode: 'ABCDE' })]) {
    const empty = new MemoryStorage(), broken = new MemoryStorage()
    broken.setItem(ROOM_SESSION_KEY, raw)
    assert.equal(loadRoomSession(empty, broken), null, `ignores legacy ${raw}`)
    assert.equal(empty.getItem(ROOM_SESSION_KEY), null)
  }
  clearRoomSession(local, legacy)
  assert.equal(local.getItem(ROOM_SESSION_KEY), null); assert.equal(legacy.getItem(ROOM_SESSION_KEY), null, 'leaving clears both stores')
}

// 2. Refresh / reopened tab: a new connection with only the stored credentials gets the same player back, with no
// name or room code typed, and the room keeps exactly the same members.
{
  const { host, guest, code, session } = await room()
  const storage = new MemoryStorage(); saveRoomSession(session, storage)
  guest.disconnect() // the old page goes away
  await until(() => games.rooms.get(code)?.player(session.playerId)?.connectionState === 'reconnecting', 'marked reconnecting')
  const reopened = tab(storage)
  reopened.socket.connect()
  await until(() => reopened.restored.length === 1, 'restored')
  const view = reopened.restored[0]
  assert.equal(view.code, code)
  assert.equal(view.players.find((player) => player.id === session.playerId)?.connectionState, 'connected')
  assert.equal(view.hostId, view.players.find((player) => player.name === 'Ana')?.id, 'host status is unchanged')
  assert.equal(activePlayers(code), 2, 'no duplicate player')
  assert.deepEqual(reopened.statuses, ['restoring', 'idle'])
  // More triggers on the same connection (visibility, online, a second connect listener) do not resume again.
  reopened.restorer.resume(); reopened.restorer.resume()
  await sleep(200)
  assert.equal(reopened.resumes(), 1, 'one resume per connection')
  assert.equal(reopened.restored.length, 1); assert.equal(activePlayers(code), 2)
  // Temporary network loss on the restored tab: Socket.IO reconnects and the restorer resumes once more.
  const before = reopened.resumes()
  reopened.socket.io.engine.close()
  await until(() => reopened.restored.length === 2, 'resumed after a transport drop')
  assert.equal(reopened.resumes(), before + 1, 'exactly one resume per new connection')
  assert.equal(activePlayers(code), 2)
  reopened.restorer.dispose(); reopened.socket.disconnect(); host.disconnect()
}

// 3. Transient failure, then retry: the server is unreachable, the credentials are kept and a retry restores the room.
{
  const { host, guest, code, session } = await room()
  const storage = new MemoryStorage(); saveRoomSession(session, storage)
  guest.disconnect()
  const offline = tab(storage, FLAKY)
  offline.socket.connect()
  await until(() => offline.status() === 'failed', 'connection failure reported')
  assert.deepEqual(loadRoomSession(storage), session, 'a temporary failure keeps the credentials')
  const proxy = net.createServer((incoming) => { const outgoing = net.connect(PORT, '127.0.0.1'); incoming.pipe(outgoing).pipe(incoming); incoming.on('error', () => outgoing.destroy()); outgoing.on('error', () => incoming.destroy()) })
  await new Promise((resolve) => proxy.listen(FLAKY, '127.0.0.1', () => resolve(null)))
  offline.restorer.retry()
  await until(() => offline.restored.length === 1, 'restored after retry')
  assert.equal(offline.status(), 'idle')
  assert.equal(activePlayers(code), 2)
  offline.restorer.dispose(); offline.socket.disconnect(); host.disconnect(); proxy.close()
}

// 4. Invalid sessions: a wrong token or a room that no longer exists clears the credentials; a valid code and name
// are never enough to take over another player.
for (const [label, mutate, error] of [
  ['wrong token', (session: RoomSession) => ({ ...session, reconnectToken: 'forged' }), 'resume-rejected'],
  ['another player id', (session: RoomSession) => ({ ...session, playerId: 'someone-else' }), 'room-not-found'],
  ['room gone', (session: RoomSession) => ({ ...session, roomCode: 'ZZZZZ' }), 'room-not-found'],
] as const) {
  const { host, guest, code, session } = await room()
  const storage = new MemoryStorage(); saveRoomSession(mutate(session), storage)
  const stranger = tab(storage)
  stranger.socket.connect()
  await until(() => stranger.invalid.length === 1, `${label} rejected`)
  assert.equal(stranger.invalid[0], error, label)
  assert.equal(loadRoomSession(storage), null, `${label}: credentials cleared`)
  assert.equal(stranger.status(), 'idle')
  assert.equal(games.rooms.get(code)?.player(session.playerId)?.socketId, guest.id, `${label}: the real player keeps their seat`)
  // Reconnecting later does not try again with cleared credentials.
  stranger.socket.io.engine.close()
  await until(() => stranger.socket.connected && stranger.resumes() === 1, 'reconnected without resuming')
  stranger.restorer.dispose(); stranger.socket.disconnect(); guest.disconnect(); host.disconnect()
}

// 4b. Long absence: after the grace period the server marks the player away (seat kept, shown as disconnected); the
// stored credentials still restore the same seat, connected again, without a duplicate. A legacy-only tab does too.
{
  const { host, guest, code, session } = await room()
  const local = new MemoryStorage(), legacy = new MemoryStorage()
  legacy.setItem(ROOM_SESSION_KEY, JSON.stringify(session))
  guest.disconnect()
  await until(() => games.rooms.get(code)?.player(session.playerId)?.connectionState === 'reconnecting', 'reconnecting')
  assert.equal(games.rooms.get(code)!.markAway(session.playerId), true) // what the grace timer does (timing: test:absence)
  assert.equal(games.rooms.get(code)!.player(session.playerId)!.connectionState, 'disconnected')
  const returning = tab(local, PORT, null, legacy)
  returning.socket.connect()
  await until(() => returning.restored.length === 1, 'restored after absence')
  assert.equal(returning.restored[0].players.find((player) => player.id === session.playerId)?.connectionState, 'connected')
  assert.equal(activePlayers(code), 2)
  assert.equal(legacy.getItem(ROOM_SESSION_KEY), null, 'legacy credentials migrated')
  assert.deepEqual(loadRoomSession(local, null), session)
  // Leaving clears both stores, so the room never comes back.
  returning.socket.emit('room:leave'); returning.restorer.forget()
  assert.equal(local.getItem(ROOM_SESSION_KEY), null)
  await until(() => activePlayers(code) === 1, 'left')
  returning.restorer.dispose(); returning.socket.disconnect(); host.disconnect()
}

// 5. Explicit leave: the credentials are cleared, later reconnections never bring the room back, and leaving while a
// resume is still in flight undoes it on the server.
{
  const { host, guest, code, session } = await room()
  const storage = new MemoryStorage(); saveRoomSession(session, storage)
  guest.disconnect()
  const leaving = tab(storage)
  await connected(leaving.socket)
  await until(() => leaving.restored.length === 1, 'restored before leaving')
  leaving.socket.emit('room:leave'); leaving.restorer.forget()
  assert.equal(loadRoomSession(storage), null)
  await until(() => activePlayers(code) === 1, 'player removed')
  leaving.socket.io.engine.close()
  await until(() => leaving.socket.connected, 'reconnected')
  await sleep(200)
  assert.equal(leaving.restored.length, 1, 'no restoration after leaving')
  assert.equal(activePlayers(code), 1)
  leaving.restorer.dispose(); leaving.socket.disconnect(); host.disconnect()
}
{
  const { host, guest, code, session } = await room()
  const storage = new MemoryStorage(); saveRoomSession(session, storage)
  guest.disconnect()
  const hasty = tab(storage)
  // The player leaves right after the resume goes out (this listener runs after the restorer's), before any reply.
  hasty.socket.once('connect', () => hasty.restorer.forget())
  hasty.socket.connect()
  await until(() => !games.rooms.get(code)?.player(session.playerId)?.active, 'late resume undone')
  assert.equal(hasty.restored.length, 0)
  assert.equal(activePlayers(code), 1)
  hasty.restorer.dispose(); hasty.socket.disconnect(); host.disconnect()
}

// 6. Two tabs of one profile share the credentials: the newer tab takes the player over, the older one is told and
// stays put (no ping-pong) until the player chooses to continue there; the room never gains a second copy.
{
  const { host, guest, code, session } = await room()
  const storage = new MemoryStorage(); saveRoomSession(session, storage)
  guest.disconnect()
  const first = tab(storage); first.socket.connect()
  await until(() => first.restored.length === 1, 'first tab restored')
  const second = tab(storage); second.socket.connect()
  await until(() => second.restored.length === 1, 'second tab restored')
  await until(() => first.status() === 'replaced', 'first tab replaced')
  first.socket.io.engine.close() // a network blip in the old tab must not steal the player back
  await until(() => first.socket.connected, 'old tab reconnected')
  await sleep(200)
  assert.equal(first.restored.length, 1)
  assert.equal(games.rooms.get(code)?.player(session.playerId)?.socketId, second.socket.id)
  first.restorer.retry() // "Continue here"
  await until(() => first.restored.length === 2 && second.status() === 'replaced', 'first tab reclaimed')
  assert.equal(activePlayers(code), 2, 'still one seat per player')
  for (const each of [first, second]) { each.restorer.dispose(); each.socket.disconnect() }
  host.disconnect()
}

// 7. An invitation to a different room wins over unrelated stored credentials; the same room's invitation still resumes.
{
  const { host, guest, code, session } = await room()
  const storage = new MemoryStorage(); saveRoomSession(session, storage)
  guest.disconnect()
  const invited = tab(storage, PORT, 'QQQQQ'); await connected(invited.socket); await sleep(150)
  assert.equal(invited.resumes(), 0); assert.deepEqual(loadRoomSession(storage), session)
  const same = tab(storage, PORT, code); same.socket.connect()
  await until(() => same.restored.length === 1, 'same-room invitation resumes')
  for (const each of [invited, same]) { each.restorer.dispose(); each.socket.disconnect() }
  host.disconnect()
}

// 8. "Continue without them" over the wire: only a permitted, connected player may use it, and only while blocking.
{
  const { host, guest, code, session } = await room()
  const third = client(); await connected(third)
  await emit<Entry>(third, 'room:join', { name: 'Cesc', code })
  const reply = (socket: Socket, playerId: string) => socket.timeout(3_000).emitWithAck('room:continue-without', { playerId }) as Promise<{ ok: boolean; error?: string }>
  const hostId = games.rooms.get(code)!.hostId!
  assert.deepEqual(await reply(guest, hostId), { ok: false, error: 'player-reconnected' }, 'a connected host cannot be skipped')
  host.disconnect()
  await until(() => games.rooms.get(code)?.player(hostId)?.connectionState === 'reconnecting', 'host reconnecting')
  assert.deepEqual(await reply(third, hostId), { ok: false, error: 'cannot-skip-player' }, 'only the member who would host decides')
  assert.equal((await reply(guest, hostId)).ok, true)
  assert.equal(games.rooms.get(code)!.hostId, session.playerId)
  assert.equal(games.rooms.get(code)!.player(hostId)!.connectionState, 'disconnected')
  guest.disconnect(); third.disconnect()
}

httpServer.close()
console.log('Reconnect checks passed: storage, refresh/reopen, transport drop, failure and retry, invalid sessions, leave, two tabs, invitations, continue-without permissions')
process.exit(0)
