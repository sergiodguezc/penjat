# Resource limits

Penjat runs as one Node 24 process on Render Free (512 MB RAM, limited CPU). These are conservative initial limits, not measured maximum capacities. No memory benchmarks, stress tests or automatic memory-based scaling were used.

`config/limits.json` is the only source of defaults. `server/config.ts` reads it once at startup, validates it and exports one frozen, typed object. Start commands (`npm run dev:server`, `npm start`, `npm run start:server`) run from the repository root, so both TypeScript development and compiled `dist-server` read the same file. Keep `config/limits.json` in the deployed checkout; it is not a frontend asset. Missing/malformed files, unknown/missing keys and invalid numbers stop startup with an `Invalid Penjat limits` diagnostic naming the file and setting.

| JSON setting | Default | Environment override | Accepted integer range |
| --- | ---: | --- | --- |
| `maxRooms` | 100 | `PENJAT_MAX_ROOMS` | 1–100,000 |
| `roomCreationRequests` | 5 | `PENJAT_ROOM_CREATION_REQUESTS` | 1–1,000,000 |
| `roomCreationWindowSeconds` | 600 | `PENJAT_ROOM_CREATION_WINDOW_SECONDS` | 1–86,400 |
| `roomPreviewRequests` | 60 | `PENJAT_ROOM_PREVIEW_REQUESTS` | 1–1,000,000 |
| `roomPreviewWindowSeconds` | 60 | `PENJAT_ROOM_PREVIEW_WINDOW_SECONDS` | 1–86,400 |
| `rateLimiterMaxEntries` | 10,000 | `PENJAT_RATE_LIMITER_MAX_ENTRIES` | 1–1,000,000 |

Bounds reject accidental unbounded storage and timer overflow; they are not capacity recommendations. JSON values must be numeric integers. Environment values must contain decimal digits only: empty strings, whitespace, signs, fractions, exponent/hex notation and out-of-range values are rejected. Environment overrides take precedence over JSON; the JSON must still be valid even for overridden fields. Zero does not disable protection.

Locally, edit the JSON and restart the server, or use e.g. `PENJAT_MAX_ROOMS=200 npm run dev:server`. The project does not automatically load `.env` files into the backend. On Render, edit the JSON and redeploy, or add/update the corresponding variable in the service's **Environment** settings and restart/redeploy. Environment changes require a new process. Remove an override to use the JSON value again. `render.yaml` intentionally contains no limit defaults, so it cannot silently override the JSON. Upgrading the Render plan only requires changing these values when appropriate.

## Behavior

Every in-memory room counts, including waiting, active, completed and empty rooms with retained seats. Capacity rejection happens before releasing an existing seat. Replacing a room where the requesting socket is the only active member is allowed at capacity because that room is deleted immediately. An explicit last departure or the existing 30-minute empty-room expiry releases capacity. Limits never evict a room, revoke a token or shorten the absence grace period.

Room creation counts every `room:create` request, including invalid and capacity-rejected requests. It is per IP across all sockets/transports and reconnects, not per player. Previews count GET and HEAD requests to `/api/rooms/:code/preview`, including nonexistent/full rooms. Unsupported HTTP methods still receive 405. Previews return 429, JSON `room-preview-rate-limited` and `Retry-After` seconds (HEAD has no body). Socket acknowledgements return `room-creation-rate-limited` or `room-capacity-reached`; the normal client error mapper shows Catalan/Spanish retry messages.

The independent creation and preview limiters use fixed windows starting at the first request. Requests at the exact expiry start a fresh window. Rejections never extend the window. Each limiter stores at most `rateLimiterMaxEntries` IP keys with one counter and deadline each. A single unreferenced interval per limiter removes expired entries at least once per window (at most 60 seconds between sweeps); incoming traffic also reclaims expired entries. At capacity, unknown IPs are rejected without evicting existing counters. Entries are ordered by expiry, so a full live store can reject a new key without scanning the entire map. Server shutdown clears the intervals and storage.

Multiple legitimate players behind one NAT share creation/preview budgets. They can join the same room (up to ten players), reconnect, restore seats, chat and play even when those budgets are exhausted. A shared network can hit the creation quota: wait for expiry or join an existing room. Health checks and static assets are outside these quotas. The inspected baseline had no HTTP/Socket.IO rate limiter for these operations. Existing chat length/history bounds, room player capacity, Socket.IO transport/payload defaults and lifecycle timers remain in place; no global connection/event throttle was added.

## Client IP trust boundary

Local/non-Render runs use only the TCP peer address and ignore all forwarding headers. On Render (`RENDER=true`, platform-provided server environment metadata), public requests pass through Render's Cloudflare edge. We use its overwritten, single-IP `CF-Connecting-IP` for both HTTP and Socket.IO's initial request, including polling and WebSocket. We never select the leftmost `X-Forwarded-For`, trust a caller's `X-Real-IP`, or accept arbitrary hop counts. Missing/malformed/duplicate/comma-separated CF headers fall back to the peer bucket, so malformed metadata cannot create arbitrary limiter keys. Equivalent IPv6 spellings and IPv4-mapped IPv6 normalize to the same key. IPs are not logged or persisted by the limiter.

This trust applies only to the Render **public ingress**, including the `onrender.com` hostname; a request header cannot enable Render mode. Do not set `RENDER=true` on a directly reachable local/custom Node server. Do not expose an alternative untrusted/private ingress to this process that bypasses Cloudflare while preserving caller-supplied CF headers. If the hosting/proxy topology changes, revise this trust rule before enabling header-based IP detection there. No Render deployment was inspected or changed during this implementation; header behavior is based on the platform documentation, and tests model that boundary.

Sources: [Render platform environment variables](https://render.com/docs/environment-variables), [Render environment changes and deployment](https://render.com/docs/configure-environment-variables), [Render edge protection and client IP guidance](https://render.com/articles/how-render-handles-ddos-attacks), [Cloudflare CF-Connecting-IP and X-Forwarded-For semantics](https://developers.cloudflare.com/fundamentals/reference/http-headers/), [Cloudflare origin trust guidance](https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/). Render recommends forwarded client IPs; Cloudflare documents that its edge sets CF-Connecting-IP and may append to an existing X-Forwarded-For. The chosen rule relies on Render's Cloudflare public ingress rather than trusting arbitrary forwarded chains.

## One process and verification

Configuration, rooms and limiter counters apply to **one Node process**. Restarting resets the limiter and loses rooms as before. Multiple instances need shared authoritative room/identity state, a distributed limiter and a compatible Socket.IO routing/adapter design; raising `numInstances` alone is insufficient.

After `npm run build:server`, run `npm run test:limits` for deterministic configuration/override/bounds/malformed input tests, fake-clock expiry/cleanup/storage-bound tests, IP spoofing/normalization tests, room capacity/seat/expiry checks and live HTTP/Socket.IO coverage (ten players on one IP, both transports, quotas, chat, resume and gameplay). These are functional regressions, not load or capacity tests. Existing reconnect, lobby-settings and seat-lifecycle suites intentionally set a higher creation quota because they create many rooms on localhost in one run. Other limits remain enabled.
