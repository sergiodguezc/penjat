# Multiplayer chat release report

2026-10-26. Local release verification complete. The user confirmed the final mobile experience on a physical iPhone running Safari. No push or deployment is authorized.

## Release scope

- Compact conversations: consecutive messages from one player within two minutes share sender/time metadata; own messages remain distinct. Long text wraps without horizontal overflow.
- Contained 32px reaction actions do not inflate short messages or overlap adjacent targets. The three-option picker has 44px buttons and is portaled inside the native chat dialog, outside transcript scrolling/clipping ancestors. Native click sends one authoritative toggle; scrolling/resizing repositions the picker instead of removing its target during a tap.
- Desktop chat remains an inline panel and does not steal focus from gameplay. Mobile chat fills the available VisualViewport, with a fixed-size header/composer and a flexible transcript. Drafts survive closing, resizing, reconnecting and lobby/game transitions.
- A compact fixed rail displays unread counts and one truncated sender/message preview. Its space is allocated outside the game scroller; result actions sit above it. A five-second preview coalesces bursts without extending indefinitely.
- Initial history is silent. Live messages are deduplicated by ID; room/player-scoped known/unread IDs survive refresh in session storage. Reconnect history adds missed unread messages without replaying alerts. A missing overlap with the bounded 50-message history uses a general indicator instead of an inaccurate count.
- Read state requires the visible document, a visible latest bubble, following the transcript end and no other blocking modal. Reading older messages preserves position and offers a jump control. Own messages, reactions and typing do not notify.
- Optional sound is off by default. Gesture-backed activation plays a confirmation; eligible incoming messages use a short two-note cue with an eight-second cooldown. Unsupported, rejected or timed-out audio activation reports a localized error. No notification queues delayed audio for tab return.
- Catalan/Spanish translations, keyboard/assistive focus, reduced-motion behavior, standard colors and Castanyada tokens are preserved.

No server, wire-protocol, vocabulary, dependency or lockfile changes. Generated tracked server output is unchanged after the full production build.

## Corrections and review findings

The original iPhone reaction cause was not conclusively captured on-device. The confirmed cancellation mechanism was dismissal on captured scroll/resize before native click; the nested picker also risked Safari clipping/hit-testing. Those paths were removed, touch ordering is covered automatically, and the user confirmed working reactions on the phone.

A CSS selector for every launcher button had overridden preview styling. The preview now has its own shrinking, borderless single-line treatment. Partial-sheet viewport subtraction and shrinking header/composer were replaced by full available-viewport sizing.

The supplied `visual-bug.PNG` showed a clipped game, empty band above the launcher and persistent yellow focus. An absolutely positioned announcement span escaped the internal scroller and enlarged the outer document; the body also retained a legacy `100vh` minimum while the room used `100dvh`. The mobile chat section now contains that span, and the body uses the same dynamic viewport with outer scrolling disabled. The game remains internally scrollable. Touch closing releases launcher focus; keyboard/assistive activation restores visible focus.

The release review found and fixed a desktop focus regression: `dialog.show()` focused the inline chat on mount and swallowed physical letter shortcuts. Desktop now sets the nonmodal open state without transferring focus. Four-player and ten-player browser matches verify gameplay, scoring, chat and rematches.

Existing browser checks were updated for the approved mobile rail and internal result-page scroller. Rank contrast is measured against the rank disc's actual background, rather than its row. Firefox 158 may reject a history traversal immediately undone by the exit guard; the harness tolerates only that specific timeout with a visible confirmation dialog, while retaining the URL, game-state, Cancel and Confirm assertions.

## Production diagnostics and repository hygiene

The development-only `?chatDebug=1` mode is intentionally retained for future device investigations. It uses a bounded 80-line memory buffer and excludes chat contents, player names, room codes and session credentials; it sends no logs externally.

Verified on the optimized production build:

- The diagnostics component, event logger and instrumentation labels such as `diagnostics:ready` and `reaction:activate` are eliminated from JavaScript. Localization labels and inert CSS may remain.
- The populated production chat has no diagnostics UI even when loaded with `?chatDebug=1`; this is an explicit browser regression assertion.
- No test audio overrides, fixture bots, debug console statements, screenshots, temporary scripts or private network addresses were added to application source.

Temporary runners, logs and screenshots remain under `/tmp/penjat-release-validation/`, `/tmp/penjat-chat-validation/`, `/tmp/penjat-phase-2d-multiplayer/`, `/tmp/penjat-p0-validation/`, `/tmp/penjat-phase-2a-validation/` and `/tmp/penjat-release-browser-artifacts/`. They are excluded from the release commit. Pre-existing `.agents/` and `skills-lock.json` are unrelated and remain uncommitted.

## Final verification

Node 24.22.1. Tests used the final production build and dedicated local servers/disposable browser profiles.

| Checks | Result |
| --- | --- |
| Full `npm run build` (client, TypeScript project builds and generated server) | Passed |
| `npm run lint` | Passed without warnings |
| Learning, vocabulary contract, daily, invitation, localization, navigation, character and seasonal checks | Passed |
| Multiplayer UI, match-results, chat inbox and sound assertions | Passed |
| Game/forgiveness, chat, lifecycle, match, N-player and absence regressions | Passed |
| Connection, reconnect/session-restoration and lobby-settings integration checks | Passed |
| SEO checks with their production server | Passed |
| Socket.IO E2E suite | Passed |
| Focused production chat browser suite | Passed at 320×568, 390×844, 768×1024, 1100×800 and 1440×900 |
| Four-player and ten-player multiplayer browser matches | Passed |
| Full browser audit: navigation/history guards, headers, invitations, storage/room restoration, learning, dialogs, touch reactions, responsive boundaries, terminal matches and real three-player results/rematch flow | Passed |
| Production diagnostics opt-in rejection | Passed |
| Whitespace checks and generated server diff | Clean |

The chat suite includes long-content/outer-scroll regressions, touch versus keyboard focus, scroll/resize during pointer-down, non-overlapping compact targets, picker edges, both themes, unread catch-up, drafts, simulated keyboard viewport changes, audio confirmation/delivery, cooldown and mute.

Production Chromium inspection also checked both themes: message text contrast 13.98:1 standard / 14.48:1 Castanyada; unread badge contrast 10.57:1 standard / 10.67:1 Castanyada. Screenshots confirm the full-screen mobile conversation. Earlier geometry checks covered 320×568, 393×680, 393×852, 430×932, 768×1024 and 852×393 with no extra document height, outer scroll or gap above the rail, and all letter rows reachable.

## Remaining limits

No known release-blocking type, lint, test or build failures remain. Vite still reports the pre-existing main-chunk warning (>500 kB); the bundle includes offline vocabulary, and no unrelated bundle restructuring is included here.

The user supplied real iPhone Safari confirmation; agent browser tests are desktop engines with touch/viewport simulation, not a substitute for that device evidence. Desktop Safari and VoiceOver were not independently revalidated during this release run. Audio still depends on browser/device output policy, with visible failure handling and silent visual-notification fallback. Server chat remains bounded to 50 messages and memory-only, as before.
