# Development and verification

## Setup

Use Node >=22.12 <23 and npm. `npm ci` installs the lockfile; `npm install` is also supported. Python 3 (standard library only) is needed for corpus checks. No database setup or secrets are required for local gameplay. `npm run dev` launches Vite (5173) and the server (3001); `dev:client` is a compatibility alias for both. To separate processes, use `npm run dev:vite-only` and `npm run dev:server` in different terminals. Vite proxies `/api` and `/socket.io`; the socket module uses the direct 3001 development URL by default.

`PORT` (default 3001), `HOST` (default 0.0.0.0), `NODE_ENV`, optional `CLIENT_ORIGIN` and build-time `VITE_SERVER_URL` configure hosting. `DETERMINISTIC_FIRST_SETTER=1` is useful for local test scenarios. `TEST_SERVER_URL` selects the integration test target. Do not point tests at production. `.env.example` documents split-origin configuration. Node start does not implicitly load arbitrary `.env` files.

Offline enrichment commands use `OPENAI_API_KEY` and optional model/rate settings described in `data/README.md`; do not run them for ordinary application verification or expose their values.

## Checks by subsystem

| Area | Commands |
| --- | --- |
| Learning / corpus runtime | `npm run test:learning`; `npm run test:vocabulary` |
| Daily | `npm run test:daily`; `npm run test:vocabulary` |
| Invitations / language routing | `npm run test:invitation`; `npm run test:localization` |
| Navigation / history guard | `npm run test:navigation` |
| Character drawing | `npm run test:character` |
| Multiplayer UI (static markup) | `npm run test:multiplayer-ui` |
| Match results (outcome, standings, rematch states) | `npm run test:match-results` |
| Server domain | `npm run build:server`, then `npm run test:game`, `npm run test:chat`, `npm run test:lifecycle`, `npm run test:match`, `npm run test:n-player`, `npm run test:connection` (create/join while the client connection is still being established), `npm run test:absence` (controlled-time retained seats: return within the 2-minute grace period, absence in each phase, blocking-only "continue without" permissions and races, return as a spectator, host transfer, rematch, explicit leave, room expiry), `npm run test:lobby-settings` (default create, host-only lobby settings, invalid values, sync, start with confirmed settings, host transfer and reconnection), `npm run test:reconnect` (stored room credentials, legacy migration and restoration: refresh/reopen, transport drop, failure and retry, invalid sessions, explicit leave, two tabs, invitations) |
| Offline corpus pipeline | `npm run test:vocab`; `npm run vocab:validate` |
| Types / lint | `npx tsc -b --pretty false`; `npx tsc -p server/tsconfig.json --noEmit`; `npm run lint` |
| Production / SEO | `npm run build`; `npm run test:seo` (starts its own server on 3205) |

Tests are Node assertions rather than a shared test-runner framework. TS tests run through TSX, Python tests through unittest. TSX transpiles tests but application type checks do not include the tests directory. Server suites import tracked generated JS from `dist-server`, so stale builds can hide defects.

For live integration, build first, then start a dedicated process:

```sh
PORT=3002 HOST=127.0.0.1 node dist-server/server/server.js
```

In another terminal:

```sh
TEST_SERVER_URL=http://127.0.0.1:3002 npm run test:e2e
```

Stop that test server afterward. The suite uses independent Socket.IO connections, covering multiple guessers, privacy, authorization, capacity, isolation, scoring, rotation and forgiveness. It does **not** create browser contexts or exercise React navigation/session storage; the optional browser suite below covers those boundaries. Manual browser reproduction should compare (1) two tabs in one profile, (2) duplicated/opener tabs that may inherit session storage, and (3) separate browser profiles/contexts. Record which isolation was used. Test a restored room A followed by an invitation to B, reload, same-room invitations, departure and rematch. Use at least three participants for concurrent guesser/forgiveness scenarios.

## Optional real-browser regressions

`npm run test:browser` uses Node's built-in WebSocket and Firefox WebDriver BiDi, without additional npm packages. It was verified with Firefox 157 and Node 22.23.3. Use a dedicated local built server (3002 by default) and a disposable Firefox profile:

```sh
mkdir -p /tmp/penjat-audit-firefox
firefox --headless --no-remote --profile /tmp/penjat-audit-firefox --remote-debugging-port 9222
```

In another terminal, with the dedicated server running:

```sh
TEST_SERVER_URL=http://127.0.0.1:3002 BIDI_URL=ws://127.0.0.1:9222 npm run test:browser
```

The script requires a fresh available automation session, creates browser user contexts and tabs, and closes its tabs/session afterward. Stop your temporary Firefox/server processes when finished. Never use a personal browser profile. The script refuses non-local targets. It covers homepage link navigation (modified/middle clicks, keyboard order from the skip link through the header to the page, back/forward), history guards (`scripts/history-guard-browser-checks.mjs`, own profile: learning leaves unguarded and resumes; Back/Forward with and without an open exit dialog in daily and a waiting room), the site header (`scripts/header-browser-checks.mjs`: phone menu keyboard/Escape/outside click/navigation/language/resize, current-page marking, sticky scope, a 320px room header and the guarded room exit), CA/ES homepage geometry at the 599/600, 660/661 and 860/861px boundaries (on phones, the hero order, full-width Jugar, equal secondary cards and first-viewport fit from 375×812, plus its Tab order and whole-surface click), the homepage daily entry after play and with corrupt storage, 599–661px contracts for the other screens, normal shared-storage tabs, actual opener-inherited session credentials, independent contexts, invitations/reload/join/leave, a whole learning unit (refreshes mid-word and on a card, bookmarks, word cards, replay and review), and departure during word selection. A plain build shows only `ready` learning units; to try a `draft` unit in a local build, build with `VITE_LEARNING_DRAFTS=1 npm run build`. Unit/static tests cover concurrent guesser notices, final rounds, rematches and score ties. The P0 checks also exercise native dialogs (Tab/Shift+Tab, Escape, inert background and focus restoration), chat reactions with real keyboard/touch input and Socket.IO updates, and wordless terminal matches in CA/ES at 1440×900, 1366×768, 768×1024, 390×844 and 320×568. They write screenshots to `/tmp/penjat-p0-validation/` and check computed contrast and internal dialog overflow. The match-results flow (`scripts/match-results-browser-checks.mjs`) plays a real three-player match with the browser as one participant and checks the results surface: focus moves once to the outcome, readiness/reconnection/language changes do not re-announce it, the phone action bar stays visible without covering content, a pending rematch request is not re-sendable, and a started rematch returns focus to the game (screenshots in `/tmp/penjat-phase-2a-validation/`). This optional browser suite supplements the existing Socket.IO E2E suite; Firefox must be installed separately. Chromium/WebKit are not exercised. For a CSS change, set `RESPONSIVE_BASELINE_CSS` to a file containing the previous CSS to also assert that non-homepage screens keep identical geometry (this writes comparison screenshots to the ignored `design-explorations/phase-2-1-sizing/screenshots/`, created on demand).

### Text enlargement

For a 200% text check, use a disposable Firefox profile whose `user.js` sets `font.size.variable.x-western` to 32.

To rebuild the UI font, run `python3 scripts/build-ui-font.py 'SourceSans3[wght].ttf' OUTDIR` (fontTools plus `woff2_compress`; the output is deterministic). Copy the result to `src/assets/fonts/`.

## Troubleshooting and production validation

- `EADDRINUSE`: use a free port; do not terminate an unrelated development process. `EPERM` from TSX pipes or HTTP listen in a restricted runner is an environment limitation requiring local socket permission, not an application failure.
- `test:browser` can intermittently stop in `checkSiteHeader` (`header-browser-checks.mjs`): "Crea una partida" stays busy and no `room:create` reaches the server, apparently a lost Socket.IO acknowledgement after a polling reset. It reproduces with unmodified code; rerun before treating it as a regression.
- Rebuild `dist-server` before interpreting backend test failures. `npm run preview` alone cannot supply rooms or room previews.
- HTTP 503 with “Frontend build unavailable”: run the full build from repository root.
- Connection failures: verify server health, frontend build-time URL and origin settings. Production uses same-origin sockets by default.
- Unknown room after restart is expected: rooms are memory-only and require one service replica.
- Empty CEFR pools: inspect runtime `linguistics.cefr` coverage as well as ignored experiment outputs. `vocab:build` can consume older lexical inputs; do not blindly overwrite approved v1 data to repair metadata.

Validate production with `npm run build`, run relevant tests, then `npm start` and visit local routes. Review generated server diffs and `git diff --check`. No automatic deployment is part of verification. Vite's >500 kB main-chunk warning is known and pre-existing.

### Other engines

`scripts/browser-driver.mjs` (`BROWSER=firefox|chromium|webkit`) drives `npm run test:browser:multiplayer`, a real multi-player browser match. For its expected tie scenario, use a dedicated server with `DETERMINISTIC_FIRST_SETTER=1`. WebKit runs need WebKitWebDriver under an Xvfb screen large enough for 1920px windows, e.g. `xvfb-run -n 99 -s '-screen 0 2400x1600x24' WebKitWebDriver --port=4445`. Below 440px the driver loads the app in an exact-size iframe on a same-origin wrapper page; a cross-origin wrapper made WebKit ignore `focus()` inside the frame. A bare Xvfb has no window manager, so a resized MiniBrowser window loses focus and never matches `:focus-visible`; restore X input focus (e.g. with `xdotool`) before focus checks. Font generation is documented in `src/assets/fonts/README.md`.
