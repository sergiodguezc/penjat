// Characterizes GameRoom's per-guess transitions and round scoring (from source, no build needed). Written before the
// rules moved to shared/round.ts, so the extraction (and local play, which reuses it) must keep these exact results.
import assert from 'node:assert/strict'
import { GameRoom } from '../server/game/GameRoom'

let now = 0
Date.now = () => now

function newRoom(ids: string[], language: 'ca' | 'es' = 'ca', voltes: 1 | 3 | 5 = 1) {
  const room = new GameRoom('TEST', language, voltes, () => 0)
  for (const id of ids) room.addPlayer(id, `socket-${id}`, `token-${id}`, id.toUpperCase())
  room.start(ids[0])
  return room
}
const guess = (room: GameRoom, id: string, letters: string) => { for (const letter of letters) room.guess(id, letter) }
const decide = (room: GameRoom, setterId: string, playerId: string, forgive: boolean) => {
  const request = room.viewFor(setterId).forgivenessRequests.find((candidate) => candidate.playerId === playerId && candidate.status === 'pending')
  assert.ok(request, `pending request for ${playerId}`)
  room.decideForgiveness(setterId, request.id, forgive)
}
const results = (room: GameRoom) => room.viewFor(room.players[0].id).round!.results
const setterEntry = (playerId: string) => ({ playerId, position: null, status: 'setter', forgiven: false, errors: null, resolutionTimeMs: null, pointsAwarded: 0 })

// Guess transitions: accent folding, Ç, automatic punctuation, repeated and invalid letters, solving on the last letter.
{
  now = 0
  const room = newRoom(['s', 'a'])
  room.setWord('s', "  plaça   d'ànec ")
  assert.equal(room.viewFor('s').privateWord, "PLAÇA D'ÀNEC")
  room.guess('a', 'à')
  let self = room.viewFor('a').self!
  assert.deepEqual(self.guessedLetters, ['A'])
  assert.deepEqual(self.displayWord, ['_', '_', 'A', '_', 'A', ' ', '_', "'", 'À', '_', '_', '_'])
  room.guess('a', 'A'); room.guess('a', 'a')
  assert.deepEqual(room.viewFor('a').self!.guessedLetters, ['A'])
  for (const invalid of ['1', 'AB', 'Ñ', '']) assert.throws(() => room.guess('a', invalid), /invalid-guess/)
  assert.throws(() => room.guess('s', 'P'), /not-guesser/)
  room.guess('a', 'x')
  self = room.viewFor('a').self!
  assert.equal(self.errors, 1)
  assert.deepEqual(self.wrongLetters, ['X'])
  now = 4000
  guess(room, 'a', 'PLçDNE')
  assert.equal(room.viewFor('a').self!.status, 'playing')
  room.guess('a', 'C')
  self = room.viewFor('a').self!
  assert.equal(self.status, 'solved')
  assert.equal(self.resolutionTimeMs, 4000)
  assert.deepEqual(results(room), [
    { playerId: 'a', position: 1, status: 'solved', forgiven: false, errors: 1, resolutionTimeMs: 4000, pointsAwarded: 1 },
    setterEntry('s'),
  ])
  assert.throws(() => room.guess('a', 'B'), /not-available/)
}

// Spanish keeps Ñ and rejects Ç.
{
  const room = newRoom(['s', 'a'], 'es')
  room.setWord('s', 'niño')
  room.guess('a', 'ñ')
  assert.deepEqual(room.viewFor('a').self!.displayWord, ['_', '_', 'Ñ', '_'])
  assert.throws(() => room.guess('a', 'Ç'), /invalid-guess/)
}

// Forgiveness: the sixth error waits for the setter; one grant per round; after it one more error eliminates.
{
  now = 0
  const room = newRoom(['s', 'grant-out', 'grant-solve', 'deny'])
  room.setWord('s', 'GAT')
  for (const id of ['grant-out', 'grant-solve', 'deny']) guess(room, id, 'BCDEFH')
  for (const id of ['grant-out', 'grant-solve', 'deny']) {
    const self = room.viewFor(id).self!
    assert.equal(self.status, 'awaiting-forgiveness')
    assert.equal(self.errors, 6)
    assert.throws(() => room.guess(id, 'G'), /not-guesser/)
  }
  assert.equal(room.viewFor('s').forgivenessRequests.length, 3)
  assert.deepEqual(room.viewFor('deny').forgivenessRequests, [])

  now = 1000; decide(room, 's', 'grant-out', true)
  assert.equal(room.viewFor('grant-out').self!.status, 'playing')
  room.guess('grant-out', 'H')
  assert.equal(room.viewFor('grant-out').self!.errors, 6)
  now = 2000; room.guess('grant-out', 'I')
  assert.equal(room.viewFor('grant-out').self!.status, 'eliminated')
  assert.equal(room.viewFor('grant-out').self!.errors, 7)
  assert.equal(room.viewFor('s').forgivenessRequests.filter((request) => request.playerId === 'grant-out').length, 1)

  now = 3000; decide(room, 's', 'grant-solve', true)
  guess(room, 'grant-solve', 'GAT')
  assert.equal(room.viewFor('grant-solve').self!.forgiven, true)

  now = 5000; decide(room, 's', 'deny', false)
  assert.deepEqual(results(room), [
    { playerId: 'grant-solve', position: 1, status: 'solved', forgiven: true, errors: 6, resolutionTimeMs: 3000, pointsAwarded: 3 },
    { playerId: 'deny', position: 2, status: 'failed', forgiven: false, errors: 6, resolutionTimeMs: 5000, pointsAwarded: 0 },
    { playerId: 'grant-out', position: 3, status: 'eliminated', forgiven: true, errors: 7, resolutionTimeMs: 2000, pointsAwarded: 0 },
    setterEntry('s'),
  ])
}

// Round order: solved first, fewer errors, shorter time, then roster order; G−i points only for solved entries.
{
  now = 0
  const room = newRoom(['s', 'a', 'b', 'c'])
  room.setWord('s', 'GAT')
  now = 3000; guess(room, 'b', 'XGAT')
  now = 5000; guess(room, 'a', 'XGAT')
  now = 9000; guess(room, 'c', 'GAT')
  assert.deepEqual(results(room), [
    { playerId: 'c', position: 1, status: 'solved', forgiven: false, errors: 0, resolutionTimeMs: 9000, pointsAwarded: 3 },
    { playerId: 'b', position: 2, status: 'solved', forgiven: false, errors: 1, resolutionTimeMs: 3000, pointsAwarded: 2 },
    { playerId: 'a', position: 3, status: 'solved', forgiven: false, errors: 1, resolutionTimeMs: 5000, pointsAwarded: 1 },
    setterEntry('s'),
  ])
  assert.deepEqual(room.viewFor('s').round!.ranking, ['c', 'b', 'a'])
}
{
  now = 0
  const room = newRoom(['s', 'a', 'b', 'c', 'd'])
  room.setWord('s', 'GAT')
  now = 1000; guess(room, 'b', 'GAT'); guess(room, 'a', 'GAT')
  guess(room, 'd', 'BCDEFH'); decide(room, 's', 'd', true); now = 1500; room.guess('d', 'I')
  guess(room, 'c', 'BCDEFH'); now = 2000; decide(room, 's', 'c', false)
  assert.deepEqual(results(room), [
    { playerId: 'a', position: 1, status: 'solved', forgiven: false, errors: 0, resolutionTimeMs: 1000, pointsAwarded: 4 },
    { playerId: 'b', position: 2, status: 'solved', forgiven: false, errors: 0, resolutionTimeMs: 1000, pointsAwarded: 3 },
    { playerId: 'c', position: 3, status: 'failed', forgiven: false, errors: 6, resolutionTimeMs: 2000, pointsAwarded: 0 },
    { playerId: 'd', position: 4, status: 'eliminated', forgiven: true, errors: 7, resolutionTimeMs: 1500, pointsAwarded: 0 },
    setterEntry('s'),
  ])
  assert.deepEqual(Object.fromEntries(room.players.map((player) => [player.id, player.score])), { s: 0, a: 4, b: 3, c: 0, d: 0 })
}

// A full three-player match with tied totals: match ranking orders by score, then roster order.
{
  now = 0
  const room = newRoom(['x', 'y', 'z'])
  const view = () => room.viewFor('x')
  assert.deepEqual(view().match.turnOrder, ['x', 'y', 'z'])
  assert.equal(view().match.totalTurns, 3)

  room.setWord('x', 'GAT')
  now = 1000; guess(room, 'y', 'GAT')
  now = 2000; guess(room, 'z', 'GAT')
  assert.equal(view().round!.nextSetterId, 'y')
  assert.throws(() => room.continue('x'), /cannot-continue/)
  room.continue('y')

  now = 10_000; room.setWord('y', 'GOS')
  now = 11_000; guess(room, 'z', 'GOS')
  now = 12_000; guess(room, 'x', 'GOS')
  room.continue('z')

  now = 20_000; room.setWord('z', 'LLOP')
  now = 21_000; guess(room, 'x', 'LOP')
  guess(room, 'y', 'BCDEFG'); decide(room, 'z', 'y', false)

  assert.equal(room.roomStatus, 'match-over')
  assert.deepEqual(view().matchResult, { ranking: ['x', 'z', 'y'], scores: { x: 3, y: 2, z: 3 } })
}

console.log('round rules characterization: ok')
