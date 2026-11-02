// "Passa el mòbil" in a real browser (Firefox WebDriver BiDi): a complete two-player match through every handoff gate,
// reloads and simulated backgrounding (visibilitychange, pagehide, bfcache pageshow, blur), the active-time clock,
// memory-only exit guards, homepage and history navigation, and no Socket.IO traffic on the local route, including
// with a stored online session and after leaving an active online room. Part of `test:browser`; standalone:
//   TEST_SERVER_URL=http://127.0.0.1:3002 BIDI_URL=ws://127.0.0.1:9222 npm run test:browser:local
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const SESSION_KEY = 'hangman-room-session'
const MATCH_KEY = 'penjat-local-match'
export const AUDIT = `() => {
  const audit = window.__socketAudit = { attempts: 0, open: 0 }
  const NativeSocket = window.WebSocket
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args)
      if (!String(args[0]).includes('/socket.io/')) return
      audit.attempts++
      this.addEventListener('open', () => { audit.open++ })
      this.addEventListener('close', () => { audit.open = Math.max(0, audit.open - 1) })
    }
  }
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (String(url).includes('/socket.io/')) audit.attempts++
    return open.call(this, method, url, ...rest)
  }
}`

export async function checkLocalMatch({ origin, io, command, evaluate, waitFor, navigate, newTab }) {
  const profile = (await command('browser.createUserContext')).userContext
  await command('script.addPreloadScript', { functionDeclaration: AUDIT, userContexts: [profile] })
  const tab = await newTab(profile)
  const js = (value) => JSON.stringify(value)
  const has = (selector) => evaluate(tab, `document.querySelector(${js(selector)}) !== null`)
  const click = (selector) => evaluate(tab, `(() => { document.querySelector(${js(selector)}).click(); return true })()`)
  const bodyText = () => evaluate(tab, 'document.body.innerText')
  const gateTitle = () => evaluate(tab, "document.querySelector('#handoff-title')?.textContent ?? null")
  const attempts = () => evaluate(tab, 'window.__socketAudit.attempts')
  const stored = () => evaluate(tab, `localStorage.getItem(${js(MATCH_KEY)})`)
  const activeMs = async () => JSON.parse(await stored()).guessers.find((guesser) => guesser.status === 'playing')?.activeMs ?? null
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const setValue = (selector, value) => evaluate(tab, `(() => { const element = document.querySelector(${js(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${js(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const letter = (value) => click(`.keyboard button[aria-label="${value}"]`)
  const unlockGate = async (name) => {
    await waitFor(tab, "document.querySelector('.handoff-action') !== null")
    if (name) assert.equal(await gateTitle(), name)
    assert.equal(await has('.keyboard, #local-secret-word, .forgive-decision'), false, 'a gate shows nothing private')
    await click('.handoff-action')
  }
  const hide = () => evaluate(tab, "(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); return true })()")
  const show = () => evaluate(tab, "(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); return true })()")
  const noPrivateText = async (word, label) => assert.ok(!(await bodyText()).includes(word), `${label}: the word stays hidden`)

  // A stored online session and a direct load of the local route: no restore, no transport, the session untouched.
  const session = JSON.stringify({ version: 1, roomCode: 'ZZZZZ', playerId: 'nobody', reconnectToken: 'nothing' })
  await navigate(tab, '/passa-el-mobil/')
  await evaluate(tab, `(() => { localStorage.setItem(${js(SESSION_KEY)}, ${js(session)}); return true })()`)
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-setup') !== null")
  assert.equal(await evaluate(tab, 'document.title'), 'Passa el mòbil: el penjat en grup amb un sol mòbil | Penjat')

  // Setup: validation, add/remove, then a two-player, one-volta match.
  await click('.local-setup .primary-action')
  await waitFor(tab, "document.querySelector('.local-setup .form-error') !== null")
  await click('.local-add')
  assert.equal(await evaluate(tab, "document.querySelectorAll('.local-players li').length"), 3)
  await click('.local-players li:nth-child(3) .local-remove')
  assert.equal(await evaluate(tab, "document.querySelectorAll('.local-players li').length"), 2)
  await setValue('.local-players li:nth-child(1) input', 'Anna')
  await setValue('.local-players li:nth-child(2) input', 'anna')
  await click('.local-setup .primary-action')
  await waitFor(tab, "document.querySelector('.local-setup .form-error')?.textContent.includes('diferent')")
  await setValue('.local-players li:nth-child(2) input', 'Bernat')
  await click('.target-selector button:first-child')
  await click('.local-setup .primary-action')
  await waitFor(tab, "document.querySelector('.handoff') !== null")
  const setter = await gateTitle()
  const guesser = setter === 'Anna' ? 'Bernat' : 'Anna'

  // Turn 1: the setter's gate, then the word form (no autocomplete or suggestions); the word never reaches a gate.
  await unlockGate(setter)
  await waitFor(tab, "document.querySelector('#local-secret-word') !== null")
  assert.deepEqual(JSON.parse(await evaluate(tab, "(() => { const input = document.querySelector('#local-secret-word'); return JSON.stringify([input.autocomplete, input.getAttribute('autocorrect'), input.spellcheck]) })()")), ['off', 'off', false])
  await click('.local-word-form .primary-action')
  await waitFor(tab, "document.querySelector('.local-word-form .form-error') !== null")
  await setValue('#local-secret-word', 'xocolata')
  // Letters typed into the form are not guesses: the private screen stays until the word is submitted.
  await evaluate(tab, "(() => { document.querySelector('#local-secret-word').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); return true })()")
  assert.equal(await has('#local-secret-word'), true)
  await click('.local-word-form .primary-action')
  await waitFor(tab, "document.querySelector('.handoff') !== null")
  await noPrivateText('XOCOLATA', 'guesser gate')

  // The guesser's board; a wrong and a right letter, a repeated one, and a physical-keyboard letter.
  await unlockGate(guesser)
  await waitFor(tab, "document.querySelector('.keyboard') !== null")
  await noPrivateText('XOCOLATA', 'board')
  await letter('Z')
  await letter('O')
  await evaluate(tab, "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })); return true })()")
  await waitFor(tab, "document.querySelector('.keyboard button[aria-label=\"C\"]').disabled")
  await pause(300)

  // Reload mid-turn: the resume card, then the guesser's own gate ("give back"), then the same board.
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-resume') !== null")
  assert.equal(await has('.keyboard, .handoff'), false)
  await noPrivateText('XOCOLATA', 'resume card')
  const afterReload = await activeMs()
  assert.ok(afterReload >= 250, `played time was saved (${afterReload} ms)`)
  await click('.local-resume .primary-action')
  await waitFor(tab, "document.querySelector('.handoff-eyebrow')?.textContent.includes('Torna')")
  await pause(600)
  assert.equal(await activeMs(), afterReload, 'a restored match does not run the clock before the gate')
  await unlockGate(guesser)
  await waitFor(tab, "document.querySelector('.keyboard button[aria-label=\"Z\"]')?.disabled")

  // Backgrounding: hidden → gate at once, clock stopped while hidden; bfcache restore and pagehide also lock.
  await pause(300)
  await hide()
  assert.equal(await has('.keyboard'), false, 'hidden page drops the board synchronously')
  assert.equal(await has('.handoff'), true)
  const hiddenAt = await activeMs()
  assert.ok(hiddenAt >= afterReload + 250, 'time on the board before hiding counts')
  await pause(1500)
  await show()
  await unlockGate(guesser)
  await waitFor(tab, "document.querySelector('.keyboard') !== null")
  await evaluate(tab, "(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); return true })()")
  await waitFor(tab, "document.querySelector('.handoff') !== null && document.querySelector('.keyboard') === null")
  assert.ok((await activeMs()) - hiddenAt < 1000, 'time hidden is not counted')
  await unlockGate(guesser)
  await waitFor(tab, "document.querySelector('.keyboard') !== null")
  await evaluate(tab, "(() => { window.dispatchEvent(new Event('pagehide')); return true })()")
  await waitFor(tab, "document.querySelector('.handoff') !== null && document.querySelector('.keyboard') === null")
  await unlockGate(guesser)
  await waitFor(tab, "document.querySelector('.keyboard') !== null")

  // Blur while visible only covers the board; focus uncovers it without a new gate.
  await evaluate(tab, "(() => { window.dispatchEvent(new Event('blur')); return true })()")
  await waitFor(tab, "document.querySelector('.local-cover') !== null && document.querySelector('.local-stage').inert")
  await evaluate(tab, "(() => { window.dispatchEvent(new Event('focus')); return true })()")
  await waitFor(tab, "document.querySelector('.local-cover') === null && document.querySelector('.keyboard') !== null")

  // Solve: the turn-complete screen keeps the word hidden; then the reveal gate and the results.
  for (const value of ['X', 'L', 'A', 'T']) await letter(value)
  await waitFor(tab, "document.querySelector('.turn-complete') !== null")
  await noPrivateText('XOCOLATA', 'turn complete')
  await click('.turn-complete .handoff-action')
  await unlockGate(null)
  await waitFor(tab, "document.querySelector('.local-results') !== null")
  assert.ok((await bodyText()).includes('XOCOLATA'), 'the reveal shows the word')
  assert.match(await evaluate(tab, "document.querySelector('.round-results').innerText"), new RegExp(`\\+1[\\s\\S]*${guesser}`))

  // Turn 2: the other player sets; six misses → the setter's gate → grant → the guesser's gate → elimination.
  await click('.local-next')
  await unlockGate(guesser)
  await setValue('#local-secret-word', 'gos')
  await click('.local-word-form .primary-action')
  await unlockGate(setter)
  for (const value of ['B', 'C', 'D', 'E', 'F', 'H']) await letter(value)
  await waitFor(tab, "document.querySelector('.handoff') !== null")
  assert.equal(await gateTitle(), guesser, 'the forgiveness decision goes to the setter')
  await navigate(tab, '/passa-el-mobil/')
  await click('.local-resume .primary-action')
  await unlockGate(guesser)
  await waitFor(tab, "document.querySelector('.forgive-decision') !== null")
  await noPrivateText('GOS', 'forgiveness decision')
  await click('.forgive-decision .primary-action')
  await waitFor(tab, "document.querySelector('.handoff-eyebrow')?.textContent.includes('Torna')")
  await unlockGate(setter)
  await waitFor(tab, "document.querySelector('.error-copy')?.textContent.includes('♥')")
  await letter('I')
  await waitFor(tab, "document.querySelector('.turn-complete') !== null")
  await click('.turn-complete .handoff-action')
  await unlockGate(null)

  // Match over: results, standings, then a rematch with the same players.
  await waitFor(tab, "document.querySelector('.local-match-over') !== null")
  assert.ok((await bodyText()).includes('GOS'))
  assert.equal(await evaluate(tab, "document.querySelectorAll('.standing-row').length"), 2)
  await click('.local-match-over .primary-action')
  await waitFor(tab, "document.querySelector('.handoff') !== null")
  assert.equal(JSON.parse(await stored()).players.every((player) => player.score === 0), true)

  // Saved play: leaving through the header asks nothing; history returns to the resume card, never a private screen.
  await click('.site-brand')
  await waitFor(tab, "location.pathname === '/'")
  assert.equal(await has('.exit-confirmation-dialog'), false)
  await evaluate(tab, 'history.back(), true')
  await waitFor(tab, "location.pathname === '/passa-el-mobil/' && document.querySelector('.local-resume') !== null")
  await evaluate(tab, 'history.forward(), true')
  await waitFor(tab, "location.pathname === '/'")
  await click('.mode-card--local a')
  await waitFor(tab, "location.pathname === '/passa-el-mobil/' && document.querySelector('.local-resume') !== null")
  await click('.local-resume .secondary-action')
  await waitFor(tab, "document.querySelector('.exit-confirmation-dialog') !== null")
  await click('.exit-confirmation-dialog .danger-action')
  await waitFor(tab, "document.querySelector('.local-setup') !== null")
  assert.equal(await stored(), null, 'abandon clears the saved match')

  assert.equal(await attempts(), 0, 'the local route never opened a Socket.IO transport')
  assert.equal(await evaluate(tab, `localStorage.getItem(${js(SESSION_KEY)})`), session, 'the stored online session is untouched')

  // Memory-only play (saving fails): a warning, and leaving through the header or Back asks first.
  await evaluate(tab, "(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }; return true })()")
  await setValue('.local-players li:nth-child(1) input', 'Carla')
  await setValue('.local-players li:nth-child(2) input', 'Dídac')
  await click('.local-setup .primary-action')
  await waitFor(tab, "document.querySelector('.local-save-warning') !== null")
  await click('.site-brand')
  await waitFor(tab, "document.querySelector('.exit-confirmation-dialog') !== null")
  await click('.exit-confirmation-dialog .secondary-action')
  await waitFor(tab, "document.querySelector('.exit-confirmation-dialog') === null && document.querySelector('.handoff') !== null")
  await evaluate(tab, 'history.back(), true')
  await waitFor(tab, "document.querySelector('.exit-confirmation-dialog') !== null")
  await click('.exit-confirmation-dialog .secondary-action')
  await waitFor(tab, "location.pathname === '/passa-el-mobil/' && document.querySelector('.handoff') !== null")
  assert.equal(await attempts(), 0)

  // From an active online room: the existing exit confirmation leaves the room, then the local page opens no transport.
  const host = io(origin, { transports: ['websocket'], forceNew: true })
  try {
    await new Promise((resolve, reject) => { host.once('connect', resolve); host.once('connect_error', reject) })
    const created = await new Promise((resolve) => host.emit('room:create', { name: 'Amfitrió', gameLanguage: 'ca', voltes: 1 }, resolve))
    assert.equal(created.ok, true)
    const roomTab = await newTab(profile)
    await navigate(roomTab, '/')
    await evaluate(roomTab, `(() => { localStorage.setItem(${js(SESSION_KEY)}, ${js(JSON.stringify({ version: 1, ...created.data.session }))}); return true })()`)
    await navigate(roomTab, '/multijugador/')
    await waitFor(roomTab, "document.querySelector('.lobby-page') !== null && window.__socketAudit.open === 1")
    await evaluate(roomTab, "(() => { document.querySelector('.site-brand').click(); return true })()")
    await waitFor(roomTab, "document.querySelector('.exit-confirmation-dialog') !== null")
    await evaluate(roomTab, "(() => { document.querySelector('.exit-confirmation-dialog .danger-action').click(); return true })()")
    await waitFor(roomTab, "location.pathname === '/' && window.__socketAudit.open === 0")
    const before = await evaluate(roomTab, 'window.__socketAudit.attempts')
    await evaluate(roomTab, "(() => { document.querySelector('.mode-card--local a').click(); return true })()")
    await waitFor(roomTab, "location.pathname === '/passa-el-mobil/' && document.querySelector('main.local-page') !== null")
    await evaluate(roomTab, "window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); true")
    await pause(400)
    assert.equal(await evaluate(roomTab, 'window.__socketAudit.attempts'), before, 'no transport after entering the local mode')
    await command('browsingContext.close', { context: roomTab })
  } finally { host.disconnect() }
  // Later checks send real key presses to the active tab: close this one so focus returns to theirs.
  await command('browsingContext.close', { context: tab })
  console.log('Browser local match checks passed: full two-player match through every gate, reload/background/bfcache/blur privacy, clock pauses, memory-only exit guard, history, no Socket.IO traffic')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { io } = await import('socket.io-client')
  const { openBidiSession } = await import('./bidi-session.mjs')
  const origin = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3002'
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Browser tests must target a local server')
  const session = await openBidiSession(origin)
  try {
    await checkLocalMatch({ origin, io, ...session })
    assert.deepEqual(session.errors, [], 'No browser console errors should occur')
  } finally { await session.close() }
}
