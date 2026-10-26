import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ALPHABETS, MAX_ERRORS, normalizeGuess } from '../../shared/game'
import type { Ack, ChatMessage, PlayerGameView } from '../../shared/protocol'
import { HangmanDrawing } from '../components/HangmanDrawing'
import { ErrorMeter } from '../components/ErrorMeter'
import { Keyboard } from '../components/Keyboard'
import { Scoreboard } from '../components/Scoreboard'
import { MatchResults } from '../components/MatchResults'
import { RoomChat } from '../components/RoomChat'
import { ForgivenessTray } from '../components/ForgivenessTray'
import { MultiplayerWord } from '../components/MultiplayerWord'
import { AbsenceNotice } from '../components/AbsenceNotice'
import { PlayerRoundStatusNotice } from '../components/PlayerRoundStatusNotice'
import { RoundResults } from '../components/RoundResults'
import { ObserverSelector } from '../components/ObserverSelector'
import { errorMessage, multiplayerTranslations } from '../multiplayer/i18n'
import { socket } from '../multiplayer/socket'
import { listenForReconnections } from '../multiplayer/reconnectionNotice'
import { hasSelectedWord, multiplayerPhase } from '../multiplayer/presentation'

type Props = { onLeave: () => void; onExitToMenu: () => void; state: PlayerGameView; interfaceLanguage: 'ca' | 'es'; chat?: ReactNode; messages: ChatMessage[]; playerId: string; typingPlayers: { playerId: string; playerName: string }[] }

export function GamePage({ state, interfaceLanguage, messages, playerId, typingPlayers, onLeave, onExitToMenu, chat }: Props) {
  const [word, setWord] = useState('')
  const [error, setError] = useState('')
  const [reconnected, setReconnected] = useState(false)
  const t = multiplayerTranslations[interfaceLanguage]
  const phase = multiplayerPhase(state)
  const matchOver = phase === 'match-over'
  const gameRef = useRef<HTMLElement>(null)
  const previousPhase = useRef(phase)
  const wordSelected = hasSelectedWord(state)
  const round = state.round
  const roundResults = round?.results ?? []
  const isSetter = round?.setterId === playerId
  const self = state.self
  const isGuesser = Boolean(self && !isSetter)
  const playersById = new Map(state.players.map((player) => [player.id, player]))
  const setter = round ? playersById.get(round.setterId) : undefined
  const observed = isSetter ? state.observedPlayer : self
  const guessed = new Set(observed?.guessedLetters ?? [])
  const wrong = new Set(observed?.wrongLetters ?? [])
  const pendingRequests = isSetter && phase === 'guessing' ? state.forgivenessRequests.filter((request) => request.status === 'pending') : []

  useEffect(() => listenForReconnections(socket, state.code, playerId, setReconnected), [state.code, playerId])

  const handleAck = useCallback((response: Parameters<Ack>[0]) => {
    if (!response.ok) setError(errorMessage(response.error, t))
  }, [t])
  const guess = useCallback((letter: string) => {
    if (!isGuesser || self?.status !== 'playing' || phase !== 'guessing') return
    socket.emit('game:guess', { letter }, handleAck)
  }, [handleAck, isGuesser, phase, self?.status])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return
      const normalized = normalizeGuess(event.key, state.gameLanguage)
      if (normalized) guess(normalized)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [guess, state.gameLanguage])

  // A started rematch replaces the results surface; keep keyboard focus inside the new game rather than on <body>.
  useEffect(() => {
    if (previousPhase.current === 'match-over' && phase !== 'match-over' && (!document.activeElement || document.activeElement === document.body)) gameRef.current?.focus({ preventScroll: true })
    previousPhase.current = phase
  }, [phase])

  const submitWord = (event: FormEvent) => {
    event.preventDefault(); setError('')
    socket.emit('round:set-word', { word }, (response) => { handleAck(response); if (response.ok) setWord('') })
  }
  const observePlayer = (observedPlayerId: string) => {
    setError('')
    socket.emit('round:observe-player', { playerId: observedPlayerId }, handleAck)
  }
  const decideForgiveness = (requestId: string, forgive: boolean) => {
    setError('')
    socket.emit('round:forgiveness', { requestId, forgive }, handleAck)
  }

  if (state.roomStatus === 'aborted' || state.roomStatus === 'closed') return <main className="disconnect-page"><section>
    <span className="disconnect-icon">!</span><h1>{t.disconnected}</h1>
  </section></main>

  const roundStatus = round?.status

  return <main className={`match-page${matchOver ? ' match-over-page' : ''}`} lang={interfaceLanguage}>
    <header className="match-header">
      <h1 className="match-title">{t.matchTitle}</h1>
      <div className="match-meta"><span>{t.roomCode} <b>{state.code}</b></span>{!matchOver && <><span>{t.round} <b>{state.match.completedTurns}/{state.match.totalTurns}</b></span><span>{t.voltes} <b>{round?.voltaNumber ?? state.match.voltaNumber}/{state.voltes}</b></span></>}<span>{t.gameLanguageNames[state.gameLanguage]}</span></div>
    </header>
    {/* Match-over is a mutually exclusive branch; RoomChat keeps its slot so a draft survives the transition. */}
    <div className={`match-layout${matchOver ? ' match-over-layout' : ''}`}>
      {!matchOver && <ForgivenessTray requests={pendingRequests} players={state.players} t={t} onDecide={decideForgiveness} />}
      {matchOver ? <MatchResults state={state} playerId={playerId} t={t} language={interfaceLanguage} onRematch={(ack) => socket.emit('match:rematch', ack)} onNewRoom={onLeave} onExitToMenu={onExitToMenu} />
      : <section className="multiplayer-game" ref={gameRef} tabIndex={-1}>
        {state.roomStatus === 'active' && <AbsenceNotice state={state} t={t} language={interfaceLanguage} />}
        {state.roomStatus === 'active' && reconnected && <div className="reconnected-notice" role="status">{t.opponentReconnected}</div>}
        {phase === 'choosing-word' && <>{round?.number === 1 && <div className="role-line" role="status">{isSetter ? t.youStart : t.playerStarts.replace('{player}', setter?.name ?? '')}</div>}{isSetter ? <form className="word-form" onSubmit={submitWord}>
          <label className="role-badge setter" htmlFor="secret-word-input"><span aria-hidden="true">✎ </span>{t.chooseWord}</label>
          <input id="secret-word-input" type="text" autoFocus maxLength={50} value={word} placeholder={t.secretPlaceholder} autoComplete="off" spellCheck={false} onChange={(e) => setWord(e.target.value)} />
          <p className="word-privacy">{t.wordPrivacy}</p>
          <button className="primary-action">{t.startRound}</button>
        </form> : <div className="phase-message"><div className="thinking">•••</div><h2>{setter?.name} {t.rivalChoosing}</h2></div>}</>}

        {phase === 'guessing' || (phase === 'round-over' && wordSelected) ? <>
          <div className="role-line">{roundStatus === 'round-over' ? t.roundComplete : isSetter ? t.youChose : self?.status === 'awaiting-forgiveness' ? t.finalErrorGuesser : self?.status === 'solved' ? t.youSolved : self?.spectating ? t.spectatingTitle : self?.status === 'failed' || self?.status === 'eliminated' ? t.youAreOut : t.yourGuess}</div>
          {isSetter && state.roomStatus === 'active' && <ObserverSelector players={state.players.filter((player) => player.id !== playerId)} selectedPlayerId={state.observedPlayerId} t={t} onSelect={observePlayer} />}
          {observed ? <div className="game-columns"><div className="drawing-panel"><HangmanDrawing errors={observed.errors} mood={observed.status === 'solved' ? 'win' : observed.errors >= MAX_ERRORS ? 'loss' : 'neutral'} />
            <div className="error-copy"><span>{t.errors}</span><strong>{observed.errors} / {MAX_ERRORS}{observed.forgiven ? ' · ♥' : ''}</strong><ErrorMeter errors={observed.errors} /></div></div><div className="guess-area">
              <MultiplayerWord displayWord={observed.displayWord} language={state.gameLanguage} label={t.wordProgress} blank={t.hiddenLetter} />
              {isSetter && state.privateWord && <p className="setter-secret">{t.youChose}: <strong>{state.privateWord}</strong></p>}
              {phase === 'guessing' && !isSetter && self?.status === 'awaiting-forgiveness' && <div className="forgiveness-wait" role="status"><strong>{t.finalErrorGuesser}</strong><span>{t.waitingForgiveness}</span></div>}
              {!isSetter && self && <PlayerRoundStatusNotice phase={phase} status={self.status} spectating={self.spectating} t={t} />}
              {roundStatus === 'round-over' && <div className="round-result"><span>{t.wordWas}</span><strong lang={state.gameLanguage}>{state.privateWord}</strong></div>}
              <div className="incorrect-list"><span>{t.incorrect}</span><strong>{observed.wrongLetters.length ? observed.wrongLetters.join(' · ') : t.none}</strong></div>
              {!isSetter && <Keyboard alphabet={ALPHABETS[state.gameLanguage]} guesses={guessed} incorrect={wrong} disabled={self?.status !== 'playing' || phase !== 'guessing'} label={t.keyboard} onGuess={guess} />}
              {roundStatus === 'round-over' && round?.nextSetterId === playerId && state.roomStatus === 'active' && <button className="primary-action" onClick={() => socket.emit('round:continue', handleAck)}>{t.next}</button>}
              {roundStatus === 'round-over' && round?.nextSetterId !== playerId && state.roomStatus === 'active' && <p className="continue-note">{playersById.get(round?.nextSetterId ?? '')?.name} · {t.next}</p>}
            </div></div> : <div className="phase-message"><h2>{t.selectPlayer}</h2></div>}
          {roundStatus === 'round-over' && roundResults.length > 0 && <RoundResults results={roundResults} players={state.players} t={t} />}
        </> : null}

        {phase === 'round-over' && !wordSelected && <div className="phase-message">
          <p role="status">{t.roundInterrupted}</p>
          {round?.nextSetterId === playerId ? <button className="primary-action" onClick={() => socket.emit('round:continue', handleAck)}>{t.next}</button>
            : <p className="continue-note">{playersById.get(round?.nextSetterId ?? '')?.name} · {t.next}</p>}
        </div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>}
      {/* After the board in reading order: on stacked layouts the game comes first; beside it (≥1000px) the grid places the ranking in its own column. */}
      {!matchOver && <Scoreboard players={state.players} setterId={round?.setterId ?? null} currentId={playerId} t={t} />}
      {chat ?? <RoomChat messages={messages} currentPlayerId={playerId} typingPlayers={typingPlayers} t={t} language={interfaceLanguage} />}
    </div>
  </main>
}
