// Opt-in, memory-only diagnostics. Never include chat text, names or room/session credentials.
export const chatDebugEnabled = Boolean(import.meta.env?.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('chatDebug') === '1')
let lines: string[] = []
const listeners = new Set<() => void>()
export function debugChat(event: string, details: Record<string, string | number | boolean | null> = {}) {
  if (!chatDebugEnabled) return
  lines = [...lines.slice(-79), `${new Date().toISOString().slice(11, 23)} ${event} ${JSON.stringify(details)}`]
  listeners.forEach((listener) => listener())
}
export const chatDebugSnapshot = () => lines
export const subscribeChatDebug = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function clearChatDebug() { lines = []; listeners.forEach((listener) => listener()) }
