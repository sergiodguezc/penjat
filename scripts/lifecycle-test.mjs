import assert from 'node:assert/strict'
import { GameManager } from '../dist-server/server/game/GameManager.js'

const games = new GameManager(() => 0)
const first = games.create('socket-a', 'Ana', 'es', 1)
const second = games.join('socket-b', 'Biel', first.room.code)
first.room.start(first.playerId)
first.room.setWord(first.playerId, 'CASA')
first.room.guess(second.playerId, 'C')
const before = first.room.viewFor(second.playerId)

const disconnected = games.markReconnecting('socket-b')
assert.ok(disconnected)
assert.equal(games.rooms.has(first.room.code), true)
assert.equal(first.room.player(second.playerId)?.connectionState, 'reconnecting')
assert.throws(() => first.room.guess(second.playerId, 'A'), /player-reconnecting/)

games.resume('socket-c', first.room.code, second.playerId, second.reconnectToken)
const after = first.room.viewFor(second.playerId)
assert.equal(first.room.player(second.playerId)?.socketId, 'socket-c')
assert.equal(first.room.player(second.playerId)?.connectionState, 'connected')
assert.equal(games.identityForSocket('socket-b'), undefined)
assert.equal(games.identityForSocket('socket-c')?.playerId, second.playerId)
assert.deepEqual(after.self.displayWord, before.self.displayWord)
assert.deepEqual(after.self.guessedLetters, before.self.guessedLetters)
assert.equal(after.round.number, before.round.number)
assert.equal(after.privateWord, undefined)

games.markReconnecting('socket-c')
games.removePlayer(second.playerId)
assert.equal(first.room.player(second.playerId)?.active, false)
assert.equal(games.rooms.has(first.room.code), true)
games.removePlayer(first.playerId)
assert.equal(games.rooms.has(first.room.code), false)

// Room codes come from the crypto generator: a constant Math.random (once the source of codes) changes nothing, every
// code keeps the 5-character unambiguous alphabet, and live codes never collide.
{
  const realRandom = Math.random
  Math.random = () => 0
  try {
    const codes = new GameManager(() => 0)
    const seen = new Set()
    for (let index = 0; index < 200; index += 1) {
      const { room } = codes.create(`code-socket-${index}`, 'Ana', 'ca', 1)
      assert.match(room.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/)
      seen.add(room.code)
    }
    assert.equal(seen.size, 200)
    assert.equal(codes.rooms.size, 200)
  } finally { Math.random = realRandom }
}

console.log('Reconnect lifecycle checks passed')
