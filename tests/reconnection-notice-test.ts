import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mock } from 'node:test'
import { listenForReconnections } from '../src/multiplayer/reconnectionNotice'

mock.timers.enable({ apis: ['setTimeout'] })
try {
  const events = new EventEmitter()
  let visible = false
  let updates = 0
  const subscribe = () => listenForReconnections(events as unknown as Parameters<typeof listenForReconnections>[0], 'ABCDE', 'self', (value) => { visible = value; updates++ })
  const reconnect = (playerId = 'other', roomCode = 'ABCDE') => events.emit('room:player-reconnected', { roomCode, playerId })
  const dispose = subscribe()
  reconnect('self'); reconnect('other', 'OTHER')
  assert.equal(visible, false, 'ignore own reconnection and other rooms')
  reconnect()
  assert.equal(visible, true, 'a live reconnection is shown')
  mock.timers.tick(3_999)
  events.emit('room:state', { code: 'ABCDE' })
  assert.equal(visible, true)
  mock.timers.tick(1)
  assert.equal(visible, false, 'dismiss at four seconds despite state updates')
  events.emit('room:state', { code: 'ABCDE' })
  assert.equal(visible, false, 'later snapshots cannot resurrect the notice')

  reconnect()
  mock.timers.tick(3_000)
  reconnect('third')
  mock.timers.tick(1_000)
  assert.equal(visible, true, 'the old timer cannot dismiss a newer reconnection')
  mock.timers.tick(3_000)
  assert.equal(visible, false, 'another player gets a fresh four seconds')
  reconnect('third')
  mock.timers.tick(4_000)
  assert.equal(visible, false, 'the same player can reconnect repeatedly')

  reconnect()
  events.emit('disconnect')
  assert.equal(visible, false, 'transport loss clears the local notice')
  const beforeDisconnectTimeout = updates
  mock.timers.tick(4_000)
  assert.equal(updates, beforeDisconnectTimeout, 'disconnect cancels the timer')
  reconnect()
  dispose()
  const beforeCleanup = updates
  mock.timers.tick(4_000)
  reconnect()
  assert.equal(updates, beforeCleanup, 'unmount cancels callbacks and subscriptions')
  assert.equal(events.listenerCount('room:player-reconnected'), 0)
  assert.equal(events.listenerCount('disconnect'), 0)
  const disposeRestored = subscribe()
  events.emit('room:state', { code: 'ABCDE' })
  assert.equal(visible, false, 'a fresh mount or restored session starts silently')
  disposeRestored()
} finally {
  mock.timers.reset()
}
console.log('Reconnection notice timer, repeated events, snapshots and cleanup checks passed')
