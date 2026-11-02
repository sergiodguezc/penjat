// "Passa el mòbil" interface (static markup, no DOM): a restored match always opens on the resume card, never on a
// private screen; every storage state is explained; the privacy guard reacts to hiding, unloading, bfcache and blur;
// Catalan and Spanish copy match; and the App renders the local route without starting an online restore.
// Interactive play, reloads and Socket.IO isolation in a real browser: scripts/local-match-browser-checks.mjs.
import assert from 'node:assert/strict'
import React from 'react'
import { registerHooks } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import { createLocalMatch, reduceLocalMatch, type LocalAction, type LocalMatch } from '../src/local/match'
import { LOCAL_MATCH_STORAGE_KEY } from '../src/local/storage'
import { localTranslations } from '../src/local/i18n'
import { createPrivacyGuard } from '../src/local/privacy'
import { LocalMatchPage } from '../src/pages/LocalMatchPage'
import { multiplayerTranslations } from '../src/multiplayer/i18n'
import { ROOM_SESSION_KEY } from '../src/multiplayer/roomSession'

registerHooks({ load: (url, context, next) => url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context) })
const { default: App } = await import('../src/App')

const memory = (entries: [string, string][] = []) => {
  const values = new Map(entries)
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
const define = (name: string, descriptor: PropertyDescriptor) => Object.defineProperty(globalThis, name, { configurable: true, ...descriptor })
const text = (html: string) => html.replace(/<[^>]+>/g, ' ')
const render = (language: 'ca' | 'es' = 'ca') => renderToStaticMarkup(<LocalMatchPage language={language} gameLanguage="ca" onHome={() => {}} onUnsavedChange={() => {}} />)
const play = (match: LocalMatch, ...actions: LocalAction[]) => actions.reduce(reduceLocalMatch, match)
const guesses = (letters: string): LocalAction[] => [...letters].map((letter) => ({ type: 'guess', letter, elapsedMs: 500 }))

// Translations: same keys and setup errors in both languages.
assert.deepEqual(Object.keys(localTranslations.ca), Object.keys(localTranslations.es))
assert.deepEqual(Object.keys(localTranslations.ca.setupErrors), Object.keys(localTranslations.es.setupErrors))
assert.equal(localTranslations.ca.title, 'Passa el mòbil')
assert.equal(localTranslations.es.title, 'Pasa el móvil')

// Empty storage: the setup form, in seating order, with language and voltes.
for (const language of ['ca', 'es'] as const) {
  define('localStorage', { value: memory() })
  const l = localTranslations[language]
  const html = render(language)
  assert.equal((html.match(/<h1>/g) ?? []).length, 1)
  assert.ok(html.includes(l.setupAccent) && html.includes(l.seatingHint) && html.includes(l.start) && html.includes(l.addPlayer))
  assert.equal((html.match(/<input /g) ?? []).length, 2, 'two players to start with')
  assert.ok(html.includes(`aria-label="${l.playerLabel(1)}"`) && html.includes(`aria-label="${l.playerLabel(2)}"`))
  assert.equal((html.match(/class="local-remove"[^>]*disabled=""/g) ?? []).length, 2, 'two players cannot be removed')
  assert.ok(html.includes(multiplayerTranslations[language].voltes) && html.includes('aria-pressed="true">3</button>'), 'default 3 voltes')
  assert.ok(!html.includes(l.resumeTitle))
}

// Each storage state is explained; a newer save is not offered as resumable.
{
  define('localStorage', { value: memory([[LOCAL_MATCH_STORAGE_KEY, '{broken']]) })
  assert.ok(render().includes(localTranslations.ca.discarded))
  define('localStorage', { value: memory([[LOCAL_MATCH_STORAGE_KEY, JSON.stringify({ version: 99 })]]) })
  const newer = render()
  assert.ok(newer.includes(localTranslations.ca.newer) && newer.includes(localTranslations.ca.start) && !newer.includes(localTranslations.ca.resumeTitle))
  define('localStorage', { get() { throw new DOMException('denied', 'SecurityError') } })
  assert.ok(render().includes(localTranslations.ca.unavailable))
}

// Restore at every phase: only the resume card (players and progress), never a gate's private screen, a board, the
// word entry form, the word or anyone's letters. Unlocking is never stored, so nothing can reopen by itself.
{
  const created = createLocalMatch(['Anna', 'Bernat', 'Carla'], { gameLanguage: 'ca', voltes: 1 }, () => 0)
  assert.ok(created.ok)
  let match = created.match
  const snapshots: [string, LocalMatch][] = [['set-word', match]]
  match = play(match, { type: 'set-word', word: 'XOCOLATA' }); snapshots.push(['guess', match])
  match = play(match, ...guesses('OBDEF')); snapshots.push(['guess mid-turn', match])
  match = play(match, ...guesses('GH')); snapshots.push(['forgive', match])
  match = play(match, { type: 'decide-forgiveness', forgive: true }); snapshots.push(['guess after a grant', match])
  match = play(match, ...guesses('XCLAT'), ...guesses('XOCLAT')); snapshots.push(['round-over', match])
  match = play(match, { type: 'next-turn' }, { type: 'set-word', word: 'GOS' }, ...guesses('GOS'), ...guesses('GOS'), { type: 'next-turn' }, { type: 'set-word', word: 'MAR' }, ...guesses('MAR'), ...guesses('MAR'))
  snapshots.push(['match-over', match])
  assert.equal(match.step, 'match-over')
  for (const [label, snapshot] of snapshots) {
    define('localStorage', { value: memory([[LOCAL_MATCH_STORAGE_KEY, JSON.stringify(snapshot)]]) })
    const html = render()
    assert.ok(html.includes(localTranslations.ca.resumeTitle) && html.includes(localTranslations.ca.resume) && html.includes(localTranslations.ca.abandon), label)
    assert.ok(html.includes('Anna · Bernat · Carla'), label)
    for (const word of ['XOCOLATA', 'GOS', 'MAR']) assert.ok(!text(html).includes(word), `${label}: no word`)
    for (const hidden of ['class="keyboard"', 'local-secret-word', 'class="handoff', 'local-board', 'round-results', 'multiplayer-word']) assert.ok(!html.includes(hidden), `${label}: ${hidden}`)
  }
}

// Privacy guard: hiding, unloading and bfcache restores lock; blur only covers; nothing after release.
{
  const target = () => {
    const listeners = new Map<string, Set<(event: Event) => void>>()
    return {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (type: string, listener: (event: Event) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener) },
      removeEventListener: (type: string, listener: (event: Event) => void) => { listeners.get(type)?.delete(listener) },
      fire(type: string, event: object = {}) { for (const listener of listeners.get(type) ?? []) listener(event as Event) },
      count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    }
  }
  const doc = target(), win = target()
  const calls: string[] = []
  const release = createPrivacyGuard(doc, win, { lock: () => calls.push('lock'), cover: (covered) => calls.push(covered ? 'cover' : 'uncover') })
  doc.fire('visibilitychange')
  assert.deepEqual(calls, [], 'visible: nothing happens')
  doc.visibilityState = 'hidden'; doc.fire('visibilitychange')
  win.fire('pagehide')
  win.fire('pageshow', { persisted: false })
  win.fire('pageshow', { persisted: true })
  win.fire('blur'); win.fire('focus')
  assert.deepEqual(calls, ['lock', 'lock', 'lock', 'cover', 'uncover'])
  release()
  assert.equal(doc.count() + win.count(), 0)
  doc.fire('visibilitychange'); win.fire('pagehide'); win.fire('blur')
  assert.equal(calls.length, 5, 'released guards do nothing')
}

// App: the local route renders the local page even with a stored online session, without starting a restore, and
// the stored session is left exactly as it was.
{
  const session = JSON.stringify({ version: 1, roomCode: 'ABCDE', playerId: 'player-1', reconnectToken: 'token-1' })
  const store = memory([[ROOM_SESSION_KEY, session]])
  define('localStorage', { value: store })
  define('sessionStorage', { value: memory() })
  define('window', { value: { location: { pathname: '/passa-el-mobil/', search: '', hash: '' }, history: { state: null, replaceState() {}, pushState() {} }, matchMedia: () => ({ matches: false }) } })
  const html = renderToStaticMarkup(<App />)
  assert.ok(html.includes(localTranslations.ca.setupAccent))
  assert.ok(!html.includes(multiplayerTranslations.ca.restoringTitle), 'no online restore on the local route')
  assert.equal(store.values.get(ROOM_SESSION_KEY), session)
  assert.equal(store.values.has(LOCAL_MATCH_STORAGE_KEY), false)
  // Any other public route still restores the stored room.
  ;(globalThis as unknown as { window: { location: { pathname: string } } }).window.location.pathname = '/'
  assert.ok(renderToStaticMarkup(<App />).includes(multiplayerTranslations.ca.restoringTitle))
}

console.log('local match UI checks passed: setup, storage notices, restore never opens a private screen, privacy guard, translations, route isolation')
