# Seasonal presentation

Spooky Season: Edició Castanyada is active **October 26 through November 8, 2026**, inclusive, using the browser clock interpreted in **Europe/Madrid**. The default appearance returns at **00:00 Madrid on November 9**. Open pages recheck at minute boundaries and on focus/visibility changes, so a suspended tab catches up on return. The season never changes room, daily, vocabulary or saved progress state.

## Preview, activate and disable

No configuration is needed for the scheduled production campaign. For local preview:

```sh
VITE_SEASON=spooky npm run dev
```

To inspect the default appearance during the campaign:

```sh
VITE_SEASON=none npm run dev
```

Unset the variable (or use `VITE_SEASON=auto`) to use the schedule. It can also be set in an ignored `.env.local`; restart Vite after changing it. **Overrides are development-only**: production builds always use the schedule, even if `VITE_SEASON` is set while building. There is no persistent user preference or public query parameter. To cancel the campaign in production, remove its entry from `SEASONS` and rebuild the frontend.

With `VITE_SEASON=spooky npm run dev` running, open `/dev/seasonal` to inspect all seven fire states and switch between Catalan and Spanish. This preview is development-only and excluded from the production bundle.

For a production preview outside the campaign, use a disposable browser's simulated clock in the date range. Changing `document.documentElement.dataset.season` to `spooky` in developer tools is a temporary visual inspection only: the scheduler will replace it at the next check.

## Design and ownership

- `src/seasonal/config.ts`: the small dated campaign list and pure Madrid-date resolver. End dates are exclusive. Add a future Christmas campaign here, with its own ID, dates, scoped CSS and ornaments; no gameplay changes are needed. Avoid overlapping campaigns (the first match wins).
- `src/seasonal/runtime.ts`, `src/main.tsx`: apply/remove the document's `data-season` attribute before React renders, refresh it while open, and dispose listeners/timers on development reload.
- `src/seasonal/seasonal.css`: removable surface colors and decoration rules. Plum `#291F30`, deep plum `#211826`, plum surfaces `#382A40`, cream `#F6EBD5`, ember orange `#EF9B58`, moon gold `#F1D18A`. Existing typography, spacing, layout and interactions remain; semantic status colors are adapted for dark surfaces. Stars stay behind opaque reading/play surfaces.
- `src/seasonal/CastanyeraScene.tsx`, `src/seasonal/SeasonalOrnaments.tsx`, `src/components/HangmanDrawing.tsx`, `src/components/MatchResults.tsx`: original React SVG castanyera, chestnuts, roasting pan and six separate flames. Each mistake extinguishes one flame; six mistakes leave cold embers. The woman and atmospheric moon remain visible. All current modes have a six-mistake budget. The ordinary character remains unchanged and is shown outside the season. Compact outcomes use the same seasonal scene. `seasonalErrors` allows the hero to show a full fire and match results to show the last round’s actual mistakes without changing the ordinary preview/verdict poses.
- `src/seasonal/i18n.ts`, `src/pages/HomePage.tsx`: translated seasonal identity and short fire-rule introduction; its heading, layout and multiplayer-first actions are retained. The preview has a leaf ornament, hidden on phones.
- `src/pages/LobbyPage.tsx`: a small decorative chestnut beside the invitation label, without changing the room code or controls. Shared plum surfaces and the castanyera carry the season across multiplayer, daily, learning and match results. No new animation is introduced.
- `src/seasonal/SeasonalPreview.tsx`: development-only gallery of all seven flame states, with CA/ES controls.
- `.env.example`, `package.json`, `tests/seasonal-test.ts`, `tests/character-test.tsx`, `tests/localization-test.ts`: documented preview variable and focused schedule, character and copy checks. Run `npm run test:seasonal`, `test:character`, `test:localization`, `test:multiplayer-ui` and `test:match-results`.
- `docs/seasonal-themes.md`, `docs/development.md`: this file guide, activation instructions and the development documentation link/check command.

The browser clock is the source of calendar time, as for the daily challenge. A wrong device clock can show the wrong season. Background timer throttling can delay the transition until the tab becomes visible again.
