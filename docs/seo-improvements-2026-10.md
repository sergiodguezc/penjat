# Targeted SEO improvements — October 2026

Implemented locally on 26 October 2026, using the installed SEO audit, Ponytail, React and frontend-testing guidance. No commit, push or deployment. Hosting and its established keep-alive mechanism are unchanged.

## Files changed

| Files | Purpose |
|---|---|
| `shared/routing.ts`, `src/routing.ts` | One public-route resolver for server and client; unknown routes return `null`. Existing frontend imports retain their entry point. |
| `shared/notFound.ts`, `src/pages/NotFoundPage.tsx` | Shared Catalan/Spanish not-found copy and a small accessible page with a real home link. |
| `server/server.ts` | Correct HTTP statuses, missing-resource handling and not-found metadata. |
| `src/App.tsx`, `src/components/SiteHeader.tsx` | Render unknown routes without rewriting them to home; remove their canonical/OG URL; preserve guarded history navigation. No navigation item is marked current on the 404. |
| `src/pages/HomePage.tsx`, `src/multiplayer/i18n.ts`, `src/App.css` | Concise localized multiplayer description and instructions link below the existing controls, using existing typography/theme tokens. Homepage branch unchanged. |
| `dist-server/server/server.js`, `dist-server/shared/routing.js`, `dist-server/shared/notFound.js` | Generated server output, rebuilt from source. |
| `tests/seo-test.mjs`, `tests/localization-test.ts` | Extend existing HTTP, metadata, route and localized markup coverage. |
| `scripts/browser-audit-test.mjs`, `scripts/homepage-browser-checks.mjs`, `scripts/history-guard-browser-checks.mjs` | Extend existing browser coverage for 404 recovery, copy/link visibility, themes and guarded navigation to unknown URLs. |
| `docs/architecture.md`, this report | Document the new response contract and verification. |

Existing `.gitignore` changes, `AGENTS.md`, installed skills, `skills-lock.json`, the original audit and unrelated files were preserved. No dependencies were added.

## Root cause and new behavior

The server previously replaced every missing filesystem path with `index.html` and wrote HTTP 200. Independently, the client mapped every unknown pathname to `/` and rewrote browser history to that route. Fixing only the HTTP status would have left the homepage visible at invalid addresses.

Both sides now recognize the same five public routes. Unknown page URLs receive **404 + the app shell**, with localized not-found titles/copy and no canonical or `og:url`. React preserves the unknown address, displays the not-found view and offers a crawlable home link. Returning home restores its normal metadata; Back/Forward can revisit the error page. The language preference works as before: initial server metadata is Catalan, and the browser applies the saved interface language.

Missing assets and unknown API resources receive **404 + plain text**, never the homepage HTML. Missing `.html` page URLs receive the localized app error experience; missing files beneath `/assets/` remain plain resource errors. `/index.html` is also a 404 page rather than another homepage URL. Malformed percent-encoded paths receive 404. Testing also exposed a leading-slash request parsing edge case: origin-form paths starting with `//` now remain paths rather than being interpreted as hostnames.

Preserved contracts:

- All five public pages, slashless/slash-ended variants and supported repeated trailing slashes return 200 with their existing titles, descriptions and canonical conventions.
- Multiplayer invitations retain `?sala=`; legacy `/es` redirects retain their 308 status, destination mapping and query parameters. Unknown legacy destinations redirect as before, then correctly return 404.
- Existing static files retain their MIME types and caching. Hashed assets retain year-long immutable caching; ordinary files/pages retain `no-cache`; room previews retain JSON and `no-store`.
- API previews, health checks, Engine.IO polling and Socket.IO WebSocket connections continue working. Existing unsupported-method handling is preserved. Tested HEAD responses have the appropriate statuses/types and no bodies.
- Room restoration, stored identities, guarded exits and create/join behavior remain intact. The new unknown-history-entry regression checks both Cancel and Confirm, including replacement rather than an extra history entry.

## Exact multiplayer copy

**Catalan description**

> Juga al penjat multijugador online en català o castellà amb 2–10 persones. Crea una sala privada, comparteix el codi i juga amb els amics sense registrar-te.

**Spanish description**

> Juega al ahorcado online en catalán o español con 2–10 personas. Crea una sala privada, comparte el código y juega con amigos sin registrarte.

**Instructions anchors:** “Com es juga al penjat multijugador” / “Cómo jugar al ahorcado multijugador”, both linking to `/com-es-juga` through the existing navigation handler.

The copy appears directly below the create/join panel. Its 34rem maximum width matches the controls. Existing H1s, page titles, descriptions, primary CTA and form order are unchanged. No homepage SEO copy, structured data, hreflang, landing pages or framework changes were introduced.

## Verification results

| Check | Result |
|---|---|
| `npm run build` | Passed: frontend types/Vite and server TypeScript. Final generated output is current. Existing >500 kB bundle warning remains. |
| `npm run lint`; `git diff --check` | Passed, no lint warnings or whitespace errors. |
| `npm run test:seo` | Passed against final build: five pages and aliases, canonical/title/indexability checks, invitations, unknown pages/assets, resource MIME/cache headers, redirects, unsupported methods, health, API previews, polling, WebSocket room creation and HEAD responses. |
| `npm run test:localization` | Passed: shared route recognition, unknown-route cases, CA/ES not-found markup, exact multiplayer copy, help href, control ordering and existing homepage text assertions. |
| `npm run test:navigation`; `npm run test:invitation` | Passed. |
| `npm run test:multiplayer-ui` | Passed, including existing reconnect/readiness and seasonal rendering assertions. |
| `npm run test:reconnect`; `npm run test:connection` | Passed: stored sessions, identity/restoration and connection-race coverage. |
| `npm run test:seasonal` | Passed. |
| `TEST_SERVER_URL=http://127.0.0.1:3004 npm run test:e2e` | Passed: existing N-player integration checks on an isolated local server. |
| `TEST_SERVER_URL=http://127.0.0.1:3004 BIDI_URL=ws://127.0.0.1:9226 npm run test:browser` | Passed against final build using a disposable Firefox profile. Includes new 404/history regressions plus existing create/join, invitations, refresh/reopen, room restoration, learning, daily, dialogs, chat and multiplayer result flows. |
| Sitemap XML and robots | Parsed XML; exactly the five original canonical locations. Robots remains open and points to the sitemap. Files unchanged. |

Sandbox TSX IPC initially failed; the focused tests subsequently passed with local-socket permissions. The first expanded HTTP run exposed the leading-slash parsing issue; the fix and final suite both passed. The final review also retained the existing replace-history behavior for guarded room exits and added its explicit browser regression.

### Rendered QA

The Browser plugin/skill was not listed, so regular Playwright MCP and the repository's existing Firefox BiDi workflow were used without installing browser dependencies. Target: `http://127.0.0.1:3004`; the pre-existing server/tab on port 3002 was not used or stopped.

| Required browser check | Evidence |
|---|---|
| Page identity / meaningful content | Unknown document returns 404 and correct CA/ES title/H1; URL, query and fragment remain intact. Multiplayer H1/title remain correct and explanatory copy is visible in the DOM. |
| Error overlay / runtime health | No framework overlay or JavaScript page errors in targeted Playwright checks; final Firefox suite's console-error assertion passed. Chromium reports the expected failed-resource message for a real 404 document and an existing Apple web-app meta deprecation warning. |
| Interaction | 404 → home → Back → 404 → Forward → home; restored homepage canonical; skip link focuses main; multiplayer help link opens the instructions. Existing suite verifies join reveal/focus, form validation, actual create/join and restoration. |
| Responsive/theme behavior | CA/ES at 320×568, 390×844 and 1440×900 in targeted Playwright checks; Firefox additionally checks 768×1024. Normal and Castanyada copy/link visibility passed. No horizontal overflow; create/join controls remain before the copy and in the first viewport at 390×844. |
| Screenshot review | Inspected the 390px normal/Castanyada multiplayer screenshots; text wraps below the unchanged controls with a clear underlined instructions link. A 390px 404 screenshot was also captured. |

Local review artifacts: [normal multiplayer](/tmp/penjat-seo-multiplayer-none.png), [Castanyada multiplayer](/tmp/penjat-seo-multiplayer-spooky.png), [404](/tmp/penjat-seo-not-found.png). These are temporary files, not committed assets.

## Remaining limits and SEO monitoring

- No deployment or production Google recrawl verification was performed. All five canonical pages remain technically indexable in the local production build; that does not certify Google's current selected canonical or indexed content.
- Physical iPhone/Safari, VoiceOver and real mobile browser chrome were not tested. Chromium/Firefox resized layouts passed; no WebKit/Safari pass is claimed.
- The existing large-bundle warning remains outside this task. No CWV improvement or ranking uplift is claimed.
- After an approved deployment, monitor valid landing URLs for unexpected 404s, public-route fetches/canonicals, invitation/reconnect errors and multiplayer qualified clicks/CTR over comparable periods. More genuine “Not found” entries for invalid URLs can be expected as Google replaces earlier soft-404/homepage responses; that alone is not a regression.
- New explanatory copy is visible after JavaScript rendering, as with existing page content. No claim is made that it has already been crawled by Google.
