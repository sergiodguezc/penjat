import assert from 'node:assert/strict'
import { GameRoom } from '../dist-server/server/game/GameRoom.js'

const room = new GameRoom('TEST', 'es', 1, () => 0)
room.addPlayer('setter', 's1', 't1', 'Setter')
room.addPlayer('guesser', 's2', 't2', 'Guesser')
room.start('setter')
room.setWord('setter', 'A')

for (const letter of ['B', 'C', 'D', 'E', 'F']) room.guess('guesser', letter)
assert.equal(room.viewFor('guesser').round.status, 'guessing')
assert.equal(room.viewFor('guesser').self.errors, 5)

room.guess('guesser', 'G')
let view = room.viewFor('guesser')
assert.equal(view.self.status, 'awaiting-forgiveness')
assert.equal(view.self.errors, 6)
assert.equal(view.privateWord, undefined)
assert.deepEqual(view.self.wrongLetters, ['B', 'C', 'D', 'E', 'F', 'G'])
assert.deepEqual(view.forgivenessRequests, [])
assert.throws(() => room.guess('guesser', 'H'), /not-guesser/)
const setterRequest = room.viewFor('setter').forgivenessRequests[0]
assert.ok(setterRequest)
assert.throws(() => room.decideForgiveness('guesser', setterRequest.id, true), /cannot-decide-forgiveness/)

const requestId = setterRequest.id
room.decideForgiveness('setter', requestId, true)
view = room.viewFor('guesser')
assert.equal(view.self.status, 'playing')
assert.equal(view.self.errors, 6)
assert.equal(view.self.forgiven, true)
assert.deepEqual(view.self.guessedLetters, ['B', 'C', 'D', 'E', 'F', 'G'])
assert.deepEqual(view.self.wrongLetters, ['B', 'C', 'D', 'E', 'F', 'G'])
assert.throws(() => room.decideForgiveness('setter', requestId, true), /cannot-decide-forgiveness/)
assert.throws(() => room.decideForgiveness('setter', requestId, false), /cannot-decide-forgiveness/)
room.guess('guesser', 'G')
assert.equal(room.viewFor('guesser').self.errors, 6, 'repeated mistakes stay recorded but are not counted twice')

room.guess('guesser', 'H')
assert.equal(room.viewFor('guesser').self.status, 'eliminated')
assert.equal(room.viewFor('guesser').self.errors, 7)
assert.equal(room.viewFor('guesser').round.status, 'round-over')
assert.equal(room.viewFor('guesser').players.find((player) => player.id === 'setter').score, 0)
assert.equal(room.viewFor('guesser').privateWord, 'A')
assert.deepEqual(room.viewFor('guesser').self.wrongLetters, ['B', 'C', 'D', 'E', 'F', 'G', 'H'])
assert.deepEqual(room.viewFor('guesser').round.results.find((result) => result.playerId === 'guesser'), {
  playerId: 'guesser', position: 1, status: 'eliminated', forgiven: true, errors: 7,
  resolutionTimeMs: room.viewFor('guesser').self.resolutionTimeMs, pointsAwarded: 0,
})

// An earlier forgiven solve must still rank behind a later solve with fewer mistakes.
const originalNow = Date.now
let now = 10_000
Date.now = () => now
try {
  const scored = new GameRoom('SCORE', 'ca', 1, () => 0)
  for (const id of ['setter', 'forgiven', 'cleaner', 'eliminated']) scored.addPlayer(id, `s-${id}`, `t-${id}`, id)
  scored.start('setter'); scored.setWord('setter', 'A')
  for (const id of ['forgiven', 'eliminated']) {
    for (const letter of ['B', 'C', 'D', 'E', 'F', 'G']) scored.guess(id, letter)
    const before = structuredClone(scored.viewFor(id).self)
    const request = scored.viewFor('setter').forgivenessRequests.find((item) => item.playerId === id)
    assert.throws(() => scored.decideForgiveness(id, request.id, true), /cannot-decide-forgiveness/)
    scored.decideForgiveness('setter', request.id, true)
    assert.deepEqual(scored.viewFor(id).self, { ...before, status: 'playing', forgiven: true }, 'granting a life changes only eligibility, not history/timing')
    assert.throws(() => scored.decideForgiveness('setter', request.id, true), /cannot-decide-forgiveness/)
    assert.throws(() => scored.decideForgiveness('setter', request.id, false), /cannot-decide-forgiveness/)
  }
  now += 100
  scored.guess('forgiven', 'A')
  const winner = scored.viewFor('forgiven').self
  assert.equal(winner.status, 'solved')
  assert.equal(winner.errors, 6)
  assert.equal(winner.forgiven, true)
  assert.deepEqual(winner.guessedLetters, ['B', 'C', 'D', 'E', 'F', 'G', 'A'])
  assert.deepEqual(winner.wrongLetters, ['B', 'C', 'D', 'E', 'F', 'G'])
  scored.guess('eliminated', 'H')
  assert.equal(scored.viewFor('eliminated').self.errors, 7)
  assert.equal(scored.viewFor('eliminated').self.status, 'eliminated')
  const requests = scored.viewFor('setter').forgivenessRequests
  assert.equal(requests.length, 2, 'the seventh mistake never creates a second opportunity')
  const eliminatedRequest = requests.find((request) => request.playerId === 'eliminated')
  assert.throws(() => scored.decideForgiveness('setter', eliminatedRequest.id, true), /cannot-decide-forgiveness/)
  assert.throws(() => scored.guess('eliminated', 'I'), /not-guesser/)
  now += 100
  scored.guess('cleaner', 'B'); scored.guess('cleaner', 'A')
  const final = structuredClone(scored.viewFor('setter'))
  assert.deepEqual(final.round.ranking, ['cleaner', 'forgiven', 'eliminated'])
  assert.deepEqual(final.round.results.map(({ playerId, status, errors, forgiven, pointsAwarded }) => [playerId, status, errors, forgiven, pointsAwarded]), [
    ['cleaner', 'solved', 1, false, 3], ['forgiven', 'solved', 6, true, 2],
    ['eliminated', 'eliminated', 7, true, 0], ['setter', 'setter', null, false, 0],
  ])
  assert.equal(final.round.results.reduce((total, result) => total + (result.errors ?? 0), 0), 14, 'round results include all historical and post-forgiveness errors')
  assert.deepEqual(final.players.map(({ id, score }) => [id, score]), [['setter', 0], ['forgiven', 2], ['cleaner', 3], ['eliminated', 0]])
  assert.throws(() => scored.decideForgiveness('setter', eliminatedRequest.id, true))
  assert.throws(() => scored.guess('forgiven', 'H'))
  assert.deepEqual(scored.viewFor('setter'), final, 'replayed actions cannot change results or award points twice')
  scored.continue('forgiven'); scored.setWord('forgiven', 'A')
  assert.throws(() => scored.decideForgiveness('forgiven', eliminatedRequest.id, true), /cannot-decide-forgiveness/)
  assert.equal(scored.viewFor('eliminated').self.errors, 0, 'only a new turn starts a fresh mistake history')
} finally {
  Date.now = originalNow
}

console.log('Forgiveness history, one-grant limit, subsequent mistakes, solved outcome, ranking and once-only scoring passed')
