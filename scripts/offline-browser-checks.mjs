// Offline support on the production build, in a real browser (Firefox WebDriver BiDi). It runs the production server on
// a copy of dist/ so it can stop it (no network at all) and stage new builds:
//   A. first install: readiness only once the controlling worker's cache is complete;
//   B. offline: launch, reload and new tabs on /passa-el-mobil/, a whole match, an interrupted match resumed, other pages;
//   C. updates: a broken update leaves the installed version working offline; a good one waits while a page is open,
//      takes over once every page has closed, removes the old cache and keeps the saved match;
//   D. recovery: the kill switch removes the caches and the registration, keeps the saved match, and a normal build
//      installs again;
//   with no Socket.IO request on the local route and no console errors.
// Needs `npm run build` and `firefox --headless --no-remote --profile DIR --remote-debugging-port 9222`. Run: npm run test:offline
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openBidiSession } from './bidi-session.mjs'
import { serviceWorkerSource } from './build-service-worker.mjs'
import { AUDIT } from './local-match-browser-checks.mjs'

const port = Number(process.env.OFFLINE_TEST_PORT || 3011)
const origin = `http://127.0.0.1:${port}`
const work = mkdtempSync(join(tmpdir(), 'penjat-offline-'))
const dist = join(work, 'dist')
cpSync('dist', dist, { recursive: true })
const versionOf = (source) => source.match(/^const VERSION = "(\w+)"/)[1]
const precacheSize = (source) => JSON.parse(source.match(/^const PRECACHE = (.*)$/m)[1]).length
const versionA = versionOf(readFileSync(join(dist, 'sw.js'), 'utf8'))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let server = null
async function start() {
  server = spawn(process.execPath, [resolve('dist-server/server/server.js')], { cwd: work, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' }, stdio: 'ignore' })
  for (let attempt = 0; attempt < 100; attempt++) { if (await fetch(`${origin}/health`).then((response) => response.ok, () => false)) return; await pause(100) }
  throw new Error('production server did not start')
}
async function stop() {
  if (!server) return
  const exited = new Promise((resolve) => server.once('exit', resolve))
  server.kill(); await exited; server = null
  assert.equal(await fetch(`${origin}/health`).then(() => true, () => false), false, 'the network is gone')
}

const session = await openBidiSession(origin)
const { command, evaluate, waitFor, navigate, newTab } = session
const allowedErrors = []
try {
  await start()
  const profile = (await command('browser.createUserContext')).userContext
  await command('script.addPreloadScript', { functionDeclaration: AUDIT, userContexts: [profile] })
  let tab = await newTab(profile)
  const js = JSON.stringify
  const click = (selector) => evaluate(tab, `(() => { document.querySelector(${js(selector)}).click(); return true })()`)
  const setValue = (selector, value) => evaluate(tab, `(() => { const element = document.querySelector(${js(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${js(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const unlock = async () => { await waitFor(tab, "document.querySelector('.handoff-action') !== null"); await click('.handoff-action') }
  const guessWord = async (letters) => { for (const letter of letters) await click(`.keyboard button[aria-label="${letter}"]`) }
  const caches = async () => JSON.parse(await evaluate(tab, '(async () => { const keys = (await caches.keys()).filter((key) => key.startsWith("penjat-")); return JSON.stringify(await Promise.all(keys.map(async (key) => [key, (await (await caches.open(key)).keys()).length]))) })()'))
  const controllerStatus = async () => JSON.parse(await evaluate(tab, `new Promise((resolve) => {
    const worker = navigator.serviceWorker.controller
    if (!worker) return resolve('null')
    const channel = new MessageChannel()
    channel.port1.onmessage = ({ data }) => resolve(JSON.stringify(data))
    worker.postMessage({ type: 'status' }, [channel.port2])
    setTimeout(() => resolve('null'), 5000)
  })`))
  const registration = async () => JSON.parse(await evaluate(tab, '(async () => { const r = await navigator.serviceWorker.getRegistration(); return JSON.stringify({ installing: !!r?.installing, waiting: !!r?.waiting, active: !!r?.active }) })()'))
  const ready = () => waitFor(tab, "document.querySelector('.offline-status.is-ready') !== null", 30000)
  // The saved match without its turn time (closing a page adds the last milliseconds played, as it should).
  const savedMatch = async () => { const match = JSON.parse(await evaluate(tab, "localStorage.getItem('penjat-local-match')")); return JSON.stringify({ ...match, guessers: match.guessers.map(({ activeMs: _, ...guesser }) => guesser) }) }

  // A. First install: preparing until the worker controls the page with a complete cache.
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.offline-status') !== null")
  await ready()
  assert.deepEqual(await controllerStatus(), { version: versionA, complete: true })
  assert.deepEqual(await caches(), [[`penjat-${versionA}`, precacheSize(readFileSync(join(dist, 'sw.js'), 'utf8'))]])
  assert.equal(await evaluate(tab, "document.querySelector('.offline-status').textContent.includes('Llest per jugar sense connexió')"), true)
  console.log(`Offline A passed: first install ready with ${(await caches())[0][1]} files in penjat-${versionA}.`)

  // B. No network at all: launch, reload and a new tab work; a whole match; an interrupted match resumes.
  await stop()
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-setup') !== null")
  await ready()
  await setValue('.local-players li:nth-child(1) input', 'Anna')
  await setValue('.local-players li:nth-child(2) input', 'Bernat')
  await click('.target-selector button:first-child')
  await click('.local-setup .primary-action')
  for (const [turn, word, letters] of [[1, 'gat', 'GAT'], [2, 'gos', 'GOS']]) {
    await unlock()
    await setValue('#local-secret-word', word)
    await click('.local-word-form .primary-action')
    await unlock()
    await guessWord(letters.slice(0, 1))
    if (turn === 1) {
      // Reload in the middle of a turn, offline: the resume card, then the same board.
      await navigate(tab, '/passa-el-mobil/')
      await click('.local-resume .primary-action')
      await unlock()
    }
    await guessWord(letters.slice(1))
    await click('.turn-complete .handoff-action')
    await unlock()
    if (turn === 1) await click('.local-next')
  }
  await waitFor(tab, "document.querySelector('.local-match-over') !== null")
  await click('.local-match-over .secondary-action')
  // An interrupted match for the update checks below.
  await setValue('.local-players li:nth-child(1) input', 'Carla')
  await setValue('.local-players li:nth-child(2) input', 'Dídac')
  await click('.local-setup .primary-action')
  await unlock()
  await setValue('#local-secret-word', 'mar')
  await click('.local-word-form .primary-action')
  await unlock()
  await guessWord('M')
  const interrupted = await savedMatch()
  assert.equal(await evaluate(tab, 'window.__socketAudit.attempts'), 0, 'no Socket.IO request on the local route')
  const second = tab
  tab = await newTab(profile)
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-resume') !== null")
  for (const [path, selector] of [['/', '.home-shell'], ['/paraula-del-dia/', '.daily-game'], ['/aprendre/', '.unit-card'], ['/com-es-juga/', '.howto-page']]) {
    await navigate(tab, path)
    await waitFor(tab, `document.querySelector(${js(selector)}) !== null`)
  }
  await command('browsingContext.close', { context: second })
  console.log('Offline B passed: offline launch, reloads and new tabs, a complete match, a resumed interrupted match, other pages, no Socket.IO.')

  // C1. A broken update (a file missing on the server) fails to install; the installed version keeps working offline.
  const original = readFileSync(join(dist, 'icons.svg'), 'utf8')
  writeFileSync(join(dist, 'icons.svg'), `${original}\n<!-- update -->`)
  const sourceB = serviceWorkerSource(dist)
  writeFileSync(join(dist, 'sw.js'), sourceB)
  const versionB = versionOf(sourceB)
  assert.notEqual(versionB, versionA)
  const illustration = readFileSync(join(dist, 'learning/words/gat.svg'))
  rmSync(join(dist, 'learning/words/gat.svg'))
  await start()
  await navigate(tab, '/passa-el-mobil/')
  await evaluate(tab, '(async () => { await (await navigator.serviceWorker.getRegistration()).update().catch(() => {}); return true })()')
  await waitFor(tab, '(async () => { const r = await navigator.serviceWorker.getRegistration(); return !r.installing && !r.waiting })()', 30000)
  allowedErrors.push(...session.errors.splice(0))
  assert.deepEqual(await registration(), { installing: false, waiting: false, active: true })
  assert.deepEqual((await caches()).map(([name]) => name), [`penjat-${versionA}`], 'the failed update left no cache behind')
  assert.deepEqual(await controllerStatus(), { version: versionA, complete: true })
  await stop()
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-resume') !== null")
  await ready()
  assert.equal(await savedMatch(), interrupted)
  console.log('Offline C1 passed: a failed update keeps the installed version, its cache and offline launches.')

  // C2. A good update installs completely but waits while a page is open; reloading this page does not force it.
  writeFileSync(join(dist, 'learning/words/gat.svg'), illustration)
  await start()
  await navigate(tab, '/passa-el-mobil/')
  await evaluate(tab, '(async () => { await (await navigator.serviceWorker.getRegistration()).update(); return true })()')
  await waitFor(tab, '(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)()', 30000)
  assert.deepEqual((await caches()).map(([name]) => name).sort(), [`penjat-${versionA}`, `penjat-${versionB}`].sort())
  assert.deepEqual(await controllerStatus(), { version: versionA, complete: true }, 'the open page stays on the installed version')
  await click('.local-resume .primary-action')
  await unlock()
  await guessWord('A')
  const continued = await savedMatch()
  assert.notEqual(continued, interrupted, 'play continues while the update waits')

  // C3. Every Penjat page closes (the Home Screen app swiped away): the update takes over, old cache gone, match kept.
  await command('browsingContext.close', { context: tab })
  await pause(500)
  tab = await newTab(profile)
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-resume') !== null")
  for (let attempt = 0; attempt < 50 && (await controllerStatus())?.version !== versionB; attempt++) { await pause(200); await navigate(tab, '/passa-el-mobil/') }
  assert.deepEqual(await controllerStatus(), { version: versionB, complete: true })
  assert.deepEqual((await caches()).map(([name]) => name), [`penjat-${versionB}`], 'the previous cache is removed once unused')
  assert.equal(await savedMatch(), continued, 'the saved match survives the update')
  await ready()
  await stop()
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-resume') !== null")
  assert.equal(await evaluate(tab, "fetch('/icons.svg').then((response) => response.text())"), `${original}\n<!-- update -->`, 'offline files come from the new version')
  console.log('Offline C passed: the update waits while a page is open, then takes over, cleans up and keeps the saved match.')

  // D. Recovery: the kill switch (PENJAT_SW_KILL_SWITCH=1) replaces the installed worker even with a page open, removes
  // Penjat's caches and unregisters, without a reload loop; the saved match stays; a normal build installs again later.
  const killSwitch = readFileSync('scripts/sw-kill-switch.js', 'utf8')
  writeFileSync(join(dist, 'sw.js'), killSwitch)
  await start()
  await command('script.addPreloadScript', { functionDeclaration: "() => { sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') || 0) + 1)) }", userContexts: [profile] })
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, '(async () => (await caches.keys()).every((key) => !key.startsWith("penjat-")))()', 30000)
  await waitFor(tab, '(async () => !(await navigator.serviceWorker.getRegistration()) && !navigator.serviceWorker.controller)()', 30000)
  const loads = Number(await evaluate(tab, "sessionStorage.getItem('loads')"))
  await pause(3000)
  assert.equal(Number(await evaluate(tab, "sessionStorage.getItem('loads')")), loads, 'no reload loop')
  assert.ok(loads <= 2, `at most one recovery reload (${loads} loads)`)
  assert.equal(await evaluate(tab, '(async () => !(await navigator.serviceWorker.getRegistration()))()'), true, 'unregistered and staying so')
  assert.deepEqual(await caches(), [])
  assert.equal(await savedMatch(), continued, 'the saved match survives the recovery')
  await navigate(tab, '/passa-el-mobil/')
  await waitFor(tab, "document.querySelector('.local-resume') !== null")
  assert.equal(await evaluate(tab, '!navigator.serviceWorker.controller'), true, 'pages load from the network, without a worker')
  // Restoring the normal build installs offline support again.
  writeFileSync(join(dist, 'sw.js'), serviceWorkerSource(dist))
  await navigate(tab, '/passa-el-mobil/')
  await ready()
  assert.equal(await savedMatch(), continued)
  console.log(`Offline D passed: the kill switch removed the caches and the registration (${loads} load(s), no loop), kept the saved match, and a normal build reinstalled.`)

  assert.deepEqual(session.errors, [], 'No browser console errors should occur')
  if (allowedErrors.length) console.log(`(Expected during the broken update: ${allowedErrors.length} console error(s).)`)
  console.log('Offline browser checks passed.')
} finally {
  await stop().catch(() => {})
  await session.close()
  rmSync(work, { recursive: true, force: true })
}
