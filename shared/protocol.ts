import type { Language } from './game.js'

export const MAX_ROOM_PLAYERS = 10
export const SUPPORTED_VOLTES = [1, 3, 5] as const
export type Voltes = typeof SUPPORTED_VOLTES[number]
export type RoomStatus = 'waiting' | 'active' | 'match-over' | 'aborted' | 'closed'
export type RoundStatus = 'choosing-word' | 'guessing' | 'round-over'
export type PlayerRoundStatus = 'setter' | 'playing' | 'awaiting-forgiveness' | 'solved' | 'failed' | 'eliminated'
/** `spectating`: back after being skipped (or away when the turn started); watches this turn, plays the next. */
export type PublicPlayerRoundStatus = Exclude<PlayerRoundStatus, 'setter'> | 'setter' | 'spectating'
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'
export type Player = { id: string; name: string; score: number; connectionState: ConnectionState; active: boolean }
export type RoomSession = { roomCode: string; playerId: string; reconnectToken: string }
export type RoomEntry = { view: PlayerGameView; session: RoomSession }
export type RoomPreview = { code: string; gameLanguage: Language; voltes: Voltes; players: number; acceptingPlayers: boolean }
export const REACTION_TYPES = ['❤️', '😂', '💀'] as const
export type ReactionType = typeof REACTION_TYPES[number]
export type MessageReactions = Record<ReactionType, string[]>
export type ChatMessage = { id: string; senderId: string; senderName: string; text: string; timestamp: number; reactions: MessageReactions }
export type ForgivenessRequest = {
  id: string
  roundId: string
  playerId: string
  setterId: string
  status: 'pending' | 'granted' | 'denied' | 'cancelled'
  createdAt: number
  decidedAt: number | null
}

export type PlayerRoundView = {
  playerId: string
  status: PlayerRoundStatus
  guessedLetters: string[]
  wrongLetters: string[]
  errors: number
  displayWord: string[]
  forgiven: boolean
  startedAt: number | null
  finishedAt: number | null
  resolutionTimeMs: number | null
  roundRank: number | null
  /** Out of this turn only because of an absence: waiting for the next turn, not beaten. */
  spectating: boolean
}

export type RoundResultEntry = {
  playerId: string
  position: number | null
  status: 'setter' | 'solved' | 'failed' | 'eliminated'
  forgiven: boolean
  errors: number | null
  resolutionTimeMs: number | null
  pointsAwarded: number
}

export type RoundView = {
  id: string
  number: number
  voltaNumber: number
  setterId: string
  nextSetterId: string | null
  status: RoundStatus
  ranking: string[]
  results: RoundResultEntry[]
}

export type MatchResult = { ranking: string[]; scores: Record<string, number> } | null
export type MatchView = {
  status: RoomStatus
  ownerId: string
  turnOrder: string[]
  turnIndex: number
  voltaNumber: number
  completedTurns: number
  totalTurns: number
  rematchReadyPlayerIds: string[]
}

export type PublicPlayer = Player & { roundStatus: PublicPlayerRoundStatus }

export type PlayerGameView = {
  code: string
  gameLanguage: Language
  voltes: Voltes
  players: PublicPlayer[]
  roomStatus: RoomStatus
  hostId: string | null
  match: MatchView
  round: RoundView | null
  self: PlayerRoundView | null
  observedPlayerId: string | null
  observedPlayer?: PlayerRoundView
  forgivenessRequests: ForgivenessRequest[]
  matchResult: MatchResult
  privateWord?: string
  /** Reconnecting players whose absence blocks progression and whom this recipient may continue without. */
  skippablePlayerIds: string[]
  reconnectedPlayerName?: string
  disconnectedPlayerName?: string
}

export type Ack<T = undefined> = (response: { ok: true; data: T } | { ok: false; error: string }) => void

export interface ClientToServerEvents {
  'room:create': (payload: { name: string; gameLanguage: Language; voltes: Voltes }, ack: Ack<RoomEntry>) => void
  'room:join': (payload: { name: string; code: string }, ack: Ack<RoomEntry>) => void
  'room:resume': (payload: RoomSession, ack: Ack<PlayerGameView>) => void
  'room:start': (ack: Ack) => void
  'round:set-word': (payload: { word: string }, ack: Ack) => void
  'game:guess': (payload: { letter: string }, ack: Ack) => void
  'round:forgiveness': (payload: { requestId: string; forgive: boolean }, ack: Ack) => void
  'round:observe-player': (payload: { playerId: string }, ack: Ack) => void
  'round:continue': (ack: Ack) => void
  'chat:send': (payload: { text: string }, ack: Ack<ChatMessage>) => void
  'chat:react': (payload: { messageId: string; reaction: ReactionType }, ack: Ack<MessageReactions>) => void
  'chat:typing': (payload: { isTyping: boolean }) => void
  'match:rematch': (ack: Ack) => void
  /** Continue without a reconnecting player who blocks progression (host, or whoever would take over their turn). */
  'room:continue-without': (payload: { playerId: string }, ack: Ack) => void
  'room:leave': () => void
}

export interface ServerToClientEvents {
  'room:state': (state: PlayerGameView) => void
  'room:error': (error: string) => void
  /** This connection no longer represents its player: another tab or device resumed the same session. */
  'room:replaced': () => void
  'chat:message': (message: ChatMessage) => void
  'chat:history': (messages: ChatMessage[]) => void
  'chat:reaction-updated': (payload: { messageId: string; reactions: MessageReactions }) => void
  'chat:typing': (payload: { playerId: string; playerName: string; isTyping: boolean }) => void
}
