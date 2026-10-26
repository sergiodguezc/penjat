import { debugChat } from './chatDebug'

export type ChatSoundResult = { ok: true } | { ok: false; reason: 'unsupported' | 'blocked' | 'not-ready' | 'cooldown' | 'failed' }
let context: AudioContext | undefined
let lastPlayed = -Infinity

// Called directly from a click/key gesture; incoming messages never resume audio or queue playback.
export async function unlockChatSound(): Promise<ChatSoundResult> {
  try {
    if (typeof AudioContext === 'undefined') return { ok: false, reason: 'unsupported' }
    if (!context || context.state === 'closed') {
      context = new AudioContext()
      context.onstatechange = () => debugChat('audio:state', { state: context?.state ?? 'none' })
    }
    debugChat('audio:unlock', { state: context.state })
    if (context.state !== 'running') {
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([context.resume(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('resume-timeout')), 2000) })]) }
      finally { clearTimeout(timer) }
    }
    const ok = context.state === 'running'
    debugChat('audio:unlocked', { state: context.state, ok })
    return ok ? { ok: true } : { ok: false, reason: 'blocked' }
  } catch (error) {
    debugChat('audio:unlock-failed', { error: error instanceof Error ? error.name : 'unknown', state: context?.state ?? 'none' })
    return { ok: false, reason: 'blocked' }
  }
}

export function playChatSound(now = Date.now(), test = false): ChatSoundResult {
  if (!context || context.state !== 'running') {
    debugChat('audio:skipped', { reason: 'not-ready', state: context?.state ?? 'none' })
    return { ok: false, reason: 'not-ready' }
  }
  if (!test && now - lastPlayed < 8000) return { ok: false, reason: 'cooldown' }
  try {
    for (const [offset, frequency] of [[0, 660], [.09, 880]]) {
      const oscillator = context.createOscillator(), gain = context.createGain()
      const start = context.currentTime + offset
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(.0001, start)
      gain.gain.exponentialRampToValueAtTime(.16, start + .012)
      gain.gain.exponentialRampToValueAtTime(.0001, start + .2)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(start); oscillator.stop(start + .21)
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    }
    if (!test) lastPlayed = now
    debugChat('audio:scheduled', { test, state: context.state })
    return { ok: true }
  } catch (error) {
    debugChat('audio:play-failed', { error: error instanceof Error ? error.name : 'unknown' })
    return { ok: false, reason: 'failed' }
  }
}
