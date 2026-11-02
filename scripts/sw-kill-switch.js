// Recovery worker for a broken offline install (docs/offline-pwa.md). Deployed as /sw.js with
// `PENJAT_SW_KILL_SWITCH=1 npm run build`: it replaces whatever worker a browser has, deletes Penjat's caches and
// unregisters, so every request goes to the network again. It never touches localStorage: saved matches stay.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('penjat-')) await caches.delete(name)
  await self.registration.unregister()
  for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
})()))
