import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { ALPHABETS, MAX_ERRORS, type Language } from '../../shared/game'
import { DEFAULT_VOLTES, SUPPORTED_VOLTES, type PublicPlayer } from '../../shared/protocol'
import { ErrorMeter } from '../components/ErrorMeter'
import { HangmanDrawing } from '../components/HangmanDrawing'
import { Keyboard } from '../components/Keyboard'
import { LanguageSelector } from '../components/LanguageSelector'
import { FinalStandings } from '../components/MatchResults'
import { Modal } from '../components/Modal'
import { MultiplayerWord } from '../components/MultiplayerWord'
import { RoundResults } from '../components/RoundResults'
import { Scoreboard } from '../components/Scoreboard'
import { createTurnClock, HEARTBEAT_MS } from '../local/clock'
import { localTranslations } from '../local/i18n'
import {
  createLocalMatch, guesserBoard, localMatchResult, MAX_LOCAL_PLAYERS, MAX_PLAYER_NAME_LENGTH, MIN_LOCAL_PLAYERS, nextSetterId, playableGuess, playerName,
  normalizePlayerName, reduceLocalMatch, requiredGate, roundNumber, roundResults, setterId, totalTurns, voltaNumber, type LocalAction, type LocalMatch, type LocalSettings, type LocalSetupError,
} from '../local/match'
import { createPrivacyGuard } from '../local/privacy'
import { clearLocalMatch, readLocalMatch, writeLocalMatch } from '../local/storage'
import { errorMessage, multiplayerTranslations } from '../multiplayer/i18n'
import { useOfflineReadiness } from '../pwa/offline'
import { matchOutcome, matchStandings, outcomeCopy } from '../multiplayer/matchResults'

type Props = { language: Language; gameLanguage: Language; onHome: () => void; onUnsavedChange: (unsaved: boolean) => void }
type Notice = 'discarded' | 'newer' | 'unavailable' | null
type Finished = { playerId: string; solved: boolean; errors: number }

/**
 * "Passa el mòbil": one device passed around the table. All rules live in local/match.ts. Whether a private screen is
 * unlocked is React state only, so a reload, relaunch or hidden page always comes back to the gate for the saved step.
 */
export function LocalMatchPage({ language, gameLanguage, onHome, onUnsavedChange }: Props) {
  const l = localTranslations[language]
  const mt = multiplayerTranslations[language]
  const [initial] = useState(() => readLocalMatch())
  const [match, setMatch] = useState<LocalMatch | null>(initial.status === 'saved' ? initial.match : null)
  const matchRef = useRef(match)
  const [notice, setNotice] = useState<Notice>(initial.status === 'discarded' || initial.status === 'newer' || initial.status === 'unavailable' ? initial.status : null)
  const [persisted, setPersisted] = useState(initial.status !== 'unavailable')
  const [playing, setPlaying] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [finished, setFinished] = useState<Finished | null>(null)
  const [covered, setCovered] = useState(false)
  const [draft, setDraft] = useState('')
  const [wordError, setWordError] = useState('')
  const [dialog, setDialog] = useState<'abandon' | 'replace' | null>(null)
  const [clock] = useState(() => createTurnClock())
  const gate = match ? requiredGate(match) : null
  const boardOpen = playing && unlocked && !finished && gate?.kind === 'guess'
  const sensitive = playing && (finished !== null || (unlocked && gate !== null && gate.kind !== 'reveal'))
  const unsaved = playing && !persisted && match !== null && match.step !== 'match-over'

  /** Every change is saved at once, in the same step as the state update: nothing claims to be saved unless it was. */
  const commit = (next: LocalMatch, replaceNewer = false) => {
    if (next === matchRef.current) return
    matchRef.current = next
    setMatch(next)
    setPersisted(writeLocalMatch(next, undefined, { replaceNewer }) === 'saved')
  }
  const act = (action: LocalAction) => { if (matchRef.current) commit(reduceLocalMatch(matchRef.current, action)) }
  const addTime = (elapsedMs: number) => { if (elapsedMs) act({ type: 'add-time', elapsedMs }) }

  // Hidden, unloaded or restored from the back/forward cache: stop the clock, drop the private screen, show the gate.
  const lock = () => flushSync(() => {
    addTime(clock.stop())
    setUnlocked(false); setFinished(null); setCovered(false); setDraft(''); setWordError('')
  })
  const lockRef = useRef(lock)
  useEffect(() => { lockRef.current = lock })
  useEffect(() => {
    if (!sensitive) return
    const release = createPrivacyGuard(document, window, { lock: () => lockRef.current(), cover: (value) => flushSync(() => setCovered(value)) })
    return () => { release(); setCovered(false) }
  }, [sensitive])

  // While a board is open, time is flushed regularly so an unexpected process kill loses at most one heartbeat.
  useEffect(() => {
    if (!boardOpen) return
    const timer = setInterval(() => addTime(clock.flush()), HEARTBEAT_MS)
    return () => clearInterval(timer)
  // addTime only reaches refs and state setters, so the first render's copy stays correct.
  }, [boardOpen, clock])
  // Leaving the page through the app keeps the time played so far.
  useEffect(() => () => { const elapsed = clock.stop(); if (elapsed && matchRef.current) writeLocalMatch(reduceLocalMatch(matchRef.current, { type: 'add-time', elapsedMs: elapsed })) }, [clock])

  useEffect(() => { onUnsavedChange(unsaved) }, [onUnsavedChange, unsaved])
  useEffect(() => () => onUnsavedChange(false), [onUnsavedChange])
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const unlock = () => {
    if (requiredGate(matchRef.current!).kind === 'guess') clock.start()
    setUnlocked(true)
  }
  const guess = (input: string) => {
    const current = matchRef.current
    // Only a letter that changes the match takes the elapsed time with it; a repeated key keeps the clock running.
    if (!current || !boardOpen || !playableGuess(current, input)) return
    const guesser = current.guessers[current.current]
    const next = reduceLocalMatch(current, { type: 'guess', letter: input, elapsedMs: clock.flush() })
    commit(next)
    const after = next.guessers.find((candidate) => candidate.playerId === guesser.playerId)!
    if (after.status === 'playing') return
    clock.stop()
    setUnlocked(false)
    if (after.status !== 'awaiting-forgiveness') setFinished({ playerId: after.playerId, solved: after.status === 'solved', errors: after.errors })
  }
  const guessRef = useRef(guess)
  useEffect(() => { guessRef.current = guess })
  useEffect(() => {
    if (!boardOpen) return
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return
      guessRef.current(event.key)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [boardOpen])

  const submitWord = (event: FormEvent) => {
    event.preventDefault()
    const current = matchRef.current!
    const next = reduceLocalMatch(current, { type: 'set-word', word: draft })
    if (next === current) { setWordError(errorMessage('invalid-word', mt)); return }
    commit(next)
    setDraft(''); setWordError(''); setUnlocked(false)
  }
  const decide = (forgive: boolean) => { act({ type: 'decide-forgiveness', forgive }); setUnlocked(false) }
  const nextTurn = () => { act({ type: 'next-turn' }); setUnlocked(false) }
  const rematch = () => { act({ type: 'rematch', random: Math.random() }); setUnlocked(false) }
  const startOver = () => {
    clearLocalMatch()
    matchRef.current = null
    setMatch(null); setPlaying(false); setUnlocked(false); setPersisted(readLocalMatch().status !== 'unavailable')
  }
  const begin = (created: LocalMatch, replaceNewer: boolean) => {
    commit(created, replaceNewer)
    setNotice((current) => current === 'unavailable' ? current : null)
    setPlaying(true); setUnlocked(false)
    // Best effort: asks the browser not to evict the saved match under storage pressure.
    void navigator.storage?.persist?.().catch(() => {})
  }

  const header = match && playing && <header className="match-header local-header">
    <h1 className="match-title">{l.title}</h1>
    <div className="match-meta"><span>{mt.round} <b>{roundNumber(match)}/{totalTurns(match)}</b></span><span>{mt.voltes} <b>{voltaNumber(match)}/{match.voltes}</b></span><span>{mt.gameLanguageNames[match.gameLanguage]}</span></div>
  </header>
  const saveWarning = playing && !persisted && <p className="local-save-warning" role="alert">{notice === 'unavailable' ? l.unavailable : l.notSaved}</p>

  let screen: ReactNode = null
  if (match && playing && gate) {
    const name = (id: string) => playerName(match, id)
    if (finished) {
      screen = <TurnComplete key={`done-${match.turnIndex}-${finished.playerId}`} title={finished.solved ? l.turnSolved : l.turnFailed} body={l.turnDoneBody} action={l.hideAndPass}
        art={<HangmanDrawing errors={finished.errors} mood={finished.solved ? 'win' : 'loss'} />} onDone={() => setFinished(null)} />
    } else if (!unlocked) {
      const handoff = gate.kind === 'write-word' ? { eyebrow: l.passTo, title: name(gate.playerId), body: l.writeWordBody(name(gate.playerId)), action: l.iAm(name(gate.playerId)) }
        : gate.kind === 'guess' ? { eyebrow: gate.resuming ? l.giveBackTo : l.passTo, title: name(gate.playerId), body: (gate.resuming ? l.resumeBody : l.guessBody)(name(gate.playerId)), action: l.iAm(name(gate.playerId)) }
        : gate.kind === 'forgive' ? { eyebrow: l.passTo, title: name(gate.playerId), body: l.forgiveBody(name(gate.playerId), name(gate.guesserId)), action: l.iAm(name(gate.playerId)) }
        : { eyebrow: null, title: l.revealTitle, body: l.revealBody, action: l.showResults }
      screen = <Handoff key={`gate-${match.turnIndex}-${match.step}-${match.current}-${gate.kind}`} {...handoff} onConfirm={unlock} />
    } else if (gate.kind === 'write-word') {
      screen = <form className="local-panel word-form local-word-form" noValidate onSubmit={submitWord}>
        <h2 className="local-screen-title">{l.writeWordTitle(name(gate.playerId))}</h2>
        <label className="sr-only" htmlFor="local-secret-word">{mt.chooseWord}</label>
        <input id="local-secret-word" type="text" autoFocus maxLength={50} value={draft} placeholder={mt.secretPlaceholder}
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} aria-invalid={Boolean(wordError) || undefined}
          aria-describedby={wordError ? 'local-word-privacy local-word-error' : 'local-word-privacy'} onChange={(event) => { setDraft(event.target.value); setWordError('') }} />
        <p id="local-word-privacy" className="word-privacy">{mt.wordPrivacy}</p>
        {wordError && <p id="local-word-error" className="form-error" role="alert">{wordError}</p>}
        <button className="primary-action">{l.hideWord}</button>
      </form>
    } else if (gate.kind === 'guess') {
      const board = guesserBoard(match)!
      screen = <Board key={`board-${match.turnIndex}-${board.playerId}`} title={l.turnOf(name(board.playerId))}>
        <div className="game-columns">
          <div className="drawing-panel"><HangmanDrawing errors={board.errors} />
            <div className="error-copy"><span>{mt.errors}</span><strong>{board.errors} / {MAX_ERRORS}{board.forgiven ? ' · ♥' : ''}</strong><ErrorMeter errors={board.errors} /></div></div>
          <div className="guess-area">
            <MultiplayerWord displayWord={board.displayWord} language={match.gameLanguage} label={mt.wordProgress} blank={mt.hiddenLetter} />
            <div className="incorrect-list"><span>{mt.incorrect}</span><strong>{board.wrongLetters.length ? board.wrongLetters.join(' · ') : mt.none}</strong></div>
            <Keyboard alphabet={ALPHABETS[match.gameLanguage]} guesses={new Set(board.guessed)} incorrect={new Set(board.wrongLetters)} disabled={false} label={mt.keyboard} onGuess={guess} />
          </div>
        </div>
      </Board>
    } else if (gate.kind === 'forgive') {
      screen = <Decision key={`forgive-${match.turnIndex}-${gate.guesserId}`} title={l.forgiveTitle(name(gate.guesserId))} question={l.forgiveQuestion}
        forgive={l.forgive} deny={l.deny} onDecide={decide} />
    } else if (match.step === 'round-over') {
      const next = nextSetterId(match)!
      screen = <Results key={`results-${match.turnIndex}`} match={match} language={language} title={mt.roundResults}>
        <button type="button" className="primary-action local-next" onClick={nextTurn}>{l.nextTurn(name(next))}</button>
      </Results>
    } else {
      screen = <MatchOver key="match-over" match={match} language={language} playAgain={l.playAgain} newMatch={l.newMatch} onRematch={rematch} onNewMatch={startOver} onHome={onHome} />
    }
  }

  return <main className={`local-page${match?.step === 'match-over' && playing && unlocked ? ' match-over-page' : ''}`} lang={language}>
    {!playing ? <Setup language={language} gameLanguage={match?.gameLanguage ?? gameLanguage} saved={match} notice={notice}
      onResume={() => { setPlaying(true); setUnlocked(false) }} onAbandon={() => setDialog('abandon')}
      onStart={(created) => notice === 'newer' ? setDialog('replace') : begin(created, false)}
      pendingStart={(created) => begin(created, true)} confirmReplace={dialog === 'replace'} onCancelReplace={() => setDialog(null)} />
      : <>
        {header}
        {saveWarning}
        <div className={`local-stage${covered ? ' is-covered' : ''}`} inert={covered || undefined}>{screen}</div>
        {covered && <div className="local-cover" role="status"><span>{l.covered}</span></div>}
      </>}
    {dialog === 'abandon' && <Modal className="exit-confirmation-dialog" labelledBy="local-abandon-title" describedBy="local-abandon-body" onCancel={() => setDialog(null)}>
      <h2 id="local-abandon-title">{l.abandonTitle}</h2>
      <p id="local-abandon-body">{l.abandonBody}</p>
      <div className="exit-confirmation-actions">
        <button type="button" className="secondary-action" data-modal-initial-focus onClick={() => setDialog(null)}>{l.cancel}</button>
        <button type="button" className="primary-action danger-action" onClick={() => { setDialog(null); startOver() }}>{l.abandonConfirm}</button>
      </div>
    </Modal>}
  </main>
}

function useFocusOnMount(ref: RefObject<HTMLElement | null>) {
  useEffect(() => { ref.current?.focus({ preventScroll: true }); window.scrollTo(0, 0) }, [ref])
}

function Handoff({ eyebrow, title, body, action, onConfirm }: { eyebrow: string | null; title: string; body: string; action: string; onConfirm: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useFocusOnMount(ref)
  return <section className="local-panel handoff" aria-labelledby="handoff-title" aria-describedby="handoff-body">
    {eyebrow && <p className="handoff-eyebrow">{eyebrow}</p>}
    <h2 id="handoff-title" className="handoff-title">{title}</h2>
    <p id="handoff-body" className="handoff-body">{body}</p>
    <button ref={ref} type="button" className="primary-action handoff-action" aria-describedby="handoff-body" onClick={onConfirm}>{action}</button>
  </section>
}

function Board({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useFocusOnMount(ref)
  return <section className="local-panel local-board" aria-labelledby="local-board-title">
    <h2 id="local-board-title" ref={ref} tabIndex={-1} className="role-line">{title}</h2>
    {children}
  </section>
}

function TurnComplete({ title, body, action, art, onDone }: { title: string; body: string; action: string; art: ReactNode; onDone: () => void }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useFocusOnMount(ref)
  return <section className="local-panel handoff turn-complete" aria-labelledby="turn-complete-title" aria-describedby="turn-complete-body">
    <div className="turn-complete-art" aria-hidden="true">{art}</div>
    <h2 id="turn-complete-title" ref={ref} tabIndex={-1} className="handoff-title">{title}</h2>
    <p id="turn-complete-body" className="handoff-body">{body}</p>
    <button type="button" className="primary-action handoff-action" onClick={onDone}>{action}</button>
  </section>
}

function Decision({ title, question, forgive, deny, onDecide }: { title: string; question: string; forgive: string; deny: string; onDecide: (forgive: boolean) => void }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useFocusOnMount(ref)
  return <section className="local-panel handoff forgive-decision" aria-labelledby="forgive-title" aria-describedby="forgive-question">
    <div className="turn-complete-art" aria-hidden="true"><HangmanDrawing errors={MAX_ERRORS} mood="loss" /></div>
    <h2 id="forgive-title" ref={ref} tabIndex={-1} className="handoff-title">{title}</h2>
    <ErrorMeter errors={MAX_ERRORS} />
    <p id="forgive-question" className="handoff-body">{question}</p>
    <div className="handoff-actions">
      <button type="button" className="primary-action" onClick={() => onDecide(true)}>{forgive}</button>
      <button type="button" className="secondary-action" onClick={() => onDecide(false)}>{deny}</button>
    </div>
  </section>
}

/** The shared phone after a reveal: everyone may look, so the scoreboard shows every status. */
function publicPlayers(match: LocalMatch): PublicPlayer[] {
  const setter = setterId(match)
  return match.players.map((player) => ({ id: player.id, name: player.name, score: player.score, connectionState: 'connected', active: true,
    roundStatus: player.id === setter ? 'setter' : match.guessers.find((guesser) => guesser.playerId === player.id)?.status ?? 'playing' }))
}

function Results({ match, language, title, children }: { match: LocalMatch; language: Language; title: string; children: ReactNode }) {
  const mt = multiplayerTranslations[language]
  const ref = useRef<HTMLHeadingElement>(null)
  useFocusOnMount(ref)
  const players = publicPlayers(match)
  return <section className="local-panel local-results" aria-labelledby="local-results-title">
    <h2 id="local-results-title" ref={ref} tabIndex={-1} className="local-screen-title">{title}</h2>
    <div className="round-result"><span>{mt.wordWas}</span><strong lang={match.gameLanguage}>{match.word}</strong></div>
    <RoundResults results={roundResults(match)} players={players} t={mt} showTitle={false} />
    {children}
    <Scoreboard players={players} setterId={null} currentId="" t={mt} defaultExpanded />
  </section>
}

function MatchOver({ match, language, playAgain, newMatch, onRematch, onNewMatch, onHome }: { match: LocalMatch; language: Language; playAgain: string; newMatch: string; onRematch: () => void; onNewMatch: () => void; onHome: () => void }) {
  const mt = multiplayerTranslations[language]
  const ref = useRef<HTMLHeadingElement>(null)
  useFocusOnMount(ref)
  const players = publicPlayers(match)
  const standings = matchStandings({ players, matchResult: localMatchResult(match) }, '')
  const outcome = matchOutcome(standings)
  const copy = outcomeCopy(outcome, standings, mt, language)
  return <section className={`match-results local-match-over outcome-${outcome.kind}`} aria-labelledby="match-outcome-title">
    <div className="match-outcome">
      <p className="match-outcome-eyebrow">{mt.matchComplete}</p>
      <h2 id="match-outcome-title" ref={ref} tabIndex={-1} aria-describedby="match-outcome-lede">{copy.heading}</h2>
      <p id="match-outcome-lede" className="match-outcome-lede">{copy.lede}</p>
    </div>
    <div className="match-actions-area"><div className="match-actions-buttons">
      <button type="button" className="primary-action" onClick={onRematch}>{playAgain}</button>
      <button type="button" className="secondary-action" onClick={onNewMatch}>{newMatch}</button>
      <button type="button" className="secondary-action" onClick={onHome}>{mt.home}</button>
    </div></div>
    {standings && <FinalStandings standings={standings} t={mt} />}
    <div className="match-round-body">
      <p className="match-round-word">{mt.wordWas}: <strong lang={match.gameLanguage}>{match.word}</strong></p>
      <RoundResults results={roundResults(match)} players={players} t={mt} />
    </div>
  </section>
}

type SetupProps = {
  language: Language; gameLanguage: Language; saved: LocalMatch | null; notice: Notice
  onResume: () => void; onAbandon: () => void; onStart: (match: LocalMatch) => void
  pendingStart: (match: LocalMatch) => void; confirmReplace: boolean; onCancelReplace: () => void
}

function Setup({ language, gameLanguage, saved, notice, onResume, onAbandon, onStart, pendingStart, confirmReplace, onCancelReplace }: SetupProps) {
  const l = localTranslations[language]
  const mt = multiplayerTranslations[language]
  const nextKey = useRef(2)
  const [rows, setRows] = useState(() => [{ key: 0, name: '' }, { key: 1, name: '' }])
  const [settings, setSettings] = useState<LocalSettings>({ gameLanguage, voltes: DEFAULT_VOLTES })
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<{ code: LocalSetupError; rowKey?: number } | null>(null)
  const [created, setCreated] = useState<LocalMatch | null>(null)
  const offline = useOfflineReadiness()
  const inputs = useRef(new Map<number, HTMLInputElement>())
  const focusKey = useRef<number | null>(null)
  useEffect(() => { if (focusKey.current !== null) { inputs.current.get(focusKey.current)?.focus(); focusKey.current = null } }, [rows, error])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = createLocalMatch(rows.map((row) => row.name), settings)
    if (!result.ok) {
      const names = rows.map((row) => normalizePlayerName(row.name)?.toLocaleLowerCase())
      const index = result.error === 'invalid-name' ? names.findIndex((name) => !name)
        : result.error === 'duplicate-name' ? names.findIndex((name, i) => names.indexOf(name) < i) : -1
      const rowKey = rows[index]?.key
      focusKey.current = rowKey ?? null
      setError({ code: result.error, rowKey }); return
    }
    setError(null); setCreated(result.match); onStart(result.match)
  }
  const add = () => { const key = nextKey.current++; focusKey.current = key; setRows((current) => [...current, { key, name: '' }]); setError(null) }
  const remove = (key: number) => {
    const index = rows.findIndex((row) => row.key === key)
    focusKey.current = (rows[index + 1] ?? rows[index - 1]).key
    setRows((current) => current.filter((row) => row.key !== key)); setError(null)
  }

  return <div className="local-setup-page">
    <header className="page-head local-setup-heading">
      <p className="page-eyebrow page-eyebrow--mar">{l.setupMode}</p>
      <h1>{l.title}. <em>{l.setupAccent}</em></h1>
      {offline !== 'unsupported' && <p className={`offline-status is-${offline}`} role="status"><span aria-hidden="true">{offline === 'ready' ? '✓' : '·'}</span> {l.offline[offline]}</p>}
    </header>
    {notice && notice !== 'newer' && <p className="local-notice" role="status">{l[notice]}</p>}
    {saved ? <section className="setup lobby-card local-resume" aria-labelledby="local-resume-title">
      <h2 id="local-resume-title">{l.resumeTitle}</h2>
      <p className="local-resume-summary">{l.resumeSummary(roundNumber(saved), totalTurns(saved), saved.players.length)}</p>
      <p className="local-resume-players">{saved.players.map((player) => player.name).join(' · ')}</p>
      <button type="button" className="primary-action" onClick={onResume}>{l.resume}</button>
      <button type="button" className="secondary-action" onClick={onAbandon}>{l.abandon}</button>
    </section> : <form className="setup lobby-card local-setup" noValidate onSubmit={submit} aria-label={l.title}>
      {notice === 'newer' && <p className="local-notice" role="status">{l.newer}</p>}
      <fieldset className="local-players">
        <legend><span>{l.players}</span><small aria-live="polite">{rows.length} / {MAX_LOCAL_PLAYERS}</small></legend>
        <p className="setup-hint" id="local-seating-hint">{l.seatingHint}</p>
        <ol className="player-list">{rows.map((row, index) => {
          const label = l.playerLabel(index + 1)
          return <li key={row.key}>
            <span className="local-seat" aria-hidden="true">{index + 1}</span>
            <input ref={(element) => { if (element) inputs.current.set(row.key, element); else inputs.current.delete(row.key) }} value={row.name} maxLength={MAX_PLAYER_NAME_LENGTH}
              aria-label={label} placeholder={label} autoComplete="off" autoCapitalize="words" aria-invalid={error?.rowKey === row.key || undefined}
              aria-describedby={error?.rowKey === row.key ? 'local-setup-error local-seating-hint' : 'local-seating-hint'}
              onChange={(event) => { const name = event.target.value; setRows((current) => current.map((candidate) => candidate.key === row.key ? { ...candidate, name } : candidate)); setError(null) }} />
            <button type="button" className="local-remove" aria-label={l.removePlayer(row.name.trim() || label)} disabled={rows.length <= MIN_LOCAL_PLAYERS} onClick={() => remove(row.key)}>
              ×
            </button>
          </li>
        })}</ol>
        <button type="button" className="secondary-action local-add" disabled={rows.length >= MAX_LOCAL_PLAYERS} onClick={add}>+ {l.addPlayer}</button>
      </fieldset>
      <section className="invitation-rules lobby-rules" aria-labelledby="local-rules-title">
        <div className="lobby-rules-head">
          <h2 id="local-rules-title">{mt.invitationRules}</h2>
          <button type="button" className="secondary-action lobby-rules-configure" aria-haspopup="dialog"
            onClick={(event) => { event.currentTarget.focus(); setEditing(true) }}>{mt.configure}</button>
        </div>
        <ul className="lobby-rules-pills" aria-live="polite"><li>{mt.languagePill(settings.gameLanguage)}</li><li>{mt.roundsPill(settings.voltes)}</li></ul>
      </section>
      {error && <p id="local-setup-error" className="form-error" role="alert">{l.setupErrors[error.code]}</p>}
      <button className="primary-action">{l.start}</button>
    </form>}
    {editing && <LocalSettingsDialog language={language} settings={settings} onChange={setSettings} onClose={() => setEditing(false)} />}
    {confirmReplace && created && <Modal className="exit-confirmation-dialog" labelledBy="local-replace-title" describedBy="local-replace-body" onCancel={onCancelReplace}>
      <h2 id="local-replace-title">{l.replaceTitle}</h2>
      <p id="local-replace-body">{l.replaceBody}</p>
      <div className="exit-confirmation-actions">
        <button type="button" className="secondary-action" data-modal-initial-focus onClick={onCancelReplace}>{l.cancel}</button>
        <button type="button" className="primary-action danger-action" onClick={() => { onCancelReplace(); pendingStart(created) }}>{l.replaceConfirm}</button>
      </div>
    </Modal>}
  </div>
}

function LocalSettingsDialog({ language, settings, onChange, onClose }: {
  language: Language; settings: LocalSettings; onChange: (settings: LocalSettings) => void; onClose: () => void
}) {
  const t = multiplayerTranslations[language]
  const heading = useRef<HTMLHeadingElement>(null)
  // As in RoomChat, follow the visible viewport while the iPhone keyboard is closing or the screen rotates.
  useEffect(() => {
    const dialog = heading.current!.closest('dialog')!
    const viewport = window.visualViewport
    const resize = () => {
      const height = viewport?.height ?? window.innerHeight
      dialog.style.setProperty('--local-viewport-height', `${height}px`)
      dialog.style.setProperty('--local-dialog-center', `${(viewport?.offsetTop ?? 0) + height / 2}px`)
    }
    resize()
    window.addEventListener('resize', resize)
    viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize)
    return () => {
      window.removeEventListener('resize', resize)
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize)
    }
  }, [])
  return <Modal className="lobby-settings-dialog local-settings-dialog" labelledBy="local-settings-title" onCancel={onClose}>
    <h2 id="local-settings-title" ref={heading}>{t.invitationRules}</h2>
    <fieldset className="lobby-rules-controls">
      <legend className="sr-only">{t.invitationRules}</legend>
      <div className="language-field"><span aria-hidden="true">{t.gameLanguage}</span>
        <LanguageSelector language={settings.gameLanguage} label={t.gameLanguage} onChange={(gameLanguage) => onChange({ ...settings, gameLanguage })} /></div>
      <fieldset className="target-selector"><legend>{t.voltes}</legend><div>
        {SUPPORTED_VOLTES.map((voltes) => <button type="button" key={voltes} className={settings.voltes === voltes ? 'active' : ''} aria-pressed={settings.voltes === voltes}
          onClick={() => onChange({ ...settings, voltes })}>{voltes}</button>)}
      </div></fieldset>
    </fieldset>
    <div className="exit-confirmation-actions"><button type="button" className="primary-action" onClick={onClose}>{t.settingsDone}</button></div>
  </Modal>
}
