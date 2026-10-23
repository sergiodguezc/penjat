# Node 24 migration — 2026-10-23

Repository changes are prepared. Full validation of the patched development toolchain and live multiplayer remains blocked by this runner's network/socket restrictions. No commit, push, deployment, dashboard change or production request was made.

## Scope and files

Inspection found one independent npm project: the root package and lockfile. The server uses that same install. There are no nested npm manifests, `.node-version`, project `.npmrc`, or repository CI workflows. `.env.example` has no conflicting Node setting. Build/start scripts already suit Node 24 and were retained.

| File | Change |
| --- | --- |
| `package.json` | Node engine `>=24 <25`; raise Vite and concurrently minimums to patched versions |
| `package-lock.json` | Matching root engine/ranges and targeted dependency updates below |
| `.nvmrc` | New file containing `24` |
| `render.yaml` | `NODE_VERSION` from `22.22.0` to locally tested `24.22.1`; build/start/health/single-instance settings retained |
| `README.md` | Node requirement and Render dashboard/version precedence guidance |
| `docs/development.md` | Node 24 setup and NVM instructions |
| `AGENTS.md` | Only the Node requirement changed; pre-existing appended workflow instructions preserved |
| `docs/node24-migration-report.md` | Findings, validation and remaining deployment checks |

The branch was `main`. Pre-existing edits in `.oxlintrc.json` and `AGENTS.md` were preserved. Application source, gameplay, vocabulary, environment variables and generated server output have no changes from this migration.

## Dependency changes

These are resolved lockfile versions, not just manifest ranges.

| Dependency | Before | After | Reason |
| --- | --- | --- | --- |
| `vite` (direct dev) | 8.2.1 | 8.2.4 | Security patch within the same minor; manifest `^8.2.0` → `^8.2.4` |
| `concurrently` (direct dev) | 10.0.4 | 10.0.6 | Replaces its exact vulnerable shell-quote pin; manifest `^10.0.4` → `^10.0.6` |
| `engine.io` (transitive production) | 6.6.9 | 6.6.11 | Compatible Socket.IO transport patch; first fixed version is 6.6.10 |
| `shell-quote` (transitive dev) | 1.9.0 | 1.12.0 | Version required by concurrently 10.0.6; first fixed version is 1.11.0 |
| `source-map-js` (transitive dev) | 1.2.1 | 1.2.2 | Fix indexed-source-map denial of service |
| `rolldown` and all 14 platform bindings (transitive dev) | 1.2.3 | 1.2.4 | Minimum compatible with Vite 8.2.4's `~1.2.4` requirement |
| `@oxc-project/types` (transitive dev) | 0.143.0 | 0.144.0 | Exact requirement of rolldown 1.2.4 |

React/React DOM remain 19.2.8, Socket.IO/client remain 4.8.3, esbuild remains 0.28.2, and PostCSS remains 8.5.26. No major upgrades, overrides, added dependencies, forced audit fixes or broad updates.

Registry DNS fails with `EAI_AGAIN` in this runner. The lockfile was resolved with npm's bundled Arborist using cached registry metadata and published integrity hashes, selecting Vite/rolldown security-compatible patch versions. The original working `node_modules` was preserved. Clean-install attempts used disposable directories under `/tmp`.

## Security findings and reachability

The user's five-package result (3 high, 2 critical) is consistent with cached advisories for engine.io, Vite, source-map-js, shell-quote and concurrently. Parent packages can count separately from their vulnerable transitive dependency. Live audits could not reproduce that count because the registry was unavailable.

| Finding | Dependency path and exposure | Fix |
| --- | --- | --- |
| High: Engine.IO protocol-revision mismatch DoS | `socket.io → engine.io`; public Socket.IO transport upgrades are enabled, so this is production-reachable before game-level validation | [GHSA-2gc4-cqfq-p2gv](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv), fixed in 6.6.10; lock uses 6.6.11 |
| Critical: shell-quote command injection | `concurrently → shell-quote`; development command expansion calls `quote()`. Current npm commands contain fixed strings and no attacker-supplied comment objects/additional argument placeholders, so the reported exploit shape is not present in the normal workflow. Not used by `npm start` | [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), fixed in 1.11.0; concurrently 10.0.6 pins 1.12.0 |
| High: source-map-js event-loop DoS | `vite → postcss → source-map-js`; malicious indexed source maps affect development/build processing. The production HTTP server does not parse source maps | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), fixed in 1.2.2 |
| High: bundled launch-editor Windows existence-check bypass | Direct Vite dev dependency; Windows/editor-specific exploitation does not apply to the stated Arch environment or the Node production server | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), Vite fix 8.2.4 |

The same Vite patch also addresses cached moderate/low advisories: [WASM file-prefix disclosure](https://github.com/advisories/GHSA-vfpm-58rq-9qcg), [filesystem allow-list bypass](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), [cross-origin middleware script execution](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [editor flag handling](https://github.com/advisories/GHSA-r825-w8mm-5pxw), and [Windows percent escaping](https://github.com/advisories/GHSA-698v-4r3x-3vcv). Vite serves local development, not production; do not expose the development server publicly.

Remaining production vulnerabilities: **none matched the cached advisory ranges; live count unknown**. Remaining development vulnerabilities: **none matched the cached advisory ranges; live count unknown**. Nineteen cached advisory records relevant to locked package names were checked using semver ranges, with zero matches. This is not a substitute for a fresh audit. Both `npm audit` and `npm audit --omit=dev` were attempted before and after changes; all four failed on registry DNS. The offline production install's printed “0 vulnerabilities” is not evidence of a live audit.

## esbuild installation warning

There is no project `allowScripts` policy or `.npmrc`; effective `ignore-scripts` is false. npm 11.19.1 warns about esbuild 0.28.2's `postinstall: node install.js`. The script selects the platform binary, checks its version and can fetch a fallback if optional binary installation is missing. Existing esbuild CLI execution (`--version` → `0.28.2`) and an actual TypeScript transform both passed. Vite builds and TSX transpilation also work.

An additional clean install of the original dependency tree on Node 24 reached esbuild's postinstall but failed with `spawnSync .../esbuild EPERM` in this runner (its captured stdout nevertheless contained `0.28.2`). Thus a clean esbuild postinstall is not fully verified here. No script permission was broadened or security check disabled; there is no demonstrated project permission problem to fix. Retain the warning until a normal host install confirms whether any narrowly scoped approval is actually needed.

## Validation results

Runtime verified: Node **v24.22.1**, npm **11.19.1**.

| Check | Result and limit |
| --- | --- |
| Updated-lock `npm ci --dry-run --offline` | Passed lockfile/manifest consistency; no `EBADENGINE` |
| Clean updated production install, `npm ci --omit=dev --offline` | Passed: 28 packages installed in an isolated directory; Socket.IO initialized successfully with Engine.IO 6.6.11 |
| Clean updated full install, online and offline | Blocked: Vite 8.2.4 tarball is not cached and registry DNS fails; other patched development packages are also unavailable locally |
| `npm run build` | Passed frontend/server compilation on Node 24 using original installed Vite 8.2.1/rolldown 1.2.3; **does not validate updated Vite**. Tracked `dist-server` unchanged |
| `npm run lint` | Passed using original installed tooling and the pre-existing lint configuration |
| Backend `test:game`, `test:chat`, `test:lifecycle`, `test:match`, `test:n-player`, `test:absence` | All six passed using rebuilt server JS on Node 24 |
| Client `test:multiplayer-ui`, `test:match-results`, `test:character`, `test:learning`, `test:vocabulary`, `test:daily`, `test:invitation`, `test:localization`, `test:navigation` | All nine passed via `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx <test-file>`; npm script invocation hit TSX CLI IPC `EPERM`, so the loader invocation avoided that unnecessary IPC |
| `test:connection`, `test:reconnect`, `test:lobby-settings` | Blocked by local TCP `listen EPERM`, including when invoked through the TSX loader |
| `npm run test:vocab` | Passed, 52 Python tests |
| `npm run vocab:validate` | Passed, 544 entries; no corpus regeneration/enrichment |
| Local Render start command, `PORT=3002 HOST=127.0.0.1 npm start` | Reached server startup; blocked by `listen EPERM`. `/health` and served frontend could not be requested |
| `npm run test:seo` | Blocked: server cannot listen; test exits with an unsettled top-level await while waiting for startup |
| Live E2E/browser suites | Not run: required local server cannot bind. Firefox is installed, but browser automation also requires local sockets |
| Final audits | Both blocked by `EAI_AGAIN`; no fresh security clearance |
| `git diff --check` | Passed |

The pre-existing Vite main-chunk warning (>500 kB) remains; changing application bundling is outside this migration. No dependency behavior changes were inferred from tests run against the original development tree.

## Before deploying

1. On an unrestricted local host, use Node 24 and run `npm ci`, then both audit commands. Verify the resolved versions above, successful esbuild installation and no `EBADENGINE`. The working checkout still has its original installed development dependencies until this succeeds.
2. Run `npm run build`, `npm run lint`, client/backend scripts, and especially `test:connection`, `test:reconnect`, `test:lobby-settings` against the new install. Repeat the build because the updated bundler has not been tested here.
3. Start the production command on a dedicated local port. Check `/health` returns HTTP 200 and `{"ok":true}`, visit the frontend, and run `TEST_SERVER_URL=http://127.0.0.1:3002 npm run test:e2e`. Run the documented disposable Firefox browser suite for room restoration, invitations, learning/daily and a multiplayer smoke test. Stop test processes afterward.
4. Inspect Render's dashboard manually; it was not accessible in this session. Confirm the service/root directory uses this root npm project, `NODE_VERSION=24.22.1` agrees with the Blueprint, build is `npm ci && npm run build`, start is `npm start`, health is `/health`, and one instance is configured. Check that dashboard npm settings do not omit build-time development dependencies. Do not change unrelated variables.
5. Render's precedence is dashboard `NODE_VERSION`, then `.node-version`, `.nvmrc`, then package engines ([Render documentation](https://render.com/docs/node-version)). A repository edit does not prove a dashboard override has changed. Review automatic deployment settings before pushing to `main`.
6. Plan deployment timing: application rooms are memory-only, so the service restart clears active matches. After an explicitly authorized deployment, verify build/start Node versions, health and a new two-player match/reconnection on the deployed service.

Suggested commit message: `chore: migrate to Node 24 and patch vulnerable dependencies`
