import type { Ack, PlayerGameView, RoomSession } from '../../shared/protocol'
import { shouldResumeRoomSession } from './invitations'

/**
 * Room credentials live in localStorage, so a refresh, a reopened tab or a mobile tab the browser discarded can rejoin
 * the same player. Only the server-issued token proves identity; a name and room code never do.
 */
export const ROOM_SESSION_KEY = 'hangman-room-session'
const ROOM_SESSION_VERSION = 1
/** The server no longer knows this player; keeping the credentials would only fail again. */
const DEFINITIVE_RESUME_ERRORS = ['room-not-found', 'resume-rejected']
const ROOM_CODE = /^[A-Z2-9]{5}$/

type StoredRoomSession = RoomSession & { version: number }
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function browserStorage(): SessionStorage | null {
  try { return window.localStorage } catch { return null }
}
/** Before credentials moved to localStorage, the same key held an unversioned session per tab in sessionStorage. */
export function legacyBrowserStorage(): SessionStorage | null {
  try { return window.sessionStorage } catch { return null }
}

const validSession = (value: Partial<RoomSession> | null): RoomSession | null =>
  value && typeof value.roomCode === 'string' && ROOM_CODE.test(value.roomCode) && typeof value.playerId === 'string' && value.playerId
    && typeof value.reconnectToken === 'string' && value.reconnectToken
    ? { roomCode: value.roomCode, playerId: value.playerId, reconnectToken: value.reconnectToken } : null
const read = (storage: SessionStorage | null) => {
  try { return JSON.parse(storage?.getItem(ROOM_SESSION_KEY) ?? 'null') as Partial<StoredRoomSession> | null } catch { return null }
}

/** Credentials stay valid until the player leaves or the server rejects them; there is no client-side expiry. A valid
 legacy sessionStorage session is moved here once when localStorage holds none. */
export function loadRoomSession(storage = browserStorage(), legacy = legacyBrowserStorage()): RoomSession | null {
  const stored = read(storage)
  const current = stored?.version === ROOM_SESSION_VERSION ? validSession(stored) : null
  if (current) return current
  const migrated = validSession(read(legacy))
  if (!migrated) return null
  saveRoomSession(migrated, storage)
  try { legacy?.removeItem(ROOM_SESSION_KEY) } catch { /* kept; it is read only while localStorage has nothing valid */ }
  return migrated
}

export function saveRoomSession(session: RoomSession, storage = browserStorage()) {
  const stored: StoredRoomSession = { version: ROOM_SESSION_VERSION, roomCode: session.roomCode, playerId: session.playerId, reconnectToken: session.reconnectToken }
  try { storage?.setItem(ROOM_SESSION_KEY, JSON.stringify(stored)) } catch { /* the room still works; only reopening cannot rejoin */ }
}

/** Clears both stores, so a legacy copy can never bring a room back after leaving. */
export function clearRoomSession(storage = browserStorage(), legacy = legacyBrowserStorage()) {
  for (const store of [storage, legacy]) try { store?.removeItem(ROOM_SESSION_KEY) } catch { /* nothing stored */ }
}

/** What submitting the entry screen means for the session stored in this browser profile, read at that moment: joining
 the stored room resumes that player (never a second seat), any other room or a new one first asks before giving it up. */
export type EntryAction = { kind: 'create' } | { kind: 'join'; code: string }
export function entryDecision(session: RoomSession | null, action: EntryAction): 'proceed' | 'resume' | 'confirm' {
  if (!session) return 'proceed'
  return action.kind === 'join' && action.code.trim().toUpperCase() === session.roomCode ? 'resume' : 'confirm'
}

export type AbandonSocket = { timeout(ms: number): { emit(event: 'room:abandon', session: RoomSession, ack: (error: Error | null, reply: Parameters<Ack>[0]) => void): unknown } }
/** Gives up a stored seat after the player confirmed it. Resolves `left` once the server removed it (or no longer knows
 it), clearing the credentials only if they are still these; `failed` keeps everything, so nothing is lost. */
export function abandonRoomSession(socket: AbandonSocket, session: RoomSession, timeoutMs: number, storage = browserStorage(), legacy = legacyBrowserStorage()) {
  return new Promise<'left' | 'failed'>((resolve) => {
    socket.timeout(timeoutMs).emit('room:abandon', session, (error, reply) => {
      if (error || (!reply.ok && !DEFINITIVE_RESUME_ERRORS.includes(reply.error))) { resolve('failed'); return }
      if (loadRoomSession(storage, legacy)?.reconnectToken === session.reconnectToken) clearRoomSession(storage, legacy)
      resolve('left')
    })
  })
}

/** `restoring`: a resume is pending or the connection is coming back. `failed`: a temporary failure; the credentials are
 kept and `retry` tries again. `replaced`: another tab or device resumed this player; `left`: another tab gave this seat
 up for another room. Either way this tab waits until asked. */
export type RestoreStatus = 'idle' | 'restoring' | 'failed' | 'replaced' | 'left'

/** What a tab that lost its seat says, from why it lost it and what this profile has stored now: the same seat continues
 elsewhere (`takeover`), the profile is in another seat (`moved`), or it has none (`left`). Only the first two can be
 continued here. */
export function lostSeatNotice(status: 'replaced' | 'left', lostToken: string | null, current: RoomSession | null) {
  if (!current) return 'left' as const
  return status === 'replaced' && current.reconnectToken === lostToken ? 'takeover' as const : 'moved' as const
}

type ResumeReply = Parameters<Ack<PlayerGameView>>[0]
type Listener = (...args: never[]) => void
export type RestoreSocket = {
  readonly connected: boolean
  readonly active: boolean
  readonly id?: string
  connect(): unknown
  disconnect(): unknown
  emit(event: 'room:leave'): unknown
  on(event: 'connect' | 'disconnect' | 'connect_error' | 'room:replaced', listener: Listener): unknown
  off(event: 'connect' | 'disconnect' | 'connect_error' | 'room:replaced', listener: Listener): unknown
  timeout(ms: number): { emit(event: 'room:resume', session: RoomSession, ack: (error: Error | null, reply: ResumeReply) => void): unknown }
}

export type RoomRestorer = {
  /** Resumes when a stored session applies and nothing is pending; safe to call on every connect/visibility/online. */
  resume(): void
  /** The player's retry: also reclaims a replaced tab and restarts a connection stuck in backoff or a silent transport. */
  retry(): void
  /** The player left on purpose: no later reconnection may bring the room back. */
  forget(): void
  /** A room was just created or joined on this connection: earlier failures or a replaced tab no longer apply. */
  reset(): void
  /** The credentials this tab held when another tab took the seat over or gave it up. */
  lostToken(): string | null
  dispose(): void
}

/**
 * The single owner of room restoration: one resume per connection, late replies ignored, credentials cleared only when
 * the server definitively rejects them. Socket.IO's own reconnection brings the transport back; every `connect` resumes.
 */
export function createRoomRestorer({ socket, storage = browserStorage, legacyStorage = legacyBrowserStorage, invitation, timeoutMs, onStatus, onRestored, onInvalid }: {
  socket: RestoreSocket
  storage?: () => SessionStorage | null
  legacyStorage?: () => SessionStorage | null
  /** The invitation in the address bar (null if none): a different room's invitation takes precedence. */
  invitation: () => string | null
  timeoutMs: number
  onStatus: (status: RestoreStatus) => void
  onRestored: (session: RoomSession, view: PlayerGameView) => void
  onInvalid: (error: string) => void
}): RoomRestorer {
  let attempt = 0, pendingSocket: string | null = null, replaced = false, stale = false, disposed = false
  // The connection already identified as the player: further wake-ups on it must not resume (and re-announce) again.
  let resumedSocket: string | null = null
  // The token the player abandoned while its resume was still in flight; a late success is undone at once.
  let forgottenToken: string | null = null
  // The session this tab holds or is restoring. Another tab may store a newer one (or take this one over): leaving here
  // then must not clear credentials that are no longer this tab's.
  let claimed: string | null = null, lost: string | null = null
  const ownsStored = () => { const stored = loadRoomSession(storage(), legacyStorage()); return Boolean(stored && stored.reconnectToken === claimed) }
  const resumable = () => {
    const session = loadRoomSession(storage(), legacyStorage())
    return session && shouldResumeRoomSession(session.roomCode, invitation()) ? session : null
  }
  const resume = () => {
    if (disposed || replaced) return
    const session = resumable()
    if (!session || (socket.connected && resumedSocket === socket.id)) { onStatus('idle'); return }
    claimed = session.reconnectToken
    onStatus('restoring')
    if (!socket.connected) { if (!socket.active) socket.connect(); return }
    if (pendingSocket === socket.id) return
    const current = ++attempt
    pendingSocket = socket.id ?? null
    socket.timeout(timeoutMs).emit('room:resume', session, (error, reply) => {
      if (!error && reply.ok && session.reconnectToken === forgottenToken) { socket.emit('room:leave'); return }
      if (disposed || current !== attempt) return
      pendingSocket = null
      // Leaving, entering another room or following another invitation meanwhile makes this reply irrelevant.
      const now = resumable()
      if (now?.reconnectToken !== session.reconnectToken) { if (!now) onStatus('idle'); return }
      if (error) { stale = true; onStatus('failed'); return }
      if (reply.ok) { stale = false; resumedSocket = socket.id ?? null; onStatus('idle'); onRestored(session, reply.data); return }
      if (DEFINITIVE_RESUME_ERRORS.includes(reply.error)) { clearRoomSession(storage(), legacyStorage()); onStatus('idle'); onInvalid(reply.error); return }
      onStatus('failed')
    })
  }
  const onDisconnect = () => {
    pendingSocket = null; resumedSocket = null; attempt++
    if (!replaced && resumable()) onStatus('restoring')
  }
  const onConnectError = () => { if (!replaced && resumable()) onStatus('failed') }
  const onReplaced = (payload?: { reason?: string }) => {
    replaced = true; lost = claimed; claimed = null; pendingSocket = null; resumedSocket = null; attempt++
    onStatus(payload?.reason === 'left' ? 'left' : 'replaced')
  }
  socket.on('connect', resume)
  socket.on('disconnect', onDisconnect)
  socket.on('connect_error', onConnectError)
  socket.on('room:replaced', onReplaced)
  return {
    resume,
    lostToken: () => lost,
    retry() {
      replaced = false
      if (!resumable()) { onStatus('idle'); return }
      // A connection waiting out its backoff, or one whose reply never came, is restarted rather than reused.
      if (stale || (!socket.connected && socket.active)) { stale = false; pendingSocket = null; attempt++; onStatus('restoring'); socket.disconnect(); socket.connect(); return }
      resume()
    },
    reset() {
      attempt++; pendingSocket = null; resumedSocket = socket.id ?? null; replaced = false; stale = false
      claimed = loadRoomSession(storage(), legacyStorage())?.reconnectToken ?? null; onStatus('idle')
    },
    forget() {
      const mine = ownsStored()
      if (pendingSocket && mine) forgottenToken = claimed
      attempt++; pendingSocket = null; resumedSocket = null; replaced = false; stale = false; claimed = null
      if (mine) clearRoomSession(storage(), legacyStorage())
      onStatus('idle')
    },
    dispose() {
      disposed = true
      socket.off('connect', resume); socket.off('disconnect', onDisconnect); socket.off('connect_error', onConnectError); socket.off('room:replaced', onReplaced)
    },
  }
}
