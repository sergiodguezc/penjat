// One connection, one seat (run `npm run build:server` first). Creating, joining or resuming another seat releases the
// previous one: lobby departures leave no roster entry, abandoned rooms expire with every timer cleared, a stale
// connection receives nothing from its old room, and lost acknowledgements followed by retries leave no orphaned room.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { io, type Socket } from 'socket.io-client'
import { ABSENCE_GRACE_MS, EMPTY_ROOM_TTL_MS, GameManager } from '../dist-server/server/game/GameManager.js'

class Clock {
  now = 0; next = 1; timers = new Map<number, { at: number; callback: () => void }>()
  setTimeout(callback: () => void, ms: number) { const id = this.next++; this.timers.set(id, { at: this.now + ms, callback }); return id }
  clearTimeout(id: number) { this.timers.delete(id) }
  advance(ms: number) {
    const target = this.now + ms
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.timers.delete(due[0]); this.now = due[1].at; due[1].callback()
    }
    this.now = target
  }
}
const managed = () => { const clock = new Clock(), expired: string[] = []; return { clock, expired, games: new GameManager(() => 0, { scheduler: clock, onRoomExpired: (code: string) => expired.push(code) }) } }

// 1. Two (and many) successive creations on one connection: each releases the previous lobby, so one room remains.
{
  const { clock, games } = managed()
  const first = games.create('s-a', 'Ana', 'ca', 1)
  const second = games.create('s-a', 'Ana', 'ca', 1)
  assert.equal(games.rooms.has(first.room.code), false, 'the first room had nobody else and is gone at once')
  assert.equal(second.released.playerId, first.playerId)
  assert.equal(games.identityForSocket('s-a').playerId, second.playerId)
  assert.throws(() => games.resume('s-x', first.room.code, first.playerId, first.reconnectToken), /room-not-found/)
  for (let index = 0; index < 500; index += 1) games.create('s-a', 'Ana', 'ca', 1)
  assert.equal(games.rooms.size, 1, 'repeated creation on one connection keeps one room, not one per attempt')
  assert.equal(clock.timers.size, 0)
}

// 2/4. Switching rooms, then disconnecting: the old room keeps its other members; every room expires once nobody is
// connected, and no absence or expiry timer outlives them.
{
  const { clock, games, expired } = managed()
  const ana = games.create('s-a', 'Ana', 'ca', 1)
  const biel = games.join('s-b', 'Biel', ana.room.code)
  const cesc = games.create('s-c', 'Cesc', 'ca', 1)
  const moved = games.join('s-a', 'Ana', cesc.room.code)
  assert.equal(moved.released.room, ana.room)
  assert.equal(ana.room.player(ana.playerId), undefined, 'the lobby seat Ana gave up is gone')
  assert.equal(ana.room.hostId, biel.playerId, 'the host role moved to the member who stayed')
  assert.deepEqual(cesc.room.players.map((player: { name: string }) => player.name), ['Cesc', 'Ana'])
  assert.equal(games.roomForPlayer(ana.playerId), undefined)
  for (const socket of ['s-a', 's-b', 's-c']) games.markReconnecting(socket)
  clock.advance(ABSENCE_GRACE_MS)
  assert.equal(games.rooms.size, 2, 'away seats are kept during the empty-room period')
  clock.advance(EMPTY_ROOM_TTL_MS)
  assert.equal(games.rooms.size, 0)
  assert.deepEqual(expired.sort(), [ana.room.code, cesc.room.code].sort())
  assert.equal(clock.timers.size, 0, 'no absence or expiry timer remains')
  for (const id of [ana.playerId, biel.playerId, cesc.playerId]) assert.equal(games.roomForPlayer(id), undefined)
}

// 3. Rejected joins and resumes keep the current seat.
{
  const { games } = managed()
  const ana = games.create('s-a', 'Ana', 'ca', 1)
  const host = games.create('s-h', 'Host', 'ca', 1)
  games.join('s-g', 'Guest', host.room.code)
  host.room.start(host.playerId)
  assert.throws(() => games.join('s-a', 'Ana', 'ZZZZZ'), /room-not-found/)
  assert.throws(() => games.join('s-a', 'Ana', host.room.code), /match-started/)
  assert.throws(() => games.resume('s-a', host.room.code, host.playerId, 'wrong-token'), /resume-rejected/)
  assert.throws(() => games.resume('s-a', host.room.code, 'nobody', host.reconnectToken), /room-not-found/)
  assert.equal(games.identityForSocket('s-a').playerId, ana.playerId)
  assert.equal(ana.room.player(ana.playerId).connectionState, 'connected')
  assert.equal(host.room.player(host.playerId).socketId, 's-h', 'the failed resume did not touch the other seat')
}

// 6. Reconnecting within the grace period: same seat, never away, no later timer.
{
  const { clock, games } = managed()
  const ana = games.create('s-a', 'Ana', 'ca', 1)
  const biel = games.join('s-b', 'Biel', ana.room.code)
  games.markReconnecting('s-b')
  clock.advance(ABSENCE_GRACE_MS - 1)
  games.resume('s-b2', ana.room.code, biel.playerId, biel.reconnectToken)
  clock.advance(ABSENCE_GRACE_MS * 10)
  assert.equal(ana.room.player(biel.playerId).connectionState, 'connected')
  assert.equal(clock.timers.size, 0)
}

// 7 (unit level). Resuming another seat on a connection that holds one treats the old seat as a lost connection (its
// credentials may still be valid elsewhere): it keeps the grace period, can return, and its room expires if left empty.
{
  const { clock, games, expired } = managed()
  const solo = games.create('s-a', 'Ana', 'ca', 1)
  const other = games.create('s-b', 'Biel', 'ca', 1)
  const guest = games.join('s-c', 'Cesc', other.room.code)
  games.markReconnecting('s-c')
  const { released } = games.resume('s-a', other.room.code, guest.playerId, guest.reconnectToken)
  assert.equal(released.playerId, solo.playerId)
  assert.equal(solo.room.player(solo.playerId).connectionState, 'reconnecting')
  assert.equal(games.identityForSocket('s-a').playerId, guest.playerId)
  clock.advance(ABSENCE_GRACE_MS)
  assert.equal(solo.room.player(solo.playerId).connectionState, 'disconnected', 'away after the grace period, seat kept')
  games.resume('s-d', solo.room.code, solo.playerId, solo.reconnectToken)
  assert.equal(solo.room.player(solo.playerId).connectionState, 'connected', 'the old seat can still return')
  games.markReconnecting('s-d')
  clock.advance(EMPTY_ROOM_TTL_MS)
  assert.deepEqual(expired, [solo.room.code])
  assert.equal(games.rooms.has(other.room.code), true, 'the resumed seat keeps its room alive')
}

// 8. Lobby: an explicit leave removes the seat at once; a lost connection keeps it (reconnecting, then away).
{
  const { clock, games } = managed()
  const ana = games.create('s-a', 'Ana', 'ca', 1)
  const biel = games.join('s-b', 'Biel', ana.room.code)
  const cesc = games.join('s-c', 'Cesc', ana.room.code)
  games.markReconnecting('s-b')
  games.leaveSocket('s-c')
  assert.deepEqual(ana.room.players.map((player: { name: string }) => player.name), ['Ana', 'Biel'])
  assert.equal(ana.room.player(cesc.playerId), undefined)
  clock.advance(ABSENCE_GRACE_MS)
  assert.equal(ana.room.player(biel.playerId).connectionState, 'disconnected')
  assert.equal(ana.room.player(biel.playerId).active, true)
  games.resume('s-b2', ana.room.code, biel.playerId, biel.reconnectToken)
  assert.equal(ana.room.viewFor(biel.playerId).players.length, 2)
  // The host leaving the lobby hands the role on, keeping the others' order.
  games.leaveSocket('s-a')
  assert.equal(ana.room.hostId, biel.playerId)
  assert.deepEqual(ana.room.players.map((player: { name: string }) => player.name), ['Biel'])
}

// 9. Repeated joins and departures never grow the roster; capacity counts current members only.
{
  const { games } = managed()
  const host = games.create('s-host', 'Host', 'ca', 1)
  for (let index = 0; index < 300; index += 1) {
    games.join(`s-${index}`, `P${index}`, host.room.code)
    games.leaveSocket(`s-${index}`)
  }
  assert.equal(host.room.players.length, 1)
  assert.equal(host.room.viewFor(host.playerId).players.length, 1)
  assert.equal(host.room.hostId, host.playerId)
  for (let index = 0; index < 9; index += 1) games.join(`f-${index}`, `F${index}`, host.room.code)
  assert.throws(() => games.join('f-extra', 'Extra', host.room.code), /room-full/)
  games.leaveSocket('f-3')
  games.join('f-extra', 'Extra', host.room.code)
  assert.equal(host.room.players.length, 10)
  assert.deepEqual(host.room.players.map((player: { name: string }) => player.name), ['Host', 'F0', 'F1', 'F2', 'F4', 'F5', 'F6', 'F7', 'F8', 'Extra'])
}

// 10 (unit level). Repeating a join after a lost acknowledgement returns the same seat instead of adding a second one.
{
  const { games } = managed()
  const host = games.create('s-host', 'Host', 'ca', 1)
  const first = games.join('s-b', 'Biel', host.room.code)
  const again = games.join('s-b', 'Biel', host.room.code)
  assert.equal(again.playerId, first.playerId)
  assert.equal(again.reconnectToken, first.reconnectToken)
  assert.equal(host.room.players.length, 2)
}

// 11. A full match after a lobby departure: completion, results with the whole roster (a match departure stays listed),
// then a rematch.
{
  const { games } = managed()
  const ana = games.create('s-a', 'Ana', 'ca', 1)
  const biel = games.join('s-b', 'Biel', ana.room.code)
  games.join('s-x', 'Xavi', ana.room.code)
  games.leaveSocket('s-x')
  const cesc = games.join('s-c', 'Cesc', ana.room.code)
  const dani = games.join('s-d', 'Dani', ana.room.code)
  const room = ana.room
  room.start(ana.playerId)
  const ids = [ana.playerId, biel.playerId, cesc.playerId, dani.playerId]
  let departed = false
  for (let steps = 0; room.roomStatus === 'active' && steps < 200; steps += 1) {
    const round = room.viewFor(ana.playerId).round
    if (round.status === 'choosing-word') room.setWord(round.setterId, 'CASA')
    else if (round.status === 'guessing') {
      // Dani leaves for good during the second turn; the turn and the match carry on without him.
      if (round.number === 2 && !departed) { games.leaveSocket('s-d'); departed = true; continue }
      for (const id of ids) if (room.viewFor(id).self?.status === 'playing') for (const letter of ['C', 'A', 'S']) if (room.viewFor(id).self?.status === 'playing') room.guess(id, letter)
    } else room.continue(round.nextSetterId)
  }
  assert.equal(room.roomStatus, 'match-over')
  const result = room.viewFor(ana.playerId).matchResult
  assert.deepEqual([...result.ranking].sort(), [...ids].sort(), 'results keep every roster member, including Dani')
  assert.equal(room.player(dani.playerId).active, false)
  assert.ok(Object.values(result.scores).some((score) => Number(score) > 0))
  for (const id of [ana.playerId, biel.playerId, cesc.playerId]) room.requestRematch(id)
  assert.equal(room.roomStatus, 'active', 'the rematch starts with the members who stayed')
  assert.deepEqual([...room.viewFor(ana.playerId).match.turnOrder].sort(), [ana.playerId, biel.playerId, cesc.playerId].sort())
}

// Socket.IO: real connections against the built server.
process.env.PORT = '3231'; process.env.HOST = '127.0.0.1'
const { httpServer, games } = await import('../dist-server/server/server.js')
if (!httpServer.listening) await once(httpServer, 'listening')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
type Inbox = { chat: string[]; states: { code: string; players: { id: string }[] }[]; replaced: string[] }
const clients: Socket[] = []
async function client() {
  const socket = io('http://127.0.0.1:3231', { forceNew: true, reconnection: false, transports: ['websocket'] }) as Socket & { inbox: Inbox }
  socket.inbox = { chat: [], states: [], replaced: [] }
  socket.on('chat:message', (message: { text: string }) => socket.inbox.chat.push(message.text))
  socket.on('room:state', (view: Inbox['states'][number]) => socket.inbox.states.push(view))
  socket.on('room:replaced', (payload: { reason: string }) => socket.inbox.replaced.push(payload.reason))
  clients.push(socket)
  await once(socket, 'connect')
  return socket
}
const send = (socket: Socket, event: string, ...payload: unknown[]) => socket.timeout(2_000).emitWithAck(event, ...payload)
const create = async (socket: Socket, name: string) => (await send(socket, 'room:create', { name })).data.session
const join = async (socket: Socket, name: string, code: string) => send(socket, 'room:join', { name, code })
const say = async (socket: Socket, text: string) => assert.equal((await send(socket, 'chat:send', { text })).ok, true)
const seatsOf = (socketId: string) => [...games.rooms.values()].flatMap((room) => room.players.filter((player: { socketId: string | null }) => player.socketId === socketId))

try {
  // 1/10. A create whose acknowledgement is lost (client timeout), then retried: one room remains, and the late reply
  // never reaches the page. The same for a repeated join: one seat.
  {
    const ana = await client()
    const before = games.rooms.size
    await assert.rejects(ana.timeout(0).emitWithAck('room:create', { name: 'Ana' }))
    await sleep(100)
    const session = await create(ana, 'Ana')
    assert.equal(games.rooms.size, before + 1, 'the retried creation left no orphaned room')
    assert.equal(seatsOf(ana.id!).length, 1)
    const biel = await client()
    await assert.rejects(biel.timeout(0).emitWithAck('room:join', { name: 'Biel', code: session.roomCode }))
    await sleep(100)
    const joined = await join(biel, 'Biel', session.roomCode)
    assert.equal(joined.ok, true)
    assert.equal(games.rooms.get(session.roomCode).players.length, 2, 'the repeated join kept one seat')
  }

  // 2/5. Switching rooms: the old room drops the seat and stops reaching this connection; the new room does reach it.
  {
    const ana = await client(), biel = await client(), cesc = await client()
    const first = await create(ana, 'Ana')
    assert.equal((await join(biel, 'Biel', first.roomCode)).ok, true)
    const second = await create(cesc, 'Cesc')
    await sleep(100)
    biel.inbox.states.length = 0
    assert.equal((await join(ana, 'Ana', second.roomCode)).ok, true)
    await sleep(150)
    const latest = biel.inbox.states.at(-1)!
    assert.deepEqual(latest.players.map((player) => player.id), [games.rooms.get(first.roomCode).hostId], 'Biel sees Ana gone (and is host)')
    ana.inbox.chat.length = 0; cesc.inbox.chat.length = 0; biel.inbox.chat.length = 0
    await say(biel, 'only the first room')
    await say(ana, 'only the second room')
    await sleep(150)
    assert.deepEqual(ana.inbox.chat, ['only the second room'], 'no message from the room Ana left')
    assert.deepEqual(biel.inbox.chat, ['only the first room'])
    assert.deepEqual(cesc.inbox.chat, ['only the second room'])
    assert.equal((await send(ana, 'room:resume', first)).error, 'room-not-found', 'the given-up seat cannot be resumed')
    assert.equal(seatsOf(ana.id!).length, 1)
  }

  // 3. Failed join and resume over the wire: the current room keeps reaching the connection both ways.
  {
    const ana = await client(), biel = await client(), host = await client(), guest = await client()
    const mine = await create(ana, 'Ana')
    await join(biel, 'Biel', mine.roomCode)
    const busy = await create(host, 'Host')
    await join(guest, 'Guest', busy.roomCode)
    assert.equal((await send(host, 'room:start')).ok, true)
    assert.equal((await join(ana, 'Ana', 'ZZZZZ')).error, 'room-not-found')
    assert.equal((await join(ana, 'Ana', busy.roomCode)).error, 'match-started')
    assert.equal((await send(ana, 'room:resume', { ...busy, reconnectToken: 'wrong' })).error, 'resume-rejected')
    ana.inbox.chat.length = 0
    await say(biel, 'still here')
    await say(ana, 'me too')
    await sleep(150)
    assert.deepEqual(ana.inbox.chat, ['still here', 'me too'])
    assert.equal(games.identityForSocket(ana.id).room.code, mine.roomCode)
  }

  // 7. Same-profile takeover from another tab that already sat elsewhere: the first tab is told and hears nothing more;
  // the second tab hears only the resumed room, and its previous seat waits as reconnecting (credentials kept).
  {
    const tab1 = await client(), tab2 = await client(), friend = await client()
    const seat = await create(tab1, 'Ana')
    await join(friend, 'Biel', seat.roomCode)
    const elsewhere = await create(tab2, 'Ana B')
    const resumed = await send(tab2, 'room:resume', seat)
    assert.equal(resumed.ok, true)
    await sleep(150)
    assert.deepEqual(tab1.inbox.replaced, ['takeover'])
    assert.equal(games.rooms.get(elsewhere.roomCode).player(elsewhere.playerId).connectionState, 'reconnecting')
    tab1.inbox.chat.length = 0; tab2.inbox.chat.length = 0
    await say(friend, 'hello Ana')
    await sleep(150)
    assert.deepEqual(tab1.inbox.chat, [], 'the replaced tab receives nothing')
    assert.deepEqual(tab2.inbox.chat, ['hello Ana'])
    assert.equal((await send(tab1, 'chat:send', { text: 'ghost' })).error, 'not-room-member', 'the replaced tab cannot post')
    assert.equal(seatsOf(tab2.id!).length, 1, 'the old seat no longer belongs to this connection')
    // The old seat returns from a third connection, as a refresh would.
    const tab3 = await client()
    assert.equal((await send(tab3, 'room:resume', elsewhere)).ok, true)
  }

  // 8/11 over the wire: explicit lobby leave vs disconnect, then a full match, results and rematch.
  {
    const ana = await client(), biel = await client(), cesc = await client(), dani = await client()
    const room = await create(ana, 'Ana')
    for (const [socket, name] of [[biel, 'Biel'], [cesc, 'Cesc'], [dani, 'Dani']] as const) await join(socket, name, room.roomCode)
    assert.equal((await send(dani, 'room:leave')).ok, true)
    cesc.disconnect()
    await sleep(150)
    const lobby = games.rooms.get(room.roomCode)
    assert.deepEqual(lobby.players.map((player: { name: string; connectionState: string }) => `${player.name}:${player.connectionState}`), ['Ana:connected', 'Biel:connected', 'Cesc:reconnecting'])
    assert.equal((await send(ana, 'room:start')).ok, true)
    // The first setter is random: wherever reconnecting Cesc blocks (setter, guesser, next setter), the host continues
    // without him, after which he is away and skipped.
    const cescId = lobby.players[2].id
    const skipCesc = async () => assert.equal((await send(ana, 'room:continue-without', { playerId: cescId })).ok, true)
    for (let steps = 0; lobby.roomStatus === 'active' && steps < 100; steps += 1) {
      const round = lobby.viewFor(lobby.hostId).round
      const as = (id: string) => [ana, biel].find((socket) => games.identityForSocket(socket.id)?.playerId === id)!
      if (round.status === 'choosing-word') {
        if (round.setterId === cescId) await skipCesc()
        else assert.equal((await send(as(round.setterId), 'round:set-word', { word: 'CASA' })).ok, true)
      } else if (round.status === 'guessing') {
        for (const socket of [ana, biel]) for (const letter of ['C', 'A', 'S']) if (lobby.viewFor(games.identityForSocket(socket.id).playerId).self?.status === 'playing') await send(socket, 'game:guess', { letter })
        if (lobby.viewFor(lobby.hostId).round.status === 'guessing') await skipCesc()
      } else if (round.nextSetterId === cescId) await skipCesc()
      else if (round.nextSetterId) assert.equal((await send(as(round.nextSetterId), 'round:continue')).ok, true)
    }
    assert.equal(lobby.roomStatus, 'match-over')
    await sleep(100)
    assert.equal(ana.inbox.states.at(-1)!.players.length, 3, 'results list the match roster')
    assert.equal((await send(ana, 'match:rematch')).ok, true)
    assert.equal((await send(biel, 'match:rematch')).ok, true)
    assert.equal(lobby.roomStatus, 'active')
    // Abandoned mid-match: both connected players leave; their seats stay listed for the results, Cesc's away seat keeps
    // the room until the empty-room expiry, and neither connection holds a seat any more.
    assert.equal((await send(ana, 'room:leave')).ok, true)
    assert.equal((await send(biel, 'room:leave')).ok, true)
    assert.equal(lobby.roomStatus, 'match-over')
    assert.deepEqual(lobby.players.map((player: { active: boolean }) => player.active), [false, false, true])
    assert.equal(seatsOf(ana.id!).length + seatsOf(biel.id!).length, 0)
    assert.equal(games.identityForSocket(ana.id), undefined)
  }
} finally {
  for (const socket of clients) socket.disconnect()
  httpServer.close()
}

console.log('Seat lifecycle checks passed: repeated creation, room switching, failed join/resume, expiry and timers, stale subscriptions and chat, grace-period return, takeover, lobby leave vs disconnect, roster growth, lost acknowledgements, match, results and rematch')
