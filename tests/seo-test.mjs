import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'

const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8')
assert.equal([...sitemap.matchAll(/https:\/\/penjat\.cat\/paraula-del-dia/g)].length, 1)

const port = 3205
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['dist-server/server/server.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverErrors = ''
server.stderr.on('data', (chunk) => { serverErrors += chunk })

try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(([code]) => { throw new Error(`SEO server exited before startup: ${code}`) })])
  const home = await fetchText(`http://127.0.0.1:${port}/`)
  assert.match(home, /<title>Penjat — Joc del penjat online en català<\/title>/)
  assert.match(home, /<link rel="canonical" href="https:\/\/penjat\.cat\/" \/>/)

  assert.equal([...home.matchAll(/<meta name="description"/g)].length, 1)
  assert.ok(home.includes('content="Juga al Penjat online en català. Endevina paraules, juga amb amics i aprèn vocabulari català de manera divertida."'))
  assert.ok(home.includes('<meta property="og:url" content="https://penjat.cat/"'))

  const daily = await fetchText(`http://127.0.0.1:${port}/paraula-del-dia`)
  assert.match(daily, /<title>El penjat del dia: endevina una paraula en català \| Penjat<\/title>/)
  assert.equal([...daily.matchAll(/<meta name="description"/g)].length, 1)
  assert.match(daily, /<meta name="description" content="Juga al penjat del dia en català\. Cada dia hi ha una nova paraula, la mateixa per a tothom\. Endevina-la i comparteix el resultat\." \/>/)
  assert.match(daily, /<link rel="canonical" href="https:\/\/penjat\.cat\/paraula-del-dia" \/>/)
  assert.match(daily, /<meta property="og:title" content="Paraula del dia \| Penjat" \/>/)
  assert.match(daily, /<meta property="og:description" content="Endevina la paraula catalana del dia jugant al Penjat i comparteix el resultat sense revelar-la\." \/>/)
  assert.match(daily, /<meta property="og:url" content="https:\/\/penjat\.cat\/paraula-del-dia" \/>/)
  assert.match(daily, /<meta name="twitter:title" content="Paraula del dia \| Penjat" \/>/)
  assert.doesNotMatch(daily, /Juga al Penjat online en català\. Endevina paraules/)

  // Vocabulary learning: thematic units, one canonical URL with or without the trailing slash, no CEFR wording.
  const learningTitle = 'Aprèn vocabulari català jugant al penjat | Penjat'
  const learningDescription = 'Aprèn vocabulari català jugant al penjat. Paraules per temes (natura, animals, menjar, casa, ciutat, emocions) amb definicions, exemples i traducció al castellà.'
  for (const path of ['/aprendre/', '/aprendre']) {
    const learning = await fetchText(`http://127.0.0.1:${port}${path}`)
    assert.ok(learning.includes(`<title>${learningTitle}</title>`), path)
    assert.equal([...learning.matchAll(/<meta name="description"/g)].length, 1)
    assert.ok(learning.includes(`<meta name="description" content="${learningDescription}" />`))
    assert.ok(learning.includes('<link rel="canonical" href="https://penjat.cat/aprendre" />'))
    assert.ok(learning.includes(`<meta property="og:title" content="${learningTitle}" />`) && learning.includes(`<meta property="og:description" content="${learningDescription}" />`))
    assert.ok(learning.includes('<meta property="og:url" content="https://penjat.cat/aprendre" />') && learning.includes(`<meta name="twitter:title" content="${learningTitle}" />`))
    assert.doesNotMatch(learning, /CEFR|A1|B1|C1|noindex|hreflang/)
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/aprendre/`, { method: 'HEAD' })).status, 200)
  // The sitemap lists exactly the canonical URL of each page, and robots.txt allows crawling and points to it.
  for (const path of ['/', '/multijugador/', '/aprendre/', '/paraula-del-dia/', '/com-es-juga/']) {
    const canonical = (await fetchText(`http://127.0.0.1:${port}${path}`)).match(/<link rel="canonical" href="([^"]+)" \/>/)[1]
    assert.ok(sitemap.includes(`<loc>${canonical}</loc>`), `sitemap lists ${canonical}`)
  }
  assert.equal([...sitemap.matchAll(/<loc>/g)].length, 5)
  const robots = await fetchText(`http://127.0.0.1:${port}/robots.txt`)
  assert.match(robots, /User-agent: \*\nAllow: \//)
  assert.doesNotMatch(robots, /Disallow/)
  assert.match(robots, /Sitemap: https:\/\/penjat\.cat\/sitemap\.xml/)

  // Every public slash variant remains indexable, including invitation parameters; HEAD agrees with GET.
  const titles = {
    '/': 'Penjat — Joc del penjat online en català',
    '/multijugador/': 'Penjat multijugador — Juga online amb amics',
    '/aprendre/': learningTitle,
    '/paraula-del-dia/': 'El penjat del dia: endevina una paraula en català | Penjat',
    '/com-es-juga/': 'Com es juga a Penjat? | Penjat',
  }
  for (const [route, title] of Object.entries(titles)) {
    for (const path of new Set([route, route.replace(/\/$/, '') || '/', `${route}///`])) {
      const response = await fetch(`${origin}${path}`)
      assert.equal(response.status, 200, path)
      const html = await response.text()
      assert.ok(html.includes(`<title>${title}</title>`), path)
      assert.ok(html.includes(`<link rel="canonical" href="https://penjat.cat${route.replace(/\/$/, '') || '/'}" />`))
      assert.doesNotMatch(html, /noindex|hreflang/)
      assert.equal(response.headers.get('cache-control'), 'no-cache')
      await checkHead(path, 200, response.headers.get('content-type'))
    }
  }
  for (const path of ['/multijugador?sala=ABCDE', '/multijugador/?sala=ABCDE&chatDebug=1']) {
    const html = await fetchText(`${origin}${path}`)
    assert.ok(html.includes('<link rel="canonical" href="https://penjat.cat/multijugador" />'))
    await checkHead(path, 200, 'text/html; charset=utf-8')
  }
  for (const path of ['/missing', '/missing/', '/missing.html', '/aprendre/extra', '/APRendre', '/index.html']) {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 404, path)
    const html = await response.text()
    assert.match(html, /<title>Pàgina no trobada \| Penjat<\/title>/)
    assert.doesNotMatch(html, /rel="canonical"|property="og:url"|Joc del penjat online en català/)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    await checkHead(path, 404, 'text/html; charset=utf-8')
  }
  for (const path of ['/assets/missing.js', '/assets/missing.css', '/assets/missing', '/missing.png', '/learning/words/missing.svg', '/api/missing', '/%E0%A4%A']) {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 404, path)
    assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(await response.text(), 'Not found')
    await checkHead(path, 404, 'text/plain; charset=utf-8')
  }

  const staticPaths = [
    ['/robots.txt', 'text/plain; charset=utf-8'], ['/sitemap.xml', 'application/xml; charset=utf-8'],
    ['/favicon.svg', 'image/svg+xml'], ['/favicon.ico', 'image/x-icon'], ['/icon-192.png', 'image/png'],
    ['/site.webmanifest', 'application/manifest+json; charset=utf-8'],
    ['/learning/words/pinya.svg', 'image/svg+xml'],
    ...[...home.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(([, path]) => [path,
      path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2']),
  ]
  assert.ok(staticPaths.some(([path]) => path.endsWith('.js')) && staticPaths.some(([path]) => path.endsWith('.css')))
  for (const [path, type] of staticPaths) {
    const response = await fetch(`${origin}${path}`)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('content-type'), type, path)
    assert.equal(response.headers.get('cache-control'), path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    assert.ok((await response.arrayBuffer()).byteLength > 0)
    await checkHead(path, 200, type)
  }

  for (const [path, location] of [
    ['/es', '/'], ['/es/', '/'], ['/es/multijugador?sala=ABCDE', '/multijugador/?sala=ABCDE'],
    ['/es/aprendre/', '/aprendre/'], ['/es/como-jugar/?x=1', '/com-es-juga/?x=1'],
    ['/es/missing', '/missing/'],
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${origin}${path}`, { method, redirect: 'manual' })
      assert.equal(response.status, 308, path)
      assert.equal(response.headers.get('location'), location)
      assert.equal(await response.text(), '')
    }
  }
  for (const path of ['/', '/missing', '/assets/missing.js', '/es/']) {
    const response = await fetch(`${origin}${path}`, { method: 'POST' })
    assert.equal(response.status, 405, path)
    assert.equal(response.headers.get('allow'), 'GET, HEAD')
  }
  const health = await fetch(`${origin}/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true })
  await checkHead('/health', 200, 'application/json; charset=utf-8')

  // Exercise Engine.IO polling and a real Socket.IO connection; valid API previews remain JSON.
  const polling = await fetch(`${origin}/socket.io/?EIO=4&transport=polling`)
  assert.equal(polling.status, 200)
  assert.match(await polling.text(), /^0\{"sid":/)
  const socket = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 3000 })
  try {
    await Promise.race([once(socket, 'connect'), once(socket, 'connect_error').then(([error]) => { throw error })])
    const created = await socket.timeout(3000).emitWithAck('room:create', { name: 'SEO routing', gameLanguage: 'ca', voltes: 1 })
    assert.equal(created.ok, true)
    const path = `/api/rooms/${created.data.session.roomCode}/preview`
    const preview = await fetch(`${origin}${path}`)
    assert.equal(preview.status, 200)
    assert.equal(preview.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(preview.headers.get('cache-control'), 'no-store')
    assert.equal((await preview.json()).ok, true)
    await checkHead(path, 200, 'application/json; charset=utf-8')
    assert.equal((await fetch(`${origin}${path}`, { method: 'POST' })).status, 405)
    const missingPreview = await fetch(`${origin}/api/rooms/ZZZZZ/preview`)
    assert.equal(missingPreview.status, 404)
    assert.equal((await missingPreview.json()).error, 'room-not-found')
    await checkHead('/api/rooms/ZZZZZ/preview', 404, 'application/json; charset=utf-8')
  } finally { socket.disconnect() }
} catch (error) {
  if (serverErrors) console.error(serverErrors)
  throw error
} finally {
  server.kill('SIGTERM')
}

console.log('SEO route tests passed.')

async function fetchText(url) {
  const response = await fetch(url)
  assert.equal(response.status, 200)
  return response.text()
}

async function checkHead(path, status, contentType) {
  const response = await fetch(`${origin}${path}`, { method: 'HEAD', redirect: 'manual' })
  assert.equal(response.status, status, `HEAD ${path}`)
  assert.equal(response.headers.get('content-type'), contentType, `HEAD ${path}`)
  assert.equal(await response.text(), '', `HEAD ${path} has no body`)
}
