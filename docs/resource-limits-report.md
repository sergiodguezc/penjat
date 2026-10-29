# Resource-limit release verification

Status: **all requested local verification passed**, 2026-10-29. Earlier sandbox failures are superseded by the completed elevated run below. No test is being counted as passed merely because it was blocked previously.

## Repository and environment

- Durable checkout: `/home/sergiodguezc/work/games/penjat/verification/resource-limits`, branch `feat/resource-limits`.
- Backup reference: `backup/resource-limits-cf6a4c0`, retaining `cf6a4c0ad1ce5e622b565a474e1eacfe1a1eba4b` and original implementation `714a6effe3831b47fb8062b15fbce6091e6d591d`. The original temporary clone was not changed.
- Successfully fetched `origin/main`: `c17cc425efef1255acd7bef58f8405059d7d6be4`, already an ancestor of this branch. No upstream changes or conflict resolution were needed.
- Node 24.22.1, npm 11.19.1, headless Firefox 158.0.1 on Linux.
- Initial sandbox probe reproduced localhost `EPERM`. An approved elevated probe confirmed TCP binding and npm/GitHub DNS; installation and socket-dependent verification then ran outside the sandbox.
- `npm ci` succeeded: 73 packages installed, 74 audited, zero vulnerabilities. `node_modules` is a real local directory, not a symlink or a copy from another checkout. No dependency or lockfile change was needed. npm emitted an esbuild install-script approval advisory; the production build and all suites succeeded with the normal clean installation.
- The parent workspace's unrelated tracked/untracked work and current branch remain untouched. No push, Render deployment or production request was performed.

## Required suites

Every suite below completed with exit status 0.

| Command | Evidence / scope |
| --- | --- |
| `npm run test:limits` | JSON/source/compiled configuration, every override and bounds, invalid startup diagnostics, immutable settings, deterministic limiter boundaries/expiry/bounded storage, IP normalization/spoofing; live HTTP and Socket.IO quota behavior |
| `npm run test:reconnect` | Stored credentials, refresh/reopen, transport drops, migration, takeover, invitations, retry and explicit departure |
| `npm run test:lobby-settings` | Defaults, validation, host-only changes, member synchronization, start and restoration |
| `npm run test:seat-lifecycle` | Seat replacement and preservation, timers/expiry, stale subscriptions/chat, retained seats, lost acknowledgements, match/results/rematch |
| `npm run test:e2e` | Real independent Socket.IO clients, privacy, authorization, scoring, rotation, forgiveness and HTTP previews |
| `npm run test:browser` | Real Firefox navigation, lazy socket lifecycle, storage and restoration, invitations, keyboard/dialogs, language/layout boundaries, terminal matches and results/rematch; no collected browser-console error assertion failed |
| `npm run test:browser:multiplayer` | Four- and ten-player real matches with independent browser contexts and socket participants, live ranking/ties, reconnect, departure, chat, results and rematch |
| `npm run test:chat-browser` | Real touch reactions, synchronization, unread/draft/history behavior, responsive chat sheet, silent restore, audio confirmation/cooldown/mute at 320, 390, 768, 1100 and 1440px widths |

The limits integration test uses one actual loopback IP across mixed polling/WebSocket connections, with different forged `CF-Connecting-IP` and `X-Forwarded-For` values. Ten players joined one room. Further creation was refused across sockets despite changed headers. Capacity refusal preserved the existing host seat and active guessing round; solo replacement fit without increasing room count. HTTP previews exercised 200, 404, 409, GET/HEAD 429, JSON error, Retry-After and bodyless HEAD. A player actually disconnected, resumed the same retained seat after creation/preview quotas were exhausted, and continued chat/gameplay.

### Isolation and fixture correction

E2E and the three browser suites each used a fresh production server on loopback ports 13401–13404. Each browser suite used its own temporary Firefox profile and BiDi endpoint (19402–19404). The runner stopped only its own server/browser process groups in `finally` cleanup. No personal browser profile was used. The Browser plugin is not available; the explicitly requested repository Firefox BiDi suites were used.

The full navigation audit deliberately creates many independent rooms, so its server used `PENJAT_ROOM_CREATION_REQUESTS=1000`. E2E, multiplayer-browser and chat-browser servers used JSON defaults. The limits integration suite retained the real five-request creation quota and explicitly used a two-room cap and three-request preview quota to test boundaries without load testing. Existing reconnect/lobby/seat suites retain their documented higher test-only creation quota.

The remaining `test:connection` fixture initially failed because its multiple independent handshake/race scenarios exceeded five localhost creations. Its npm script now sets the same explicit `PENJAT_ROOM_CREATION_REQUESTS=1000` test override; the entire suite then passed. This fixes test isolation and does not change application behavior or production defaults. No other genuine test failure remained.

## Remaining regressions and build checks

All of these passed with the clean local installation:

- `npm run build` (production client and server), `npm run lint`, `npx tsc -b --pretty false`, `npx tsc -p server/tsconfig.json --noEmit`.
- `test:game`, `test:chat`, `test:lifecycle`, `test:match`, `test:n-player`, `test:absence`, `test:connection`, `test:entry-race`, `test:reconnection-notice`.
- `test:chat-inbox`, `test:chat-sound`, `test:multiplayer-ui`, `test:match-results`, `test:storage`, `test:invitation`, `test:localization`, `test:navigation`.
- `test:learning`, `test:vocabulary`, `test:daily`, `test:character`, `test:seasonal`, `test:seo` (its own local production server).
- `git diff --check`; rebuilding left tracked `dist-server` unchanged, confirming generated server files match source.

There were 31 successful npm test suites, plus production/configuration smoke checks. No corpus generation, paid enrichment, stress test or memory benchmark ran.

## Render-style local production verification

The clean checkout contains tracked `config/limits.json`; Render's existing `npm ci && npm run build` / `npm start` commands operate from that checkout root. There are no duplicate limits in `render.yaml`.

An additional loopback-only smoke check started the actual `npm start` command using `RENDER=true`, `PENJAT_MAX_ROOMS=1`, `PENJAT_ROOM_CREATION_REQUESTS=1` and `PENJAT_ROOM_PREVIEW_REQUESTS=1`. It passed all of these:

- Health, built HTML and a referenced JS asset return 200. The backend configuration is not exposed as a public frontend asset.
- Environment overrides take effect in the compiled server: the second room is refused at capacity and repeated creation/preview requests are refused after one request rather than the JSON defaults.
- Synthetic trusted-edge CF metadata gives independent IP buckets; changing only the untrusted X-Forwarded-For does not reset a quota. Different malformed CF values share the peer fallback.
- Resume, join, match start, word setting and guessing work after refusals.

The smoke process was stopped afterward. This models Render's documented public ingress locally; it does not claim that a real Cloudflare/Render request was inspected. Previous dependency-free archive checks also demonstrated that compiled configuration resolves the included JSON and applies overrides from a clean checkout root.

## Evidence and remaining limits

Raw E2E/browser results and logs: `/tmp/penjat-resource-final-verification/results.json`, `test-e2e.log`, `test-browser.log`, `test-browser-multiplayer.log`, `test-chat-browser.log`, their separate server/Firefox logs, and `render-config-smoke-server.log`.

Screenshots: `/tmp/penjat-p0-validation/`, `/tmp/penjat-phase-2a-validation/`, `/tmp/penjat-phase-2d-multiplayer/firefox/`, `/tmp/penjat-chat-validation/firefox/`. These are temporary local artifacts, not committed assets.

Known limits, not unresolved local test failures:

- Render/Cloudflare header trust relies on the documented public-ingress topology. No production or deployed staging edge was contacted; an alternative ingress that preserves arbitrary CF headers must not bypass that trust boundary. See [resource limits](resource-limits.md).
- Rooms, configuration and quotas belong to one process. Restarting loses rooms and resets counters; multiple instances require shared authoritative state, distributed limiting and Socket.IO routing/adapter work.
- Browser checks use headless desktop Firefox with simulated viewport/touch input, not physical iOS/Android or additional engines. Firefox driver logs include animation-frame/shutdown warnings; all suite assertions completed successfully.
- Vite still reports the known client chunk over 500 kB. Initial limits remain conservative values, not measured capacity estimates.

## Recommended release procedure

The branch is locally verified and ready for review. No manual terminal verification remains for the user. Review the final committed diff and explicitly authorize publishing/merging and deployment as a separate action. Before deployment, review any existing Render `PENJAT_` overrides: they take precedence over JSON. Keep one Node process/instance and the JSON file in the checkout; do not duplicate its defaults in `render.yaml`. Deploy only the reviewed SHA and schedule the restart with the loss of existing in-memory rooms understood. The rollback target is the previously deployed SHA; rollback also restarts the process. This verification did not publish, merge or deploy anything.
