/* global VERSION, PRECACHE */
// Penjat's service worker, served as /sw.js in production only. scripts/build-service-worker.mjs prepends VERSION and
// PRECACHE (every file of the build with its content hash). It never stores anything at runtime and never touches
// localStorage, so saved matches survive every update.
//
// Install: download and verify the whole build into a new cache; any failure deletes it and the install fails, so the
// previous worker and its complete cache keep serving. No skipWaiting: an update waits until every Penjat page is closed
// (on an iPhone, the Home Screen app swiped away), so a running match never changes code underneath. Activate: the old
// caches go, since no page uses them any more, and the worker takes control (only first installs have pages to claim).
// Fetch: page loads try the network first (fresh HTML with route metadata, assets from the network as well) and fall back
// to this version's shell offline or after a few seconds; precached files come from this version's cache. Everything
// else (Socket.IO, /api/, /health, other origins, non-GET) is never intercepted.

const CACHE = `penjat-${VERSION}`
const NAVIGATION_TIMEOUT_MS = 4000
const files = new Set(PRECACHE.map((entry) => entry.url))
const hex = (buffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

async function verified(entry, response) {
  if (!response.ok || response.redirected) return false
  // The shell must belong to this build: it references exactly this build's hashed assets.
  if (entry.assets) { const html = await response.clone().text(); return entry.assets.every((asset) => html.includes(asset)) }
  return hex(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())).startsWith(entry.revision)
}

async function precache() {
  const cache = await caches.open(CACHE)
  try {
    await Promise.all(PRECACHE.map(async (entry) => {
      const response = await fetch(entry.url, { cache: 'reload', credentials: 'same-origin' })
      if (!(await verified(entry, response))) throw new Error(`Penjat offline cache: ${entry.url} is missing or from another build`)
      await cache.put(entry.url, response)
    }))
  } catch (error) {
    await caches.delete(CACHE)
    throw error
  }
}

async function complete() {
  if (!(await caches.has(CACHE))) return false
  const cache = await caches.open(CACHE)
  return (await Promise.all(PRECACHE.map((entry) => cache.match(entry.url)))).every(Boolean)
}

async function navigate(request) {
  let timer
  try {
    return await Promise.race([fetch(request), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('slow network')), NAVIGATION_TIMEOUT_MS) })])
  } catch {
    return (await caches.match('/', { cacheName: CACHE })) ?? Response.error()
  } finally { clearTimeout(timer) }
}

self.addEventListener('install', (event) => event.waitUntil(precache()))

self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('penjat-') && name !== CACHE) await caches.delete(name)
  await self.clients.claim()
})()))

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || /^\/(socket\.io|api|health)(\/|$)/.test(url.pathname)) return
  if (request.mode === 'navigate') { if (!/\.[^/]+$/.test(url.pathname)) event.respondWith(navigate(request)); return }
  if (files.has(url.pathname)) event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then((cached) => cached ?? fetch(request)))
})

// Offline readiness for the page: this version's cache holds every file. An evicted or damaged cache is downloaded
// again when the network allows; until then the page reports that it is not ready.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'status' || !event.ports[0]) return
  event.waitUntil((async () => {
    let ready = await complete()
    if (!ready && navigator.onLine) ready = await precache().then(() => true, () => false)
    event.ports[0].postMessage({ version: VERSION, complete: ready })
  })())
})
