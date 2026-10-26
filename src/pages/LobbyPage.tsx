import { useEffect, useState, type ReactNode } from 'react'
import type { ChatMessage, PlayerGameView, RoomSettings } from '../../shared/protocol'
import { MAX_ROOM_PLAYERS, SUPPORTED_VOLTES } from '../../shared/protocol'
import { LanguageSelector } from '../components/LanguageSelector'
import { Modal } from '../components/Modal'
import { RoomChat } from '../components/RoomChat'
import { invitationUrl } from '../multiplayer/invitations'
import { multiplayerTranslations } from '../multiplayer/i18n'
import { errorMessage, type MultiplayerTranslations } from '../multiplayer/i18n'
import { REQUEST_TIMEOUT_MS, socket } from '../multiplayer/socket'
import { isPresent } from '../multiplayer/presentation'
import { AbsenceNotice } from '../components/AbsenceNotice'
import { ChestnutEmblem } from '../seasonal/SeasonalOrnaments'

export function LobbyPage({ state, interfaceLanguage, messages, playerId, typingPlayers, chat }: { state: PlayerGameView; interfaceLanguage: 'ca' | 'es'; chat?: ReactNode; messages: ChatMessage[]; playerId: string; typingPlayers: { playerId: string; playerName: string }[] }) {
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
  const isHost = state.hostId === playerId
  const canStart = isHost && presentPlayers.length >= 2
  const hostName = state.players.find((player) => player.id === state.hostId)?.name ?? ''
  const start = () => { setStartError(''); socket.emit('room:start', (response) => { if (!response.ok) setStartError(errorMessage(response.error, t)) }) }
  return <main className="lobby-page" lang={interfaceLanguage}>
    <div className="lobby-layout"><section className="lobby-card">
      <span className="eyebrow"><svg className="spooky-only lobby-season-lantern" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><ChestnutEmblem /></svg>{t.share}</span><div className="room-code">{state.code}</div>
      <button className="copy-button" onClick={copy}>{copyStatus === 'copied' ? t.copied : t.copy}</button>
      {copyStatus === 'failed' && <p className="copy-status" role="alert">{t.copyFailed}</p>}
      {canInvite && <div className="lobby-invite">
        <button className="secondary-action lobby-invite-button" type="button" onClick={invite}>{t.challengeFriend}</button>
        {inviteStatus !== 'idle' && <p role="status">{inviteStatus === 'copied' ? t.inviteCopied : t.inviteFailed}</p>}
      </div>}
      <LobbySettings state={state} isHost={isHost} t={t} />
      <div className="waiting-pulse"><i /><span>{presentPlayers.length < 2 ? t.waiting : isHost ? t.waitingToStart : t.waitingForHost(hostName)}</span></div>
      <AbsenceNotice state={state} t={t} language={interfaceLanguage} onlyWhenBlocking />
      {canStart && <button className="primary-action lobby-start" type="button" onClick={start}>{t.startMatch}</button>}
      {startError && <p className="form-error" role="alert">{startError}</p>}
      <div className="lobby-meta"><span>{activePlayers.length} / {MAX_ROOM_PLAYERS} {t.players}</span></div>
      <ul className="player-list">{state.players.map((player) => <li key={player.id} className={player.active ? '' : 'player-departed'}><span>{player.name.charAt(0)}</span>{player.name}{player.id === state.hostId && <small>{t.host}</small>}{player.active && player.connectionState !== 'connected' && <small>{player.connectionState === 'reconnecting' ? t.statusReconnecting : t.statusDisconnected}</small>}</li>)}</ul>
    </section>{chat ?? <RoomChat messages={messages} currentPlayerId={playerId} typingPlayers={typingPlayers} t={t} language={interfaceLanguage} />}</div>
  </main>
}

/** The match rules everyone will play with, as a compact summary. Only the current host sees "Configura", which opens a
 dialog with the language and rounds controls; each change is confirmed by the server and reaches every member at once.
 The dialog closes itself if the host role moves to someone else. */
function LobbySettings({ state, isHost, t }: { state: PlayerGameView; isHost: boolean; t: MultiplayerTranslations }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const editing = open && isHost
  // Losing the host role (transfer while away) closes the dialog for good, so it never reopens if the role comes back.
  useEffect(() => { if (!isHost) { setOpen(false); setError('') } }, [isHost])
  const update = (settings: Partial<RoomSettings>) => {
    if (pending) return
    setPending(true); setError('')
    socket.timeout(REQUEST_TIMEOUT_MS).emit('room:update-settings', settings, (timedOut, response) => {
      setPending(false)
      if (timedOut) setError(errorMessage('connect_error', t))
      else if (!response.ok) setError(['not-host', 'match-started', 'player-reconnecting'].includes(response.error) ? t.settingsUnavailable : errorMessage(response.error, t))
    })
  }
  const close = () => { setOpen(false); setError('') }
  return <section className="invitation-rules lobby-rules" aria-labelledby="lobby-rules-title">
    <div className="lobby-rules-head">
      <h2 id="lobby-rules-title">{t.invitationRules}</h2>
      {isHost && <button type="button" className="secondary-action lobby-rules-configure" aria-haspopup="dialog"
        // Focus first (taps in Safari do not), so closing the dialog returns focus here.
        onClick={(event) => { event.currentTarget.focus(); setOpen(true) }}>{t.configure}</button>}
    </div>
    <ul className="lobby-rules-pills" aria-live="polite">
      <li>{t.languagePill(state.gameLanguage)}</li>
      <li>{t.roundsPill(state.voltes)}</li>
    </ul>
    {editing && <Modal className="lobby-settings-dialog" labelledBy="lobby-settings-title" describedBy="lobby-settings-note" onCancel={close}>
      <h2 id="lobby-settings-title">{t.invitationRules}</h2>
      <p id="lobby-settings-note">{t.settingsHostNote}</p>
      <fieldset className="lobby-rules-controls" disabled={pending} aria-busy={pending}>
        <legend className="sr-only">{t.invitationRules}</legend>
        <div className="language-field"><span aria-hidden="true">{t.gameLanguage}</span>
          <LanguageSelector language={state.gameLanguage} label={t.gameLanguage} onChange={(gameLanguage) => { if (gameLanguage !== state.gameLanguage) update({ gameLanguage }) }} /></div>
        <fieldset className="target-selector"><legend>{t.voltes}</legend><div>
          {SUPPORTED_VOLTES.map((value) => <button type="button" key={value} className={state.voltes === value ? 'active' : ''} aria-pressed={state.voltes === value}
            onClick={() => { if (value !== state.voltes) update({ voltes: value }) }}>{value}</button>)}
        </div></fieldset>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="exit-confirmation-actions">
        <button type="button" className="primary-action" onClick={close}>{t.settingsDone}</button>
      </div>
    </Modal>}
  </section>
}
