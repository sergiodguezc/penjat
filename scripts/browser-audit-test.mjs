// Optional real-browser regressions using Firefox's native WebDriver BiDi (no npm dependency).
// Start a dedicated headless Firefox with --remote-debugging-port 9222 and a built local server.
import assert from 'node:assert/strict'
import { io } from 'socket.io-client'
import { checkP0Dialogs, checkP0Chat, checkP0Terminal, checkP0EmptyChat } from './p0-browser-checks.mjs'
import { checkMatchResultsFlow } from './match-results-browser-checks.mjs'
import { checkResponsiveScope } from './responsive-scope-checks.mjs'
import { checkHomeNavigation, checkHomeLayout, checkSetupEmphasis, checkNotFoundNavigation, homeMetrics } from './homepage-browser-checks.mjs'
import { checkSiteHeader } from './header-browser-checks.mjs'
import { checkHistoryGuard } from './history-guard-browser-checks.mjs'
import { checkReconnect } from './reconnect-browser-checks.mjs'

const origin = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3002'
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Browser tests must target a local server')
const baseline = process.env.AUDIT_BASELINE === '1'
const ws = new WebSocket(`${process.env.BIDI_URL || 'ws://127.0.0.1:9222'}/session`)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let id = 0
const pending = new Map()
const browserErrors = []
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  if (message.method === 'log.entryAdded' && message.params.level === 'error') browserErrors.push(message.params.text)
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  clearTimeout(request.timer)
  if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`))
  else request.resolve(message.result)
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)) }, 10000)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, method, params }))
  })
}
async function evaluate(context, expression) {
  const result = await command('script.evaluate', { expression, target: { context }, awaitPromise: true, userActivation: true })
  if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.type === 'null' ? null : result.result.value
}
async function waitFor(context, expression) {
  const deadline = Date.now() + 7000
  while (Date.now() < deadline) {
    if (await evaluate(context, expression)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Browser condition failed: ${expression}\n${await evaluate(context, 'document.body.innerText')}`)
}
const sockets = []
async function createRoom(name) {
  const socket = io(origin, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  const response = await new Promise((resolve) => socket.emit('room:create', { name, gameLanguage: 'ca', voltes: 1 }, resolve))
  assert.equal(response.ok, true)
  return response.data.session
}
async function navigate(context, path) {
  await command('browsingContext.navigate', { context, url: new URL(path, origin).href, wait: 'complete' })
}
const contexts = []
async function newTab(userContext) {
  const result = await command('browsingContext.create', { type: 'tab', userContext })
  contexts.push(result.context)
  return result.context
}
try {
  await command('session.new', { capabilities: {} })
  await command('session.subscribe', { events: ['log.entryAdded'] })
  const profile = (await command('browser.createUserContext')).userContext
  const isolatedProfile = (await command('browser.createUserContext')).userContext
  const home = await newTab(isolatedProfile)
  await checkNotFoundNavigation({ context: home, command, evaluate, waitFor, navigate })
  await checkP0Dialogs({context:home, command, evaluate, waitFor, navigate})
  await checkHomeNavigation({ context: home, command, evaluate, waitFor, navigate })
  await checkSiteHeader({ context: home, command, evaluate, waitFor, navigate })
  // Its own profile (it plays a daily guess) and tab; closing it brings the main tab back to the foreground for keyboard checks.
  const historyTab = await newTab((await command('browser.createUserContext')).userContext)
  await checkHistoryGuard({ context: historyTab, command, evaluate, waitFor, navigate })
  await command('browsingContext.close', { context: historyTab })
  await checkReconnect({ origin, command, evaluate, waitFor, navigate, newTab })
  await command('browsingContext.activate', { context: home })
  for (const language of ['ca', 'es']) {
    await navigate(home, '/')
    await evaluate(home, `localStorage.setItem('hangman-interface-language', '${language}')`)
    await navigate(home, '/')
    await waitFor(home, "document.querySelector('.home-modes') !== null")
    for (const [width, height] of [[1440,900], [1024,768], [768,1024], [820,1180], [390,844], [320,568], [599,960], [600,960], [660,1000], [661,1000], [860,1180], [861,1180], [1024,1366], [844,390]]) {
      await command('browsingContext.setViewport', { context: home, viewport: { width, height } })
      checkHomeLayout(JSON.parse(await evaluate(home, homeMetrics)))
    }
  }
  await evaluate(home, "localStorage.setItem('hangman-interface-language', 'ca')")
  await navigate(home, '/paraula-del-dia/')
  await waitFor(home, "document.querySelector('.keyboard') !== null")
  for (let i=0; i<28 && !await evaluate(home, "document.querySelector('.daily-result') !== null"); i++) {
    await evaluate(home, "document.querySelector('.keyboard button:not(:disabled)')?.click()")
  }
  await waitFor(home, "document.querySelector('.daily-result') !== null")
  await command('browsingContext.setViewport', { context:home, viewport:{ width:320, height:568 } })
  assert.equal(await evaluate(home, "getComputedStyle(document.querySelector('.daily-result .daily-tomorrow')).whiteSpace"), 'normal')
  assert.equal(await evaluate(home, "getComputedStyle(document.querySelector('.daily-result .daily-tomorrow')).fontSize"), '14px')
  const wonDaily = await evaluate(home, "document.querySelector('.daily-result').classList.contains('win')")
  const secretDaily = await evaluate(home, "document.querySelector('.daily-result h2').textContent")
  // Phase 3B: home is reached through the header brand link (the finished daily game needs no exit confirmation).
  await evaluate(home, "document.querySelector('.site-brand').click()")
  await waitFor(home, "document.querySelector('.daily-tomorrow') !== null")
  assert.equal(await evaluate(home, "document.querySelector('.daily-caption').textContent.includes('Encertada')"), wonDaily)
  assert.equal(await evaluate(home, "getComputedStyle(document.querySelector('.daily-entry .daily-tomorrow')).fontSize"), '14px')
  assert.equal(await evaluate(home, "getComputedStyle(document.querySelector('.daily-entry .daily-tomorrow')).color"), await evaluate(home, "getComputedStyle(document.querySelector('.daily-caption')).color"))
  assert.equal(await evaluate(home, `document.querySelector('.home-modes').textContent.replace('Paraula del dia', '').includes(${JSON.stringify(secretDaily)})`), false)
  // Phase 3C phone hero (320px here): the daily card tags a played day without revealing the word.
  assert.equal(await evaluate(home, "getComputedStyle(document.querySelector('.home-quick')).display"), 'block')
  assert.match(await evaluate(home, "document.querySelector('.quick-card--daily').textContent"), /^Paraula del dia#\d+ ✓ · Jugada$/)
  assert.equal(await evaluate(home, `document.querySelector('.home-quick').textContent.replace('Paraula del dia', '').includes(${JSON.stringify(secretDaily)})`), false)
  for (const attempt of ['{', JSON.stringify({ challengeId:'2000-01-01', guesses:['A'], completed:true, won:true })]) {
    await evaluate(home, `localStorage.setItem('penjat-daily-challenge', ${JSON.stringify(attempt)}); window.dispatchEvent(new Event('focus'))`)
    await waitFor(home, "document.querySelector('.daily-caption').textContent === 'La mateixa per a tothom'")
    assert.match(await evaluate(home, "document.querySelector('.quick-card--daily').textContent"), /^Paraula del dia#\d+$/)
  }
  assert.equal(await evaluate(home, "document.querySelector('.home-modes .primary-action').textContent"), 'Juga amb amics')
  console.log('Homepage daily status passed: completed game return, corrupt/outdated storage refresh, stable primary action.')
  console.log('Homepage responsive checks passed in CA/ES, including all six boundaries.')
  await navigate(home, '/multijugador/')
  await waitFor(home, "document.querySelector('.setup form') !== null")
  await checkResponsiveScope({ context:home, command, evaluate, page:'setup', root:'.setup', selectors:'.setup, .setup *' })
  await checkSetupEmphasis({ context:home, command, evaluate, waitFor, navigate })
  await navigate(home, '/com-es-juga/')
  await waitFor(home, "document.querySelector('.howto-header') !== null")
  await checkResponsiveScope({ context:home, command, evaluate, page:'help', root:'.howto-page', selectors:'.howto-page, .howto-page *' })
  const oldRoom = await createRoom('Old host')
  const invitedRoom = await createRoom('New host')
  const source = await newTab(profile)
  await navigate(source, '/')
  await evaluate(source, `localStorage.setItem('hangman-room-session', JSON.stringify({ version: 1, ...${JSON.stringify(oldRoom)} })); localStorage.setItem('hangman-name', 'Shared name')`)
  await navigate(source, '/multijugador/')
  await waitFor(source, `document.body.innerText.includes(${JSON.stringify(oldRoom.roomCode)})`)

  // A normal same-profile tab shares localStorage, room credentials included; the invitation still takes precedence.
  const shared = await newTab(profile)
  await navigate(shared, `/multijugador/?sala=${invitedRoom.roomCode}`)
  await waitFor(shared, "document.querySelector('.invitation-form') !== null")
  await checkResponsiveScope({ context:shared, command, evaluate, page:'invitation', root:'.invitation-card', selectors:'.invitation-card, .invitation-card *' })
  assert.equal(await evaluate(shared, "localStorage.getItem('hangman-name')"), 'Shared name')
  assert.equal(JSON.parse(await evaluate(shared, "localStorage.getItem('hangman-room-session')")).roomCode, oldRoom.roomCode)

  // Separate user contexts have independent browser storage, like different devices.
  const isolated = await newTab(isolatedProfile)
  await navigate(isolated, `/multijugador/?sala=${invitedRoom.roomCode}`)
  await waitFor(isolated, "document.querySelector('.invitation-form') !== null")
  assert.equal(await evaluate(isolated, "localStorage.getItem('hangman-name')"), null)

  // An opener-created tab sees the previous room's credentials too; the invitation it opens still wins.
  const before = new Set((await command('browsingContext.getTree')).contexts.map((item) => item.context))
  await evaluate(source, `window.open(${JSON.stringify(new URL(`/multijugador/?sala=${invitedRoom.roomCode}`, origin).href)}, '_blank'); true`)
  const tree = await command('browsingContext.getTree')
  const copied = tree.contexts.find((item) => !before.has(item.context)).context
  contexts.push(copied)
  await waitFor(copied, "document.readyState === 'complete' && document.body.innerText.length > 20")
  await waitFor(copied, baseline ? `document.body.innerText.includes(${JSON.stringify(oldRoom.roomCode)})` : "document.querySelector('.invitation-form') !== null")
  assert.equal(JSON.parse(await evaluate(copied, "localStorage.getItem('hangman-room-session')")).roomCode, oldRoom.roomCode)
  if (baseline) {
    assert.equal(await evaluate(copied, `document.body.innerText.includes(${JSON.stringify(invitedRoom.roomCode)})`), false)
    console.log('BASELINE reproduced F02: opener tab displays old room despite new invitation; ordinary shared tabs and isolated contexts display invitation.')
  } else {
    assert.equal(await evaluate(copied, `document.querySelector('.lobby-page') !== null`), false)
    // Reload must preserve invitation precedence and leave the old credential intact until joining.
    await navigate(copied, `/multijugador/?sala=${invitedRoom.roomCode}`)
    await waitFor(copied, "document.querySelector('.invitation-form') !== null")
    // A same-room invitation still restores the valid session.
    await navigate(source, `/multijugador/?sala=${oldRoom.roomCode}`)
    await waitFor(source, "document.querySelector('.lobby-page') !== null")
    await checkResponsiveScope({ context:source, command, evaluate, page:'lobby', root:'.lobby-page', selectors:'.lobby-page, .lobby-page *' })
    // Joining another room asks first (one seat per browser profile); nothing changes until the player confirms. The
    // confirmed switch gives the old seat up, and the tab that held it says it was left, not that it is open elsewhere.
    await evaluate(copied, "document.querySelector('.invitation-form button.primary-action').click()")
    await waitFor(copied, `document.querySelector('.exit-confirmation-dialog[open]')?.innerText.includes(${JSON.stringify(oldRoom.roomCode)})`)
    assert.equal(JSON.parse(await evaluate(copied, "localStorage.getItem('hangman-room-session')")).roomCode, oldRoom.roomCode)
    await evaluate(copied, "document.querySelector('.exit-confirmation-dialog .danger-action').click()")
    await waitFor(copied, "document.querySelector('.lobby-page') !== null")
    await waitFor(source, "document.querySelector('.room-restore-card')?.innerText.includes('Ara jugues en una altra sala')")
    assert.equal(JSON.parse(await evaluate(copied, "localStorage.getItem('hangman-room-session')")).roomCode, invitedRoom.roomCode)
    await navigate(copied, '/multijugador/?sala=bad')
    await waitFor(copied, "document.querySelector('.invitation-invalid') !== null")
    assert.equal(JSON.parse(await evaluate(copied, "localStorage.getItem('hangman-room-session')")).roomCode, invitedRoom.roomCode)
    await navigate(copied, '/multijugador/')
    await waitFor(copied, "document.querySelector('.lobby-page') !== null")
    await evaluate(copied, "document.querySelector('.global-back-button').click()")
    await waitFor(copied, "localStorage.getItem('hangman-room-session') === null")
    // Join errors on the invitation page keep their own message: a room that filled up after the preview says so,
    // and only a real connection failure shows the connection error.
    const roomFull = { ca: 'La sala és plena.', es: 'La sala está llena.' }
    const connectionError = { ca: "No s'ha pogut connectar al servidor. Torna-ho a provar d'aquí a uns instants.", es: 'No se ha podido conectar con el servidor. Inténtalo de nuevo en unos instantes.' }
    const inviteError = () => evaluate(isolated, "document.querySelector('.invitation-form .form-error')?.textContent ?? ''")
    const joinInvitation = async (language, roomCode) => {
      await navigate(isolated, '/')
      await evaluate(isolated, `localStorage.setItem('hangman-interface-language', '${language}'); localStorage.setItem('hangman-name', 'Convidada'); sessionStorage.clear(); localStorage.removeItem('hangman-room-session'); true`)
      await navigate(isolated, `/multijugador/?sala=${roomCode}`)
      await waitFor(isolated, "document.querySelector('.invitation-form button.primary-action:not(:disabled)') !== null")
    }
    for (const language of ['ca', 'es']) {
      const fullRoom = await createRoom('Plena')
      await joinInvitation(language, fullRoom.roomCode)
      for (let index = 2; index <= 10; index++) {
        const guest = io(origin, { transports: ['websocket'], forceNew: true }); sockets.push(guest)
        const reply = await new Promise((resolve) => guest.emit('room:join', { name: `Jugador ${index}`, code: fullRoom.roomCode }, resolve))
        assert.equal(reply.ok, true)
      }
      await evaluate(isolated, "document.querySelector('.invitation-form button.primary-action').click()")
      await waitFor(isolated, "document.querySelector('.invitation-form .form-error') !== null")
      assert.equal(await inviteError(), roomFull[language], `Room full on the invitation page (${language})`)
      // Block the Socket.IO transports for this tab only; the preview (fetch) still loads.
      const { script } = await command('script.addPreloadScript', { contexts: [isolated], functionDeclaration: `() => {
        const blocked = (url) => String(url).includes('/socket.io/')
        const NativeSocket = window.WebSocket
        window.WebSocket = function (url, protocols) { if (blocked(url)) throw new Error('blocked'); return new NativeSocket(url, protocols) }
        const open = XMLHttpRequest.prototype.open
        XMLHttpRequest.prototype.open = function (method, url, ...rest) { return open.call(this, method, blocked(url) ? 'http://127.0.0.1:9/' : url, ...rest) }
      }` })
      const openRoom = await createRoom('Oberta')
      await joinInvitation(language, openRoom.roomCode)
      await evaluate(isolated, "document.querySelector('.invitation-form button.primary-action').click()")
      await waitFor(isolated, "document.querySelector('.invitation-form .form-error') !== null && !document.querySelector('.invitation-form button.primary-action').disabled")
      assert.equal(await inviteError(), connectionError[language], `Connection failure on the invitation page (${language})`)
      await command('script.removePreloadScript', { script })
    }
    await navigate(isolated, '/')
    await evaluate(isolated, "localStorage.removeItem('hangman-interface-language'); localStorage.removeItem('hangman-name'); sessionStorage.clear(); localStorage.removeItem('hangman-room-session'); true")
    console.log('Browser invitation tests passed: shared tabs, opener copy, isolated contexts, reload, same-room restoration, join, invalid invitation and explicit leave; join errors in CA/ES (room full, connection failure).')

    const learning = await newTab(isolatedProfile)
    const stored = async () => JSON.parse(await evaluate(learning, "localStorage.getItem('penjat-learning')"))
    const click = (selector) => evaluate(learning, `document.querySelector(${JSON.stringify(selector)}).click()`)
    const text = (selector) => evaluate(learning, `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)
    const guessed = "document.querySelectorAll('.learning-game .keyboard button:disabled').length"
    const finishWord = async () => {
      // Exercise UI guesses to completion; alphabetical guesses win some words and lose others.
      for (let index = 0; index < 28; index++) {
        if (await evaluate(learning, "document.querySelector('.vocab-card') !== null")) return
        await evaluate(learning, "document.querySelector('.keyboard button:not(:disabled)')?.click()")
      }
      await waitFor(learning, "document.querySelector('.vocab-card') !== null")
    }
    const noOverflow = () => evaluate(learning, 'document.documentElement.scrollWidth <= document.documentElement.clientWidth')
    await navigate(learning, '/')
    await evaluate(learning, "localStorage.removeItem('penjat-learning'); localStorage.setItem('hangman-interface-language', 'ca')")
    await navigate(learning, '/aprendre/')
    await waitFor(learning, "document.querySelector('.unit-card .primary-action')?.textContent === 'Comença'")
    await click('.unit-card .primary-action')
    await waitFor(learning, "document.querySelector('.learning-game .keyboard') !== null")
    assert.equal(await text('.unit-head h1'), 'Paraula 1 de 12')
    // A refresh mid-word reopens the unit on the same word with its guesses.
    await click('.keyboard button:not(:disabled)')
    await waitFor(learning, `${guessed} === 1`)
    await navigate(learning, '/aprendre/')
    await waitFor(learning, `${guessed} === 1`)
    await finishWord()
    const word = await text('.vocab-card h2')
    const firstResults = (await stored()).words
    assert.equal(Object.keys(firstResults).length, 1)
    // A refresh on the card shows the same card and records nothing twice.
    await navigate(learning, '/aprendre/')
    await waitFor(learning, "document.querySelector('.vocab-card h2') !== null")
    assert.equal(await text('.vocab-card h2'), word)
    assert.deepEqual((await stored()).words, firstResults)
    // The bookmark is saved; a word chip opens its read-only card.
    await click('.vocab-bookmark')
    await waitFor(learning, "document.querySelector('.vocab-bookmark').getAttribute('aria-pressed') === 'true'")
    await navigate(learning, '/aprendre/')
    await waitFor(learning, "document.querySelector('.vocab-bookmark')?.getAttribute('aria-pressed') === 'true'")
    assert.deepEqual((await stored()).bookmarks, Object.keys(firstResults))
    await click('.word-chips button')
    await waitFor(learning, "document.querySelector('.vocab-dialog:modal .vocab-card') !== null")
    await click('.vocab-dialog [data-modal-initial-focus]')
    await waitFor(learning, "document.querySelector('.vocab-dialog') === null")
    // "Torna a les unitats" leaves without asking; the unit continues on the same card.
    await click('.global-back-button')
    await waitFor(learning, "document.querySelector('.unit-list') !== null")
    assert.equal(await evaluate(learning, "document.querySelector('.exit-confirmation-dialog') === null"), true)
    assert.equal(await text('.unit-card .primary-action'), 'Continua')
    assert.ok((await text('.unit-card p')).startsWith('1 de 12 descobertes'))
    await click('.unit-card .primary-action')
    await waitFor(learning, `document.querySelector('.vocab-card h2')?.textContent === ${JSON.stringify(word)}`)
    // Interface language: CA/ES labels; the Catalan content does not change.
    await evaluate(learning, "Array.from(document.querySelectorAll('.interface-language-toggle button')).find((b) => b.textContent.trim() === 'ES').click()")
    await waitFor(learning, "document.querySelector('.vocab-actions .primary-action')?.textContent === 'Siguiente palabra'")
    assert.equal(await evaluate(learning, "document.querySelector('.global-back-button').getAttribute('aria-label')"), 'Volver a las unidades')
    assert.equal(await text('.vocab-card h2'), word)
    await evaluate(learning, "Array.from(document.querySelectorAll('.interface-language-toggle button')).find((b) => b.textContent.trim() === 'CA').click()")
    await waitFor(learning, "document.querySelector('.vocab-actions .primary-action')?.textContent === 'Següent paraula'")
    // Layout: no sideways scroll; on a phone the fixed action bar never covers the end of the page.
    for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
      await command('browsingContext.setViewport', { context: learning, viewport: { width, height } })
      await evaluate(learning, 'scrollTo(0, document.documentElement.scrollHeight)')
      assert.equal(await noOverflow(), true, `learning card fits ${width}px`)
      assert.equal(await evaluate(learning, "document.querySelector('.unit-words').getBoundingClientRect().bottom <= document.querySelector('.vocab-actions').getBoundingClientRect().top + 1"), true, `actions leave the words visible at ${width}px`)
    }
    await command('browsingContext.setViewport', { context: learning, viewport: { width: 1440, height: 900 } })
    // Play the unit to the end: the last card leads to the summary.
    for (let index = 1; index < 12; index++) {
      await click('.vocab-actions .primary-action')
      await waitFor(learning, `document.querySelector('.unit-head h1')?.textContent === 'Paraula ${index + 1} de 12' && document.querySelector('.learning-game .keyboard') !== null`)
      await finishWord()
    }
    assert.equal(await text('.vocab-actions .primary-action'), 'Veure el resum')
    await click('.vocab-actions .primary-action')
    await waitFor(learning, "document.querySelector('.unit-summary') !== null")
    const results = (await stored()).words
    const failed = Object.values(results).filter((result) => result === 'failed').length
    assert.equal(Object.keys(results).length, 12)
    assert.equal(await text('.unit-summary h1'), 'Unitat completada')
    assert.equal(await text('.progress-tiles div:nth-child(3) dd'), String(failed))
    assert.equal((await stored()).sessions.natura, undefined)
    // Replay queues all 12 words without touching the results; review queues only the failed words.
    await evaluate(learning, "Array.from(document.querySelectorAll('.unit-summary-actions button')).find((b) => b.textContent === 'Torna a jugar la unitat').click()")
    await waitFor(learning, "document.querySelector('.unit-head h1')?.textContent === 'Paraula 1 de 12'")
    assert.equal((await stored()).sessions.natura.queue.length, 12)
    assert.deepEqual((await stored()).words, results)
    await evaluate(learning, "localStorage.setItem('penjat-learning', JSON.stringify({ ...JSON.parse(localStorage.getItem('penjat-learning')), sessions: {} }))")
    await click('.global-back-button')
    await navigate(learning, '/aprendre/')
    await waitFor(learning, "document.querySelector('.unit-card .primary-action')?.textContent === 'Revisa'")
    await click('.unit-card .primary-action')
    await waitFor(learning, "document.querySelector('.unit-summary') !== null")
    if (failed > 0) {
      await evaluate(learning, "Array.from(document.querySelectorAll('.unit-summary-actions button')).find((b) => b.textContent === 'Repassa les fallades').click()")
      await waitFor(learning, `document.querySelector('.unit-head h1')?.textContent === 'Repàs: paraula 1 de ${failed}'`)
    }
    await evaluate(learning, "localStorage.removeItem('penjat-learning'); sessionStorage.clear(); localStorage.removeItem('hangman-room-session')")
    console.log('Browser learning tests passed: start, mid-word and card refresh without double counting, bookmark, word card, unguarded return to units, CA/ES, layout at 1440/768/390, whole unit to summary, replay and review.')

    // Finish a match through departure while its last round is still choosing.
    // The server intentionally retains that round; the UI must prioritize match-over.
    const hostSession = await createRoom('Departure host')
    const hostSocket = sockets.at(-1)
    const guestSocket = io(origin, { transports: ['websocket'], forceNew: true })
    sockets.push(guestSocket)
    await new Promise((resolve, reject) => { guestSocket.once('connect', resolve); guestSocket.once('connect_error', reject) })
    const emit = (socket, event, payload) => new Promise((resolve) => payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve))
    const joined = await emit(guestSocket, 'room:join', { name: 'Departure guest', code: hostSession.roomCode })
    assert.equal(joined.ok, true)
    const started = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { hostSocket.off('room:state', listener); reject(new Error('Match did not start')) }, 7000)
      const listener = (view) => {
        if (view.roomStatus !== 'active') return
        clearTimeout(timer); hostSocket.off('room:state', listener); resolve(view)
      }
      hostSocket.on('room:state', listener)
    })
    assert.equal((await emit(hostSocket, 'room:start')).ok, true)
    const state = await started
    const setterSession = state.round.setterId === hostSession.playerId ? hostSession : joined.data.session
    const leavingSocket = state.round.setterId === hostSession.playerId ? guestSocket : hostSocket
    const terminal = await newTab(isolatedProfile)
    await navigate(terminal, '/')
    await evaluate(terminal, `localStorage.setItem('hangman-room-session', JSON.stringify({ version: 1, ...${JSON.stringify(setterSession)} }))`)
    await navigate(terminal, '/multijugador/')
    await waitFor(terminal, "document.querySelector('.word-form') !== null")
    await checkResponsiveScope({ context:terminal, command, evaluate, page:'match', root:'.match-page', selectors:'.match-page, .match-page *' })
    await checkP0EmptyChat({context:terminal,evaluate})
    assert.equal((await emit(leavingSocket, 'chat:send', {text:'Prova de reaccions · Mensaje sin reacciones'})).ok, true)
    await waitFor(terminal, "document.querySelector('.reaction-trigger') !== null")
    await checkP0Chat({context:terminal,command,evaluate,waitFor})
    leavingSocket.emit('room:leave')
    await waitFor(terminal, "document.querySelector('.match-results') !== null")
    assert.equal(await evaluate(terminal, "document.querySelector('.word-form, .forgiveness-wait, .player-terminal-state, .keyboard button:not(:disabled)') !== null"), false)
    console.log('Browser terminal-match test passed: departure during word choice shows results without active-round controls.')
    await checkP0Terminal({context:terminal,command,evaluate,waitFor})
    await checkMatchResultsFlow({ origin, io, sockets, command, evaluate, waitFor, navigate, context: await newTab(isolatedProfile) })
    assert.deepEqual(browserErrors, [], 'No browser console errors should occur')


  }
} finally {
  for (const context of contexts.reverse()) await command('browsingContext.close', { context }).catch(() => {})
  sockets.forEach((socket) => socket.disconnect())
  await command('session.end').catch(() => {})
  ws.close()
}
