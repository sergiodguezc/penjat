// Retained seats with controlled time (run `npm run build:server` first): a lost connection is frozen for the 2-minute
// grace period (or until a permitted player continues without them, when they block the room), then the player is away —
// seat, identity and score kept, game no longer waiting — until they return, leave explicitly, or the room expires
// after nobody has been connected for the empty-room TTL.
import assert from 'node:assert/strict'
import { GameManager, ABSENCE_GRACE_MS, EMPTY_ROOM_TTL_MS } from '../dist-server/server/game/GameManager.js'

class Clock {
  now = 0; next = 1; timers = new Map()
  setTimeout(callback, ms) { const id = this.next++; this.timers.set(id, { at: this.now + ms, callback }); return id }
  clearTimeout(id) { this.timers.delete(id) }
  advance(ms) {
    const target = this.now + ms
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.timers.delete(due[0]); this.now = due[1].at; due[1].callback()
    }
    this.now = target
  }
}
const HOUR = 3600_000
function setup(names = ['Ana', 'Biel', 'Cesc']) {
  const clock = new Clock(), changes = [], expired = []
  const games = new GameManager(() => 0, { scheduler: clock, onRoomChange: (code) => changes.push(code), onRoomExpired: (code) => expired.push(code) })
  const host = games.create('s-0', names[0], 'ca', 1)
  const players = [{ id: host.playerId, token: host.reconnectToken, socket: 's-0' }]
  for (const [index, name] of names.slice(1).entries()) {
    const joined = games.join(`s-${index + 1}`, name, host.room.code)
    players.push({ id: joined.playerId, token: joined.reconnectToken, socket: `s-${index + 1}` })
  }
  let sockets = 100
  const drop = (player) => { assert.ok(games.markReconnecting(player.socket)); player.socket = null }
  const back = (player) => { player.socket = `s-${sockets++}`; return games.resume(player.socket, host.room.code, player.id, player.token) }
  const state = (player) => host.room.player(player.id)
  const skip = (actor, target) => games.continueWithout(actor.socket, target.id)
  const skippable = (player) => host.room.viewFor(player.id).skippablePlayerIds
  return { clock, games, room: host.room, players, changes, expired, drop, back, state, skip, skippable }
}

// 1. Lobby: a dropped player is frozen during the grace period, then away; the seat survives far beyond the old
// 25-second removal and is restored with the same identity, as connected, without a duplicate.
{
  const { clock, room, players: [ana, biel], changes, drop, back, state } = setup(['Ana', 'Biel'])
  drop(biel)
  clock.advance(ABSENCE_GRACE_MS - 1)
  assert.equal(state(biel).connectionState, 'reconnecting')
  clock.advance(1)
  assert.equal(state(biel).connectionState, 'disconnected', 'away after the grace period')
  assert.equal(state(biel).active, true, 'seat kept')
  assert.deepEqual(changes, [room.code], 'members are told the player is away')
  clock.advance(5 * HOUR)
  back(biel)
  assert.equal(state(biel).connectionState, 'connected')
  assert.equal(room.players.length, 2)
  assert.equal(room.hostId, ana.id)
}

// 2. Host: an away host hands the role to the first connected member; returning never makes a second host.
{
  const { clock, room, players: [ana, biel, cesc], drop, back } = setup()
  drop(ana)
  clock.advance(ABSENCE_GRACE_MS - 1)
  assert.equal(room.hostId, ana.id, 'a reconnecting host keeps the role during the grace period')
  clock.advance(1)
  assert.equal(room.hostId, biel.id)
  back(ana)
  assert.equal(room.hostId, biel.id, 'the transferred role stays')
  assert.equal(room.viewFor(ana.id).hostId, biel.id)
  assert.throws(() => room.start(ana.id), /not-host/)
  // Every member away: the host stays on its away seat until someone returns, who then hosts.
  drop(biel); drop(cesc); drop(ana)
  clock.advance(ABSENCE_GRACE_MS)
  assert.equal(room.hostId, biel.id)
  back(cesc)
  assert.equal(room.hostId, cesc.id, 'the first member back hosts when the host is away')
  back(biel)
  assert.equal(room.hostId, cesc.id)
}

// 3. Lobby start needs two present players; away seats join the roster and are skipped until they return.
{
  const { clock, room, players: [ana, biel, cesc], drop } = setup()
  drop(biel); drop(cesc)
  clock.advance(ABSENCE_GRACE_MS)
  assert.throws(() => room.start(ana.id), /not-enough-players/)
}

// 4. Setter away while choosing: frozen during the grace period, then the turn is cancelled without points and the
// next present setter continues; on return the former setter keeps the score and does not undo the new turn.
{
  const { clock, room, players: [ana, biel], drop, back } = setup()
  room.start(ana.id)
  assert.equal(room.viewFor(ana.id).round.setterId, ana.id)
  drop(ana)
  clock.advance(ABSENCE_GRACE_MS - 1)
  assert.equal(room.viewFor(biel.id).round.setterId, ana.id, 'nothing moves during the grace period')
  clock.advance(1)
  const view = room.viewFor(biel.id)
  assert.equal(view.round.setterId, biel.id, 'the next present setter takes the turn')
  assert.equal(view.round.number, 2)
  assert.equal(room.hostId, biel.id)
  assert.equal(view.players.find((player) => player.id === ana.id).roundStatus, 'spectating', 'away during this turn, not beaten')
  back(ana) // back before the word is set: joins this turn
  assert.equal(room.viewFor(ana.id).self.status, 'playing')
  assert.equal(room.viewFor(ana.id).round.number, 2)
}

// 5. Guesser away while guessing: eliminated after the grace period, so the round finishes for the others; the
// returning player stays eliminated for that turn (nothing undone) and keeps the earlier score.
{
  const { clock, room, players: [ana, biel, cesc], drop, back } = setup()
  room.start(ana.id)
  room.setWord(ana.id, 'CASA')
  for (const letter of 'CAS') room.guess(cesc.id, letter)
  assert.equal(room.viewFor(cesc.id).self.status, 'solved')
  room.guess(biel.id, 'C')
  drop(biel)
  assert.throws(() => room.guess(biel.id, 'A'), /player-reconnecting|not-room-member|not-guesser/)
  clock.advance(ABSENCE_GRACE_MS)
  const view = room.viewFor(cesc.id)
  assert.equal(view.round.status, 'round-over', 'the round no longer waits for the away guesser')
  assert.equal(view.round.results.find((result) => result.playerId === biel.id).status, 'eliminated')
  const cescScore = room.player(cesc.id).score
  back(biel)
  const returned = room.viewFor(biel.id)
  assert.equal(returned.round.status, 'round-over')
  assert.equal(returned.self.status, 'eliminated')
  assert.deepEqual(returned.self.guessedLetters, ['C'], 'own progress is restored')
  assert.equal(room.player(cesc.id).score, cescScore)
}

// 6. Guesser away before the word is set sits the turn out unscored; back after the word, they watch until the next turn.
{
  const { clock, room, players: [ana, biel, cesc], drop, back } = setup()
  room.start(ana.id)
  drop(cesc)
  clock.advance(ABSENCE_GRACE_MS)
  room.setWord(ana.id, 'CASA')
  back(cesc)
  assert.equal(room.viewFor(cesc.id).self.status, 'eliminated', 'cannot join a turn whose word is set')
  for (const letter of 'CAS') room.guess(biel.id, letter)
  const round = room.viewFor(biel.id).round
  assert.equal(round.status, 'round-over')
  assert.deepEqual(round.ranking, [biel.id], 'a sat-out player is not ranked')
  assert.equal(round.results.find((result) => result.playerId === biel.id).pointsAwarded, 1, 'points count only players who played')
  assert.equal(round.results.some((result) => result.playerId === cesc.id), false)
  // The next turn includes the returned player normally.
  room.continue(round.nextSetterId)
  assert.equal(room.viewFor(cesc.id).round.setterId === cesc.id || room.viewFor(cesc.id).self.status === 'playing', true)
}

// 7. Next setter away at the end of a turn: the following present player continues; nobody waits.
{
  const { clock, room, players: [ana, biel, cesc], drop } = setup()
  room.start(ana.id)
  room.setWord(ana.id, 'CASA')
  for (const player of [biel, cesc]) for (const letter of 'CAS') room.guess(player.id, letter)
  assert.equal(room.viewFor(ana.id).round.nextSetterId, biel.id)
  drop(biel)
  assert.equal(room.viewFor(ana.id).round.nextSetterId, biel.id, 'a reconnecting next setter is still awaited')
  clock.advance(ABSENCE_GRACE_MS)
  assert.equal(room.viewFor(ana.id).round.nextSetterId, cesc.id)
  room.continue(cesc.id)
  assert.equal(room.viewFor(ana.id).round.setterId, cesc.id)
}

// 8. Fewer than two present players ends the match; the away seat keeps its score and can rematch on return.
// An away player never blocks a rematch of the others.
{
  const { clock, room, players: [ana, biel], drop, back } = setup(['Ana', 'Biel'])
  room.start(ana.id)
  drop(biel)
  clock.advance(ABSENCE_GRACE_MS)
  assert.equal(room.roomStatus, 'match-over')
  back(biel)
  assert.equal(room.viewFor(biel.id).roomStatus, 'match-over')
  room.requestRematch(ana.id); room.requestRematch(biel.id)
  assert.equal(room.roomStatus, 'active')
}
{
  const { clock, room, players: [ana, biel, cesc], drop, back } = setup()
  room.start(ana.id)
  drop(biel); drop(cesc)
  clock.advance(ABSENCE_GRACE_MS)
  assert.equal(room.roomStatus, 'match-over')
  back(biel)
  room.requestRematch(ana.id)
  assert.equal(room.roomStatus, 'match-over')
  room.requestRematch(biel.id)
  assert.equal(room.roomStatus, 'active', 'the away player does not block the rematch')
  const round = room.viewFor(ana.id).round
  assert.equal(room.viewFor(ana.id).match.turnOrder.includes(cesc.id), true, 'the away seat stays in the rotation')
  assert.equal(round.setterId === cesc.id, false)
}

// 9. Explicit leave gives the seat up at once; the last member leaving deletes the room immediately.
{
  const { games, room, players: [ana, biel], back } = setup(['Ana', 'Biel'])
  games.removePlayer(biel.id, biel.socket)
  assert.equal(room.player(biel.id).active, false)
  assert.throws(() => back(biel), /room-not-found|resume-rejected/)
  games.removePlayer(ana.id, ana.socket)
  assert.equal(games.rooms.has(room.code), false)
}

// 10. Cleanup stays bounded: away seats never keep a room alive once nobody is connected. A connected member keeps it.
{
  const { clock, games, room, players: [ana, biel], expired, drop, back } = setup(['Ana', 'Biel'])
  drop(biel)
  clock.advance(EMPTY_ROOM_TTL_MS * 3)
  assert.equal(games.rooms.has(room.code), true, 'a connected member keeps the room')
  drop(ana)
  clock.advance(EMPTY_ROOM_TTL_MS - 1)
  back(biel) // anyone returning cancels the expiry
  drop(biel)
  clock.advance(EMPTY_ROOM_TTL_MS - 1)
  assert.equal(games.rooms.has(room.code), true)
  clock.advance(1)
  assert.equal(games.rooms.has(room.code), false, 'expired after the TTL with nobody connected')
  assert.deepEqual(expired, [room.code])
  assert.equal(clock.timers.size, 0, 'no timer outlives the room')
  assert.throws(() => back(ana), /room-not-found/)
  assert.equal(games.roomForPlayer(ana.id), undefined)
}
{
  // A departure that leaves only away seats starts the expiry too.
  const { clock, games, room, players: [ana, biel], drop } = setup(['Ana', 'Biel'])
  drop(biel)
  clock.advance(ABSENCE_GRACE_MS)
  games.removePlayer(ana.id, ana.socket)
  assert.equal(games.rooms.has(room.code), true)
  clock.advance(EMPTY_ROOM_TTL_MS)
  assert.equal(games.rooms.has(room.code), false)
}

// 11. Within the 2-minute grace period nothing is lost: a guesser keeps playing the same word after returning.
{
  const { clock, room, players: [ana, biel, cesc], drop, back, state } = setup()
  assert.equal(ABSENCE_GRACE_MS, 2 * 60_000)
  room.start(ana.id); room.setWord(ana.id, 'CASA')
  room.guess(biel.id, 'C'); room.guess(biel.id, 'X')
  drop(biel)
  room.guess(cesc.id, 'C') // ordinary play goes on meanwhile
  clock.advance(ABSENCE_GRACE_MS - 1)
  assert.equal(state(biel).connectionState, 'reconnecting')
  back(biel)
  const self = room.viewFor(biel.id).self
  assert.equal(self.status, 'playing'); assert.equal(self.spectating, false)
  assert.deepEqual(self.guessedLetters, ['C', 'X']); assert.equal(self.errors, 1)
  for (const letter of 'AS') room.guess(biel.id, letter)
  assert.equal(room.viewFor(biel.id).self.status, 'solved')
  clock.advance(ABSENCE_GRACE_MS * 2)
  assert.equal(state(biel).connectionState, 'connected', 'the old timer never fires after a return')
}

// 12. The action appears only while the absence blocks progression, and only for the host or the turn's successor.
{
  const { clock, room, players: [ana, biel, cesc, dani], drop, skip, skippable } = setup(['Ana', 'Biel', 'Cesc', 'Dani'])
  room.start(ana.id)
  // A guesser dropping while the word is chosen blocks nothing.
  drop(dani)
  assert.deepEqual(room.blockingPlayerIds(), [])
  assert.deepEqual(skippable(ana), [])
  room.setWord(ana.id, 'CASA')
  // Still nothing: Biel and Cesc can keep guessing.
  assert.deepEqual(room.blockingPlayerIds(), [])
  for (const player of [biel, cesc]) for (const letter of 'CAS') room.guess(player.id, letter)
  // Now the round only waits for Dani: the host may continue without them; other players may not.
  assert.deepEqual(room.blockingPlayerIds(), [dani.id])
  assert.deepEqual(skippable(ana), [dani.id])
  assert.deepEqual(skippable(cesc), [])
  assert.throws(() => skip(cesc, dani), /cannot-skip-player/)
  assert.throws(() => skip(ana, biel), /player-reconnected/)
  skip(ana, dani)
  assert.equal(room.viewFor(ana.id).round.status, 'round-over', 'continuing applies the away handling at once')
  assert.equal(room.player(dani.id).connectionState, 'disconnected')
  assert.equal(clock.timers.size, 0, 'the automatic timer is cancelled')
  assert.equal(skip(ana, dani), room, 'a second, simultaneous request is harmless')
}

// 13. Setter choosing a word: the host and the player who would take the turn may continue; it then moves on.
{
  const { room, players: [ana, biel, cesc, dani], drop, back, skip, skippable } = setup(['Ana', 'Biel', 'Cesc', 'Dani'])
  room.start(ana.id)
  room.setWord(ana.id, 'CASA')
  for (const player of [biel, cesc, dani]) for (const letter of 'CAS') room.guess(player.id, letter)
  room.continue(biel.id)
  assert.equal(room.viewFor(ana.id).round.setterId, biel.id)
  drop(biel)
  assert.deepEqual(skippable(ana), [biel.id], 'the host')
  assert.deepEqual(skippable(cesc), [biel.id], 'the next setter')
  assert.deepEqual(skippable(dani), [])
  skip(cesc, biel)
  const view = room.viewFor(cesc.id)
  assert.equal(view.round.setterId, cesc.id); assert.equal(view.round.number, 3)
  // Back while Cesc is still choosing: Biel joins this turn as a guesser.
  back(biel)
  assert.equal(room.viewFor(biel.id).self.status, 'playing')
  assert.equal(room.viewFor(biel.id).self.spectating, false)
}

// 14. Reconnect/action races: a return before the action wins; after it, the player joins the current state as a
// spectator for the rest of the turn (not "out"), then plays the next turn.
{
  const { room, players: [ana, biel, cesc], drop, back, skip } = setup()
  room.start(ana.id); room.setWord(ana.id, 'CASA')
  for (const letter of 'CAS') room.guess(cesc.id, letter)
  drop(biel)
  back(biel)
  assert.throws(() => skip(ana, biel), /player-reconnected/)
  assert.equal(room.viewFor(biel.id).self.status, 'playing')
  drop(biel)
  skip(ana, biel)
  assert.equal(room.viewFor(ana.id).round.status, 'round-over')
  back(biel)
  const returned = room.viewFor(biel.id)
  assert.equal(returned.self.spectating, true, 'waiting for the next turn, not beaten')
  assert.equal(returned.players.find((player) => player.id === biel.id).roundStatus, 'spectating')
  room.continue(returned.round.nextSetterId)
  const next = room.viewFor(biel.id)
  assert.equal(next.round.setterId === biel.id || next.self.status === 'playing', true, 'plays the next turn')
}

// 15. Next setter at the end of a turn, a lobby host and a rematch: each blocking case offers the action.
{
  const { room, players: [ana, biel, cesc], drop, skip, skippable } = setup()
  room.start(ana.id); room.setWord(ana.id, 'CASA')
  for (const player of [biel, cesc]) for (const letter of 'CAS') room.guess(player.id, letter)
  drop(biel)
  assert.deepEqual(skippable(cesc), [biel.id], 'the player after Biel may continue')
  skip(cesc, biel)
  assert.equal(room.viewFor(ana.id).round.nextSetterId, cesc.id)
}
{
  const { room, players: [ana, biel, cesc], drop, skip, skippable } = setup()
  drop(ana)
  assert.deepEqual(skippable(biel), [ana.id], 'with the host missing, the first connected member decides')
  assert.deepEqual(skippable(cesc), [])
  skip(biel, ana)
  assert.equal(room.hostId, biel.id)
  room.start(biel.id)
  assert.equal(room.roomStatus, 'active')
}
{
  const { clock, room, players: [ana, biel, cesc], drop, back, skip, skippable } = setup()
  room.start(ana.id)
  drop(biel); drop(cesc); clock.advance(ABSENCE_GRACE_MS)
  back(biel); back(cesc)
  assert.equal(room.roomStatus, 'match-over')
  room.requestRematch(ana.id); room.requestRematch(biel.id)
  drop(cesc)
  assert.deepEqual(skippable(ana), [cesc.id])
  skip(ana, cesc)
  assert.equal(room.roomStatus, 'active', 'the rematch starts without the missing player')
}

console.log('Absence checks passed: seats beyond the old deadline, host transfer, setter/guesser/next-setter absence, match end and rematch, explicit leave, bounded room expiry, return within the grace period, blocking-only action with host/successor permissions, races, return as a spectator')
