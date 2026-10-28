import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import type { Language } from '../../shared/game'
import type { Ack, PlayerGameView, RoomEntry, RoomPreview, RoomSession } from '../../shared/protocol'
import { Modal } from '../components/Modal'
import { HangmanDrawing } from '../components/HangmanDrawing'
import { getLanguageConfig } from '../game/languages'
import { errorMessage, multiplayerTranslations } from '../multiplayer/i18n'
import { REQUEST_TIMEOUT_MS, socket, whenConnected } from '../multiplayer/socket'
import { abandonRoomSession, entryDecision, loadRoomSession, saveRoomSession, type EntryAction } from '../multiplayer/roomSession'
import { shouldResumeRoomSession } from '../multiplayer/invitations'
import { DAILY_CHALLENGE_PUBLIC_PATH, getDailyChallenge } from '../daily/challenge'
import { getHomeDailyStatus } from '../daily/homeSummary'
import { browserStorage, readStored, writeStored } from '../storage'
import { dailyTranslations } from '../daily/i18n'
import { homeTranslations } from '../home/i18n'
import { seasonalTranslations } from '../seasonal/i18n'
import { AutumnLeaf } from '../seasonal/SeasonalOrnaments'
import { routeClick as route } from '../navigation/links'

type Props = {
  interfaceLanguage: Language
  gameLanguage: Language
  notice?: string
  invitedRoomCode?: string | null
  mode: 'home' | 'multiplayer'
  onEnter: (view: PlayerGameView, playerId: string) => void
  /** Joining the room this browser profile already has a seat in: take that player back instead of joining again. */
  onResume: () => void
  onLearn: () => void
  onDaily?: () => void
  onMultiplayer: () => void
  onHelp: () => void
}

function isIosDevice() {
  const platform = navigator.platform || ''
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalonePwa() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

function readHomeDaily() {
  const challenge = getDailyChallenge()
  try {
    return { number: challenge.number, ...getHomeDailyStatus(challenge, browserStorage()) }
  } catch {
    return { number: challenge.number, status: 'new' as const, mistakes: 0 }
  }
}

export function HomePage({ interfaceLanguage, gameLanguage, notice, invitedRoomCode = null, mode, onEnter, onResume, onLearn, onDaily, onMultiplayer, onHelp }: Props) {
  const [panel, setPanel] = useState<'menu' | 'multiplayer'>(mode === 'multiplayer' ? 'multiplayer' : 'menu')
  // One name for both actions, pre-filled with the remembered one.
  const [name, setName] = useState(readStoredName)
  // "Uneix-te a una sala" reveals the code field in place; the name is kept and focus moves to the code.
  const [joinOpen, setJoinOpen] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const entryRequest = useRef({ version: 0, cancel: undefined as (() => void) | undefined }).current
  // Creating or joining another room while this profile holds a seat elsewhere waits for an explicit confirmation.
  const [pendingSwitch, setPendingSwitch] = useState<{ action: EntryAction; session: RoomSession } | null>(null)
  const [invitation, setInvitation] = useState<RoomPreview | null>(null)
  const [invitationStatus, setInvitationStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [previewRetry, setPreviewRetry] = useState(0)
  const [showIosInstall, setShowIosInstall] = useState(false)
  const [installExpanded, setInstallExpanded] = useState(false)
  const [daily, setDaily] = useState(readHomeDaily)
  const t = multiplayerTranslations[interfaceLanguage]
  const storedSession = loadRoomSession()
  const invitationOverridesSession = storedSession && !shouldResumeRoomSession(storedSession.roomCode, invitedRoomCode)
  const isCatalan = interfaceLanguage === 'ca'
  const homeCopy = homeTranslations[interfaceLanguage]
  const d = dailyTranslations[interfaceLanguage]
  const previewSlots = ['', 'E', '', 'J', '', 'T']

  useEffect(() => { setPanel(mode === 'multiplayer' ? 'multiplayer' : 'menu') }, [mode])
  useEffect(() => {
    setBusy(false)
    return () => { entryRequest.version++; entryRequest.cancel?.() }
  }, [mode, invitedRoomCode, entryRequest])

  // Re-read on return from another tab and after the Madrid date changes while open.
  useEffect(() => {
    if (mode !== 'home') return
    const refresh = () => setDaily(readHomeDaily())
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    refresh()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [mode])

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const updateInstallHint = () => setShowIosInstall(isIosDevice() && !isStandalonePwa())
    updateInstallHint()
    displayMode.addEventListener('change', updateInstallHint)
    return () => displayMode.removeEventListener('change', updateInstallHint)
  }, [])

  // A failed attempt or a lost reply resets the busy state with a recoverable error (the user can try again).
  const connectionFailed = useCallback(() => { setBusy(false); setError(errorMessage('connect_error', t)) }, [t])
  const connect = useCallback((done: () => void) => {
    setBusy(true); setError('')
    const current = entryRequest.version
    entryRequest.cancel?.()
    entryRequest.cancel = whenConnected(socket, () => { if (current === entryRequest.version) done() }, () => { if (current === entryRequest.version) connectionFailed() })
  }, [connectionFailed, entryRequest])

  useEffect(() => {
    if (mode !== 'multiplayer' || invitedRoomCode === null) {
      setInvitation(null)
      setInvitationStatus('idle')
      return
    }
    if (!invitedRoomCode) {
      setInvitation(null)
      setInvitationStatus('error')
      setError('invalid-invitation')
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setInvitation(null)
    setInvitationStatus('loading')
    setError('')
    setBusy(true)
    fetch(`/api/rooms/${encodeURIComponent(invitedRoomCode)}/preview`, { signal: controller.signal, cache: 'no-store' })
      .then(async (previewResponse) => {
        const response = await previewResponse.json() as { ok: true; data: RoomPreview } | { ok: false; error: string }
        if (cancelled) return
        setBusy(false)
        if (!response.ok) {
          setInvitationStatus('error')
          setError(response.error)
          return
        }
        setInvitation(response.data)
        setCode(response.data.code)
        setInvitationStatus('ready')
      })
      .catch((fetchError) => {
        if (cancelled || fetchError instanceof DOMException && fetchError.name === 'AbortError') return
        setBusy(false)
        setInvitationStatus('error')
        setError('preview-load-failed')
      })
    return () => { cancelled = true; controller.abort() }
  }, [invitedRoomCode, mode, previewRetry])

  const openJoin = () => { setJoinOpen(true); setError('') }
  useEffect(() => { if (joinOpen) codeRef.current?.focus() }, [joinOpen])
  /** Both actions need a name; the field explains it rather than a disabled button. */
  const requireName = () => {
    if (name.trim()) return true
    setError(t.needName); nameRef.current?.focus()
    return false
  }

  const entered = (playerName: string, current = entryRequest.version) => (timedOut: Error | null, response: Parameters<Ack<RoomEntry>>[0]) => {
    if (current !== entryRequest.version) return
    if (timedOut) return connectionFailed()
    setBusy(false)
    if (!response.ok) return setError(errorMessage(response.error, t))
    // The room exists either way: unsaved credentials only mean a refresh cannot rejoin, which the room page says.
    writeStored('hangman-name', playerName.trim()); saveRoomSession(response.data.session); onEnter(response.data.view, response.data.session.playerId)
  }
  const run = (action: EntryAction) => connect(() => action.kind === 'create'
    ? socket.timeout(REQUEST_TIMEOUT_MS).emit('room:create', { name, gameLanguage }, entered(name))
    : socket.timeout(REQUEST_TIMEOUT_MS).emit('room:join', { name, code: action.code }, entered(name)))
  /** The stored session is read when the action is submitted: another tab may have taken it over, left or moved on. */
  const submit = (action: EntryAction) => {
    const session = loadRoomSession()
    const decision = entryDecision(session, action)
    if (decision === 'resume') { setError(''); onResume(); return }
    if (decision === 'confirm' && session) { setPendingSwitch({ action, session }); return }
    run(action)
  }
  const confirmSwitch = () => {
    const pending = pendingSwitch
    setPendingSwitch(null)
    if (!pending) return
    // The seat changed while the question was open: decide again for what is stored now.
    if (loadRoomSession()?.reconnectToken !== pending.session.reconnectToken) { submit(pending.action); return }
    const current = entryRequest.version
    connect(() => { void abandonRoomSession(socket, pending.session, REQUEST_TIMEOUT_MS).then((result) => {
      if (current === entryRequest.version) { if (result === 'left') run(pending.action); else connectionFailed() }
    }) })
  }
  const switchDialog = pendingSwitch && <Modal className="exit-confirmation-dialog" labelledBy="switch-room-title" describedBy="switch-room-copy" onCancel={() => setPendingSwitch(null)}>
    <h2 id="switch-room-title">{t.switchTitle(pendingSwitch.session.roomCode)}</h2>
    <p id="switch-room-copy">{t.switchBody(pendingSwitch.session.roomCode, pendingSwitch.action.kind === 'join' ? pendingSwitch.action.code : null)}</p>
    <div className="exit-confirmation-actions">
      <button type="button" className="secondary-action" data-modal-initial-focus onClick={() => setPendingSwitch(null)}>{t.switchCancel}</button>
      <button type="button" className="primary-action danger-action" onClick={confirmSwitch}>{t.switchConfirm}</button>
    </div>
  </Modal>

  const create = (event: FormEvent) => {
    event.preventDefault()
    if (!requireName()) return
    submit({ kind: 'create' })
  }

  if (panel === 'multiplayer') {
    if (invitedRoomCode !== null) {
      return <main className="home-page home-page--multiplayer home-page--invitation">
        <section className="home-card home-card--join invitation-card">
          <div className="home-intro home-intro--compact">
            <p className="page-eyebrow page-eyebrow--mar">{t.multiplayerMode}</p>
            <h1>{t.subtitle}</h1>
          </div>
          {invitationOverridesSession && <p role="status">{t.invitationTakesPriority}</p>}
          {invitationStatus === 'loading' && <p className="invitation-loading">{t.invitationLoading}</p>}
          {invitationStatus === 'error' && <div className="invitation-invalid">
            <h2>{t.invitationUnavailable}</h2>
            <p className="form-error" role="alert">{errorMessage(error || 'room-not-found', t)}</p>
            <div className="invitation-error-actions">
              {invitedRoomCode && <button type="button" className="primary-action" onClick={() => setPreviewRetry((current) => current + 1)}>{t.retryInvitation}</button>}
              <button type="button" className="secondary-action" onClick={onMultiplayer}>{t.goToMultiplayer}</button>
            </div>
          </div>}
          {invitationStatus === 'ready' && invitation && <form className="invitation-form">
            <h2>{t.invitationHeading}</h2>
            <section className="invitation-rules" aria-labelledby="invitation-rules-title">
              <h3 id="invitation-rules-title">{t.invitationRules}</h3>
              <dl>
                <div><dt>{t.gameLanguage}</dt><dd>{t.gameLanguageNames[invitation.gameLanguage]}</dd></div>
                <div><dt>{t.voltes}</dt><dd>{invitation.voltes}</dd></div>
              </dl>
            </section>
            <label>{t.name}<input value={name} maxLength={24} required placeholder={t.namePlaceholder} onChange={(e) => setName(e.target.value)} /></label>
            <button type="button" className="primary-action" disabled={busy || !name.trim()} onClick={() => submit({ kind: 'join', code })}>{t.joinInvitation}</button>
            {/* `error` is already translated by join (room errors) or connectionFailed; only the notice is still a code. */}
            {(error || notice) && <p className="form-error" role="alert">{error || errorMessage(notice!, t)}</p>}
            <div className="invitation-alternative">
              <span>{t.preferDifferentRules}</span>
              <button type="button" className="text-button" onClick={onMultiplayer}>{t.createYourGame}</button>
            </div>
          </form>}
        </section>
        {switchDialog}
      </main>
    }

    return <main className="home-page home-page--multiplayer">
      <header className="page-head">
        <p className="page-eyebrow page-eyebrow--mar">{t.multiplayerMode}</p>
        <h1>{t.setupTitle} <em>{t.setupAccent}</em></h1>
      </header>
      {/* One panel: a shared name, then Create; joining is the secondary path and reveals the code in place. Two
          sibling forms, so Enter in the name creates and Enter in the code joins. */}
      <section className="setup" aria-label={t.multiplayerMode}>
        <form className="entry-create" id="entry-create" noValidate onSubmit={create}>
          <label className="setup-name">{t.name}<input ref={nameRef} value={name} maxLength={24} required autoComplete="nickname"
            onChange={(e) => { setName(e.target.value); if (error === t.needName) setError('') }} /></label>
          <button className="primary-action" disabled={busy}>{t.createRoom}</button>
          <p className="setup-hint">{t.createHint}</p>
        </form>
        {joinOpen ? <form className="entry-join" id="entry-join" noValidate onSubmit={(event) => {
          event.preventDefault()
          if (!requireName()) return
          if (code.length !== 5) { setError(t.codeIncomplete); codeRef.current?.focus(); return }
          submit({ kind: 'join', code })
        }}>
          <label htmlFor="entry-room-code">{t.roomCode}</label>
          <div className="entry-join-row">
            <input id="entry-room-code" ref={codeRef} className="room-code-input" value={code} maxLength={5} placeholder={t.codePlaceholder} autoCapitalize="characters" autoComplete="off"
              onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '')); if (error === t.codeIncomplete) setError('') }} />
            <button className="secondary-action" disabled={busy}>{t.enterRoom}</button>
          </div>
        </form> : <button type="button" className="secondary-action entry-join-toggle" onClick={openJoin}>{t.joinRoom}</button>}
        {(error || notice) && <p className="form-error" role="alert">{error || errorMessage(notice!, t)}</p>}
      </section>
      <div className="multiplayer-about">
        <p>{t.multiplayerDescription}</p>
        <a className="howto-link" href="/com-es-juga" onClick={route(onHelp)}>{t.multiplayerInstructions}</a>
      </div>
      {switchDialog}
    </main>
  }

  return <main className="home-page">
    <section className="home-shell">
      <div className="home-hero">
        <section className="home-copy">
          <p className="page-eyebrow page-eyebrow--safra"><span className="home-eyebrow-default">{homeCopy.eyebrow}</span><span className="spooky-only home-season-name">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 16q-2-7 7-12q9 5 7 12q-7 8-14 0Z" /><path d="m8 10 8 7m-7 0 7-7" /></svg>
            {seasonalTranslations[interfaceLanguage].spooky}
          </span></p>
          <h1>{isCatalan ? <>Juga al penjat online <em>en català.</em></> : <>Juega a Penjat <em>online.</em></>}</h1>
          <p className="home-lede"><span className="home-season-default">{homeCopy.lede}</span><span className="spooky-only">{seasonalTranslations[interfaceLanguage].lede}</span></p>
          <nav className="home-modes" aria-label={homeCopy.modes}>
            <ul className="mode-pair">
              <li><a className="primary-action" href="/multijugador" aria-describedby="home-mp" onClick={route(onMultiplayer)}><ModeIcon mode="multiplayer" />{homeCopy.multiplayer}</a>
                <p className="mode-caption" id="home-mp">{homeCopy.multiplayerCaption}</p></li>
              <li><a className="secondary-action" href="/aprendre" aria-describedby="home-learn" onClick={route(onLearn)}><ModeIcon mode="learning" />{homeCopy.learning}</a>
                <p className="mode-caption" id="home-learn">{homeCopy.learningCaption}</p></li>
              <li className="mode-daily"><a className="daily-entry" href={DAILY_CHALLENGE_PUBLIC_PATH} onClick={route(onDaily)}>
                <ModeIcon mode="daily" />
                <span>
                  <span className="daily-head"><span className="daily-title">{d.title}</span><span className="daily-number">#{daily.number}</span></span>
                  <span className="daily-caption">{daily.status === 'new' ? d.sameForEveryone : <>{daily.status === 'won' ? d.wonWith(daily.mistakes) : d.lost}<span className="daily-sep" aria-hidden="true"> · </span><span className="daily-tomorrow">{d.comeBackTomorrow}</span></>}</span>
                </span>
                <span className="daily-arrow" aria-hidden="true">→</span>
              </a></li>
            </ul>
          </nav>
        </section>
        <aside className="home-preview" aria-hidden="true">
          <AutumnLeaf />
          <span className="preview-tag">{homeCopy.previewTag}</span>
          <div className="preview-board">
            <div className="preview-drawing">
              <HangmanDrawing errors={4} seasonalErrors={0} />
            </div>
            <div className="preview-word">
              {previewSlots.map((letter, index) => <span key={`${letter || 'blank'}-${index}`} className="preview-letter">{letter}</span>)}
            </div>
          </div>
        </aside>
        {/* Phones only (CSS): the same destinations as .home-modes, re-ranked below the illustration with one dominant action. */}
        <nav className="home-quick" aria-label={homeCopy.modes}>
          <ul>
            <li className="quick-play-item"><a className="quick-play" href="/multijugador" onClick={route(onMultiplayer)}>
              <span className="quick-play-badge" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M8 5.5v13l11-6.5z" /></svg></span>
              <span className="quick-play-text"><span className="quick-play-label">{homeCopy.play}</span><span className="quick-play-caption">{homeCopy.playCaption}</span></span>
              <span className="quick-play-arrow" aria-hidden="true">→</span>
            </a></li>
            <li><a className="quick-card quick-card--learn" href="/aprendre" onClick={route(onLearn)}>
              <span className="quick-card-icon"><ModeIcon mode="learning" /></span>
              <span className="quick-card-label">{homeCopy.quickLearning}</span>
            </a></li>
            <li><a className="quick-card quick-card--daily" href={DAILY_CHALLENGE_PUBLIC_PATH} onClick={route(onDaily)}>
              <span className="quick-card-icon"><ModeIcon mode="daily" /></span>
              <span className="quick-card-label">{d.title}</span>
              <span className="quick-card-tag">#{daily.number}{daily.status !== 'new' && <><span aria-hidden="true"> ✓</span><span className="sr-only"> · {homeCopy.dailyPlayed}</span></>}</span>
            </a></li>
          </ul>
        </nav>
      </div>

      {showIosInstall && <section className="ios-install-card" aria-labelledby="ios-install-title">
        <button type="button" className="ios-install-toggle" aria-expanded={installExpanded} aria-controls="ios-install-content" onClick={() => setInstallExpanded((expanded) => !expanded)}>
          <span className="ios-install-summary"><span id="ios-install-title">{t.iosInstallSummary}</span></span>
          <svg className="ios-install-chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        <div id="ios-install-content" className="ios-install-content" aria-hidden={!installExpanded}>
          <div className="ios-install-content-inner">
            <p>{t.iosInstallIntro}</p>
            <ol>
              <li>{t.iosInstallOpenPrefix} <strong>{t.iosInstallSite}</strong> {t.iosInstallOpenMiddle} <strong>{t.iosInstallBrowser}</strong>.</li>
              <li>{t.iosInstallTapButton} <strong>{t.iosInstallShare}</strong>.</li>
              <li>{t.iosInstallSelect} <strong>{t.iosInstallAddHome}</strong>.</li>
              <li>{t.iosInstallTap} <strong>{t.iosInstallAdd}</strong>.</li>
            </ol>
            <p>{t.iosInstallOutro}</p>
          </div>
        </div>
      </section>}
      {notice && <p className="form-error home-notice" role="alert">{errorMessage(notice, t)}</p>}
    </section>

    {/* Decorative divider between the hero and the modes: Catalan words drifting slowly on an ink band. */}
    <WordBand pauseLabel={homeCopy.bandPause} playLabel={homeCopy.bandPlay} />

    <div className="home-shell">
      <section className="home-cards" aria-labelledby="home-cards-title">
        <div className="section-head">
          <h2 id="home-cards-title">{homeCopy.cardsTitle}</h2>
        </div>
        <ul className="mode-cards">
          <ModeCard tone="mar" href="/multijugador" onClick={route(onMultiplayer)} title={homeCopy.multiplayer} body={homeCopy.multiplayerCard} action={homeCopy.multiplayerCardAction}
            art={<span className="mode-art-code">{'K7QF2'.split('').map((letter) => <span key={letter}>{letter}</span>)}</span>} />
          <ModeCard tone="safra" href={DAILY_CHALLENGE_PUBLIC_PATH} onClick={route(onDaily)} title={d.title} body={homeCopy.dailyCard} action={homeCopy.dailyCardAction}
            art={<span className="mode-art-grid">{['hit', 'hit', 'miss', 'hit', 'hit', 'hit', 'miss', 'hit', 'hit', 'hit'].map((cell, index) => <i key={index} className={cell} />)}</span>} />
          <ModeCard tone="oliva" href="/aprendre" onClick={route(onLearn)} title={homeCopy.learning} body={homeCopy.learningCard} action={homeCopy.learningCardAction}
            art={<span className="mode-art-hint"><span lang="es">caracol</span><strong lang="ca">cargol</strong></span>} />
          <ModeCard tone="paper" href="/com-es-juga" onClick={route(onHelp)} title={isCatalan ? 'Com es juga' : 'Cómo se juega'} body={homeCopy.helpCard} action={homeCopy.helpCardAction}
            art={<span className="mode-art-drawing"><HangmanDrawing errors={3} /></span>} />
        </ul>
      </section>
      <small className="sr-only">{getLanguageConfig(interfaceLanguage).name}</small>
    </div>
  </main>
}

const BAND_WORDS = ['rebombori', 'xiruca', 'endreçar', 'cargol', 'magrana', 'aixopluc', 'esbufegar', 'papallona', 'caliu', 'fogueró', 'barretina', 'endevinalla', 'llamp', 'xerrameca']

// Ambient drift in CSS px per second: slow enough to read as texture beside the hero, never as a moving target.
const BAND_SPEED = 6

/** The word band: identical copies of the word list drift left by exactly one copy per cycle (seamless). It renders as
 many copies as the band needs to stay covered while moving, measured from the real widths, so any viewport or zoom works.
 The band itself is the pause control (moving content needs one): click, tap, Enter or Space. With reduced motion it is
 static and not interactive. */
function WordBand({ pauseLabel, playLabel }: { pauseLabel: string; playLabel: string }) {
  const copyRef = useRef<HTMLSpanElement>(null)
  const [layout, setLayout] = useState({ copies: 2, width: 0 })
  const [paused, setPaused] = useState(false)
  const [still, setStill] = useState(() => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = () => setStill(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useLayoutEffect(() => {
    const copy = copyRef.current, band = copy?.closest<HTMLElement>('.home-band')
    if (!copy || !band || typeof ResizeObserver === 'undefined') return
    const words = [...copy.children]
    const measure = () => {
      // Natural width of one copy, rounded up to whole pixels: every copy gets exactly that width and the track shifts by
      // it, so the frame that ends a cycle lands on the same pixels as the frame that starts it (no subpixel step).
      const width = Math.ceil(words[words.length - 1].getBoundingClientRect().right - words[0].getBoundingClientRect().left)
      if (!width) return
      // The track spans the band plus the copy that scrolls out during one cycle.
      const copies = Math.ceil(band.clientWidth / width) + 1
      setLayout((current) => current.copies === copies && current.width === width ? current : { copies, width })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(band); words.forEach((word) => observer.observe(word))
    return () => observer.disconnect()
  }, [still])
  const track = (layout.width ? { '--band-shift': `${layout.width}px`, '--band-duration': `${layout.width / BAND_SPEED}s` } : {}) as CSSProperties
  const className = `home-band${layout.width && !still ? ' is-moving' : ''}${paused ? ' is-paused' : ''}`
  const words = <span className="home-band-track" lang="ca" aria-hidden="true" style={track}>
    {Array.from({ length: layout.copies }, (_, copy) => <span className="home-band-copy" key={copy} ref={copy === 0 ? copyRef : undefined}>
      {BAND_WORDS.map((word) => <span key={word}>{word}</span>)}
    </span>)}
  </span>
  if (still) return <div className={className}>{words}</div>
  const label = paused ? playLabel : pauseLabel
  return <button type="button" className={className} aria-label={label} title={label} onClick={() => setPaused((current) => !current)}>{words}</button>
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function readStoredName() {
  return readStored('hangman-name') ?? ''
}

function ModeCard({ tone, href, onClick, title, body, action, art }: { tone: 'mar' | 'safra' | 'oliva' | 'paper'; href: string; onClick: ReturnType<typeof route>; title: string; body: string; action: string; art: ReactNode }) {
  return <li className={`mode-card mode-card--${tone}`}>
    <a href={href} onClick={onClick}>
      <div className="mode-card-text">
        <h3>{title}</h3>
        <p className="mode-card-body">{body}</p>
        <span className="mode-card-action">{action}<span aria-hidden="true"> →</span></span>
      </div>
      <span className="mode-card-art" aria-hidden="true">{art}</span>
    </a>
  </li>
}

function ModeIcon({ mode }: { mode: 'multiplayer' | 'learning' | 'daily' }) {
  return <svg className="mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {mode === 'multiplayer' ? <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3 M16 5a3 3 0 0 1 0 6 M18 15a5 5 0 0 1 3 5" /></>
      : mode === 'learning' ? <><path d="M12 5v16 M3 3c4 0 6 0 9 2 3-2 5-2 9-2v16c-4 0-6 0-9 2-3-2-5-2-9-2z" /><path d="M6 8h3 M15 8h3" /></>
      : <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18 M8 3v4 M16 3v4" /><path d="M8 14h2 M12 14h2 M8 17h2" /></>}
  </svg>
}
