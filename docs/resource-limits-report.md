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
