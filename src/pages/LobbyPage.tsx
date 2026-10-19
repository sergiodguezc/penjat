import { useState } from 'react'
import type { ChatMessage, PlayerGameView } from '../../shared/protocol'
import { MAX_ROOM_PLAYERS } from '../../shared/protocol'
import { RoomChat } from '../components/RoomChat'
import { getLanguageConfig } from '../game/languages'
import { invitationUrl } from '../multiplayer/invitations'
import { multiplayerTranslations } from '../multiplayer/i18n'
import { errorMessage } from '../multiplayer/i18n'
import { socket } from '../multiplayer/socket'
import { isPresent } from '../multiplayer/presentation'
import { AbsenceNotice } from '../components/AbsenceNotice'

export function LobbyPage({ state, interfaceLanguage, messages, playerId, typingPlayers }: { state: PlayerGameView; interfaceLanguage: 'ca' | 'es'; messages: ChatMessage[]; playerId: string; typingPlayers: { playerId: string; playerName: string }[] }) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [startError, setStartError] = useState('')
  const t = multiplayerTranslations[interfaceLanguage]
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.code)
      setCopyStatus('copied')
      window.setTimeout(() => setCopyStatus('idle'), 1500)
    } catch {
      setCopyStatus('failed')
      window.setTimeout(() => setCopyStatus('idle'), 2200)
    }
  }
  const invite = async () => {
    const url = invitationUrl(window.location.origin, state.code)
    const shareData = { title: t.inviteTitle, text: t.inviteText.replace('{code}', state.code), url }
    try {
      if (navigator.share) {
        await navigator.share(shareData)
        return
      }
      await navigator.clipboard.writeText(url)
      setInviteStatus('copied')
      window.setTimeout(() => setInviteStatus('idle'), 1800)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setInviteStatus('failed')
      window.setTimeout(() => setInviteStatus('idle'), 2200)
    }
  }
  const activePlayers = state.players.filter((player) => player.active)
  const canInvite = state.roomStatus === 'waiting' && activePlayers.length < MAX_ROOM_PLAYERS
  const presentPlayers = state.players.filter(isPresent)
  const canStart = state.hostId === playerId && presentPlayers.length >= 2
  const start = () => { setStartError(''); socket.emit('room:start', (response) => { if (!response.ok) setStartError(errorMessage(response.error, t)) }) }
  return <main className="lobby-page" lang={interfaceLanguage}>
    <div className="lobby-layout"><section className="lobby-card">
      <span className="eyebrow">{t.share}</span><div className="room-code">{state.code}</div>
      <button className="copy-button" onClick={copy}>{copyStatus === 'copied' ? t.copied : t.copy}</button>
      {copyStatus === 'failed' && <p className="copy-status" role="alert">{t.copyFailed}</p>}
      {canInvite && <div className="lobby-invite">
        <button className="secondary-action lobby-invite-button" type="button" onClick={invite}>{t.challengeFriend}</button>
        {inviteStatus !== 'idle' && <p role="status">{inviteStatus === 'copied' ? t.inviteCopied : t.inviteFailed}</p>}
      </div>}
      <div className="waiting-pulse"><i /><span>{presentPlayers.length < 2 ? t.waiting : t.waitingToStart}</span></div>
      <AbsenceNotice state={state} t={t} language={interfaceLanguage} onlyWhenBlocking />
      {canStart && <button className="primary-action lobby-start" type="button" onClick={start}>{t.startMatch}</button>}
      {startError && <p className="form-error" role="alert">{startError}</p>}
      <div className="lobby-meta"><span>{getLanguageConfig(state.gameLanguage).name}</span><span>{t.voltes}: {state.voltes}</span><span>{activePlayers.length} / {MAX_ROOM_PLAYERS} {t.players}</span></div>
      <ul className="player-list">{state.players.map((player) => <li key={player.id} className={player.active ? '' : 'player-departed'}><span>{player.name.charAt(0)}</span>{player.name}{player.id === state.hostId && <small>{t.host}</small>}{player.active && player.connectionState !== 'connected' && <small>{player.connectionState === 'reconnecting' ? t.statusReconnecting : t.statusDisconnected}</small>}</li>)}</ul>
    </section><RoomChat messages={messages} currentPlayerId={playerId} typingPlayers={typingPlayers} t={t} /></div>
  </main>
}
