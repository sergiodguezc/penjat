// Writes dist/sw.js after `vite build`: the service worker template (src/pwa/service-worker.js) preceded by the precache
// list of the finished build. It reads dist/ itself (Vite copies public/ at renderStart and writes index.html later), so
// every file a production deploy serves is listed with a content hash, hashed asset names or not.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const TEMPLATE = new URL('../src/pwa/service-worker.js', import.meta.url)
// Crawler files, licence texts and the worker itself are never needed offline.
const EXCLUDED = [/^sw\.js$/, /^robots\.txt$/, /^sitemap\.xml$/, /^licenses\//, /\.map$/]
const hash = (content) => createHash('sha256').update(content).digest('hex')

function files(directory, root = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path, root) : [relative(root, path).split(sep).join('/')]
  })
}

/** The precache list for a built dist/: `/` (the app shell) plus every other served file with its content hash. */
export function precacheManifest(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  // The server injects route metadata into the shell, so `/` is checked by the build's own asset references instead.
  const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1])
  const entries = files(dist).filter((path) => path !== 'index.html' && !EXCLUDED.some((pattern) => pattern.test(path)))
    .sort().map((path) => ({ url: `/${path}`, revision: hash(readFileSync(join(dist, path))).slice(0, 32) }))
  const listed = new Set(entries.map((entry) => entry.url))
  const manifest = JSON.parse(readFileSync(join(dist, 'site.webmanifest'), 'utf8'))
  const missing = [...assets, ...manifest.icons.map((icon) => icon.src)].filter((url) => !listed.has(url))
  if (missing.length) throw new Error(`Precache is missing files the app references: ${missing.join(', ')}`)
  return [{ url: '/', revision: hash(html).slice(0, 32), assets: [...new Set(assets.filter((url) => url.startsWith('/assets/')))] }, ...entries]
}

/** Source of dist/sw.js. The version changes with any listed file or with the worker's own code. */
export function serviceWorkerSource(dist, template = readFileSync(TEMPLATE, 'utf8')) {
  const precache = precacheManifest(dist)
  const version = hash(JSON.stringify(precache) + template).slice(0, 16)
  return `const VERSION = ${JSON.stringify(version)}\nconst PRECACHE = ${JSON.stringify(precache)}\n${template}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dist = process.argv[2] ?? 'dist'
  if (process.env.PENJAT_SW_KILL_SWITCH === '1') {
    writeFileSync(join(dist, 'sw.js'), readFileSync(new URL('./sw-kill-switch.js', import.meta.url)))
    console.log('sw.js: recovery worker (PENJAT_SW_KILL_SWITCH=1): removes offline caches and unregisters')
  } else {
    writeFileSync(join(dist, 'sw.js'), serviceWorkerSource(dist))
    console.log(`sw.js: ${precacheManifest(dist).length} files precached`)
  }
}
