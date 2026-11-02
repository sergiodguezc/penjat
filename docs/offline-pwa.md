# Offline play and the service worker

Penjat installs a service worker in production so "Passa el mòbil" (and the daily challenge, learning and help pages) keep working without a network, including from an iPhone Home Screen. Online multiplayer is unchanged: it always needs the server.

## Pieces

| File | Role |
| --- | --- |
| `src/pwa/service-worker.js` | Worker template: install, activate, fetch routing, readiness replies. |
| `scripts/build-service-worker.mjs` | Runs after `vite build` (`build:client`): lists every file of the finished `dist/` with a SHA-256 content hash and writes `dist/sw.js` (template + `VERSION` + `PRECACHE`). Fails the build if `index.html` or the manifest references a file that is not listed. |
| `src/pwa/offline.ts` | `registerServiceWorker()` (production only, after the page's `load`) and `useOfflineReadiness()` for the local setup screen. |
| `public/site.webmanifest`, `index.html` | Manifest (`id`/`start_url` `/`, `standalone`, `any` and `maskable` icons) and the Apple meta tags/touch icon. |

The list is built from `dist/` after the build rather than inside a Vite hook: Vite copies `public/` at `renderStart` and writes `index.html` afterwards, so only the finished folder has everything a deploy serves. Hashing contents means unhashed names (`icons.svg`, `learning/words/*.svg`, the manifest, icons) get a new revision when they change. `VERSION` hashes the whole list plus the worker template, so any content or worker change is a new worker.

**Precache (current build):** 90 files, about 1.2 MB: the shell `/` (2 KB), the JS bundle with the vocabulary (≈ 904 KB), CSS (≈ 121 KB), both fonts (≈ 87 KB), manifest, favicons and icons (≈ 49 KB), and the 78 learning illustrations and emblems (≈ 49 KB). Excluded: `sw.js`, `robots.txt`, `sitemap.xml`, `licenses/`, source maps.

## Runtime behaviour

| Request | Handling |
| --- | --- |
| Non-GET, other origins, `/socket.io/`, `/api/`, `/health` | Never intercepted. |
| Page loads (navigations to paths without an extension) | Network first: the server's HTML, with its route metadata, and (on a new deploy) the new hashed assets from the network. On a network error, or after 4 s without an answer, the active version's cached shell `/`, whose assets are all in the same cache. |
| Files in the precache list | That version's cache, then the network if missing. |
| Anything else (e.g. `/sw.js`, `/licenses/...`) | Not intercepted. |

Nothing is ever cached at runtime, and the worker never touches `localStorage`, `sessionStorage` or cookies: saved local matches, daily attempts, learning progress and the online room session are untouched by installs, updates and cleanup.

## Install, readiness and updates

- **Install:** every listed file is downloaded with `cache: 'reload'` and verified (status OK, not redirected, content hash equal to the build's; the shell must reference exactly this build's hashed assets). Any failure deletes the new cache and fails the install, so a half-deployed or mixed server never produces an apparently complete offline copy.
- **First install:** there is no previous worker, so it activates and claims the open page at once.
- **Readiness** (`.offline-status` on the local setup screen): "Llest per jugar sense connexió" only when this page is controlled by a worker that answers that its own cache holds every listed file. Before that, "Preparant…"; offline without a complete cache, "Cal connexió…"; a failed install, a message that online play still works. Unsupported browsers and development show nothing. If a controlling worker finds files missing (evicted), it downloads them again when online.
- **Updates:** the browser checks `/sw.js` (served `no-cache`) on page loads. A new version installs in the background into its own cache; if that fails, the installed version and its cache keep working, online and offline. A complete update then **waits**: there is no `skipWaiting`, so code never changes under a running match. It activates when every Penjat page in that browser profile has closed (on an iPhone, swiping the Home Screen app away; on a desktop, closing all Penjat tabs). A reload alone is not enough while another page is open. On activation it deletes the older `penjat-*` caches, which no page uses any more. Online page loads already get the newest HTML and assets from the network meanwhile; the waiting only concerns what an offline launch would use.
- **Compatibility:** an offline launch always gets one version's shell with that version's assets. Saved matches carry their own schema version (`penjat-local-match`, see [gameplay contracts](gameplay-contracts.md)), independent of the worker.

## Storage on iPhone

Safari and an app added to the Home Screen have separate storage, service worker registrations and caches ([WebKit](https://webkit.org/tracking-prevention/)): being ready in Safari does not prepare the installed app, and a match saved in one is not visible in the other. After adding Penjat to the Home Screen, open it from there once with a connection and wait for "Llest per jugar sense connexió" on "Passa el mòbil" (the homepage install card says so). Home Screen apps are exempt from Safari's 7-day script-storage cap ([WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)), and starting a local match asks for persistent storage (`navigator.storage.persist()`, Safari 17+). Storage can still be removed under storage pressure, by the user, or when the app is deleted; unused registrations may be removed after weeks ([WebKit](https://webkit.org/blog/8090/workers-at-your-service/)). The page then reports that it is not ready, and opening it online prepares it again.

## Recovery and rollback

- **Bad build, fixed by a new deploy:** deploy the fix (or redeploy the previous commit). Its `sw.js` differs, so it installs as an ordinary update and takes over once pages close. A rollback is just another version.
- **The worker itself is broken (e.g. pages fail to load):** redeploy the same commit with the environment variable `PENJAT_SW_KILL_SWITCH=1` (on Render: set it on the service and trigger a deploy; the build command is unchanged). The build then writes `scripts/sw-kill-switch.js` as `/sw.js`: browsers pick it up on their next online page load as an update, it takes over at once (`skipWaiting`, the only place where that is acceptable), deletes every `penjat-*` cache, unregisters and reloads open pages once from the network. Pages keep registering `/sw.js`, and each new registration of the recovery worker unregisters itself again, so nothing is left installed and there is no reload loop. Saved matches stay in `localStorage`. Offline play is unavailable while the switch is deployed. To restore it, remove the variable and deploy the fixed build: the normal worker installs again. Removing `sw.js` from the server is not enough: browsers keep an installed worker when its script returns 404. Rehearsed by `npm run test:offline` (scenario D).
- **One device:** close every Penjat tab/app and reopen it online; or remove the website data (Safari: Settings › Apps › Safari › Advanced › Website Data; desktop: site data in the browser settings), or delete and re-add the Home Screen app. These also delete saved local matches.

## Testing

- `npm run test:pwa`: precache list and revisions (fixture and real `dist/`, including fonts, icons and every learning image), the generated worker in a sandbox (complete install, failures from a missing file, changed content, a server error, a shell of another build or no network; activation cleanup; routing; offline and slow-network shell; readiness and repair), and the page's readiness rules.
- `npm run test:offline` (after `npm run build`, with headless Firefox on 9222): starts the production server on a copy of `dist/`, installs, checks readiness, **stops the server**, then launches, reloads and opens new tabs offline, plays a complete match and resumes an interrupted one, opens the other pages, stages a broken update (installed version kept, offline launch still works) and a good one (waits while a page is open, takes over once it closes, removes the old cache, keeps the saved match), then rehearses the kill switch (caches and registration removed, one reload and no loop, saved match kept, normal build reinstalls), with no Socket.IO request on the local route and no console errors.
- `npm run test:browser` against a production build exercises the whole site with the worker active.

Desktop Firefox cannot show Home Screen behaviour. Real-iPhone checks (Phase 5), all **unverified** so far:

1. Safari: open penjat.cat, Share › Add to Home Screen; the icon and name are right.
2. Open the Home Screen app online; "Passa el mòbil" shows "Llest per jugar sense connexió".
3. Airplane Mode, then cold-launch from the icon: the app opens (no Safari error page), on `/` and on "Passa el mòbil".
4. Play a complete offline match (word entry, guesses, perdó, reveal, results, rematch).
5. Force-quit mid-turn and reopen offline: the resume card, then the right gate; no board or word on screen.
6. App switcher and backgrounding during a turn: the snapshot and the return show no private screen; Control Center only covers it.
7. Saved match after hours/days and a device restart; Safari and the Home Screen app keep separate matches.
8. Deploy a new version; open the app online, swipe it away and reopen: the new version runs, readiness returns, the saved match is intact.
9. Online multiplayer from the Home Screen app still creates, joins and restores rooms.
10. Status bar, safe areas and the keyboard in standalone mode.
