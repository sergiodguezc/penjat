import type { ChatMessage, PlayerGameView, PublicPlayer, RoomStatus, RoundStatus } from '../../shared/protocol'

export function continuesChatGroup(previous: ChatMessage | undefined, message: ChatMessage) {
  return Boolean(previous && previous.senderId === message.senderId && message.timestamp - previous.timestamp >= 0 && message.timestamp - previous.timestamp < 120_000)
}

export type MultiplayerPhase = Exclude<RoomStatus, 'active'> | RoundStatus | 'waiting'

export function multiplayerPhase(state: Pick<PlayerGameView, 'roomStatus' | 'round'>): MultiplayerPhase {
  return state.roomStatus === 'active' ? state.round?.status ?? 'waiting' : state.roomStatus
}

/** Seated players the game waits for: connected or reconnecting. Away (disconnected) players keep their seat but are skipped. */
export const isPresent = (player: Pick<PublicPlayer, 'active' | 'connectionState'>) => player.active && player.connectionState !== 'disconnected'

// Reconnecting players remain eligible until the server marks them away.
export function rematchAvailability(state: Pick<PlayerGameView, 'players' | 'match' | 'roomStatus'>) {
  const activeIds = new Set(state.players.filter(isPresent).map((player) => player.id))
  return {
    available: state.roomStatus === 'match-over' && activeIds.size >= 2,
    total: activeIds.size,
    readyIds: state.match.rematchReadyPlayerIds.filter((id) => activeIds.has(id)),
  }
}

/** Whether the chat list should end at the bottom after a messages update: on the first messages, for your own new
 message, and otherwise only if the reader was already at the bottom (new messages from others, reactions). */
export function chatSticksToBottom(previousLastId: string | undefined, last: { id: string; senderId: string } | undefined, selfId: string, pinned: boolean) {
  if (!last) return false
  if (previousLastId === undefined || (last.id !== previousLastId && last.senderId === selfId)) return true
  return pinned
}

export function hasSelectedWord(state: Pick<PlayerGameView, 'privateWord' | 'self' | 'observedPlayer'>) {
  return Boolean(state.privateWord || state.self?.displayWord.length || state.observedPlayer?.displayWord.length)
}
