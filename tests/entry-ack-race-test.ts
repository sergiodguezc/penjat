// A room entry that times out and is retried (run `npm run build:server` first): a late acknowledgement or a late
// execution of the first request can never overwrite the newer session, enter the abandoned room, or leave it behind.
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { Server } from 'socket.io'
import { io, type Socket } from 'socket.io-client'
import { whenConnected } from '../src/multiplayer/socket'
import { loadRoomSession, saveRoomSession, type SessionStorage } from '../src/multiplayer/roomSession'
import type { RoomSession } from '../shared/protocol'

const TIMEOUT_MS = 300
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const memory = (): SessionStorage => { const values = new Map<string, string>(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } } }
type Reply = { ok: true; data: { session: RoomSession } } | { ok: false; error: string }

/** HomePage's entry: connect, emit with a timeout, then — only for the current attempt — save the session and enter. */
function entryScreen(socket: Socket, storage: SessionStorage) {
  const log = { timeouts: 0, entered: [] as string[], calls: 0 }
  let version = 0
  const entered = (current = version) => (timedOut: Error | null, response: Reply) => {
    log.calls++
    if (current !== version) return
    if (timedOut) { log.timeouts++; return }
    if (!response.ok) return
    saveRoomSession(response.data.session, storage)
    log.entered.push(response.data.session.roomCode)
  }
  const create = (name: string) => whenConnected(socket, () => socket.timeout(TIMEOUT_MS).emit('room:create', { name }, entered()), () => assert.fail('connect_error'))
  return { log, create, leavePage: () => { version++ } }
}
const session = (roomCode: string): RoomSession => ({ roomCode, playerId: `player-${roomCode}`, reconnectToken: `token-${roomCode}` })

// 1. Acknowledgement order under test control: a server that answers whenever the test says.
{
  const httpServer = (await import('node:http')).createServer()
  const server = new Server(httpServer)
  const pending: { name: string; ack: (reply: Reply) => void }[] = []
  server.on('connection', (socket) => socket.on('room:create', (payload: { name: string }, ack: (reply: Reply) => void) => pending.push({ name: payload.name, ack })))
  httpServer.listen(3243, '127.0.0.1'); await once(httpServer, 'listening')
  const connect = () => io('http://127.0.0.1:3243', { autoConnect: false, transports: ['websocket'], reconnection: false }) as Socket

  // 1a. A times out, B is sent and answered, then A's reply arrives: it reaches nothing and changes nothing.
  {
    const socket = connect(), storage = memory(), page = entryScreen(socket, storage)
    page.create('A'); await sleep(TIMEOUT_MS + 100)
    assert.equal(page.log.timeouts, 1, 'A reported a recoverable timeout')
    page.create('B'); await sleep(50)
    assert.deepEqual(pending.map((request) => request.name), ['A', 'B'], 'the server received both, in order')
    pending[1].ack({ ok: true, data: { session: session('BBBBB') } }); await sleep(50)
    pending[0].ack({ ok: true, data: { session: session('AAAAA') } }); await sleep(100)
    assert.deepEqual(page.log.entered, ['BBBBB'], 'only B entered a room')
    assert.equal(page.log.calls, 2, "A's late reply never called its handler a second time")
    assert.deepEqual(loadRoomSession(storage, null), session('BBBBB'), 'the stored session is still B')
    pending.length = 0; socket.disconnect()
  }

  // 1b. A's reply arrives after its timeout but before the retry: dropped; B then enters normally.
  {
    const socket = connect(), storage = memory(), page = entryScreen(socket, storage)
    page.create('A'); await sleep(TIMEOUT_MS + 100)
    pending[0].ack({ ok: true, data: { session: session('AAAAA') } }); await sleep(100)
    assert.deepEqual(page.log.entered, [])
    assert.equal(loadRoomSession(storage, null), null)
    page.create('B'); await sleep(50)
    pending[1].ack({ ok: true, data: { session: session('BBBBB') } }); await sleep(100)
    assert.deepEqual(page.log.entered, ['BBBBB'])
    assert.deepEqual(loadRoomSession(storage, null), session('BBBBB'))
    pending.length = 0; socket.disconnect()
  }

  // 1c. A queued while the connection is down and timing out is never sent later: only B reaches the server.
  {
    const socket = connect(), storage = memory(), page = entryScreen(socket, storage)
    socket.timeout(TIMEOUT_MS).emit('room:create', { name: 'A' }, () => { page.log.timeouts++ }) // buffered, not connected
    await sleep(TIMEOUT_MS + 100)
    assert.equal(page.log.timeouts, 1)
    page.create('B'); await sleep(200)
    assert.deepEqual(pending.map((request) => request.name), ['B'], 'the timed-out request was dropped from the send buffer')
    pending[0].ack({ ok: true, data: { session: session('BBBBB') } }); await sleep(50)
    assert.deepEqual(page.log.entered, ['BBBBB'])
    pending.length = 0; socket.disconnect()
  }

  // 1d. Leaving the entry screen while A is pending: A's in-time reply is ignored, a later B still enters.
  {
    const socket = connect(), storage = memory(), page = entryScreen(socket, storage)
    page.create('A'); await sleep(50)
    page.leavePage()
    pending[0].ack({ ok: true, data: { session: session('AAAAA') } }); await sleep(50)
    assert.deepEqual(page.log.entered, [])
    assert.equal(loadRoomSession(storage, null), null)
    pending.length = 0; socket.disconnect()
  }
  server.close()
}

// 2. Delayed server-side execution against the real server: a proxy holds A's bytes past the client timeout, the
// retry B queues behind it, then both arrive (TCP keeps their order). A creates a room, B releases it: one room remains,
// the page holds B, and A's credentials (never seen by the page) resume nothing.
{
  process.env.PORT = '3241'; process.env.HOST = '127.0.0.1'
  const { httpServer, games } = await import('../dist-server/server/server.js')
  if (!httpServer.listening) await once(httpServer, 'listening')
  let holding = false
  const held: Buffer[] = []
  let upstream: net.Socket | null = null
  const proxy = net.createServer((incoming) => {
    const outgoing = net.connect(3241, '127.0.0.1'); upstream = outgoing
    incoming.on('data', (chunk) => { if (holding) held.push(chunk); else outgoing.write(chunk) })
    outgoing.pipe(incoming)
    incoming.on('error', () => outgoing.destroy()); outgoing.on('error', () => incoming.destroy())
  }).listen(3242, '127.0.0.1')
  await once(proxy, 'listening')
  const socket = io('http://127.0.0.1:3242', { autoConnect: false, transports: ['websocket'], reconnection: false }) as Socket
  const storage = memory(), page = entryScreen(socket, storage)
  socket.connect(); await once(socket, 'connect')
  const before = games.rooms.size
  holding = true
  page.create('A'); await sleep(TIMEOUT_MS + 100)
  assert.equal(page.log.timeouts, 1)
  page.create('B'); await sleep(50)
  assert.equal(games.rooms.size, before, 'neither request has reached the server yet')
  holding = false
  for (const chunk of held.splice(0)) upstream!.write(chunk)
  await sleep(300)
  assert.equal(page.log.entered.length, 1, 'only B entered')
  const stored = loadRoomSession(storage, null)!
  assert.equal(stored.roomCode, page.log.entered[0])
  assert.equal(games.rooms.size, before + 1, "A's room was released when B ran: no orphaned room")
  assert.equal(games.identityForSocket(socket.id).room.code, stored.roomCode)
  // The stored session (B) resumes from a fresh connection, as a refresh would.
  const refreshed = io('http://127.0.0.1:3241', { transports: ['websocket'], reconnection: false }) as Socket
  await once(refreshed, 'connect')
  const resumed = await refreshed.timeout(2_000).emitWithAck('room:resume', stored)
  assert.equal(resumed.ok, true)
  refreshed.disconnect(); socket.disconnect(); proxy.close(); httpServer.close()
}

console.log('Entry acknowledgement race checks passed: late reply after retry, late reply before retry, timed-out buffered request, left entry screen, delayed server execution')
process.exit(0)
