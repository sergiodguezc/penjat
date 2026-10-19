import { useState } from 'react'
import type { Language } from '../../shared/game'
import type { PlayerGameView } from '../../shared/protocol'
import { errorMessage, type MultiplayerTranslations } from '../multiplayer/i18n'
import { listNames } from '../multiplayer/matchResults'
import { socket } from '../multiplayer/socket'

/** Who lost the connection, and — only where their absence blocks the room and this player may decide — a way to go on
 without them. The server applies the away handling and still refuses if they came back meanwhile. */
export function AbsenceNotice({ state, t, language, onlyWhenBlocking = false }: { state: PlayerGameView; t: MultiplayerTranslations; language: Language; onlyWhenBlocking?: boolean }) {
  const [error, setError] = useState('')
  const reconnecting = state.players.filter((player) => player.active && player.connectionState === 'reconnecting')
  const skippable = (state.skippablePlayerIds ?? []).map((id) => reconnecting.find((player) => player.id === id)).filter((player) => player !== undefined)
  if (!reconnecting.length || (onlyWhenBlocking && !skippable.length)) return null
  const continueWithout = (playerId: string) => {
    setError('')
    socket.emit('room:continue-without', { playerId }, (response) => { if (!response.ok) setError(errorMessage(response.error, t)) })
  }
  return <div className="connection-notice absence-notice" role="status">
    {t.playersReconnecting(listNames(reconnecting.map((player) => player.name), language), reconnecting.length)}
    {skippable.map((player) => <button key={player.id} type="button" className="text-button" onClick={() => continueWithout(player.id)}>{t.continueWithout(player.name)}</button>)}
    {error && <span className="absence-error"> {error}</span>}
  </div>
}
