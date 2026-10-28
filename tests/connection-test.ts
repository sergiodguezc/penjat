// Connection-race regressions for create/join against the built server (run `npm run build` first).
// Each case uses a fresh client so a stale connection can never hide a lost request.
import assert from 'node:assert/strict'
import net from 'node:net'
import { io, type Socket } from 'socket.io-client'
import { whenConnected } from '../src/multiplayer/socket'

const PORT = 3211, PROXY = 3212, DOWN = 3213
process.env.PORT = String(PORT); process.env.HOST = '127.0.0.1'
const { httpServer, games } = await import('../dist-server/server/server.js')
await new Promise((resolve) => httpServer.listening ? resolve(null) : httpServer.once('listening', resolve))

type Reply = { ok: boolean; data?: { session: { roomCode: string } }; error?: string }
const client = (port: number) => io(`http://127.0.0.1:${port}`, { autoConnect: false, timeout: 2_000, reconnectionDelay: 100, reconnectionDelayMax: 200 }) as Socket
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
// Mirrors HomePage: wait for the connection, then emit with a timeout; resolves with the reply or the failure.
const request = (socket: Socket, event: string, payload: object) => new Promise<Reply | 'connect_error' | 'timeout'>((resolve) => {
  whenConnected(socket, () => socket.timeout(3_000).emit(event, payload, (timedOut: Error | null, reply: Reply) => resolve(timedOut ? 'timeout' : reply)), () => resolve('connect_error'))
})
const create = (socket: Socket) => request(socket, 'room:create', { name: 'Ana', gameLanguage: 'ca', voltes: 1 })
const join = (socket: Socket, code: string) => request(socket, 'room:join', { name: 'Biel', code })
const transportOpens = (socket: Socket) => { let opens = 0; socket.io.on('open', () => { opens++ }); return () => opens }
async function roomCode() { const host = client(PORT); const reply = await create(host); assert.ok(typeof reply === 'object' && reply.ok); return { host, code: reply.data!.session.roomCode } }

// 1. Original bug: App starts the connection on load and the form submits before it is ready. Calling connect() a
// second time re-sent CONNECT, the server dropped the transport and the request was lost.
// The narrow window is after the transport opens and before the server answers CONNECT; test it and plain "at once".
for (const moment of ['at once', 'transport open, handshake pending'] as const) for (const action of ['create', 'join'] as const) {
  const { host, code } = await roomCode()
  const socket = client(PORT); const opens = transportOpens(socket)
  const opened = new Promise((resolve) => socket.io.once('open', () => resolve(null)))
  socket.connect() // App's connect on entering multiplayer
  if (moment !== 'at once') { await opened; assert.equal(socket.connected, false) }
  const reply = await (action === 'create' ? create(socket) : join(socket, code))
  assert.ok(typeof reply === 'object' && reply.ok, `${action} ${moment}: ${JSON.stringify(reply)}`)
  assert.equal(opens(), 1, `${action} ${moment} opened one transport`)
  socket.disconnect(); host.disconnect()
}

// 2. Delayed initial connection: a proxy holds the first bytes for 700 ms; the request waits and succeeds once.
const proxy = net.createServer((incoming) => {
  const outgoing = net.connect(PORT, '127.0.0.1')
  let held: Buffer[] | null = []
  setTimeout(() => { for (const chunk of held!) outgoing.write(chunk); held = null; incoming.pipe(outgoing) }, 700)
  incoming.on('data', (chunk) => { if (held) { held.push(chunk); incoming.pause() } })
  outgoing.pipe(incoming)
  incoming.on('error', () => outgoing.destroy()); outgoing.on('error', () => incoming.destroy())
}).listen(PROXY, '127.0.0.1')
for (const action of ['create', 'join'] as const) {
  const { host, code } = await roomCode()
  const socket = client(PROXY); const opens = transportOpens(socket)
  socket.connect()
  const started = Date.now()
  const reply = await (action === 'create' ? create(socket) : join(socket, code))
  assert.ok(typeof reply === 'object' && reply.ok, `${action} during a delayed connection: ${JSON.stringify(reply)}`)
  assert.ok(Date.now() - started >= 600, `${action} waited for the delayed connection`)
  assert.equal(opens(), 1, `${action} during a delayed connection opened one transport`)
  socket.disconnect(); host.disconnect()
}
proxy.close()

// Leaving the entry screen while connecting cancels the pending action, including on a later connection.
{
  const socket = client(PORT)
  let calls = 0
  const cancel = whenConnected(socket, () => { calls++ }, () => { calls++ })
  cancel(); socket.disconnect()
  socket.connect(); await new Promise((resolve) => socket.once('connect', resolve))
  assert.equal(calls, 0, 'cancelled entry never runs after reconnecting')
  assert.equal(socket.listeners('connect_error').length, 0, 'cancel removes the failure listener too')
  socket.disconnect()
}

// 3. Already connected: the request goes out at once, without touching the connection.
for (const action of ['create', 'join'] as const) {
  const { host, code } = await roomCode()
  const socket = client(PORT); const opens = transportOpens(socket)
  socket.connect(); await new Promise((resolve) => socket.once('connect', resolve))
  const reply = await (action === 'create' ? create(socket) : join(socket, code))
  assert.ok(typeof reply === 'object' && reply.ok, `${action} when connected`)
  assert.equal(opens(), 1)
  socket.disconnect(); host.disconnect()
}

// 4. Disconnected socket (e.g. after App resets a stale session): the request reconnects it.
{
  const socket = client(PORT)
  socket.connect(); await new Promise((resolve) => socket.once('connect', resolve)); socket.disconnect()
  assert.equal(socket.active, false)
  const reply = await create(socket)
  assert.ok(typeof reply === 'object' && reply.ok, 'create after an explicit disconnect')
  socket.disconnect()
}

// 5. Failed connection, then reconnection: the first attempt reports a recoverable error (the UI stops loading);
// automatic reconnection keeps going and a retry succeeds on the same socket without restarting it.
{
  const socket = client(DOWN); const opens = transportOpens(socket)
  socket.connect()
  assert.equal(await create(socket), 'connect_error', 'a failed connection is reported, not left pending')
  assert.equal(socket.active, true, 'automatic reconnection is still running')
  const late = net.createServer((incoming) => { const outgoing = net.connect(PORT, '127.0.0.1'); incoming.pipe(outgoing).pipe(incoming); incoming.on('error', () => outgoing.destroy()); outgoing.on('error', () => incoming.destroy()) })
  await sleep(150); late.listen(DOWN, '127.0.0.1')
  let reply = await create(socket)
  for (let attempt = 0; reply === 'connect_error' && attempt < 10; attempt++) reply = await create(socket) // reconnection attempts that started before the server came up
  assert.ok(typeof reply === 'object' && reply.ok, `retry after the server came back: ${JSON.stringify(reply)}`)
  assert.equal(opens(), 1, 'one transport once the server is reachable')
  socket.disconnect(); late.close()
}

// Departure is acknowledged only after the seat is released, so closing the transport cannot retain it.
{
  const socket = client(PORT)
  const reply = await create(socket)
  assert.ok(typeof reply === 'object' && reply.ok)
  const code = reply.data!.session.roomCode
  assert.deepEqual(await socket.timeout(1_000).emitWithAck('room:leave'), { ok: true })
  assert.equal(games.rooms.has(code), false, 'the last seat is removed before acknowledging departure')
  assert.deepEqual(await socket.timeout(1_000).emitWithAck('room:leave'), { ok: true }, 'leaving twice still acknowledges')
  socket.disconnect()
}

httpServer.close()
console.log('Connection race checks passed: create/join immediately, during a delayed connection, when connected, after a disconnect and after a failed connection')
process.exit(0)
