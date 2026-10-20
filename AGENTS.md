# Penjat

Catalan hangman with Catalan/Spanish interfaces, vocabulary learning, a persistent daily challenge, and private 2–10-player Socket.IO matches. Preserve gameplay and visual design unless the task changes them.

## Map

- `src/main.tsx` → `src/App.tsx`: React entry, History API routing, navigation and room restoration. Pages own UI state; components render reusable boards, results and controls.
- `src/learning/`, `src/daily/`: client game rules; `data/vocabulary.json` is bundled offline vocabulary.
- `server/server.ts`: Node HTTP/Socket.IO boundary. `server/game/GameManager.ts` owns identities/rooms; `GameRoom.ts` owns authoritative gameplay.
- `shared/game.ts` and `shared/protocol.ts`: matching rules and typed wire contract.
- Read [architecture](docs/architecture.md), [development](docs/development.md), or [gameplay contracts](docs/gameplay-contracts.md) as relevant. For corpus work also read [vocabulary v1](docs/vocabulary-v1.md) and [data workflow](data/README.md).

## Commands

Use Node 22 (>=22.12), npm and Python 3 for offline vocabulary checks.

- Install: `npm ci` (lockfile) or `npm install`.
- Full-stack dev: `npm run dev`; separate: `npm run dev:vite-only` and `npm run dev:server`. `dev:client` also starts both.
- Build: `npm run build`; production locally: `npm start`. `npm run preview` previews only the frontend.
- Lint: `npm run lint`. Type check: `npx tsc -b --pretty false` and `npx tsc -p server/tsconfig.json --noEmit` (also checked by build).
- Client/domain: `npm run test:learning`, `test:vocabulary`, `test:daily`, `test:invitation`, `test:localization`, `test:navigation`, `test:character`, `test:multiplayer-ui`, `test:match-results`.
- Backend: build server first, then `npm run test:game`, `test:chat`, `test:lifecycle`, `test:match`, `test:n-player`, `test:absence`, `test:reconnect`, `test:lobby-settings`.
- Integration: `TEST_SERVER_URL=http://127.0.0.1:3002 npm run test:e2e` with a dedicated local server. `npm run test:seo` starts its own server after a full build.
- Browser navigation/storage regressions: `npm run test:browser` with dedicated Firefox BiDi and a local built server; setup is in development docs. No additional npm dependency.
- Corpus: `npm run test:vocab` and `npm run vocab:validate` (offline). Do not regenerate or run paid enrichment just to validate a UI fix.

## Conventions and constraints

- TypeScript ES modules, function components/hooks, PascalCase component files, camelCase functions. Follow surrounding compact formatting; no broad formatting changes. Server imports use `.js` for compiled Node execution; frontend imports use bundler resolution. Use type-only imports for types.
- Keep domain calculations in pure helpers where practical; multiplayer score/phase mutations belong on the server. Use `PlayerGameView`, not private server state, in UI.
- Styling: use the semantic type/space/radius tokens in `src/index.css` (Georgia `--font-display` for brand/outcomes/words, self-hosted `--font-ui` for functional UI) and em-based breakpoints; avoid literal font sizes and a global `min-width`. See [architecture](docs/architecture.md#styling-and-typography).
- Server rejects invalid actions with error codes via typed acknowledgements; UI translates them. Keep Catalan and Spanish copy in sync in subsystem translation modules. Game language and interface language are independent.
- Tests use Node assertions, TSX/static React markup, and Python unittest. Most server tests import **generated `dist-server`**, so rebuild before running them. Generated server files are tracked: review source and generated diffs together.
- Preserve recipient-specific word/forgiveness privacy; scoring once per completed round; setter rotation through the original roster while skipping departed and away players; token identity; retained seats (a disconnected player keeps their seat until an explicit leave or room expiry, and the game stops waiting for them after the 2-minute absence grace period, or sooner when a permitted player continues without a blocking one). See contracts for precise scoring, absence and departure rules.
- Preserve daily date/ID/pool ordering and stored guess replay. Learning CEFR filtering uses linguistic metadata, not game difficulty. Preserve vocabulary IDs and reviewed lexical fields.

## Working sessions

Inspect the relevant code/tests first. Preserve unrelated work; add focused regressions for fixes, run relevant checks, and document behavior changes. Do not require every task to read all docs or run all suites. Do not deploy, commit or push unless requested. Record unresolved evidence in a task report, not permanent global instructions.
