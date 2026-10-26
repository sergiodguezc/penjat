import type { ChatMessage } from '../../shared/protocol'

export type ChatInbox = {
  key: string
  messages: ChatMessage[]
  knownIds: string[]
  unreadIds: string[]
  olderUnread: boolean
  baseline: boolean
  notification: ChatMessage | null
}

export const chatInboxStorageKey = (key: string) => `penjat-chat-inbox:${key}`

export function emptyChatInbox(key = '', saved?: unknown): ChatInbox {
  const value = saved as Partial<ChatInbox> | null
  const valid = value && Array.isArray(value.knownIds) && value.knownIds.length <= 50 && value.knownIds.every((id) => typeof id === 'string')
    && Array.isArray(value.unreadIds) && value.unreadIds.length <= 50 && value.unreadIds.every((id) => typeof id === 'string' && value.knownIds!.includes(id)) && typeof value.olderUnread === 'boolean'
  return { key, messages: [], knownIds: valid ? value.knownIds! : [], unreadIds: valid ? value.unreadIds! : [], olderUnread: valid ? value.olderUnread! : false, baseline: Boolean(valid), notification: null }
}

function retain(inbox: ChatInbox, messages: ChatMessage[], unreadIds: string[], olderUnread: boolean): ChatInbox {
  const retained = messages.slice(-50)
  const knownIds = retained.map((message) => message.id)
  return { ...inbox, messages: retained, knownIds, unreadIds: unreadIds.filter((id) => knownIds.includes(id)), olderUnread: olderUnread || unreadIds.some((id) => !knownIds.includes(id)), baseline: true }
}

export function receiveChatHistory(inbox: ChatInbox, history: ChatMessage[], selfId: string): ChatInbox {
  const unique = history.filter((message, index) => history.findIndex((other) => other.id === message.id) === index)
  const missed = inbox.baseline ? unique.filter((message) => !inbox.knownIds.includes(message.id) && message.senderId !== selfId).map((message) => message.id) : []
  // Without an overlap, the bounded server history cannot tell us how many messages were missed.
  const gap = inbox.baseline && inbox.knownIds.length > 0 && unique.length >= 50 && !unique.some((message) => inbox.knownIds.includes(message.id))
  return { ...retain(inbox, unique, [...new Set([...inbox.unreadIds, ...missed])], inbox.olderUnread || gap), notification: null }
}

export function receiveChatMessage(inbox: ChatInbox, message: ChatMessage, selfId: string): ChatInbox {
  if (inbox.knownIds.includes(message.id)) return inbox
  const other = message.senderId !== selfId
  return { ...retain(inbox, [...inbox.messages, message], other ? [...inbox.unreadIds, message.id] : inbox.unreadIds, inbox.olderUnread), notification: other ? message : null }
}

export function readChatInbox(inbox: ChatInbox): ChatInbox {
  return inbox.unreadIds.length || inbox.olderUnread ? { ...inbox, unreadIds: [], olderUnread: false } : inbox
}
