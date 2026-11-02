// Offline support without a browser: the precache list built from a dist/ folder, the generated service worker run in a
// sandbox with fake caches and network (install, verification, failure, activation, routing, readiness, repair), and the
// page's readiness rules. When a production build exists, its real precache is checked too (run `npm run build` first).
// Real installs, offline launches and updates: scripts/offline-browser-checks.mjs (`npm run test:offline`).
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { precacheManifest, serviceWorkerSource } from '../scripts/build-service-worker.mjs'
import { checkOfflineReadiness } from '../src/pwa/offline'
import { allLearningUnits, emblemUrl, illustrationUrl } from '../src/learning/units'

const ORIGIN = 'https://penjat.test'
const fixture = mkdtempSync(join(tmpdir(), 'penjat-pwa-'))
const write = (path: string, content: string) => { mkdirSync(dirname(join(fixture, path)), { recursive: true }); writeFileSync(join(fixture, path), content) }
const html = '<!doctype html><link rel="icon" href="/favicon.svg"><link rel="manifest" href="/site.webmanifest"><link rel="stylesheet" href="/assets/index-b.css"><script type="module" src="/assets/index-a.js"></script>'
write('index.html', html)
write('assets/index-a.js', 'console.log(1)')
write('assets/index-b.css', 'body{}')
write('assets/font-c.woff2', 'font')
write('favicon.svg', '<svg/>')
write('icon-192.png', 'png')
write('site.webmanifest', JSON.stringify({ icons: [{ src: '/icon-192.png' }] }))
write('learning/words/gat.svg', '<svg>gat</svg>')
for (const excluded of ['robots.txt', 'sitemap.xml', 'licenses/OFL.txt', 'sw.js', 'assets/index-a.js.map']) write(excluded, 'x')

try {
  // A. The precache list: the shell, every served file with a content hash, nothing a crawler or licence needs.
  const manifest = precacheManifest(fixture)
  assert.deepEqual(manifest.map((entry) => entry.url), ['/', '/assets/font-c.woff2', '/assets/index-a.js', '/assets/index-b.css', '/favicon.svg', '/icon-192.png', '/learning/words/gat.svg', '/site.webmanifest'])
  assert.deepEqual(manifest[0].assets, ['/assets/index-b.css', '/assets/index-a.js'])
  assert.ok(manifest.every((entry) => /^[0-9a-f]{32}$/.test(entry.revision)))
  const source = serviceWorkerSource(fixture)
  const version = (code: string) => code.match(/^const VERSION = "(\w+)"/)![1]
  write('learning/words/gat.svg', '<svg>gat 2</svg>')
  assert.notEqual(precacheManifest(fixture).find((entry) => entry.url === '/learning/words/gat.svg')!.revision, manifest.find((entry) => entry.url === '/learning/words/gat.svg')!.revision, 'an unhashed file name still gets a new revision')
  assert.notEqual(version(serviceWorkerSource(fixture)), version(source), 'any content change is a new version')
  write('learning/words/gat.svg', '<svg>gat</svg>')
  assert.equal(version(serviceWorkerSource(fixture)), version(source), 'the version depends only on content')
  assert.notEqual(version(serviceWorkerSource(fixture, '// changed worker')), version(source), 'a worker change is a new version')
  rmSync(join(fixture, 'assets/index-b.css'))
  assert.throws(() => precacheManifest(fixture), /missing files the app references: \/assets\/index-b.css/)
  write('assets/index-b.css', 'body{}')

  // B. The worker, in a sandbox: fake caches and network, real Request/Response/crypto.
  const files = new Map<string, { body: string; status?: number }>()
  for (const entry of manifest) files.set(entry.url, { body: entry.url === '/' ? html.replace('<link', '<title>Penjat</title><link') : readFileSync(join(fixture, entry.url.slice(1)), 'utf8') })
  files.set('/passa-el-mobil/', { body: '<html>fresh</html>' })
  let online = true
  let hanging = false
  const requests: string[] = []
  const network = async (input: string | { url: string }) => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN)
    requests.push(url.pathname)
    if (!online) throw new TypeError('offline')
    if (hanging) return new Promise<Response>(() => {})
    const file = files.get(url.pathname)
    return new Response(file?.body ?? 'missing', { status: file ? file.status ?? 200 : 404 })
  }
  const stores = new Map<string, Map<string, Response>>()
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return { put: async (url: string, response: Response) => { store.set(url, response) }, match: async (url: string) => store.get(url)?.clone() }
    },
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
    match: async (url: string, options: { cacheName: string }) => stores.get(options.cacheName)?.get(url)?.clone(),
  }
  const worker = (code: string) => {
    const listeners = new Map<string, (event: unknown) => void>()
    let claimed = 0
    const sandbox = createContext({
      self: { addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener), location: new URL(ORIGIN), clients: { claim: async () => { claimed++ } } },
      caches, fetch: network, crypto: globalThis.crypto, navigator: { get onLine() { return online } }, Response, URL, TextEncoder,
      setTimeout: (callback: () => void) => setTimeout(callback, 0), clearTimeout,
    })
    runInContext(code, sandbox)
    const run = async (type: string, event: Record<string, unknown> = {}) => {
      let waited: Promise<unknown> | undefined
      let responded: Promise<Response> | undefined
      listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => { waited = promise }, respondWith: (promise: Promise<Response>) => { responded = promise } })
      return { waited, responded }
    }
    const status = async () => {
      let reply: unknown
      const { waited } = await run('message', { data: { type: 'status' }, ports: [{ postMessage: (data: unknown) => { reply = data } }] })
      await waited
      return JSON.parse(JSON.stringify(reply)) as { version: string; complete: boolean }
    }
    const request = (path: string, init: { method?: string; mode?: string; origin?: string } = {}) => ({ url: new URL(path, init.origin ?? ORIGIN).href, method: init.method ?? 'GET', mode: init.mode ?? 'cors' })
    const fetchEvent = async (path: string, init?: Parameters<typeof request>[1]) => (await run('fetch', { request: request(path, init) })).responded
    return { run, status, fetchEvent, claims: () => claimed }
  }
  const cacheName = `penjat-${version(source)}`

  // A complete install: every file stored, and the readiness reply says so.
  const first = worker(source)
  await (await first.run('install')).waited
  assert.deepEqual([...stores.keys()], [cacheName])
  assert.deepEqual([...stores.get(cacheName)!.keys()].sort(), manifest.map((entry) => entry.url).sort())
  assert.deepEqual(await first.status(), { version: version(source), complete: true })
  await (await first.run('activate')).waited
  assert.equal(first.claims(), 1)

  // Routing: only same-origin GET page loads and precached files; never Socket.IO, the API, health or other origins.
  for (const [path, init] of [['/socket.io/?EIO=4', {}], ['/api/rooms/ABCDE/preview', {}], ['/health', { mode: 'navigate' }], ['/assets/index-a.js', { method: 'POST' }],
    ['/assets/index-a.js', { origin: 'https://cdn.example' }], ['/not-precached.txt', {}], ['/sw.js', { mode: 'navigate' }], ['/socket.io/', { mode: 'navigate' }]] as const) {
    assert.equal(await first.fetchEvent(path, init), undefined, `${path} is not intercepted`)
  }
  requests.length = 0
  assert.equal(await (await first.fetchEvent('/assets/index-a.js'))!.text(), 'console.log(1)')
  assert.deepEqual(requests, [], 'precached files come from the cache')
  assert.equal(await (await first.fetchEvent('/passa-el-mobil/', { mode: 'navigate' }))!.text(), '<html>fresh</html>', 'online page loads come from the network (route metadata)')
  online = false
  assert.match(await (await first.fetchEvent('/passa-el-mobil/', { mode: 'navigate' }))!.text(), /<title>Penjat<\/title>/, 'offline page loads get the shell')
  assert.equal(await (await first.fetchEvent('/learning/words/gat.svg'))!.text(), '<svg>gat</svg>')
  online = true; hanging = true
  assert.match(await (await first.fetchEvent('/aprendre/', { mode: 'navigate' }))!.text(), /<title>Penjat<\/title>/, 'a stalled network falls back to the shell')
  hanging = false

  // Readiness repairs an evicted file when online, and reports it missing when offline.
  stores.get(cacheName)!.delete('/favicon.svg')
  online = false
  assert.deepEqual(await first.status(), { version: version(source), complete: false })
  online = true
  assert.deepEqual(await first.status(), { version: version(source), complete: true })

  // A failed update (a missing file, a file from another build, a shell of another build) leaves the active cache alone.
  const update = serviceWorkerSource(fixture, readFileSync('src/pwa/service-worker.js', 'utf8') + '\n// update')
  const updateCache = `penjat-${version(update)}`
  for (const [label, break_, restore] of [
    ['missing file', () => files.delete('/icon-192.png'), () => files.set('/icon-192.png', { body: 'png' })],
    ['changed content', () => files.set('/icon-192.png', { body: 'other png' }), () => files.set('/icon-192.png', { body: 'png' })],
    ['server error', () => files.set('/icon-192.png', { body: 'png', status: 503 }), () => files.set('/icon-192.png', { body: 'png' })],
    ['shell of another build', () => files.set('/', { body: html.replace('index-a.js', 'index-z.js') }), () => files.set('/', { body: html })],
  ] as const) {
    break_()
    await assert.rejects((await worker(update).run('install')).waited!, /missing or from another build/, label)
    assert.deepEqual([...stores.keys()], [cacheName], `${label}: no partial cache, the previous one intact`)
    restore()
  }
  online = false
  await assert.rejects((await worker(update).run('install')).waited!, TypeError)
  assert.deepEqual([...stores.keys()], [cacheName], 'an install without network leaves the previous cache')
  online = true

  // A successful update: both caches until activation, then only the new one (and unrelated caches stay).
  stores.set('other-cache', new Map())
  const next = worker(update)
  await (await next.run('install')).waited
  assert.deepEqual([...stores.keys()].sort(), [cacheName, 'other-cache', updateCache].sort())
  assert.deepEqual(await first.status(), { version: version(source), complete: true }, 'the waiting update does not disturb the active version')
  await (await next.run('activate')).waited
  assert.deepEqual([...stores.keys()].sort(), ['other-cache', updateCache].sort())
  assert.deepEqual(await next.status(), { version: version(update), complete: true })
} finally {
  rmSync(fixture, { recursive: true, force: true })
}

// C. Page readiness: only a controlling worker with a complete cache is ready.
{
  const controller = (complete: boolean | null) => ({ postMessage: (_: unknown, [port]: MessagePort[]) => { if (complete !== null) port.postMessage({ version: 'v', complete }) } }) as unknown as ServiceWorker
  const registration = (workers: Partial<Record<'installing' | 'waiting' | 'active', object>>) => ({ installing: null, waiting: null, active: null, ...workers }) as unknown as ServiceWorkerRegistration
  assert.equal(await checkOfflineReadiness(null, null, true), 'failed', 'registration failed')
  assert.equal(await checkOfflineReadiness(registration({ active: {} }), controller(true), false), 'ready')
  assert.equal(await checkOfflineReadiness(registration({ active: {}, waiting: {} }), controller(true), true), 'ready', 'a waiting update keeps the active version ready')
  assert.equal(await checkOfflineReadiness(registration({ active: {} }), controller(false), false), 'needs-connection')
  assert.equal(await checkOfflineReadiness(registration({ installing: {} }), null, true), 'preparing', 'first install in progress')
  assert.equal(await checkOfflineReadiness(registration({ active: {} }), null, true), 'preparing', 'an active worker that does not control this page is not ready yet')
  assert.equal(await checkOfflineReadiness(registration({ installing: {} }), null, false), 'needs-connection')
  assert.equal(await checkOfflineReadiness(registration({}), null, true), 'failed', 'the install failed')
}

// D. The real production build, when present: every critical file is precached and sw.js matches the build.
if (existsSync('dist/index.html')) {
  const urls = new Set(precacheManifest('dist').map((entry) => entry.url))
  const built = readFileSync('dist/index.html', 'utf8')
  for (const [, url] of built.matchAll(/(?:src|href)="(\/[^"]+)"/g)) assert.ok(urls.has(url), url)
  for (const url of ['/', '/site.webmanifest', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/favicon.ico', '/favicon.svg']) assert.ok(urls.has(url), url)
  assert.equal([...urls].filter((url) => url.endsWith('.woff2')).length, 2, 'both fonts')
  assert.equal([...urls].filter((url) => /^\/assets\/index-[\w-]+\.js$/.test(url)).length, 1, 'the app bundle')
  // Learning illustrations and unit emblems, so vocabulary also works offline.
  const images = allLearningUnits.flatMap((unit) => [emblemUrl(unit), ...unit.words.map(illustrationUrl)]).filter((url): url is string => url !== null)
  assert.ok(images.length > 70)
  for (const url of images) assert.ok(urls.has(url), url)
  assert.ok(!urls.has('/sw.js') && !urls.has('/robots.txt') && !urls.has('/sitemap.xml'))
  if (existsSync('dist/sw.js')) assert.equal(readFileSync('dist/sw.js', 'utf8'), serviceWorkerSource('dist'), 'dist/sw.js is current (rebuild if this fails)')
  console.log(`production precache: ${urls.size} files`)
}

console.log('PWA checks passed: precache list and revisions, install verification and failures, activation cleanup, routing, offline shell, readiness and repair')
