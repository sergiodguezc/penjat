import { useCallback, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/protocol'
import { chatInboxStorageKey, emptyChatInbox, readChatInbox, receiveChatHistory, receiveChatMessage, type ChatInbox } from './chatInbox'
import { debugChat } from './chatDebug'
import { loadRoomSession } from './roomSession'

// Socket callbacks update the ref synchronously: a history/live pair in one packet batch sees one baseline.
export function useChatInbox() {
  const current = useRef(emptyChatInbox())
  const [state, setState] = useState(current.current)
  const commit = useCallback((next: ChatInbox) => {
    if (next === current.current) return
    current.current = next
    setState(next)
    if (next.key && next.baseline) {
      try { sessionStorage.setItem(chatInboxStorageKey(next.key), JSON.stringify({ knownIds: next.knownIds, unreadIds: next.unreadIds, olderUnread: next.olderUnread })) } catch { /* Storage can be unavailable in private browsing. */ }
    }
  }, [])
  const sessionInbox = useCallback(() => {
    const session = loadRoomSession()
    if (!session) return null
    const key = `${session.roomCode}:${session.playerId}`
    if (current.current.key !== key) {
      let saved: unknown
      try { saved = JSON.parse(sessionStorage.getItem(chatInboxStorageKey(key)) ?? 'null') } catch { /* A fresh baseline is safe for malformed storage. */ }
      current.current = emptyChatInbox(key, saved)
    }
    return { inbox: current.current, selfId: session.playerId }
  }, [])
  const history = useCallback((messages: ChatMessage[]) => {
    const session = sessionInbox()
    if (session) commit(receiveChatHistory(session.inbox, messages, session.selfId))
  }, [commit, sessionInbox])
  const message = useCallback((message: ChatMessage) => {
    const session = sessionInbox()
    if (session) commit(receiveChatMessage(session.inbox, message, session.selfId))
  }, [commit, sessionInbox])
  const reaction = useCallback(({ messageId, reactions }: { messageId: string; reactions: ChatMessage['reactions'] }) => {
    debugChat('reaction:broadcast', { message: messageId.slice(-6), count: Object.values(reactions).reduce((sum, members) => sum + members.length, 0) })
    const inbox = current.current
    if (inbox.messages.some((message) => message.id === messageId)) commit({ ...inbox, messages: inbox.messages.map((message) => message.id === messageId ? { ...message, reactions } : message) })
  }, [commit])
  const markRead = useCallback(() => { if (document.visibilityState === 'visible') commit(readChatInbox(current.current)) }, [commit])
  const notificationHandled = useCallback(() => { if (current.current.notification) commit({ ...current.current, notification: null }) }, [commit])
  const reset = useCallback(() => commit(emptyChatInbox()), [commit])
  return { state, history, message, reaction, markRead, notificationHandled, reset }
}
