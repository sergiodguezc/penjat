import { AbsenceNotice } from './AbsenceNotice'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MAX_ERRORS } from '../../shared/game'
import type { Ack, PlayerGameView } from '../../shared/protocol'
import { errorMessage, type MultiplayerTranslations } from '../multiplayer/i18n'
import { listNames, matchOutcome, matchStandings, outcomeCopy, type Standing } from '../multiplayer/matchResults'
import { hasSelectedWord, rematchAvailability } from '../multiplayer/presentation'
import { HangmanDrawing } from './HangmanDrawing'
import { RoundResults } from './RoundResults'

type Props = {
  state: PlayerGameView
  playerId: string
  t: MultiplayerTranslations
  language: 'ca' | 'es'
  onRematch: (ack: Ack) => void
  onNewRoom: () => void
  onExitToMenu: () => void
}

/** Dedicated match-over surface: outcome, rematch, one authoritative classification and optional last-round details. */
export function MatchResults({ state, playerId, t, language, onRematch, onNewRoom, onExitToMenu }: Props) {
  const standings = matchStandings(state, playerId)
  const outcome = matchOutcome(standings)
  const copy = outcomeCopy(outcome, standings, t, language)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const transitionCopy = useRef(copy)
  // Decorative verdict: the character is rescued for a win or a shared first place, defeated otherwise.
  const mood = outcome.kind === 'unavailable' ? null : outcome.kind === 'self-won' || outcome.kind === 'self-tied' ? 'win' : 'loss'

  // One transition per mount: focus the outcome, unless the player is typing (then announce it politely instead).
  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable)) {
      setAnnouncement(`${transitionCopy.current.heading}. ${transitionCopy.current.lede}`)
    } else {
      window.scrollTo(0, 0)
      headingRef.current?.focus({ preventScroll: true })
    }
  }, [])

  return <section className={`match-results outcome-${outcome.kind}`} aria-labelledby="match-outcome-title">
    <div className="match-outcome">
      <p className="match-outcome-eyebrow">{t.matchComplete}</p>
      <h2 id="match-outcome-title" ref={headingRef} tabIndex={-1} aria-describedby="match-outcome-lede">
        {outcome.kind === 'self-won' && <span className="match-outcome-mark" aria-hidden="true">★</span>}{copy.heading}
      </h2>
      <p id="match-outcome-lede" className="match-outcome-lede">{copy.lede}</p>
      {mood && <div className="match-outcome-art"><HangmanDrawing errors={MAX_ERRORS} seasonalErrors={state.self?.errors ?? MAX_ERRORS} mood={mood} /></div>}
    </div>
    <RematchActions state={state} playerId={playerId} t={t} language={language} onRematch={onRematch} onNewRoom={onNewRoom} onExitToMenu={onExitToMenu} />
    {standings && <FinalStandings standings={standings} t={t} />}
    <LastRound state={state} t={t} />
    <p className="sr-only" role="status">{announcement}</p>
  </section>
}

export function FinalStandings({ standings, t }: { standings: Standing[]; t: MultiplayerTranslations }) {
  return <section className="match-standings" aria-labelledby="match-standings-title">
    <div className="match-standings-head">
      <h3 id="match-standings-title">{t.standingsTitle}</h3>
      <span aria-hidden="true">{t.standingsPoints}</span>
    </div>
    <ol role="list">{standings.map((standing) => {
      const classes = ['standing-row', standing.isLeader && 'is-leader', standing.isSelf && 'is-self', standing.presence !== 'connected' && `is-${standing.presence}`].filter(Boolean).join(' ')
      return <li key={standing.id} className={classes}>
        <span className="standing-rank" aria-hidden="true">{standing.rank}</span>
        <span className="standing-player">
          <span className="sr-only">{t.placeLabel(t.ordinal(standing.rank))}: </span>
          <span className="standing-name">{standing.name ?? t.unknownPlayer}</span>
          {standing.isSelf && <span className="standing-self"><span className="sr-only">, </span>{t.resultsYou}</span>}
          {standing.presence !== 'connected' && <span className="standing-status"><span className="sr-only">, </span>{standing.presence === 'departed' ? t.statusDeparted : standing.presence === 'disconnected' ? t.statusDisconnected : t.statusReconnecting}</span>}
        </span>
        <span className="standing-score"><span aria-hidden="true">{standing.score}</span><span className="sr-only">, {t.points(standing.score)}</span></span>
      </li>
    })}</ol>
  </section>
}

function RematchActions({ state, playerId, t, language, onRematch, onNewRoom, onExitToMenu }: Omit<Props, 'state'> & { state: PlayerGameView }) {
  const rematch = rematchAvailability(state)
  const ready = rematch.readyIds.includes(playerId)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const requested = useRef(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const readyRef = useRef<HTMLParagraphElement>(null)
  const reconnecting = state.players.filter((player) => player.active && player.connectionState === 'reconnecting' && player.id !== playerId)

  const request = () => {
    if (pending || ready) return
    requested.current = true
    setPending(true); setError('')
    onRematch((response) => {
      setPending(false)
      if (!response.ok && response.error !== 'rematch-already-ready') setError(errorMessage(response.error, t))
    })
  }

  // The request button is replaced by a non-actionable state; keep keyboard focus on that replacement.
  useLayoutEffect(() => {
    if (ready && requested.current && (!document.activeElement || document.activeElement === document.body)) readyRef.current?.focus()
  }, [ready])

  // Persistent phone action bar: reserve exactly its height below the page and for focus scrolling.
  useLayoutEffect(() => {
    const element = actionsRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const update = () => root.style.setProperty('--match-actions-height', `${Math.ceil(element.getBoundingClientRect().height)}px`)
    const observer = new ResizeObserver(update)
    observer.observe(element); update()
    return () => { observer.disconnect(); root.style.removeProperty('--match-actions-height') }
  }, [])

  return <div className="match-actions-area">
    {!rematch.available && <div className="rematch-unavailable" role="status">
      <strong>{t.rematchNotEnough}</strong><span>{t.rematchNotEnoughBody}</span>
    </div>}
    {rematch.available && state.skippablePlayerIds?.length > 0 && <AbsenceNotice state={state} t={t} language={language} onlyWhenBlocking />}
    {rematch.available && reconnecting.length > 0 && !state.skippablePlayerIds?.length && <p className="rematch-note" role="status">{t.rematchWaitingReconnect(listNames(reconnecting.map((player) => player.name), language))}</p>}
    <div className="match-actions" ref={actionsRef}>
      <div className="match-actions-buttons">
        {!rematch.available ? <button type="button" className="primary-action" onClick={onNewRoom}>{t.createNewRoom}</button>
          : ready ? <p className="rematch-requested" ref={readyRef} tabIndex={-1}><span className="rematch-requested-mark" aria-hidden="true">✓</span>{t.rematchRequested}</p>
            : <button type="button" className="primary-action" aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={request}>{pending ? t.rematchSending : t.rematch}</button>}
        <button type="button" className="secondary-action" onClick={onExitToMenu}>{t.exitToMenu}</button>
      </div>
      {rematch.available && <div className="rematch-readiness">
        <span className="rematch-dots" aria-hidden="true">{Array.from({ length: rematch.total }, (_, index) => <i key={index} className={index < rematch.readyIds.length ? 'on' : undefined} />)}</span>
        <span aria-live="polite">{t.rematchReadiness(rematch.readyIds.length, rematch.total)}</span>
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </div>
}

function LastRound({ state, t }: { state: PlayerGameView; t: MultiplayerTranslations }) {
  const round = state.round
  if (!round) return null
  if (!hasSelectedWord(state)) return <p className="match-round-note">{t.roundInterrupted}</p>
  const setter = state.players.find((player) => player.id === round.setterId)
  return <details className="match-round-details">
    <summary>{t.lastRoundDetails}</summary>
    <div className="match-round-body">
      {state.privateWord && <p className="match-round-word">{t.wordWas}: <strong lang={state.gameLanguage}>{state.privateWord}</strong></p>}
      {setter && <p className="match-round-meta">{t.lastRoundSetter(setter.name)}</p>}
      <RoundResults results={round.results} players={state.players} t={t} showTitle={false} />
    </div>
  </details>
}
