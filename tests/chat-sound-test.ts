import assert from 'node:assert/strict'
import { playChatSound, unlockChatSound } from '../src/multiplayer/chatSound'
let starts = 0, resumes = 0, peakGain = 0
let rejectResume = false, failNodes = false, hangResume = false
class FakeContext {
  static instance: FakeContext
  state = 'suspended'
  currentTime = 0
  destination = {}
  constructor() { FakeContext.instance = this }
  resume() {
    resumes++
    if (rejectResume) return Promise.reject(new Error('blocked'))
    if (hangResume) return new Promise<void>(() => {})
    this.state = 'running'; return Promise.resolve()
  }
  createOscillator() { if (failNodes) throw new Error('failed'); return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() { starts++ }, stop() {} } }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime(value: number) { peakGain = Math.max(peakGain, value) } }, connect() {}, disconnect() {} } }
}
assert.deepEqual(playChatSound(0), { ok: false, reason: 'not-ready' }, 'incoming messages cannot activate audio')
assert.deepEqual(await unlockChatSound(), { ok: false, reason: 'unsupported' })
Object.assign(globalThis, { AudioContext: FakeContext })
assert.deepEqual(await unlockChatSound(), { ok: true })
assert.equal(resumes, 1)
assert.deepEqual(playChatSound(0, true), { ok: true }, 'confirmation tests the sound independently')
assert.equal(starts, 2)
assert.equal(peakGain, .16)
assert.deepEqual(playChatSound(0), { ok: true }, 'confirmation does not consume notification cooldown')
assert.equal(starts, 4)
assert.deepEqual(playChatSound(7999), { ok: false, reason: 'cooldown' })
assert.equal(starts, 4)
assert.deepEqual(playChatSound(8000), { ok: true })
await unlockChatSound()
assert.equal(resumes, 1, 'reuse the running context')
FakeContext.instance.state = 'interrupted'
assert.deepEqual(playChatSound(16000), { ok: false, reason: 'not-ready' })
rejectResume = true
assert.deepEqual(await unlockChatSound(), { ok: false, reason: 'blocked' }, 'rejected activation is reported')
rejectResume = false
assert.deepEqual(await unlockChatSound(), { ok: true })
failNodes = true
assert.deepEqual(playChatSound(16000), { ok: false, reason: 'failed' })
failNodes = false
assert.deepEqual(playChatSound(16000), { ok: true }, 'failed playback does not consume cooldown')
FakeContext.instance.state = 'closed'
assert.deepEqual(await unlockChatSound(), { ok: true }, 'a closed engine can be recreated by a gesture')
FakeContext.instance.state = 'suspended'; hangResume = true
assert.deepEqual(await unlockChatSound(), { ok: false, reason: 'blocked' }, 'Safari resume promises cannot leave the UI pending forever')
console.log('Chat sound: activation, independent confirmation, volume, cooldown, interruption, unsupported/blocked/failed audio and timeout passed')
