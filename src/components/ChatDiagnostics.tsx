import { useEffect, useSyncExternalStore } from 'react'
import { chatDebugEnabled, chatDebugSnapshot, clearChatDebug, debugChat, subscribeChatDebug } from '../multiplayer/chatDebug'
import type { MultiplayerTranslations } from '../multiplayer/i18n'

export function ChatDiagnostics({ t, onTestSound }: { t: MultiplayerTranslations; onTestSound: () => void }) {
  const lines = useSyncExternalStore(subscribeChatDebug, chatDebugSnapshot, chatDebugSnapshot)
  useEffect(() => {
    if (!chatDebugEnabled) return
    const part = (target: EventTarget | null) => target instanceof Element ? target.closest('[data-chat-part]')?.getAttribute('data-chat-part') ?? target.tagName.toLowerCase() : 'viewport'
    const record = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.chat-debug')) return
      if (!['scroll', 'resize'].includes(event.type) && (!(target instanceof Element) || !target.closest('.room-chat, .reaction-picker'))) return
      const point = event instanceof PointerEvent || event instanceof MouseEvent ? event : 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : null
      debugChat(`event:${event.type}`, { target: part(target), hit: point ? part(document.elementFromPoint(point.clientX, point.clientY)) : '-', trusted: event.isTrusted })
    }
    const events = ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click', 'focusin', 'focusout', 'scroll']
    events.forEach((type) => document.addEventListener(type, record, { capture: true, passive: true }))
    window.visualViewport?.addEventListener('resize', record)
    debugChat('diagnostics:ready')
    return () => { events.forEach((type) => document.removeEventListener(type, record, true)); window.visualViewport?.removeEventListener('resize', record) }
  }, [])
  if (!chatDebugEnabled) return null
  return <details className="chat-debug"><summary>{t.chatDebugTitle}</summary>
    <div><button type="button" onClick={onTestSound}>{t.chatTestSound}</button><button type="button" onClick={clearChatDebug}>{t.chatDebugClear}</button></div>
    <pre tabIndex={0} aria-label={t.chatDebugTitle}>{lines.join('\n')}</pre>
  </details>
}
