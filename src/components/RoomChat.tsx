import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChatDiagnostics } from './ChatDiagnostics'
import { debugChat } from '../multiplayer/chatDebug'
import { REACTION_TYPES, type ChatMessage, type ReactionType } from '../../shared/protocol'
import type { MultiplayerTranslations } from '../multiplayer/i18n'
import { errorMessage } from '../multiplayer/i18n'
import { chatSticksToBottom, continuesChatGroup } from '../multiplayer/presentation'
import { playChatSound, unlockChatSound } from '../multiplayer/chatSound'
import { socket } from '../multiplayer/socket'

// Within this distance of the end the reader counts as following the conversation.
const PINNED_DISTANCE = 48

type Props = { messages: ChatMessage[]; currentPlayerId: string; typingPlayers: { playerId: string; playerName: string }[]; t: MultiplayerTranslations; language?: 'ca' | 'es'; draft?: string; onDraftChange?: (text: string) => void; mobileOpen?: boolean; onMobileOpenChange?: (open: boolean) => void; enabled?: boolean; unreadIds?: string[]; olderUnread?: boolean; notification?: ChatMessage | null; onRead?: () => void; onNotificationHandled?: () => void }

export function RoomChat({ messages, currentPlayerId, typingPlayers, t, language = 'ca', draft, onDraftChange, mobileOpen, onMobileOpenChange, enabled = true, unreadIds = [], olderUnread = false, notification, onRead, onNotificationHandled }: Props) {
  const timeFormatter = useMemo(() => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }), [language])
  const [localText, setLocalText] = useState('')
  const text = draft ?? localText
  const setText = (next: string) => { setLocalText(next); onDraftChange?.(next) }
  const textRef = useRef(text)
  textRef.current = text
  const [localOpen, setLocalOpen] = useState(false)
  const open = mobileOpen ?? localOpen
  const setOpen = (next: boolean) => { setLocalOpen(next); onMobileOpenChange?.(next) }
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 62.4375em)').matches)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const keyboardInteraction = useRef(false)
  const titleId = useId()
  useEffect(() => {
    const query = window.matchMedia('(max-width: 62.4375em)')
    const change = () => setMobile(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    if (dialog.open) dialog.close()
    // The inline desktop panel must not steal focus from the game's letter shortcuts.
    if (!mobile) { dialog.open = true; return }
    if (!open) return
    const launcher = launcherRef.current
    const scrollY = window.scrollY
    const bodyStyle = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width, overflow: document.body.style.overflow }
    Object.assign(document.body.style, { position: 'fixed', top: `${-scrollY}px`, width: '100%', overflow: 'hidden' })
    const resize = () => {
      const viewport = window.visualViewport
      dialog.style.setProperty('--chat-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
      dialog.style.setProperty('--chat-viewport-top', `${viewport?.offsetTop ?? 0}px`)
      dialog.style.setProperty('--chat-viewport-left', `${viewport?.offsetLeft ?? 0}px`)
      dialog.style.setProperty('--chat-viewport-width', `${viewport?.width ?? window.innerWidth}px`)
      debugChat('viewport:layout', { height: Math.round(viewport?.height ?? window.innerHeight), top: Math.round(viewport?.offsetTop ?? 0) })
    }
    resize()
    dialog.showModal()
    closeRef.current?.focus({ preventScroll: true })
    window.visualViewport?.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    return () => {
      window.visualViewport?.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
      if (document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) document.activeElement.blur()
      dialog.close()
      Object.assign(document.body.style, bodyStyle)
      window.scrollTo({ top: scrollY, behavior: 'instant' })
      if (keyboardInteraction.current) launcher?.focus({ preventScroll: true })
      else if (document.activeElement === launcher) launcher?.blur()
    }
  }, [mobile, open])
  const [error, setError] = useState('')
  const [soundEnabled, setSoundEnabled] = useState(() => { try { return localStorage.getItem('penjat-chat-sound') === 'on' } catch { return false } })
  const [soundError, setSoundError] = useState(false)
  const soundAttempt = useRef(0)
  const testSound = async () => {
    const attempt = ++soundAttempt.current
    const result = await unlockChatSound()
    if (!alive.current || attempt !== soundAttempt.current || document.visibilityState !== 'visible') return
    const playback = result.ok ? playChatSound(Date.now(), true) : result
    setSoundError(!playback.ok)
    debugChat('audio:test-result', { ok: playback.ok, reason: playback.ok ? 'scheduled' : playback.reason })
  }
  const toggleSound = () => {
    const next = !soundEnabled
    setSoundEnabled(next)
    soundAttempt.current++
    setSoundError(false)
    try { localStorage.setItem('penjat-chat-sound', next ? 'on' : 'off') } catch { /* The preference still works for this visit. */ }
    debugChat('audio:preference', { enabled: next })
    if (next) void testSound()
  }
  const activateSound = () => {
    if (soundEnabled) void unlockChatSound().then((result) => { if (alive.current) setSoundError(!result.ok) })
  }
  const [preview, setPreview] = useState<ChatMessage | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const previewTimer = useRef<number | undefined>(undefined)
  const sectionRef = useRef<HTMLElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const unread = olderUnread ? '•' : unreadIds.length ? String(unreadIds.length) : ''
  const firstUnreadId = unreadIds[0]
  const [openMessageId, setOpenMessageId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const typingTimer = useRef<number | undefined>(undefined)
  const isTyping = useRef(false)
  const composing = useRef(false)
  const alive = useRef(true)
  const pendingReactions = useRef(new Set<string>())
  useEffect(() => { alive.current = true; return () => { alive.current = false; window.clearTimeout(previewTimer.current); previewTimer.current = undefined } }, [])
  const [sending, setSending] = useState(false)
  const [connected, setConnected] = useState(socket.connected)
  useEffect(() => {
    const update = () => setConnected(socket.connected)
    socket.on('connect', update); socket.on('disconnect', update)
    return () => { socket.off('connect', update); socket.off('disconnect', update) }
  }, [])

  const stopTyping = () => { window.clearTimeout(typingTimer.current); typingTimer.current = undefined; if (isTyping.current) { isTyping.current = false; if (socket.connected) socket.emit('chat:typing', { isTyping: false }) } }
  useEffect(() => () => stopTyping(), [])
  useEffect(() => { if (!enabled || (mobile && !open)) stopTyping() }, [enabled, mobile, open])

  // Updated from scroll events, so it always describes the position before the next content update.
  const pinned = useRef(true)
  const lastMessageId = useRef<string | undefined>(undefined)
  const wasVisible = useRef(false)
  const savedScroll = useRef(0)
  const canRead = useCallback(() => {
    if (!enabled || document.visibilityState !== 'visible' || (mobile && !open)) return false
    const modal = document.querySelector('dialog:modal')
    if (modal && modal !== dialogRef.current) return false
    const list = listRef.current
    if (!list || !list.getClientRects().length) return false
    const last = list.querySelector('article:last-child') ?? list
    const rect = last.getBoundingClientRect()
    const viewport = window.visualViewport
    const top = viewport?.offsetTop ?? 0, bottom = top + (viewport?.height ?? window.innerHeight)
    const listRect = list.getBoundingClientRect()
    return rect.bottom <= Math.min(bottom, listRect.bottom) + 1 && rect.bottom > Math.max(top, listRect.top) && rect.right > 0 && rect.left < window.innerWidth
  }, [enabled, mobile, open])
  const readIfVisible = useCallback(() => { if (pinned.current && canRead()) onRead?.() }, [canRead, onRead])
  useLayoutEffect(() => {
    const list = listRef.current
    const visible = !mobile || open
    if (!list || !visible) { wasVisible.current = false; return }
    const last = messages.at(-1)
    if (!wasVisible.current && firstUnreadId) {
      const target = [...list.querySelectorAll<HTMLElement>('article')].find((article) => article.dataset.messageId === firstUnreadId)
      if (target) list.scrollTop += target.getBoundingClientRect().top - list.getBoundingClientRect().top
    } else if (!wasVisible.current && !pinned.current) list.scrollTop = savedScroll.current
    else if (chatSticksToBottom(lastMessageId.current, last, currentPlayerId, pinned.current)) list.scrollTop = list.scrollHeight
    pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight <= PINNED_DISTANCE
    setAtBottom(pinned.current)
    lastMessageId.current = last?.id
    wasVisible.current = true
    readIfVisible()
  }, [messages, currentPlayerId, mobile, open, enabled, firstUnreadId, readIfVisible])
  useEffect(() => {
    const check = () => { if (document.visibilityState !== 'visible') { setPreview(null); soundAttempt.current++ } readIfVisible() }
    document.addEventListener('visibilitychange', check)
    document.addEventListener('scroll', check, true)
    window.addEventListener('resize', check)
    const observer = new IntersectionObserver(check, { threshold: [0, .5, 1] })
    if (listRef.current) observer.observe(listRef.current)
    return () => { document.removeEventListener('visibilitychange', check); document.removeEventListener('scroll', check, true); window.removeEventListener('resize', check); observer.disconnect() }
  }, [mobile, open, enabled, readIfVisible])
  useEffect(() => {
    if (!notification) return
    debugChat('notification:received', { message: notification.id.slice(-6), soundEnabled })
    onNotificationHandled?.()
    if (document.visibilityState === 'visible') setAnnouncement(`${notification.senderName}: ${pinned.current && canRead() ? notification.text : t.newMessages}`)
    const rect = listRef.current?.getBoundingClientRect()
    const readingOlder = !pinned.current && rect && rect.bottom > 0 && rect.top < window.innerHeight
    const reason = !enabled ? 'restoring' : document.visibilityState !== 'visible' ? 'hidden' : (mobile && open) || readingOlder || (pinned.current && canRead()) ? 'reading' : 'eligible'
    debugChat('notification:eligibility', { reason })
    if (reason !== 'eligible') return
    if (soundEnabled) {
      const result = playChatSound()
      debugChat('audio:notification-result', { ok: result.ok, reason: result.ok ? 'scheduled' : result.reason })
      if (!result.ok && result.reason !== 'cooldown') setSoundError(true)
    }
    setPreview(notification)
    if (previewTimer.current === undefined) previewTimer.current = window.setTimeout(() => { setPreview(null); previewTimer.current = undefined }, 5000)
  }, [notification, onNotificationHandled, canRead, mobile, open, enabled, soundEnabled, t.newMessages])
  useEffect(() => { if (mobile && open) setPreview(null) }, [mobile, open])
  const openChat = () => {
    setPreview(null)
    if (mobile) setOpen(true)
    else { sectionRef.current?.scrollIntoView({ block: 'nearest' }); dialogRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }) }
  }
  // The typing indicator and layout changes resize the list: a reader at the end stays there, anyone else keeps their place.
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (list.getClientRects().length && pinned.current) list.scrollTop = list.scrollHeight; readIfVisible() })
    observer.observe(list)
    return () => observer.disconnect()
  }, [mobile, open, enabled, readIfVisible])

  const send = (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (!message || composing.current || sending || !enabled || !socket.connected) return
    setError('')
    setSending(true)
    inputRef.current?.focus({ preventScroll: true })
    socket.timeout(10_000).emit('chat:send', { text: message }, (timedOut, response) => {
      if (!alive.current) return
      setSending(false)
      if (timedOut) { setError(t.chatFailed); return }
      if (!response.ok) setError(errorMessage(response.error, t))
      else { if (textRef.current.trim() === message) setText(''); stopTyping() }
    })
  }

  const reactionLabels: Record<ReactionType, string> = { '❤️': t.reactionHeart, '😂': t.reactionLaugh, '💀': t.reactionSkull }
  const react = (messageId: string, reaction: ReactionType) => {
    debugChat('reaction:activate', { message: messageId.slice(-6), reaction, enabled, connected: socket.connected })
    if (!enabled || !socket.connected) { debugChat('reaction:blocked'); setError(t.reactionFailed); return }
    if (pendingReactions.current.has(messageId)) { debugChat('reaction:pending'); return }
    pendingReactions.current.add(messageId)
    debugChat('reaction:send', { message: messageId.slice(-6), reaction })
    socket.timeout(10_000).emit('chat:react', { messageId, reaction }, (timedOut, response) => {
      debugChat('reaction:ack', { message: messageId.slice(-6), ok: !timedOut && response.ok, error: timedOut ? 'timeout' : response.ok ? '' : response.error })
      pendingReactions.current.delete(messageId)
      if (!alive.current) return
      if (timedOut) setError(t.reactionFailed)
      else if (!response.ok) setError(errorMessage(response.error, t))
    })
  }

  return <section className={`room-chat${messages.length ? '' : ' is-empty'}`} aria-label={t.chatTitle} ref={sectionRef}
    onPointerDownCapture={() => { keyboardInteraction.current = false }} onKeyDownCapture={() => { keyboardInteraction.current = true }}
    onClickCapture={(event) => { if (event.detail === 0) keyboardInteraction.current = true; activateSound() }}>
    <div className={`chat-launcher${unread ? ' has-unread' : ''}`}><button ref={launcherRef} type="button" aria-haspopup={mobile ? 'dialog' : undefined} aria-expanded={mobile ? open : undefined} onClick={openChat}>{t.chatTitle}{unread && <span className="chat-badge" aria-label={`${t.unreadMessages}: ${olderUnread ? t.newMessages : unread}`}>{unread}</span>}</button>
      {preview && <button className="chat-preview" type="button" onClick={openChat}><span><strong>{preview.senderName}:</strong> {preview.text}</span></button>}
    </div>
    <span className="sr-only" role="status">{preview ? `${preview.senderName}: ${t.newMessages}` : ''}</span>
    <dialog ref={dialogRef} className="chat-dialog" open={!mobile} role={mobile ? 'dialog' : 'region'} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); setOpen(false) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') activateSound(); event.stopPropagation() }} onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.target === event.currentTarget && (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right)) setOpen(false)
    }}>
    <header className="chat-heading"><h2 id={titleId} tabIndex={-1}>{t.chatTitle}{unread && <span className="chat-badge" aria-label={t.unreadMessages}>{unread}</span>}</h2><button className="chat-sound" type="button" aria-label={soundEnabled ? t.chatSoundOff : t.chatSoundOn} aria-pressed={soundEnabled} title={soundEnabled ? t.chatSoundOff : t.chatSoundOn} onClick={toggleSound}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z" />{soundEnabled ? <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /> : <path d="m16 9 5 6m0-6-5 6" />}</svg></button><button className="chat-close" ref={closeRef} type="button" aria-label={t.closeChat} onClick={() => setOpen(false)}>×</button></header>
    <span className="sr-only" role="status">{announcement}</span>
    <div className="chat-messages" ref={listRef} aria-label={t.chatTitle} onScroll={(event) => {
      const list = event.currentTarget
      if (mobile && !open) return
      savedScroll.current = list.scrollTop
      pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight <= PINNED_DISTANCE
      setAtBottom(pinned.current)
      readIfVisible()
    }}>
      {!messages.length && <p className="chat-empty">{t.chatEmpty}</p>}
      {messages.map((message, index) => <article key={message.id} data-message-id={message.id} aria-label={message.senderName} className={`${message.senderId === currentPlayerId ? 'own ' : ''}${(message.id !== firstUnreadId && continuesChatGroup(messages[index - 1], message)) ? 'continued ' : ''}${openMessageId === message.id ? 'reactions-open' : ''}`.trim()}>
        {message.id === firstUnreadId && <span className="chat-unread-divider">{t.newMessages}</span>}
        {!(message.id !== firstUnreadId && continuesChatGroup(messages[index - 1], message)) && <div className="chat-message-meta"><strong>{message.senderName}</strong><time dateTime={new Date(message.timestamp).toISOString()}>{timeFormatter.format(message.timestamp)}</time></div>}
        <div className="chat-message-body">
          <p>{message.text}</p>
          <MessageReactions message={message} currentPlayerId={currentPlayerId} t={t} labels={reactionLabels}
            open={openMessageId === message.id} onOpen={(open) => setOpenMessageId(open ? message.id : null)} onReact={react} />
        </div>
      </article>)}
    </div>
    {!atBottom && unread && <button type="button" className="chat-jump" onClick={() => { const list = listRef.current; if (list) list.scrollTop = list.scrollHeight; pinned.current = true; setAtBottom(true); readIfVisible() }}>{t.latestMessages} ↓</button>}
    {typingPlayers.some((player) => player.playerId !== currentPlayerId) && <p className="typing-indicator" role="status">{t.typing.replace('{player}', typingPlayers.filter((player) => player.playerId !== currentPlayerId).map((player) => player.playerName).join(', '))}</p>}
    {soundError && <p className="chat-error" role="alert">{t.chatAudioFailed}</p>}
    <ChatDiagnostics t={t} onTestSound={() => { void testSound() }} />
    <form className="chat-form" onSubmit={send}>
      <input ref={inputRef} value={text} maxLength={300} enterKeyHint="send" onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} aria-label={t.chatPlaceholder}
        placeholder={t.chatPlaceholder} onChange={(event) => { const next = event.target.value; setText(next); window.clearTimeout(typingTimer.current); if (!next.trim()) stopTyping(); else { if (enabled && socket.connected && !isTyping.current) { isTyping.current = true; socket.emit('chat:typing', { isTyping: true }) } typingTimer.current = window.setTimeout(stopTyping, 2000) } }} />
      <button disabled={!text.trim() || sending || !connected || !enabled}>{t.chatSend}</button>
    </form>
    {error && <p className="chat-error" role="alert">{error}</p>}
    </dialog>
  </section>
}

function MessageReactions({ message, currentPlayerId, t, labels, open, onOpen, onReact }: {
  message: ChatMessage; currentPlayerId: string; t: MultiplayerTranslations; labels: Record<ReactionType, string>
  open: boolean; onOpen: (open: boolean) => void; onReact: (messageId: string, reaction: ReactionType) => void
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const picker = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setPortalTarget(root.current?.closest<HTMLElement>('.chat-dialog') ?? null) }, [])
  const previousReactions = useRef(message.reactions)
  useEffect(() => {
    if (previousReactions.current !== message.reactions) debugChat('reaction:rendered', { message: message.id.slice(-6), count: Object.values(message.reactions).reduce((sum, members) => sum + members.length, 0) })
    previousReactions.current = message.reactions
  }, [message.id, message.reactions])
  const [position, setPosition] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!open) return
    debugChat('picker:open', { message: message.id.slice(-6) })
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect()
      const popup = picker.current!.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      setPosition({ left: Math.max(left + 8, Math.min(rect.right - popup.width, left + width - popup.width - 8)), top: rect.bottom + popup.height + 8 < top + height ? rect.bottom + 4 : Math.max(top + 8, rect.top - popup.height - 4) })
    }
    place()
    // Pointer users keep their focus: moving it can cause Safari viewport/scroll events before the next tap.
    if (keyboardOpen.current) picker.current?.querySelector('button')?.focus({ preventScroll: true })
    document.addEventListener('scroll', place, { capture: true, passive: true })
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => { document.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place) }
  }, [open, message.id, portalTarget])
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      const path = event.composedPath()
      if (!path.includes(root.current!) && !path.includes(picker.current!)) {
        debugChat('picker:dismiss', { reason: event.type })
        onOpen(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [open, onOpen])
  const keyboardOpen = useRef(false)
  const toggle = (detail: number) => { keyboardOpen.current = detail === 0; onOpen(!open) }
  const close = () => { onOpen(false); trigger.current?.focus({ preventScroll: true }) }
  const active = REACTION_TYPES.filter((reaction) => message.reactions[reaction].length > 0)
  const overlay = <div ref={picker} id={id} className="reaction-picker" data-chat-part="picker" style={position} role="group" aria-label={t.reactions} hidden={!open}>
      {REACTION_TYPES.map((reaction) => <button type="button" key={reaction} data-chat-part="emoji" aria-label={labels[reaction]}
        aria-pressed={message.reactions[reaction].includes(currentPlayerId)} onClick={() => { onReact(message.id, reaction); close() }}>{reaction}<span>{message.reactions[reaction].length || ''}</span></button>)}
    </div>
  return <div className="message-reactions" ref={root} onKeyDown={(event) => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }}>
    {/* The portal stays inside the native dialog, so it remains interactive while the game is inert. */}
    <button ref={trigger} type="button" className="reaction-trigger" data-chat-part="reaction-trigger" aria-label={t.addReaction.replace('{player}', message.senderName)}
      aria-expanded={open} aria-controls={id} onClick={(event) => toggle(event.detail)}><span aria-hidden="true">☺</span></button>
    {active.length > 0 && <button type="button" className="active-reactions" aria-label={`${t.reactions}: ${active.map((reaction) => `${labels[reaction]} ${message.reactions[reaction].length}${message.reactions[reaction].includes(currentPlayerId) ? `, ${t.you}` : ''}`).join(', ')}`}
      aria-expanded={open} aria-controls={id} onClick={(event) => toggle(event.detail)}>
      {active.map((reaction) => <span key={reaction} className={message.reactions[reaction].includes(currentPlayerId) ? 'selected' : ''}>{reaction} {message.reactions[reaction].length}</span>)}
    </button>}
    {portalTarget ? createPortal(overlay, portalTarget) : overlay}
  </div>
}
