// Phase 2A: a real three-player match, with the browser playing one participant through the UI, ending in the
// dedicated results surface. Covers the in-browser transition, focus, readiness, reconnection, language switching,
// the phone action bar and a started rematch. Screenshots go to /tmp/penjat-phase-2a-validation/.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

const directory = '/tmp/penjat-phase-2a-validation'

export async function checkMatchResultsFlow({ origin, io, sockets, command, evaluate, waitFor, navigate, context }) {
  const key = async (value) => command('input.performActions', { context, actions: [{ type: 'key', id: 'phase-2a-keyboard', actions: [{ type: 'keyDown', value }, { type: 'keyUp', value }] }] })
  const screenshot = async (name) => {
    mkdirSync(directory, { recursive: true })
    const shot = await command('browsingContext.captureScreenshot', { context, origin: 'viewport' })
    writeFileSync(`${directory}/${name}.png`, Buffer.from(shot.data, 'base64'))
  }
  const connect = async () => {
    const socket = io(origin, { transports: ['websocket'], forceNew: true })
    sockets.push(socket)
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
    return socket
  }
  const emit = (socket, event, payload) => new Promise((resolve) => payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve))
  let latest = null
  const until = async (predicate, label) => {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) { if (latest && predicate(latest)) return latest; await new Promise((resolve) => setTimeout(resolve, 25)) }
    throw new Error(`Server state never reached: ${label}\n${JSON.stringify(latest)}`)
  }

  const host = await connect()
  host.on('room:state', (view) => { latest = view })
  const created = await emit(host, 'room:create', { name: 'Amfitrió', gameLanguage: 'ca', voltes: 1 })
  assert.equal(created.ok, true)
  const code = created.data.session.roomCode
  const guest = await connect()
  const guestJoin = await emit(guest, 'room:join', { name: 'Convidada', code })
  const browserSeed = await connect()
  const browserJoin = await emit(browserSeed, 'room:join', { name: 'Navegador', code })
  assert.equal(guestJoin.ok && browserJoin.ok, true)
  const A = created.data.session.playerId, B = guestJoin.data.session.playerId, C = browserJoin.data.session.playerId
  const socketFor = { [A]: host, [B]: guest }

  await command('browsingContext.setViewport', { context, viewport: { width: 1440, height: 900 } })
  await navigate(context, '/')
  await evaluate(context, "localStorage.setItem('hangman-interface-language', 'ca')")
  await evaluate(context, `localStorage.setItem('hangman-room-session', JSON.stringify({ version: 1, ...${JSON.stringify(browserJoin.data.session)} }))`)
  await navigate(context, '/multijugador/')
  await waitFor(context, "document.querySelector('.lobby-layout, .lobby-page, .player-list') !== null")
  assert.equal((await emit(host, 'room:start')).ok, true)

  // Play the whole match. The browser guesses first whenever it guesses, so it wins uniquely (4 points vs 3 and 2).
  for (let turn = 1; ; turn++) {
    const choosing = await until((view) => view.roomStatus === 'active' && view.round?.number === turn && view.round.status === 'choosing-word', `turn ${turn} choosing`)
    const setter = choosing.round.setterId
    if (setter === C) {
      await waitFor(context, "document.querySelector('.word-form input') !== null")
      await evaluate(context, "document.querySelector('.word-form input').focus()")
      await key('A'); await key('')
    } else assert.equal((await emit(socketFor[setter], 'round:set-word', { word: 'A' })).ok, true)
    await until((view) => view.round?.status === 'guessing', `turn ${turn} guessing`)
    for (const guesser of [C, A, B].filter((id) => id !== setter)) {
      if (guesser === C) {
        await waitFor(context, "document.querySelector('.keyboard button:not(:disabled)') !== null")
        await key('a')
        await until((view) => view.players.find((player) => player.id === C)?.roundStatus === 'solved' || view.round?.status !== 'guessing', `browser solved turn ${turn}`)
      } else assert.equal((await emit(socketFor[guesser], 'game:guess', { letter: 'A' })).ok, true)
    }
    const finished = await until((view) => view.roomStatus === 'match-over' || view.round?.status === 'round-over', `turn ${turn} finished`)
    if (finished.roomStatus === 'match-over') break
    const next = finished.round.nextSetterId
    if (next === C) {
      await waitFor(context, "[...document.querySelectorAll('.multiplayer-game .primary-action')].some((b) => b.textContent === 'Torn següent')")
      await evaluate(context, "[...document.querySelectorAll('.multiplayer-game .primary-action')].find((b) => b.textContent === 'Torn següent').click()")
    } else assert.equal((await emit(socketFor[next], 'round:continue')).ok, true)
  }
  assert.equal(latest.matchResult.scores[C], 4)

  // The in-browser transition: gameplay disappears, the outcome heading takes focus once, no live announcement.
  await waitFor(context, "document.querySelector('.match-results') !== null")
  const transition = JSON.parse(await evaluate(context, `JSON.stringify({
    heading: document.querySelector('#match-outcome-title').lastChild.textContent, focused: document.activeElement?.id,
    gameplay: !!document.querySelector('.keyboard, .scoreboard, .game-columns, .word-form, .drawing-panel, .forgiveness-tray'),
    rows: [...document.querySelectorAll('.standing-row')].map((row) => [row.querySelector('.standing-rank').textContent, row.querySelector('.standing-name').textContent, row.querySelector('.standing-score [aria-hidden]').textContent, !!row.querySelector('.standing-self')]),
    readiness: document.querySelector('.rematch-readiness [aria-live]').textContent, announcement: document.querySelector('.match-results > [role=status]').textContent,
    actionBeforeStandings: document.querySelector('.match-actions').getBoundingClientRect().bottom < document.querySelector('.match-standings').getBoundingClientRect().top })`))
  assert.equal(transition.heading, 'Has guanyat!')
  assert.equal(transition.focused, 'match-outcome-title')
  assert.equal(transition.gameplay, false)
  assert.deepEqual(transition.rows[0], ['1', 'Navegador', '4', true])
  assert.deepEqual(transition.rows.map(([, name]) => name).sort(), ['Amfitrió', 'Convidada', 'Navegador'])
  assert.equal(transition.rows.filter(([, , , self]) => self).length, 1)
  assert.equal(transition.readiness, '0 de 3 jugadors preparats')
  assert.equal(transition.announcement, '', 'focus carries the outcome; no duplicate live announcement')
  assert.equal(transition.actionBeforeStandings, true)
  await screenshot('ca-1440-real-win')

  // Readiness and reconnection updates neither move focus nor re-announce the outcome.
  assert.equal((await emit(host, 'match:rematch')).ok, true)
  await waitFor(context, "document.querySelector('.rematch-readiness [aria-live]').textContent === '1 de 3 jugadors preparats'")
  assert.equal(await evaluate(context, "document.querySelector('.match-actions .primary-action').textContent"), 'Revenja', 'others being ready keeps the action available')
  guest.disconnect()
  await waitFor(context, "document.querySelector('.rematch-note')?.textContent === 'Esperant la reconnexió de Convidada.'")
  assert.equal(await evaluate(context, "[...document.querySelectorAll('.standing-row')].find((row) => row.textContent.includes('Convidada')).querySelector('.standing-status').lastChild.textContent"), 'Reconnectant…')
  assert.equal(await evaluate(context, "document.querySelector('.rematch-readiness [aria-live]').textContent"), '1 de 3 jugadors preparats', 'reconnecting players stay in the denominator')
  assert.equal(await evaluate(context, 'document.activeElement.id'), 'match-outcome-title')
  assert.equal(await evaluate(context, "document.querySelector('.match-results > [role=status]').textContent"), '')
  await screenshot('ca-1440-real-reconnecting')

  // Interface language switch keeps the same surface without stealing focus or announcing again.
  await evaluate(context, "(() => { const b = [...document.querySelectorAll('.interface-language-toggle button')].find((b) => b.textContent.trim() === 'ES'); b.focus(); b.click() })()")
  await waitFor(context, "document.querySelector('#match-outcome-title')?.lastChild.textContent === '¡Has ganado!'")
  const spanish = await evaluate(context, "document.querySelector('.match-results').innerText")
  for (const catalan of ['Revenja', 'Surt al menú', 'Classificació', 'jugadors', 'Reconnectant', 'Detalls']) assert.ok(!spanish.includes(catalan), `Spanish results contain "${catalan}"`)
  assert.equal(await evaluate(context, "document.activeElement.closest('.interface-language-toggle') !== null"), true, 'language switch does not refocus the outcome')
  assert.equal(await evaluate(context, "document.querySelector('.match-results > [role=status]').textContent"), '')

  // Phone: persistent bar visible from the first screen and after scrolling to the end.
  await command('browsingContext.setViewport', { context, viewport: { width: 390, height: 844 } })
  const phone = JSON.parse(await evaluate(context, `(() => { const main = document.querySelector('.match-over-page'); main.scrollTop = 0; const top = document.querySelector('.match-actions .primary-action').getBoundingClientRect(); main.scrollTop = main.scrollHeight; const bottom = document.querySelector('.match-actions .primary-action').getBoundingClientRect(), bar = document.querySelector('.match-actions').getBoundingClientRect(), rail = document.querySelector('.chat-launcher').getBoundingClientRect(); return JSON.stringify({ position: getComputedStyle(document.querySelector('.match-actions')).position, top: top.bottom <= innerHeight, bottom: bottom.bottom <= innerHeight, chatClear: bar.bottom <= rail.top && main.getBoundingClientRect().bottom <= rail.top, overflow: document.documentElement.scrollWidth > innerWidth }) })()`))
  assert.deepEqual(phone, { position: 'fixed', top: true, bottom: true, chatClear: true, overflow: false })
  await evaluate(context, 'document.querySelector(".match-over-page").scrollTop = 0')
  await screenshot('es-390-real-reconnecting')

  // Request: pending is not actionable, a second activation sends nothing, focus lands on the requested state.
  await evaluate(context, "document.querySelector('.match-actions .primary-action').focus()")
  await key(''); await key('')
  await waitFor(context, "document.querySelector('.rematch-requested') !== null")
  assert.equal(await evaluate(context, "document.activeElement.className"), 'rematch-requested')
  assert.equal(await evaluate(context, "document.querySelector('.match-actions .primary-action, .match-actions .form-error')"), null)
  assert.equal(await evaluate(context, "document.querySelector('.rematch-readiness [aria-live]').textContent"), '2 de 3 jugadores listos')
  assert.deepEqual([...latest.match.rematchReadyPlayerIds].sort(), [A, C].sort())
  await screenshot('es-390-real-ready')

  // The reconnecting player returns and accepts: the server starts the rematch and the results surface goes away.
  const returning = await connect()
  assert.equal((await emit(returning, 'room:resume', guestJoin.data.session)).ok, true)
  await waitFor(context, "document.querySelector('.rematch-note') === null")
  assert.equal((await emit(returning, 'match:rematch')).ok, true)
  await waitFor(context, "document.querySelector('.match-results') === null && document.querySelector('.multiplayer-game') !== null")
  assert.equal(await evaluate(context, "document.activeElement !== document.body && document.querySelector('.match-layout').contains(document.activeElement)"), true, 'focus moves into the new game')
  assert.equal(await evaluate(context, "document.documentElement.style.getPropertyValue('--match-actions-height')"), '', 'action-bar reservation is removed with the results')
  await evaluate(context, "[...document.querySelectorAll('.interface-language-toggle button')].find((b) => b.textContent.trim() === 'CA').click()")
  for (const socket of [host, returning, browserSeed]) socket.emit('room:leave')
  console.log('Phase 2A browser flow passed: real 3-player win, focus once, readiness/reconnection without re-announcement, CA→ES, phone bar, guarded request, rematch start.')
}
