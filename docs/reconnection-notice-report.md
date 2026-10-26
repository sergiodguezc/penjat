# Reconnection notice fix

## Cause and behavior

`GameRoom.resume()` stored `reconnectedPlayerName` on the room. `viewFor()` copied it into every recipient snapshot, including resume acknowledgements; `GamePage` rendered it without a timer. Only a later disconnect cleared it. Ordinary game updates and restored sessions therefore kept showing an old success message.

The server now emits `room:player-reconnected` once after a successful transition from reconnecting/away to connected, to the other room members. Already-connected resumes/takeovers and rejected resumes emit nothing. The event contains only the room code and player ID. It is neither stored nor replayed. Both old notification-name fields were removed from `GameRoom` and `PlayerGameView`; `disconnectedPlayerName` had the same stale storage pattern but no UI consumer.

`GamePage` subscribes through `reconnectionNotice.ts` using stable room/player dependencies. A live event shows the existing Catalan/Spanish message for four seconds; a subsequent event replaces the timeout. Snapshots and language changes do not restart it. Transport loss clears it, and cleanup removes both listeners and cancels the timeout. A new subscription starts silently. `AbsenceNotice` still derives genuine warnings from current player statuses. The two-minute grace period and all game rules are unchanged.

Other notices were inspected: absence/scoreboard/rematch warnings derive from current player status. Chat already separates live messages from history and uses a bounded preview timer; no equivalent indefinite reconnection-message bug was found there.

## Verification

- Passed on Node 24: controlled-time notice regressions; CA/ES multiplayer UI, including three-player simultaneous absences and silent restored snapshots; match results; absence, N-player, lifecycle, forgiveness and match domain suites.
- Passed: `npx tsc -b --pretty false`, `npm run build:server` (also checks server types), `npm run lint`, `git diff --check`. Tracked generated server JavaScript was updated and reviewed.
- The TSX CLI cannot create its IPC pipe in this sandbox (`EPERM`); TypeScript tests were run with `TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx <test-file>` instead.
- Live `test:reconnect` and `test:lobby-settings` were attempted but blocked before execution by `listen EPERM` on localhost ports 3221 and 3231. New three-player wire regressions cover recipients, repeated returns, simultaneous absences, no replay to an offline player, takeover and rejected credentials, but still need execution in an environment allowing local sockets.
- No browser suite or client production bundle was run. The remaining verification risk is live server/client event delivery and rendered timer behavior in a browser. No commit, push or deployment was performed.
