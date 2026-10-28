// Browser storage that throws (blocked cookies, a full quota) never breaks rendering, room entry, settings or the daily
// challenge, and the room says when a refresh could not rejoin it.
import assert from 'node:assert/strict'
import React from 'react'
import { registerHooks } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { browserStorage, readStored, writeStored } from '../src/storage'
import { INTERFACE_LANGUAGE_STORAGE_KEY, readInterfaceLanguage } from '../src/localization'
import { loadRoomSession, clearRoomSession, roomSessionPersisted, ROOM_SESSION_KEY, saveRoomSession } from '../src/multiplayer/roomSession'
import { UnsavedSessionNotice } from '../src/components/RoomRestoreNotice'
import { multiplayerTranslations } from '../src/multiplayer/i18n'
import { DailyChallengePage } from '../src/pages/DailyChallengePage'
import { getDailyChallenge } from '../src/daily/challenge'
import { readDailyAttempt, writeDailyAttempt } from '../src/daily/storage'
import { getHomeDailyStatus } from '../src/daily/homeSummary'
import { dailyTranslations } from '../src/daily/i18n'

// Vite bundles the stylesheets App imports; here they load as empty modules so the whole App can render.
registerHooks({ load: (url, context, next) => url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context) })
const { default: App } = await import('../src/App')

const session = { roomCode: 'ABCDE', playerId: 'player-1', reconnectToken: 'token-1' }
const memory = (values = new Map<string, string>()) => ({
  values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) },
})
const define = (name: string, descriptor: PropertyDescriptor) => Object.defineProperty(globalThis, name, { configurable: true, ...descriptor })
const browserWindow = { location: { pathname: '/', search: '', hash: '' }, history: { state: null, replaceState() {}, pushState() {} }, matchMedia: () => ({ matches: false }) }
define('window', { value: browserWindow })
const notice = (language: 'ca' | 'es') => renderToStaticMarkup(<UnsavedSessionNotice language={language} />)

// 1. Working storage: the session survives a refresh and the room shows no warning.
{
  const store = memory()
  define('localStorage', { value: store })
  assert.equal(saveRoomSession(session), true)
  assert.equal(roomSessionPersisted(), true)
  assert.deepEqual(loadRoomSession(), session)
  assert.equal(notice('ca'), '')
  clearRoomSession()
}

// 2. Full quota: reads work, writes throw. Entering a room still succeeds; the older room's credentials are removed so a
// refresh can never resume the wrong room, this page keeps the new seat for reconnection, and the room says so.
{
  const store = memory(new Map([[ROOM_SESSION_KEY, JSON.stringify({ version: 1, roomCode: 'OLDER', playerId: 'old', reconnectToken: 'old' })]]))
  define('localStorage', { value: { ...store, setItem: () => { throw new Error('QuotaExceededError') } } })
  assert.equal(writeStored('hangman-name', 'Ana'), false)
  assert.doesNotThrow(() => writeDailyAttempt(browserStorage(), { challengeId: 'x', guesses: [], completed: false, won: null, mistakes: 0 }))
  assert.equal(saveRoomSession(session), false)
  assert.equal(store.values.has(ROOM_SESSION_KEY), false, 'no stale credentials remain for a refresh')
  assert.deepEqual(loadRoomSession(), session, 'a dropped connection can still rejoin from this page')
  assert.equal(roomSessionPersisted(), false)
  for (const language of ['ca', 'es'] as const) assert.ok(notice(language).includes(multiplayerTranslations[language].sessionNotSaved))
  clearRoomSession()
  assert.equal(loadRoomSession(), null, 'leaving forgets the page-only seat')
}

// 3. Blocked storage: reading `localStorage` itself throws (cookies disabled). Every page still renders.
define('localStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError') } })
define('sessionStorage', { get() { throw new DOMException('The operation is insecure.', 'SecurityError') } })
try {
  assert.equal(browserStorage(), null)
  assert.equal(readStored('hangman-name'), null)
  assert.equal(writeStored(INTERFACE_LANGUAGE_STORAGE_KEY, 'es'), false)
  // Settings: interface and game language fall back to defaults, and changing them only fails to persist.
  assert.equal(readInterfaceLanguage(browserStorage()), 'ca')
  const throwing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readInterfaceLanguage(throwing), 'ca')
  assert.equal(readStored('hangman-game-language', throwing), null)
  assert.equal(writeStored('hangman-game-language', 'es', throwing), false)

  // Initial rendering of every public page, including the daily challenge and learning.
  for (const [pathname, text] of [['/', 'Juga al penjat online en català.'], ['/multijugador/', multiplayerTranslations.ca.setupTitle], ['/paraula-del-dia/', dailyTranslations.ca.title], ['/aprendre/', 'Aprèn vocabulari'], ['/com-es-juga/', 'Com es juga']] as const) {
    browserWindow.location.pathname = pathname
    const html = renderToStaticMarkup(<App />)
    assert.ok(html.replace(/<[^>]+>/g, '').includes(text), `${pathname} renders with blocked storage`)
  }

  // Daily challenge: a fresh game, no stored attempt, and saving progress never throws.
  const challenge = getDailyChallenge()
  assert.equal(readDailyAttempt(null, challenge.id), null)
  assert.equal(readDailyAttempt(throwing, challenge.id), null)
  assert.deepEqual(getHomeDailyStatus(challenge, browserStorage()), { status: 'new', mistakes: 0 })
  assert.doesNotThrow(() => writeDailyAttempt(throwing, { challengeId: challenge.id, guesses: ['A'], completed: false, won: null, mistakes: 1 }))
  for (const language of ['ca', 'es'] as const) assert.ok(renderToStaticMarkup(<DailyChallengePage language={language} />).includes(dailyTranslations[language].title))

  // Room entry: saving the session cannot fail the entry; the seat lives in this page and the room says a refresh loses it.
  assert.equal(saveRoomSession(session), false)
  assert.deepEqual(loadRoomSession(), session)
  assert.ok(notice('ca').includes(multiplayerTranslations.ca.sessionNotSaved))
  clearRoomSession()
  assert.equal(loadRoomSession(), null)
} finally {
  Reflect.deleteProperty(globalThis, 'localStorage')
  Reflect.deleteProperty(globalThis, 'sessionStorage')
  Reflect.deleteProperty(globalThis, 'window')
}

console.log('Storage failure checks passed: blocked and full storage, pages, room entry, settings and daily challenge')
