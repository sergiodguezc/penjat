# Resource-limit implementation verification

Branch: `feat/resource-limits`, based on a fresh clone of main at `c17cc425efef1255acd7bef58f8405059d7d6be4`.

The original workspace's `.git` directory was read-only. Implementation and the commit live in `/tmp/penjat-resource-limits`; the original worktree, including its unrelated `.gitignore` change and untracked local files, was left untouched. No push or deployment was performed.

## Passed

- Node 24.22.1.
- `npm run build`: production client and server build; tracked generated `dist-server` reviewed with source. Vite reports the pre-existing client chunk over 500 kB warning.
- `npm run build:server` after the final creation-handler guard/IP capture change. No client code changed after the full production build.
- `npm run lint`.
- `npx tsc -b --pretty false` and `npx tsc -p server/tsconfig.json --noEmit`.
- `node tests/resource-limits-test.mjs`: source/compiled configuration agreement, frozen object, every environment override and lower/upper bound, invalid/missing/unknown settings, missing/broken JSON, invalid startup diagnostic, limiter exact boundaries and automatic fake-clock cleanup, bounded storage/no eviction, independent IP quotas, spoofed forwarding headers, mapped/canonical IPs, room-capacity rejection before seat release, solo replacement, retained seats/resume, expiry and explicit departure.
- `npm run test:game`, `test:chat`, `test:lifecycle`, `test:match`, `test:n-player`, `test:absence`.
- Existing localization (including new CA/ES error mappings), invitation and multiplayer UI suites, run with `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx tests/<suite>` to avoid the tsx CLI's IPC listener.
- `git diff --check`.

The lifecycle code-uniqueness fixture now explicitly permits its existing 200 rooms; it does not change the production cap. Network-heavy reconnect, lobby-settings and seat-lifecycle scripts explicitly override the creation quota to avoid coupling many unrelated scenarios to a single localhost IP budget. The new limit integration suite uses the real five-request quota.

## Blocked / unverified

The sandbox denies socket listeners with `listen EPERM`, including localhost TCP and the tsx CLI's Unix IPC listener. Consequently:

- `npm run test:limits`: the unit portion passes; the new live HTTP/Socket.IO portion cannot bind port 3244. Its assertions cover ten shared-IP players, mixed polling/WebSocket transports, header spoofing, quotas/status/Retry-After/HEAD, room replacement and seat preservation, resume, chat and active gameplay, but have not run here.
- `npm run test:reconnect`, `test:lobby-settings`, `test:seat-lifecycle`: attempted; tsx IPC denied. Retried using the equivalent `node --import tsx` runner and the scripts' quota override; backend TCP listeners were also denied. The seat-lifecycle synchronous domain assertions ran before its listener failure; the complete suite is unverified.
- No live Render edge-header check was performed. Proxy trust relies on Render's documented Cloudflare public ingress and Cloudflare's overwritten CF-Connecting-IP header; alternative ingress paths must not bypass that boundary. See the linked primary sources and assumptions in [resource limits](resource-limits.md).

`npm ci` failed during esbuild's binary validation with sandbox `spawnSync ... EPERM`; verification used a symlink to the existing workspace dependencies. No dependency was added or changed. No memory benchmarks, stress tests, broad browser/SEO/E2E suites, automatic scaling, push or deployment were run.

## Follow-up verification attempt (2026-10-29)

Release verification is **incomplete**. The current session still denies localhost listeners and outbound localhost connections, and provides no permission escalation or unrestricted execution host. The original temporary clone and commit `714a6effe3831b47fb8062b15fbce6091e6d591d` remain unchanged.

A separate, normal Git clone with its own copied objects and writable `.git` now lives at `/home/sergiodguezc/work/games/penjat/verification/resource-limits`, branch `feat/resource-limits`. It has no symlinked or borrowed `node_modules`. Its remote points to the original GitHub repository. The original workspace's unrelated files and branch were not changed; only this new `verification/` directory was added. This preserves the implementation outside `/tmp` without claiming that the release gate passed.

Fetching current main failed: SSH rejects the system SSH configuration permissions; HTTPS cannot resolve `github.com`. Consequently the durable branch is based on the last-known main, `c17cc425efef1255acd7bef58f8405059d7d6be4`; freshness against current `origin/main` remains unverified. No rebase was attempted against an unverified ref.

### Test correction

Inspection found that the unrun integration suite expected HTTP 200 for a ten-player room, although full-room previews correctly return 409. The test now previews a separate available room for 200, a guaranteed-absent code for 404, and the full/active room for HEAD 409 before checking GET/HEAD 429 and Retry-After. It also starts a round before capacity rejection, verifies that the active round survives, and performs a real disconnect/resume after quota exhaustion. These corrected live assertions remain unexecuted; syntax checking and focused lint passed. Backend behavior did not change.

### Results from this follow-up

| Command/check | Result |
| --- | --- |
| `npm run test:limits` | Unit portion passed; live portion blocked by `listen EPERM` on 127.0.0.1:3244 |
| `npm run test:reconnect` | Blocked by tsx IPC `EPERM`; equivalent `node --import tsx` invocation reaches TCP `listen EPERM` on 3221 |
| `npm run test:lobby-settings` | Blocked by tsx IPC `EPERM`; equivalent runner reaches TCP `listen EPERM` on 3231 |
| `npm run test:seat-lifecycle` | Blocked by tsx IPC `EPERM`; equivalent runner executes synchronous domain assertions before TCP `listen EPERM` on 3231 |
| `PORT=3002 HOST=127.0.0.1 DETERMINISTIC_FIRST_SETTER=1 npm start` | Production startup reaches TCP listen, then `EPERM` |
| `TEST_SERVER_URL=http://127.0.0.1:3002 npm run test:e2e` | Blocked by localhost WebSocket `connect EPERM` |
| `TEST_SERVER_URL=http://127.0.0.1:3002 BROWSER=firefox npm run test:browser:multiplayer` | Cannot connect to local Firefox BiDi endpoint on 9222; browser interactions unexecuted |
| `TEST_SERVER_URL=http://127.0.0.1:3002 BROWSER=firefox npm run test:chat-browser` | Blocked by localhost backend health-request `connect EPERM`; browser interactions unexecuted |
| `npm run test:chat` | Passed |
| Chat inbox and sound suites | Passed using `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx` |
| `npm ci --cache /tmp/penjat-resource-verification-npm-cache` in the fresh durable checkout | Failed with npm registry DNS `EAI_AGAIN`; reproducible clean installation unverified |
| Offline download-cache fallback | Copy exceeded disk quota; the copied cache was removed, preserving install logs. Offline install did not pass. No dependencies were borrowed for the durable checkout |
| `npm run build` in the original temporary clone | Passed using its existing symlinked dependencies; known >500 kB client chunk warning remains. This is not clean-install verification |
| `npm run lint`, both application/server TypeScript checks | Passed using existing dependencies in the temporary clone |
| Corrected integration file `node --check`, focused lint, `git diff --check` | Passed |
| Clean archived production configuration check | Passed: Git-tracked `package.json`, `config/limits.json` and compiled `dist-server/server/config.js` extracted to `/tmp/penjat-production-config-check`; Node with `NODE_ENV=production` loads and freezes JSON defaults and honors `PENJAT_MAX_ROOMS=123`, without any dependencies or symlinks |

The archive check confirms inclusion and configuration resolution from the checkout root used by Render's `npm start`. It does not confirm an end-to-end clean Render build or a running service. Browser plugin is not available; the specifically requested repository Firefox suites were attempted. There are no browser screenshots, DOM, console or interaction results to claim. No production traffic, deployment, push, memory benchmark or stress test was used.

### Required before release

On a normal non-production host with Node 24, npm registry/GitHub access and localhost TCP/Unix socket permissions:

1. Use the durable checkout. Preserve a backup branch before fetching and rebasing `feat/resource-limits` onto the freshly fetched `origin/main`; retain the original implementation commit through the backup. Resolve any conflicts and review the resulting diff. Do not use the temporary clone as the only copy.
2. Run `npm ci`, `npm run build`, `npm run lint`, `npx tsc -b --pretty false`, `npx tsc -p server/tsconfig.json --noEmit`, then `npm run test:limits`, `npm run test:reconnect`, `npm run test:lobby-settings`, `npm run test:seat-lifecycle` and the existing chat domain/inbox/sound suites. Recheck the existing domain/UI suites if rebasing changes their connected code.
3. For E2E, multiplayer browser and chat browser tests, use a **fresh dedicated local server for each suite**, not one server for all three: their combined creation requests would exceed the conservative default five-request IP quota. Start each with `PORT=3002 HOST=127.0.0.1 DETERMINISTIC_FIRST_SETTER=1 npm start`, run the selected suite with `TEST_SERVER_URL=http://127.0.0.1:3002`, then stop only that test server. Use a disposable Firefox profile/BiDi instance per the development docs for the two browser suites. Keep the real limits enabled; no capacity/load testing is required.
4. Record actual pass/fail evidence, including the corrected full-room preview test, shared-IP joins, spoofed headers, active-game continuity, seat preservation and real disconnect/resume. Fix genuine regressions and commit any fixes. Keep release blocked until all requested suites pass with clean dependencies and the latest main base is verified.
5. Review Render's existing environment overrides and public-ingress trust assumption without changing production. Keep the JSON file in the checkout, one instance/process and no duplicate limit defaults in `render.yaml`. After review, a human can explicitly authorize pushing/merging and deploying the verified SHA. Restart/redeployment resets in-memory rooms and quotas, so schedule the release with that lifecycle consequence understood. The rollback is the previously deployed SHA; rolling back also restarts the process.
