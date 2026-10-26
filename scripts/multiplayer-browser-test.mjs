// Phase 2D: real Socket.IO matches with several real browser participants (separate browser contexts/windows) plus
// socket bots, checking the live ranking against the server's own state after every update.
//   4 players: host bot + 3 browsers (390, 1100, 1366); full match, tie for first, results and rematch.
//   10 players: 4 browsers (390 CA, 1100 ES, 1366 CA, 320 ES; two of them named "Marc") + 6 bots; a disconnect and resume,
//   a departure, chat while the ranking updates, completion and rematch.
// Usage: TEST_SERVER_URL=http://127.0.0.1:3002 BROWSER=firefox|chromium|webkit npm run test:browser:multiplayer
// Engine endpoints and setup are described in scripts/browser-driver.mjs. Screenshots: $SCREENSHOT_DIR (default
// /tmp/penjat-phase-2d-multiplayer/<engine>/).
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { io } from 'socket.io-client'
import { openDriver, KEY } from './browser-driver.mjs'

const origin = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3002'
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Browser tests must target a local server')
const engine = process.env.BROWSER || 'firefox'
const only = process.env.SCENARIO // 'four' | 'ten'
const shots = `${process.env.SCREENSHOT_DIR || '/tmp/penjat-phase-2d-multiplayer'}/${engine}`
mkdirSync(shots, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// Compact ranking below the three-column layout since Phase 2D; PHASE_2C_BASELINE=1 expects the older stacked-only rule.
const STACKED_MAX = 999, COMPACT_MAX = process.env.PHASE_2C_BASELINE === '1' ? 999 : 1299
const copy = {
  ca: { reconnecting: 'Reconnectant…', more: 'Veure tot', less: 'Veure menys', count: (n, d) => `${n} jugadors${d ? ` · ${d} ${d === 1 ? 'ha sortit' : 'han sortit'}` : ''}`, tied: (n) => `${n} jugadors empatats`, next: 'Torn següent', rematch: 'Revenja', notice: (name) => `${name} ha perdut la connexió. Té 2 minuts per tornar.` },
  es: { reconnecting: 'Reconectando…', more: 'Ver todo', less: 'Ver menos', count: (n, d) => `${n} ${n === 1 ? 'jugador' : 'jugadores'}${d ? ` · ${d} ${d === 1 ? 'ha salido' : 'han salido'}` : ''}`, tied: (n) => `${n} jugadores empatados`, next: 'Siguiente turno', rematch: 'Revancha', notice: (name) => `${name} ha perdido la conexión. Tiene 2 minutos para volver.` },
}

const sockets = []
async function connect() {
  const socket = io(origin, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  return socket
}
const emit = (socket, event, payload) => new Promise((resolve) => payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve))
const competition = (players) => { const sorted = [...players].sort((a, b) => b.score - a.score); return sorted.map((player) => ({ player, rank: sorted.findIndex((p) => p.score === player.score) + 1 })) }

async function scenario(driver, label, roster) {
  console.log(`\n[${engine}] ${label}`)
  let latest = null
  const until = async (predicate, what, timeout = 10000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { if (latest && predicate(latest)) return latest; await sleep(20) }
    throw new Error(`Server state never reached: ${what}\n${JSON.stringify({ room: latest?.roomStatus, round: latest?.round && [latest.round.number, latest.round.status, latest.round.setterId], players: latest?.players?.map((p) => [p.id, p.name, p.score, p.roundStatus, p.connectionState]) })}`)
  }
  // Join everyone: bots keep their socket; browsers get a seeded session and resume it from the page.
  const members = []
  for (const [index, person] of roster.entries()) {
    const socket = await connect()
    if (index === 0) socket.on('room:state', (view) => { latest = view })
    const response = index === 0 ? await emit(socket, 'room:create', { name: person.name, gameLanguage: 'ca', voltes: 1 }) : await emit(socket, 'room:join', { name: person.name, code: members[0].session.roomCode })
    assert.equal(response.ok, true, `${person.name} joins`)
    members.push({ ...person, socket, session: response.data.session, id: response.data.session.playerId })
  }
  const browsers = members.filter((m) => m.browser)
  for (const member of browsers) {
    const { width, height, lang } = member.browser
    member.page = await driver.newPage({ width, height })
    member.t = copy[lang]
    await member.page.goto(`${origin}/`)
    await member.page.eval(`(localStorage.setItem('hangman-interface-language', '${lang}'), localStorage.setItem('hangman-room-session', JSON.stringify({ version: 1, ...${JSON.stringify(member.session)} })), true)`)
    await member.page.goto(`${origin}/multijugador/`)
  }
  for (const member of browsers) await member.page.waitFor('document.querySelector(".lobby-layout, .lobby-page")', `${member.name} lobby`)
  const byId = Object.fromEntries(members.map((m) => [m.id, m]))
  const host = members[0]
  const shot = async (member, name) => member.page.screenshot(`${shots}/${label}-${member.browser.width}-${name}.png`)

  // The ranking in every browser equals the server's active roster with competition ranks; only its own row is "you".
  async function checkRanking(member, state) {
    const { width } = member.browser
    const dom = await member.page.eval(`(() => { const board = document.querySelector('.scoreboard'); if (!board) return null; const toggle = board.querySelector('.scoreboard-toggle'); return {
      count: board.querySelector('.scoreboard-count').textContent, collapsible: board.classList.contains('is-collapsible'),
      toggle: toggle && getComputedStyle(toggle).display !== 'none' ? toggle.getAttribute('aria-expanded') : null,
      fullVisible: getComputedStyle(board.querySelector('.scoreboard-full')).display !== 'none',
      rows: [...board.querySelectorAll('.scoreboard-full ol > li')].map((li) => [li.querySelector('.rank').textContent, li.querySelector('.player-name').textContent, li.querySelector('strong').textContent, !!li.querySelector('.player-self'), li.querySelector('small').textContent]),
      departed: [...board.querySelectorAll('.departed-players li')].map((li) => [li.querySelector('.player-name').textContent, li.querySelector('strong').textContent]),
      summary: [...board.querySelectorAll('.ranking-summary-row')].filter((row) => getComputedStyle(row).display !== 'none').map((row) => row.textContent),
      overflow: document.documentElement.scrollWidth - innerWidth } })()`)
    assert.ok(dom, `${member.name}@${width}: ranking present`)
    const active = state.players.filter((p) => p.active), departed = state.players.filter((p) => !p.active)
    const expected = competition(active).map(({ player, rank }) => [String(rank), player.name, String(player.score), player.id === member.id])
    assert.deepEqual(dom.rows.map((row) => row.slice(0, 4)), expected, `${member.name}@${width}: ranks, names, scores and "you"`)
    assert.equal(dom.rows.filter((row) => row[3]).length, 1, 'exactly one "you" row')
    assert.deepEqual(dom.departed, departed.map((p) => [p.name, String(p.score)]), 'departed players keep their scores')
    assert.equal(dom.count, member.t.count(active.length, departed.length))
    for (const row of dom.rows) if (state.players.find((p) => p.name === row[1] && p.connectionState === 'reconnecting' && p.active)) assert.equal(row[4], member.t.reconnecting)
    assert.ok(dom.overflow <= 0, `${member.name}@${width}: no page overflow`)
    const compact = width <= COMPACT_MAX && state.players.length >= 4
    assert.equal(dom.toggle !== null, compact, `${member.name}@${width}: compact ranking ${compact ? 'shown' : 'not used'}`)
    if (compact && dom.toggle === 'false') {
      assert.equal(dom.fullVisible, false)
      const ranks = competition(active), leaders = ranks.filter((r) => r.rank === 1), self = ranks.find((r) => r.player.id === member.id)
      if (leaders.length > 2) assert.ok(dom.summary[0].includes(member.t.tied(leaders.length)), `summary names a ${leaders.length}-way tie: ${dom.summary[0]}`)
      else for (const { player } of leaders) assert.ok(dom.summary[0].includes(player.name), `leader ${player.name} named`)
      if (self && !(leaders.length <= 2 && self.rank === 1)) assert.ok(dom.summary.at(-1).includes(`${self.player.score} `), `own line shows ${self.player.score}: ${dom.summary.at(-1)}`)
    } else assert.equal(dom.fullVisible, true)
    return dom
  }
  const checkAll = async (what) => { const state = latest; for (const member of browsers) await checkRanking(member, state); console.log(`  ✓ ranking in ${browsers.length} browsers: ${what}`) }

  // Plays one turn. `order(guesserIds, state)` returns the solve order; `during` runs once guessing has started.
  async function turn(number, { order = (ids) => ids, during } = {}) {
    const choosing = await until((v) => v.round?.number === number && v.round.status === 'choosing-word', `turn ${number} choosing`)
    const setter = byId[choosing.round.setterId]
    if (setter.page) {
      await setter.page.waitFor('document.querySelector(".word-form input")', 'word form')
      await setter.page.eval('(document.querySelector(".word-form input").focus(), true)')
      await setter.page.key('A'); await setter.page.key(KEY.Enter)
    } else assert.equal((await emit(setter.socket, 'round:set-word', { word: 'A' })).ok, true)
    const guessing = await until((v) => v.round?.number === number && v.round.status === 'guessing', `turn ${number} guessing`)
    if (during) await during(guessing, setter)
    const guessers = latest.players.filter((p) => p.active && p.id !== setter.id).map((p) => p.id)
    for (const id of order(guessers, latest)) {
      const member = byId[id]
      if (member.page) {
        await member.page.waitFor('document.querySelector(".keyboard button:not(:disabled)")', `${member.name} keyboard`)
        // Physical key unless focus is in a text field (where letters belong to the field); then the on-screen key.
        const typing = await member.page.eval('document.activeElement?.matches("input, textarea") ?? false')
        if (typing) await member.page.eval('([...document.querySelectorAll(".keyboard button")].find((b) => b.textContent.trim() === "A").click(), true)')
        else await member.page.key('a')
      } else assert.equal((await emit(member.socket, 'game:guess', { letter: 'A' })).ok, true)
      await until((v) => v.players.find((p) => p.id === id)?.roundStatus === 'solved' || v.round?.status !== 'guessing', `${member.name} solved`)
    }
    const done = await until((v) => v.roomStatus === 'match-over' || (v.round?.number === number && v.round.status === 'round-over'), `turn ${number} finished`)
    for (const member of browsers) await member.page.waitFor(`(() => { const s = [...document.querySelectorAll('.scoreboard-full ol > li strong')].map((e) => e.textContent).join(); return ${JSON.stringify(latest.players.filter((p) => p.active).map((p) => String(p.score)).sort((a, b) => b - a).join())} === s || !!document.querySelector('.match-results') })()`, `${member.name} sees turn ${number} scores`)
    return done
  }
  async function advance(state) {
    if (state.roomStatus === 'match-over') return
    const next = byId[state.round.nextSetterId]
    if (next.page) {
      await next.page.waitFor(`[...document.querySelectorAll('.multiplayer-game .primary-action')].some((b) => b.textContent === ${JSON.stringify(next.t.next)})`, 'next round button')
      await next.page.eval(`([...document.querySelectorAll('.multiplayer-game .primary-action')].find((b) => b.textContent === ${JSON.stringify(next.t.next)}).click(), true)`)
    } else assert.equal((await emit(next.socket, 'round:continue')).ok, true)
  }
  // Order so the two players closest to first place finish level on top (exhaustive over pairs, simulated).
  const tieOrder = (ids, state) => {
    const score = Object.fromEntries(state.players.map((p) => [p.id, p.score])), G = ids.length
    for (const p of ids) for (const q of ids) {
      if (p === q || score[p] < score[q] || score[p] - score[q] >= G) continue
      const rest = ids.filter((id) => id !== p && id !== q).sort((a, b) => score[a] - score[b])
      const order = Array(G).fill(null); order[0] = q; order[score[p] - score[q]] = p
      if (order[score[p] - score[q]] !== p || score[p] - score[q] === 0) continue
      for (let i = 0, r = 0; i < G; i++) if (order[i] === null) order[i] = rest[r++]
      const total = (id) => score[id] + (ids.includes(id) ? G - order.indexOf(id) : 0)
      const top = Math.max(...state.players.filter((x) => x.active).map((x) => total(x.id)))
      if (total(p) === top && total(q) === top && state.players.filter((x) => x.active && total(x.id) === top).length === 2) return order
    }
    return ids
  }

  assert.equal((await emit(host.socket, 'room:start')).ok, true)
  for (const member of browsers) await member.page.waitFor('document.querySelector(".multiplayer-game")', `${member.name} game`)
  await until((v) => v.round?.status === 'choosing-word', 'started')
  await checkAll('match start, everyone on 0 (all tied)')

  // Turn 1: live update from 0 to distinct scores while a compact-ranking participant (not the setter, whose word form
  // unmounts on submit) has the full list open with focus on its toggle.
  const phone = browsers.find((m) => m.browser.width <= STACKED_MAX)
  let opener = null
  let state = await turn(1, {
    during: async (_, setter) => {
      opener = browsers.find((m) => m.browser.width <= COMPACT_MAX && m !== setter)
      await opener.page.eval('(document.querySelector(".scoreboard-toggle").focus(), true)')
      await opener.page.key(KEY.Enter)
      await opener.page.waitFor('document.querySelector(".scoreboard-toggle").getAttribute("aria-expanded") === "true"', 'expanded')
    },
  })
  await checkAll('after turn 1 (live update)')
  assert.deepEqual(await opener.page.eval('[document.activeElement?.className, document.querySelector(".scoreboard-toggle").getAttribute("aria-expanded"), document.querySelector(".scoreboard-toggle").textContent]'), ['scoreboard-toggle', 'true', opener.t.less], 'live update keeps the ranking open and focused')
  await shot(opener, 'expanded-after-update')
  await opener.page.key(' ')
  await opener.page.waitFor('document.querySelector(".scoreboard-toggle").getAttribute("aria-expanded") === "false"', 'collapsed with Space')
  console.log(`  ✓ expand (Enter) at ${opener.browser.width}px, live update keeps state and focus, collapse (Space)`)
  await advance(state)

  // Turn 2: a desktop participant drafts a chat message while the ranking updates; then a tie for first place.
  let writer = null
  state = await turn(2, {
    order: tieOrder,
    during: async (_, setter) => {
      writer = [...browsers].sort((a, b) => b.browser.width - a.browser.width).find((m) => m !== setter)
      if (writer.browser.width < 1000) {
        await writer.page.eval('(document.querySelector(".chat-launcher > button").click(), true)')
        await writer.page.waitFor('document.querySelector(".chat-dialog").open')
      }
      await writer.page.eval('(document.querySelector(".chat-form input").focus(), true)')
      for (const character of 'Hola') await writer.page.key(character)
    },
  })
  const leaders = competition(state.players.filter((p) => p.active)).filter((r) => r.rank === 1)
  assert.equal(leaders.length, 2, `turn 2 ends with two leaders: ${JSON.stringify(state.players.map((p) => [p.name, p.score]))}`)
  await checkAll(`after turn 2 (tie: ${leaders.map((l) => l.player.name).join(' = ')} on ${leaders[0].player.score})`)
  {
    assert.equal(await writer.page.eval('document.querySelector(".chat-form input").value'), 'Hola', 'chat draft survives a ranking update')
    assert.equal(await writer.page.eval('document.activeElement === document.querySelector(".chat-form input")'), true, 'chat keeps focus across ranking updates')
    await writer.page.key(KEY.Enter)
    for (const member of browsers) await member.page.waitFor(`[...document.querySelectorAll('.chat-messages')].some((c) => c.textContent.includes('Hola'))`, `${member.name} receives chat`)
    if (writer.browser.width < 1000) await writer.page.eval('(document.querySelector(".chat-close").click(), true)')
    console.log('  ✓ chat draft and focus survive a ranking update; message reaches every browser')
  }
  for (const member of browsers) await shot(member, 'tie')
  await advance(state)

  let number = 3
  if (roster.length >= 10) {
    // Turn 3: a guesser drops; every browser shows the reconnecting state, then the player resumes and finishes.
    let dropper = null
    state = await turn(3, {
      during: async (_, setter) => {
        dropper = members.find((m) => !m.page && m !== host && m !== setter)
        dropper.socket.disconnect()
        await until((v) => v.players.find((p) => p.id === dropper.id)?.connectionState === 'reconnecting', 'reconnecting')
        for (const member of browsers) await member.page.waitFor(`document.querySelector('.connection-notice')?.textContent.startsWith(${JSON.stringify(member.t.notice(dropper.name))})`, `${member.name} notice`)
        await checkAll('player reconnecting')
        await phone.page.eval('(document.querySelector(".scoreboard-toggle").click(), true)')
        assert.equal(await phone.page.eval(`[...document.querySelectorAll('.scoreboard-full li')].find((li) => li.querySelector('.player-name').textContent === ${JSON.stringify(dropper.name)}).querySelector('small').textContent`), phone.t.reconnecting)
        for (const member of browsers) await shot(member, 'reconnecting')
        await phone.page.eval('(document.querySelector(".scoreboard-toggle").click(), true)')
        dropper.socket = await connect()
        assert.equal((await emit(dropper.socket, 'room:resume', dropper.session)).ok, true)
        await until((v) => v.players.find((p) => p.id === dropper.id)?.connectionState === 'connected', 'resumed')
        for (const member of browsers) await member.page.waitFor('document.querySelector(".connection-notice") === null', `${member.name} notice cleared`)
        console.log('  ✓ reconnecting status and notice in every browser, cleared on resume')
      },
    })
    await checkAll('after turn 3')
    await advance(state)
    // Turn 4: a bot leaves for good while choosing; it moves to the departed section with its score.
    await until((v) => v.round?.number === 4 && v.round.status === 'choosing-word', 'turn 4')
    const leaver = members.find((m) => !m.page && m !== host && m.id !== latest.round.setterId)
    {
      leaver.socket.emit('room:leave')
      await until((v) => v.players.find((p) => p.id === leaver.id)?.active === false, 'departed')
      for (const member of browsers) await member.page.waitFor('document.querySelector(".departed-players")', `${member.name} departed list`)
      await checkAll('after a departure')
      for (const member of browsers) await shot(member, 'departed')
      console.log('  ✓ departure: header count, departed section with score, ranks recomputed')
    }
    number = 4
  }
  // Remaining turns until match-over (a departed player's turn is skipped, so round numbers can jump).
  for (; ; number++) {
    const next = await until((v) => v.roomStatus === 'match-over' || (v.round?.number >= number && v.round.status === 'choosing-word'), `turn ${number}`)
    if (next.roomStatus === 'match-over') break
    number = next.round.number
    state = await turn(number)
    if (state.roomStatus === 'match-over') break
    await checkAll(`after turn ${number}`)
    await advance(state)
  }

  // Results: every browser replaces the board with the final classification computed from the server snapshot.
  const final = await until((v) => v.roomStatus === 'match-over' && v.matchResult, 'match result')
  for (const member of browsers) {
    await member.page.waitFor('document.querySelector(".match-results")', `${member.name} results`)
    const rows = await member.page.eval('[...document.querySelectorAll(".standing-row")].map((row) => [row.querySelector(".standing-rank").textContent, row.querySelector(".standing-name").textContent, !!row.querySelector(".standing-self")])')
    assert.equal(rows.length, final.players.length, 'final classification keeps the whole roster')
    assert.equal(rows.filter((r) => r[2]).length, 1, 'one "you" in results')
    const mine = rows.find((r) => r[2])
    assert.equal(mine[1], member.name)
    const scores = final.matchResult.scores, own = scores[member.id]
    assert.equal(mine[0], String(1 + Object.values(scores).filter((s) => s > own).length), `${member.name}: own final place`)
    assert.equal(await member.page.eval('document.documentElement.scrollWidth - innerWidth <= 0'), true)
    await shot(member, 'results')
  }
  console.log('  ✓ match-over results in every browser (roster, own place, no overflow)')
  // Rematch: browsers press the button (keyboard), bots accept; a new game starts with everyone back on zero.
  for (const member of members.filter((m) => latest.players.find((p) => p.id === m.id)?.active)) {
    if (member.page) {
      await member.page.eval('(document.querySelector(".match-actions .primary-action").focus(), true)')
      await member.page.key(KEY.Enter)
    } else assert.equal((await emit(member.socket, 'match:rematch')).ok, true)
  }
  await until((v) => v.roomStatus === 'active' && v.players.every((p) => !p.active || p.score === 0), 'rematch started')
  for (const member of browsers) await member.page.waitFor('document.querySelector(".multiplayer-game") && !document.querySelector(".match-results")', `${member.name} rematch`)
  await checkAll('rematch: scores reset, all tied')
  for (const member of browsers) await shot(member, 'rematch')
  console.log('  ✓ rematch starts in every browser')
  for (const member of members) member.socket.emit('room:leave')
  for (const member of browsers) await member.page.close()
}

const driver = await openDriver(engine)
console.log(`${driver.version} against ${origin}`)
try {
  if (!only || only === 'four') await scenario(driver, 'four', [
    { name: 'Amfitrió' },
    { name: 'Marc', browser: { width: 390, height: 844, lang: 'ca' } },
    { name: 'Maria Antònia Fernández', browser: { width: 1100, height: 800, lang: 'es' } },
    { name: 'Júlia', browser: { width: 1366, height: 768, lang: 'ca' } },
  ])
  if (!only || only === 'ten') await scenario(driver, 'ten', [
    { name: 'Amfitrió' },
    { name: 'Marc', browser: { width: 390, height: 844, lang: 'ca' } },
    { name: 'Maria Antònia Fernández', browser: { width: 1100, height: 800, lang: 'es' } },
    { name: 'Júlia', browser: { width: 1366, height: 768, lang: 'ca' } },
    { name: 'Marc', browser: { width: 320, height: 568, lang: 'es' } },
    { name: 'Pol' }, { name: 'Ona' }, { name: 'Biel' }, { name: 'Quim' }, { name: 'Núria Puigdomènech Roig' },
  ])
  console.log(`\n[${engine}] multiplayer browser checks passed. Screenshots: ${shots}`)
} finally {
  for (const socket of sockets) socket.close()
  await driver.close()
}
