// One tiny page API over three real engines, with no npm dependency (Node's built-in WebSocket/fetch). Used by
// test:browser:multiplayer.
//   firefox  — WebDriver BiDi:   firefox --headless --no-remote --profile DIR --remote-debugging-port 9222
//   chromium — Chrome DevTools:  chrome --headless=new --user-data-dir=DIR --remote-debugging-port=9223 '--remote-allow-origins=*'
//              (any Chromium build; e.g. the one `npx playwright install chromium` downloads — Playwright itself is not used)
//   webkit   — classic WebDriver: xvfb-run -a WebKitWebDriver --port=4445   (system WebKitGTK MiniBrowser)
// Endpoints: FIREFOX_BIDI, CHROMIUM_CDP, WEBKIT_WEBDRIVER, WEBKIT_MINIBROWSER. These are desktop engines with a resized
// viewport: phone widths are simulated layouts, not iOS Safari or Android Chrome.
import { writeFileSync } from 'node:fs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const KEY = { Tab: '', Enter: '', Shift: '', Escape: '', Space: ' ', Backspace: '' }
// Every evaluation returns JSON so the three protocols agree on value types.
const wrap = (expression) => `(async () => JSON.stringify(await (async () => (${expression}))() ?? null))()`

function socketRpc(url, onEvent = () => {}) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let id = 0
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.id === undefined || !pending.has(message.id)) return onEvent(message)
    const { resolve, reject, timer } = pending.get(message.id)
    pending.delete(message.id); clearTimeout(timer)
    if (message.error) reject(new Error(typeof message.error === 'string' ? `${message.error}: ${message.message}` : JSON.stringify(message.error)))
    else resolve(message.result)
  }
  const ready = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error(`Cannot connect to ${url}`)) })
  const send = (payload, timeout = 15000) => new Promise((resolve, reject) => {
    const requestId = ++id
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${payload.method}`)) }, timeout)
    pending.set(requestId, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: requestId, ...payload }))
  })
  return { ready, send, close: () => ws.close() }
}

function common(page) {
  page.waitFor = async (expression, label = expression, timeout = 8000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) { try { if (await page.eval(`!!(${expression})`)) return } catch { /* navigating */ } await sleep(40) }
    throw new Error(`[${page.engine}] timed out waiting for ${label}`)
  }
  page.settle = () => page.eval('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).then(() => true)')
  page.press = async (...keys) => { for (const key of keys) await page.key(key) }
  return page
}

async function firefox() {
  const rpc = socketRpc(`${process.env.FIREFOX_BIDI || 'ws://127.0.0.1:9222'}/session`)
  await rpc.ready
  const command = (method, params = {}) => rpc.send({ method, params })
  const session = await command('session.new', { capabilities: {} })
  const pages = []
  let active = null
  return {
    name: 'firefox', version: `Firefox ${session.capabilities.browserVersion}`,
    async newPage({ width = 1366, height = 768 } = {}) {
      const userContext = (await command('browser.createUserContext')).userContext
      const context = (await command('browsingContext.create', { type: 'tab', userContext })).context
      await command('browsingContext.setViewport', { context, viewport: { width, height } })
      const page = common({
        engine: 'firefox',
        goto: (url) => command('browsingContext.navigate', { context, url, wait: 'complete' }),
        async eval(expression) {
          const result = await command('script.evaluate', { expression: wrap(expression), target: { context }, awaitPromise: true, userActivation: true })
          if (result.type === 'exception') throw new Error(`[firefox] ${expression.slice(0, 90)}: ${result.exceptionDetails.text}`)
          return JSON.parse(result.result.value)
        },
        viewport: (w, h) => command('browsingContext.setViewport', { context, viewport: { width: w, height: h } }),
        async screenshot(file, { full = false } = {}) { writeFileSync(file, Buffer.from((await command('browsingContext.captureScreenshot', { context, origin: full ? 'document' : 'viewport' })).data, 'base64')) },
        // Several participants share one window as tabs: keys only reach the active tab, so activate it first.
        key: async (value, { shift = false } = {}) => { if (active !== context) { await command('browsingContext.activate', { context }); active = context } return command('input.performActions', { context, actions: [{ type: 'key', id: 'kbd', actions: [...(shift ? [{ type: 'keyDown', value: KEY.Shift }] : []), { type: 'keyDown', value }, { type: 'keyUp', value }, ...(shift ? [{ type: 'keyUp', value: KEY.Shift }] : [])] }] }) },
        preload: (source) => command('script.addPreloadScript', { functionDeclaration: `() => { ${source} }`, contexts: [context] }),
        close: async () => { await command('browsingContext.close', { context }).catch(() => {}); await command('browser.removeUserContext', { userContext }).catch(() => {}) },
      })
      pages.push(page)
      return page
    },
    async close() { for (const page of pages) await page.close(); await command('session.end').catch(() => {}); rpc.close() },
  }
}

const cdpKeys = { [KEY.Tab]: ['Tab', 'Tab', 9], [KEY.Enter]: ['Enter', 'Enter', 13, '\r'], [KEY.Escape]: ['Escape', 'Escape', 27], [KEY.Backspace]: ['Backspace', 'Backspace', 8], ' ': [' ', 'Space', 32, ' '] }
async function chromium() {
  const endpoint = process.env.CHROMIUM_CDP || 'http://127.0.0.1:9223'
  const { webSocketDebuggerUrl, Browser } = await (await fetch(`${endpoint}/json/version`)).json()
  const rpc = socketRpc(webSocketDebuggerUrl)
  await rpc.ready
  const command = (method, params = {}, sessionId) => rpc.send({ method, params, ...(sessionId ? { sessionId } : {}) })
  const pages = []
  let front = null
  return {
    name: 'chromium', version: Browser.replace('/', ' '),
    async newPage({ width = 1366, height = 768 } = {}) {
      const { browserContextId } = await command('Target.createBrowserContext', { disposeOnDetach: true })
      const { targetId } = await command('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true })
      const send = (method, params) => command(method, params, sessionId)
      await send('Page.enable'); await send('Runtime.enable')
      // Phone widths: touch emulation and overlay-style (hidden) scrollbars as on Android; desktop Linux Chromium would
      // otherwise reserve a 15px classic scrollbar. Still a simulated phone, not a device.
      const viewport = async (w, h) => {
        const phone = w < 700
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
        await send('Emulation.setScrollbarsHidden', { hidden: phone })
        await send('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
        await send('Emulation.setEmitTouchEventsForMouse', { enabled: phone })
      }
      await viewport(width, height)
      const page = common({
        engine: 'chromium',
        async goto(url) {
          await send('Page.navigate', { url })
          const deadline = Date.now() + 10000
          await sleep(60)
          while (Date.now() < deadline) { const r = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }).catch(() => null); if (r?.result?.value === 'complete') return; await sleep(40) }
          throw new Error(`[chromium] navigation timed out: ${url}`)
        },
        async eval(expression) {
          const result = await send('Runtime.evaluate', { expression: wrap(expression), awaitPromise: true, returnByValue: true, userGesture: true })
          if (result.exceptionDetails) throw new Error(`[chromium] ${expression.slice(0, 90)}: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
          return JSON.parse(result.result.value)
        },
        viewport,
        async screenshot(file, { full = false } = {}) { writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full })).data, 'base64')) },
        async key(value, { shift = false } = {}) {
          if (front !== targetId) { await send('Page.bringToFront'); front = targetId }
          const [key, code, keyCode, text] = cdpKeys[value] ?? [value, /[a-z]/i.test(value) ? `Key${value.toUpperCase()}` : '', value.toUpperCase().charCodeAt(0), value]
          const modifiers = shift ? 8 : 0
          if (shift) await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers })
          await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, text, unmodifiedText: text, modifiers })
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers })
          if (shift) await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 })
        },
        preload: (source) => send('Page.addScriptToEvaluateOnNewDocument', { source }),
        close: async () => { await command('Target.closeTarget', { targetId }).catch(() => {}); await command('Target.disposeBrowserContext', { browserContextId }).catch(() => {}) },
      })
      pages.push(page)
      return page
    },
    async close() { for (const page of pages) await page.close(); rpc.close() },
  }
}

// Classic WebDriver drives one window at a time, so each page switches to its own window before acting. Windows share
// storage (one session), room credentials included, so only one browser player per WebKit session can hold a room.
async function webkit() {
  const base = process.env.WEBKIT_WEBDRIVER || 'http://localhost:4445'
  const request = async (method, path, body) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = await response.json()
    if (json.value?.error) throw new Error(`[webkit] ${path}: ${json.value.error}: ${json.value.message}`)
    return json.value
  }
  const created = await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: process.env.WEBKIT_MINIBROWSER || '/usr/lib/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } })
  const sid = created.sessionId, s = `/session/${sid}`
  let current = await request('GET', `${s}/window`)
  let firstUsed = false
  const pages = []
  return {
    name: 'webkit', version: `WebKitGTK ${created.capabilities.browserVersion}`,
    async newPage({ width = 1366, height = 768 } = {}) {
      let handle = current
      if (firstUsed) handle = (await request('POST', `${s}/window/new`, { type: 'window' })).handle
      firstUsed = true
      // Switching windows resets WebDriver's current browsing context to the top-level document, so a framed page
      // must re-enter its iframe; otherwise evaluation would run in the blank wrapper page.
      const focus = async () => { if (current !== handle) { await request('POST', `${s}/window`, { handle }); current = handle; if (framed) await into() } }
      let lock = Promise.resolve()
      const serial = (fn) => (...args) => (lock = lock.then(async () => { await focus(); return fn(...args) }, async () => { await focus(); return fn(...args) }))
      const evalRaw = async (expression) => JSON.parse(await request('POST', `${s}/execute/async`, { script: `const done = arguments[arguments.length - 1]; ${wrap(expression)}.then(done, (e) => done(JSON.stringify({ __error: String(e && e.stack || e) })))`, args: [] }))
      // MiniBrowser windows cannot shrink below ~420px. Narrower viewports load the app in an exact-size iframe on a
      // same-origin wrapper page: the iframe is a real layout viewport for media/container queries, innerWidth and scrolling.
      let size = [width, height], framed = false
      const top = () => request('POST', `${s}/frame`, { id: null })
      const into = () => request('POST', `${s}/frame`, { id: 0 })
      const frameStyle = () => `border:0;display:block;width:${size[0]}px;height:${size[1]}px`
      // The wrapper is a static file of the app's own origin with its body replaced. A cross-origin (data:) wrapper made
      // WebKit ignore element.focus() inside the frame (the window is never OS-focused under Xvfb), silently breaking the
      // app's focus management and every keyboard check.
      const load = async (url) => {
        if (!framed) return request('POST', `${s}/url`, { url })
        await top()
        const { origin } = new URL(url), iframe = `<iframe style="${frameStyle()}" src="${url}"></iframe>`
        if (origin === 'null') return request('POST', `${s}/url`, { url: `data:text/html,${encodeURIComponent(`<!doctype html><body style="margin:0">${iframe}`)}` }).then(into)
        await request('POST', `${s}/url`, { url: `${origin}/robots.txt` })
        await request('POST', `${s}/execute/sync`, { script: `document.body.style.margin = '0'; document.body.innerHTML = arguments[0]`, args: [iframe] })
        await into()
      }
      const page = common({
        engine: 'webkit',
        // Inside an existing frame, navigate the frame itself, as a real page would; rebuilding the wrapper is only
        // needed for the first load.
        goto: serial(async (url) => {
          if (!framed || !(await evalRaw('location.href !== "about:blank"').catch(() => false))) return load(url)
          await evalRaw(`(location.href = ${JSON.stringify(url)}, true)`).catch(() => {})
          const deadline = Date.now() + 10000
          while (Date.now() < deadline) { await sleep(60); const ready = await evalRaw(`location.href === ${JSON.stringify(new URL(url).href)} && document.readyState === 'complete'`).catch(() => false); if (ready) return }
          throw new Error(`[webkit] frame navigation timed out: ${url}`)
        }),
        eval: serial(async (expression) => { const value = await evalRaw(expression); if (value?.__error) throw new Error(`[webkit] ${expression.slice(0, 90)}: ${value.__error}`); return value }),
        viewport: serial(async (w, h) => {
          size = [w, h]
          const wantFrame = w < 440
          if (wantFrame) {
            await request('POST', `${s}/window/rect`, { width: 480, height: h + 40 })
            if (!framed) { const at = await evalRaw('location.href'); framed = true; await load(at) }
            else { await top(); await request('POST', `${s}/execute/sync`, { script: `document.querySelector('iframe').style.cssText = ${JSON.stringify(frameStyle())}`, args: [] }); await into() }
          } else {
            if (framed) { const at = await evalRaw('location.href'); framed = false; await top(); await request('POST', `${s}/url`, { url: at }) }
            await request('POST', `${s}/window/rect`, { width: w, height: h })
            const [iw, ih] = await evalRaw('[innerWidth, innerHeight]')
            if (iw !== w || ih !== h) await request('POST', `${s}/window/rect`, { width: w + (w - iw), height: h + (h - ih) })
          }
          const actual = await evalRaw('[innerWidth, innerHeight]')
          if (actual[0] !== w) throw new Error(`[webkit] viewport ${w}x${h} unavailable (got ${actual.join('x')})`)
        }),
        screenshot: serial(async (file) => {
          if (!framed) return writeFileSync(file, Buffer.from(await request('GET', `${s}/screenshot`), 'base64'))
          await top()
          const element = Object.values(await request('POST', `${s}/element`, { using: 'css selector', value: 'iframe' }))[0]
          writeFileSync(file, Buffer.from(await request('GET', `${s}/element/${element}/screenshot`), 'base64'))
          await into()
        }),
        key: serial((value, { shift = false } = {}) => request('POST', `${s}/actions`, { actions: [{ type: 'key', id: 'kbd', actions: [...(shift ? [{ type: 'keyDown', value: KEY.Shift }] : []), { type: 'keyDown', value }, { type: 'keyUp', value }, ...(shift ? [{ type: 'keyUp', value: KEY.Shift }] : [])] }] })),
        preload: null,
        // The first window stays open (closing the last one ends the session); afterwards the session must point at a
        // live window again, or the next newPage() fails with "no such window".
        close: serial(async () => {
          if (pages.length < 2 || handle === pages[0].handle) return
          await request('DELETE', `${s}/window`).catch(() => {})
          await request('POST', `${s}/window`, { handle: pages[0].handle }); current = pages[0].handle
        }),
        handle,
        get framed() { return framed },
      })
      await page.viewport(width, height)
      pages.push(page)
      return page
    },
    async close() { await request('DELETE', s).catch(() => {}) },
  }
}

export async function openDriver(engine) {
  const open = { firefox, chromium, webkit }[engine]
  if (!open) throw new Error(`Unknown engine ${engine} (firefox, chromium, webkit)`)
  return open()
}

// Deterministic harness: seeded Math.random and a fixed wall clock, installed before any app script. A tab can override
// both through window.name (`seed=N now=ISO`), which survives navigations.
export const deterministicPreload = (seed = 20261009, iso = '2026-10-09T10:00:00Z') => `
  (() => { let s = (Number((window.name.match(/seed=(\\d+)/) || [])[1]) || ${seed}) >>> 0; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const fixed = Date.parse((window.name.match(/now=(\\S+)/) || [])[1] || '${iso}'), start = performance.now(), RealDate = Date
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed + performance.now() - start])) } static now() { return fixed + performance.now() - start } } })()`
