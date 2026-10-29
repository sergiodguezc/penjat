import assert from 'node:assert/strict'
import { once } from 'node:events'
import { io } from 'socket.io-client'

process.env.PORT = '3244'; process.env.HOST = '127.0.0.1'
process.env.PENJAT_ROOM_CREATION_REQUESTS = '5'
process.env.PENJAT_MAX_ROOMS = '2'; process.env.PENJAT_ROOM_PREVIEW_REQUESTS = '3'
delete process.env.RENDER
const { httpServer, games } = await import('../dist-server/server/server.js')
if (!httpServer.listening) await once(httpServer, 'listening')
const base = `http://127.0.0.1:${httpServer.address().port}`
const sockets = []
const emit = (socket, event, ...args) => socket.timeout(2000).emitWithAck(event, ...args)
async function member(index, transport = 'websocket') {
  const socket = io(base, { forceNew: true, reconnection: false, transports: [transport], extraHeaders: { 'X-Forwarded-For': `198.51.100.${index}`, 'CF-Connecting-IP': `203.0.113.${index}` } })
  sockets.push(socket); await once(socket, 'connect'); return socket
}
try {
  const host = await member(1, 'polling'), other = await member(2)
  const created = await emit(host, 'room:create', { name: 'Host' }); assert.ok(created.ok)
  const code = created.data.session.roomCode
  const players = []
  // All ten players share one real IP, with mixed transports and forged headers.
  for (let i = 0; i < 9; i++) {
    const socket = await member(i + 3)
    const joined = await emit(socket, 'room:join', { code, name: `Guest ${i}` }); assert.ok(joined.ok)
    players.push({ socket, session: joined.data.session })
  }
  assert.ok((await emit(other, 'room:create', { name: 'Other' })).ok)
  assert.deepEqual(await emit(players[0].socket, 'room:create', { name: 'Extra' }), { ok: false, error: 'room-capacity-reached' })
  assert.deepEqual(await emit(host, 'room:create', { name: 'Host' }), { ok: false, error: 'room-capacity-reached' })
  assert.equal(games.identityForSocket(host.id).playerId, created.data.session.playerId)
  assert.ok((await emit(other, 'room:create', { name: 'Replacement' })).ok, 'solo retry replaces its old room at capacity')
  assert.equal(games.rooms.size, 2)
  const fresh = await member(99)
  fresh.emit('room:create', { name: 'No acknowledgement' })
  assert.deepEqual(await emit(fresh, 'room:create', { name: 'Blocked' }), { ok: false, error: 'room-creation-rate-limited' }, 'new socket and spoofed headers do not reset the IP quota')
  for (let i = 0; i < 3; i++) {
    const response = await fetch(`${base}/api/rooms/${i === 1 ? 'ZZZZZ' : code}/preview`, { method: i === 2 ? 'HEAD' : 'GET', headers: { 'X-Forwarded-For': `192.0.2.${i}`, 'CF-Connecting-IP': `192.0.2.${i}` } })
    assert.equal(response.status, i === 1 ? 404 : 200)
  }
  const rejected = await fetch(`${base}/api/rooms/${code}/preview`)
  assert.equal(rejected.status, 429); assert.ok(Number(rejected.headers.get('retry-after')) > 0)
  assert.deepEqual(await rejected.json(), { ok: false, error: 'room-preview-rate-limited' })
  const head = await fetch(`${base}/api/rooms/${code}/preview`, { method: 'HEAD' }); assert.equal(head.status, 429); assert.equal(await head.text(), '')
  assert.equal((await fetch(`${base}/health`)).status, 200)
  // Reconnection/takeover and chat/gameplay still work after both quotas are exhausted.
  const resumed = await emit(fresh, 'room:resume', players[0].session); assert.ok(resumed.ok)
  assert.ok((await emit(fresh, 'chat:send', { text: 'Hola!' })).ok)
  assert.ok((await emit(host, 'room:start')).ok)
  const room = games.rooms.get(code)
  const view = room.viewFor(created.data.session.playerId)
  const setterSocket = sockets.find(socket => socket.id === room.player(view.round.setterId)?.socketId)
  assert.ok(setterSocket)
  assert.ok((await emit(setterSocket, 'round:set-word', { word: 'gat' })).ok)
  assert.ok((await emit(setterSocket === fresh ? host : fresh, 'game:guess', { letter: 'G' })).ok)
  assert.equal(games.rooms.size, 2)
  console.log('HTTP/Socket.IO limits, spoofing, shared-IP players and active gameplay passed')
} finally {
  for (const socket of sockets) socket.disconnect()
  httpServer.closeAllConnections(); await new Promise(resolve => httpServer.close(resolve))
}
