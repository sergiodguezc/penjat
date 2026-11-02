/** Longest single segment counted. The interface flushes at least every `HEARTBEAT_MS` while a board is open, so a longer
 gap means the page was suspended without a visibility event (iOS can freeze a page); that time is not play time. */
export const MAX_SEGMENT_MS = 10_000
/** How often an open board flushes, bounding what an unexpected process kill can lose. */
export const HEARTBEAT_MS = 2_000

/**
 * One guesser's active time while their board is unlocked. Memory only: a restored page has a stopped clock until the
 * player unlocks their gate again, and time with the page hidden or closed is never measured. Each flush hands over the
 * milliseconds since the previous one exactly once, for the match to add to the guesser's durable `activeMs`.
 */
export function createTurnClock(now: () => number = () => performance.now()) {
  let since: number | null = null
  const take = (keepRunning: boolean) => {
    if (since === null) return 0
    const at = now()
    const elapsed = Math.min(MAX_SEGMENT_MS, Math.max(0, at - since))
    since = keepRunning ? at : null
    return elapsed
  }
  return {
    get running() { return since !== null },
    /** Starting a running clock does nothing, so a repeated unlock cannot drop or double time. */
    start() { if (since === null) since = now() },
    flush: () => take(true),
    stop: () => take(false),
  }
}
