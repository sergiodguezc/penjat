type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/**
 * Watches the page while a private screen (word entry, a guesser's board, a forgiveness decision) is open.
 * Hidden, unloaded or restored from the back/forward cache → `lock`: the caller stops the clock and returns to the gate.
 * Window blur while still visible (Control Center, a system sheet) → `cover(true)` only; focus removes it, with no new
 * gate. Typing never blurs the window. iOS may still take its app-switcher snapshot before the page repaints: this is
 * best effort, not a guarantee.
 */
export function createPrivacyGuard(doc: Target & { visibilityState: DocumentVisibilityState }, win: Target, { lock, cover }: { lock: () => void; cover: (covered: boolean) => void }) {
  const visibility = () => { if (doc.visibilityState === 'hidden') lock() }
  const pageshow = (event: Event) => { if ((event as PageTransitionEvent).persisted) lock() }
  const blur = () => cover(true)
  const focus = () => cover(false)
  doc.addEventListener('visibilitychange', visibility)
  win.addEventListener('pagehide', lock)
  win.addEventListener('pageshow', pageshow)
  win.addEventListener('blur', blur)
  win.addEventListener('focus', focus)
  return () => {
    doc.removeEventListener('visibilitychange', visibility)
    win.removeEventListener('pagehide', lock)
    win.removeEventListener('pageshow', pageshow)
    win.removeEventListener('blur', blur)
    win.removeEventListener('focus', focus)
  }
}
