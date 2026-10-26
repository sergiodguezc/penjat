// Focused real-browser chat checks. No npm browser dependency. See docs/development.md for engine setup.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { io } from 'socket.io-client'
import { openDriver, KEY } from './browser-driver.mjs'

const origin = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3002'
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Use a dedicated local server')
assert.ok((await fetch(`${origin}/health`)).ok, 'A built local server must be running')
const engine = process.env.BROWSER || 'firefox'
assert.ok(['firefox', 'chromium'].includes(engine), 'This suite requires an engine with real touch input support')
const directory = `/tmp/penjat-chat-validation/${engine}`
mkdirSync(directory, { recursive: true })
const sockets = []
const connect = async () => {
  const socket = io(origin, { transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
  return socket
}
const emit = async (socket, event, payload) => {
  const response = await new Promise((resolve, reject) => socket.timeout(5000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response)))
  assert.equal(response.ok, true, `${event}: ${JSON.stringify(response)}`)
  return response.data
}
const driver = await openDriver(engine)
try {
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1100, 800], [1440, 900]]) {
    const host = await connect()
    const room = await emit(host, 'room:create', { name: 'Marta', gameLanguage: 'ca', voltes: 1 })
    const seat = await connect()
    const joined = await emit(seat, 'room:join', { name: 'Júlia', code: room.session.roomCode })
    const page = await driver.newPage({ width, height })
    await page.goto(origin)
    await page.eval(`(localStorage.setItem('hangman-room-session', JSON.stringify({ version: 1, ...${JSON.stringify(joined.session)} })), true)`)
    await page.goto(`${origin}/multijugador/?chatDebug=1`)
    await page.waitFor('document.querySelector(".room-chat")')
    assert.equal(await page.eval('document.querySelector(".chat-debug") !== null'), false, 'Production never enables diagnostics, even with the opt-in query')
    if (width >= 1000) assert.equal(await page.eval('document.activeElement.closest(".chat-dialog") !== null'), false, 'Inline chat does not steal keyboard focus on mount')
    // A persisted empty baseline proves restoration completed before sending the first live message.
    await page.waitFor(`sessionStorage.getItem('penjat-chat-inbox:${room.session.roomCode}:${joined.session.playerId}') !== null`)
    if (width < 1000) {
      // Safari's legacy vh minimum can exceed dvh while its toolbars are visible.
      await page.eval(`(() => { const style=document.createElement('style'); style.textContent='@media (max-width:62.4375em) { body { min-height:calc(100dvh + 180px) } }'; document.querySelector('.lobby-card').style.minHeight='200dvh'; document.head.append(style); window.scrollTo(0,180); return true })()`)
      await page.settle()
      const pageGeometry = await page.eval('({ scroll: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight, rootTop: document.querySelector("#root").getBoundingClientRect().top })')
      assert.equal(pageGeometry.scroll, 0, 'Only the game container can scroll, not a taller outer body')
      assert.ok(pageGeometry.height <= pageGeometry.viewport + 1, 'No legacy-vh blank area below the app')
      assert.equal(pageGeometry.rootTop, 0)
      assert.equal(await page.eval('(() => { const main=document.querySelector("main"); main.scrollTop=main.scrollHeight; return main.scrollTop>0 && scrollY===0 })()'), true, 'Long room content stays scrollable without moving the outer page')
      await page.eval('(document.querySelector(".lobby-card").style.minHeight="", document.querySelector("main").scrollTop=0, true)')
    }
    const railBefore = width < 1000 ? await page.eval('document.querySelector(".chat-launcher").getBoundingClientRect().height') : null
    for (const text of ['Ei!', 'Sí', '😂', 'Quina paraula!', 'No pot ser', 'Va']) await emit(host, 'chat:send', { text })
    await page.waitFor('document.querySelectorAll(".chat-messages article").length === 6')
    if (width < 1000) {
      await page.waitFor('document.querySelector(".chat-launcher .chat-badge")?.textContent === "6"')
      assert.equal(await page.eval('document.querySelector(".chat-launcher").getBoundingClientRect().height'), railBefore, 'Notifications never change the rail height')
      assert.equal(await page.eval('Math.round(document.querySelector("main").getBoundingClientRect().bottom - document.querySelector(".chat-launcher").getBoundingClientRect().top)'), 0, 'The rail is outside the game scroll viewport, never over its controls')
      const previewStyle = await page.eval('(() => { const preview = document.querySelector(".chat-preview"); const s = getComputedStyle(preview); return [s.borderTopWidth, s.flexShrink, document.querySelectorAll(".chat-preview").length] })()')
      assert.deepEqual(previewStyle, ['0px', '1', 1], 'One compact preview may shrink and has no bubble border')
      await page.screenshot(`${directory}/${width}-launcher.png`)
      await page.tap('.chat-launcher > button')
      await page.waitFor('document.querySelector(".chat-dialog").matches(":modal")')
      assert.equal(await page.eval('document.activeElement.matches(".chat-close")'), true, 'Opening does not summon the keyboard')
    }
    await page.settle()
    const density = await page.eval(`(() => {
      const articles = [...document.querySelectorAll('.chat-messages article')]
      const triggers = articles.map((article) => article.querySelector('.reaction-trigger').getBoundingClientRect())
      return {
        names: document.querySelectorAll('.chat-message-meta strong').length,
        rows: articles.slice(1).map((article) => article.getBoundingClientRect().height),
        disjoint: triggers.every((rect, i) => !i || rect.top >= triggers[i - 1].bottom),
        contained: articles.every((article, i) => { const r = article.getBoundingClientRect(); return triggers[i].top >= r.top && triggers[i].bottom <= r.bottom }),
        overflow: document.documentElement.scrollWidth > innerWidth
      }
    })()`)
    assert.equal(density.names, 1, 'Consecutive short messages share metadata')
    assert.ok(density.rows.every((height) => height < 44), `Reaction controls must not inflate short messages: ${density.rows}`)
    assert.equal(density.disjoint, true, 'Adjacent touch targets do not overlap')
    assert.equal(density.contained, true, 'Reaction targets stay inside their message')
    assert.equal(density.overflow, false)
    await page.screenshot(`${directory}/${width}-conversation.png`)
    if (width < 1000) {
      // Simulated VisualViewport changes cover keyboard layout geometry, not native iOS keyboard behavior.
      for (const [fraction, offset] of [[.55, 0], [.45, 60], [1, 0]]) {
        const available = Math.round(height * fraction)
        await page.eval(`(() => { Object.defineProperty(visualViewport, 'height', {configurable:true, get:()=>${available}}); Object.defineProperty(visualViewport, 'offsetTop', {configurable:true, get:()=>${offset}}); visualViewport.dispatchEvent(new Event('resize')); return true })()`)
        await page.settle()
        const geometry = await page.eval(`(() => { const d=document.querySelector('.chat-dialog').getBoundingClientRect(), h=document.querySelector('.chat-heading').getBoundingClientRect(), f=document.querySelector('.chat-form').getBoundingClientRect(); return [d.y,d.height,h.height,f.bottom,scrollY] })()`)
        assert.equal(geometry[0], offset)
        assert.equal(geometry[1], available)
        assert.ok(geometry[2] >= 44, 'Header controls must not shrink')
        assert.ok(Math.abs(geometry[3] - offset - available) <= 1, 'Composer stays at the available viewport bottom')
        assert.equal(geometry[4], 0, 'The game does not scroll under the keyboard')
        await page.screenshot(`${directory}/${width}-viewport-${fraction}.png`)
      }
      await page.eval("(delete visualViewport.height, delete visualViewport.offsetTop, visualViewport.dispatchEvent(new Event('resize')), true)")
    }
    for (const season of ['spooky', 'none']) {
      await page.eval(season === 'none' ? '(delete document.documentElement.dataset.season, true)' : '(document.documentElement.dataset.season = "spooky", true)')
      await page.tap('.reaction-trigger')
      await page.waitFor('!document.querySelector(".reaction-picker").hidden')
      // Safari may resize/scroll between pointer-down and click; the target must survive.
      await page.eval('(document.dispatchEvent(new Event("scroll")), window.dispatchEvent(new Event("resize")), document.activeElement.blur(), true)')
      assert.equal(await page.eval('document.querySelector(".reaction-picker").hidden'), false)
      await page.eval("(document.addEventListener('pointerdown', () => { document.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')) }, {once:true, capture:true}), true)")
      await page.tap('.reaction-picker button:nth-child(2)')
      await page.waitFor('document.querySelector(".active-reactions")?.textContent.includes("😂 1")')
      const historyReply = new Promise((resolve) => host.once('chat:history', resolve))
      const snapshot = await emit(host, 'room:resume', room.session)
      assert.equal(snapshot.code, room.session.roomCode)
      const history = await historyReply
      assert.ok(history[0].reactions['😂'].includes(joined.session.playerId), 'Touch reaches the server and synchronizes')
      await page.tap('.active-reactions')
      await page.waitFor('!document.querySelector(".reaction-picker").hidden')
      assert.equal(await page.eval('(() => { const r=document.querySelector(".reaction-picker:not([hidden])").getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })()'), true, 'Picker stays inside viewport edges')
      await page.screenshot(`${directory}/${width}-${season}-picker.png`)
      await page.tap('.reaction-picker button:nth-child(2)')
      await page.waitFor('document.querySelector(".active-reactions") === null')
    }
    // New arrivals must not move someone reading older messages.
    for (let index = 0; index < 20; index++) await emit(host, 'chat:send', { text: `Missatge ${index}` })
    await page.waitFor('document.querySelectorAll(".chat-messages article").length === 26')
    await page.eval('(document.querySelector(".chat-messages").scrollTop = 0, true)')
    await page.settle()
    await emit(host, 'chat:send', { text: 'Sense moure el fil' })
    await page.waitFor('document.querySelectorAll(".chat-messages article").length === 27 && document.querySelector(".chat-jump") !== null')
    assert.equal(await page.eval('document.querySelector(".chat-messages").scrollTop'), 0)
    await page.tap('.chat-jump')
    await page.waitFor('document.querySelector(".chat-jump") === null')
    // Draft survives closing and responsive reparenting; the transcript/composer is never duplicated.
    await page.eval(`(() => { const input = document.querySelector('.chat-form input'); input.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Bona partida'); input.dispatchEvent(new Event('input', {bubbles:true})); return true })()`)
    if (width < 1000) {
      await page.tap('.chat-close')
      await page.waitFor('!document.querySelector(".chat-dialog").open')
      assert.equal(await page.eval('document.querySelector(".chat-launcher > button").matches(":focus-visible")'), false, 'Touch close leaves no persistent keyboard focus ring')
      await page.eval('(document.querySelector(".chat-launcher > button").focus(), true)')
      await page.key(KEY.Enter)
      await page.waitFor('document.querySelector(".chat-dialog").matches(":modal")')
      await page.key(KEY.Escape)
      await page.waitFor('!document.querySelector(".chat-dialog").open')
      assert.equal(await page.eval('document.activeElement.matches(".chat-launcher > button") && document.activeElement.matches(":focus-visible")'), true, 'Keyboard close restores a visible focus indicator')
      await page.tap('.chat-launcher > button')
    }
    await page.viewport(width < 1000 ? 1100 : 390, height)
    await page.settle()
    assert.equal(await page.eval('document.querySelectorAll(".chat-form input").length'), 1)
    assert.equal(await page.eval('document.querySelector(".chat-form input").value'), 'Bona partida')
    await page.viewport(width, height)
    if (width < 1000) {
      await page.waitFor('document.querySelector(".chat-launcher > button").getAttribute("aria-haspopup") === "dialog"')
      if (!await page.eval('document.querySelector(".chat-dialog").matches(":modal")')) await page.tap('.chat-launcher > button')
      await page.key(KEY.Escape)
      await page.waitFor('!document.querySelector(".chat-dialog").open')
    }
    // Reload catches up silently and retains unread state while the phone chat stays closed.
    await emit(host, 'chat:send', { text: 'Torna quan vulguis' })
    await page.waitFor('document.querySelectorAll(".chat-messages article").length === 28')
    await page.goto(`${origin}/multijugador/`)
    await page.waitFor('document.querySelectorAll(".chat-messages article").length === 28')
    assert.equal(await page.eval('document.querySelector(".chat-preview") !== null'), false, 'Restored history never creates a preview')
    if (width < 1000) assert.equal(await page.eval('document.querySelector(".chat-launcher .chat-badge")?.textContent'), '1')
    await page.goto('about:blank')
    await emit(host, 'chat:send', { text: 'Mentre eres fora' })
    await page.goto(`${origin}/multijugador/`)
    await page.waitFor('document.querySelectorAll(".chat-messages article").length === 29')
    assert.equal(await page.eval('document.querySelector(".chat-preview") !== null'), false)
    if (width < 1000) assert.equal(await page.eval('document.querySelector(".chat-launcher .chat-badge")?.textContent'), '2', 'Disconnected catch-up remains unread without replaying an alert')
    if (width === 390) {
      await page.tap('.chat-launcher > button')
      await page.eval(`(() => { const Native=window.AudioContext; window.chatAudioNotes=0; if (!Native) return true; window.AudioContext=class extends Native { createOscillator(){const n=super.createOscillator(); const start=n.start.bind(n); n.start=(...args)=>{window.chatAudioNotes++; return start(...args)}; return n} }; return true })()`)
      await page.tap('.chat-sound')
      await page.waitFor('window.chatAudioNotes === 2 || document.querySelector(".chat-error[role=alert]") !== null')
      const audioReady = await page.eval('window.chatAudioNotes === 2')
      await page.tap('.chat-close')
      for (const text of ['So', 'Un altre', 'I un altre']) await emit(host, 'chat:send', {text})
      await page.waitFor('document.querySelectorAll(".chat-messages article").length === 32')
      if (audioReady) {
        await page.waitFor('window.chatAudioNotes === 4')
        assert.equal(await page.eval('window.chatAudioNotes'), 4, 'A rapid burst produces only one two-note cue')
      }
      await page.tap('.chat-launcher > button')
      await page.tap('.chat-sound')
      const notesBefore = await page.eval('window.chatAudioNotes')
      await page.tap('.chat-close')
      await emit(host, 'chat:send', {text:'Sense so'})
      await page.waitFor('document.querySelectorAll(".chat-messages article").length === 33')
      assert.equal(await page.eval('window.chatAudioNotes'), notesBefore, 'Muted chat does not play')
      console.log(`  audio: ${audioReady ? 'confirmation and eligible-message cue verified' : 'unavailable engine reported visibly'}, burst cooldown and mute verified`)
    }
    await page.close()
    for (const socket of [host, seat]) socket.disconnect()
    console.log(`${engine} ${width}×${height}: density, touch add/remove, synchronization, themes, draft, responsive sheet and silent restore passed`)
  }
} finally { for (const socket of sockets) socket.disconnect(); await driver.close() }
