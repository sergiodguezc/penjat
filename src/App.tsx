import { useEffect, useRef, useState } from 'react'
import type { Language } from '../shared/game'
import type { PlayerGameView } from '../shared/protocol'
import { useChatInbox } from './multiplayer/useChatInbox'
import { RoomChat } from './components/RoomChat'
import { multiplayerTranslations } from './multiplayer/i18n'
import { Modal } from './components/Modal'
import { GamePage } from './pages/GamePage'
import { HomePage } from './pages/HomePage'
import { LobbyPage } from './pages/LobbyPage'
import { LearningPage } from './pages/LearningPage'
import { DailyChallengePage } from './pages/DailyChallengePage'
import { HowToPlayPage } from './pages/HowToPlayPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { notFoundTranslations } from '../shared/notFound'
import { SiteHeader } from './components/SiteHeader'
import { SiteFooter } from './components/SiteFooter'
import { INTERFACE_LANGUAGE_STORAGE_KEY, readInterfaceLanguage } from './localization'
import { normalizeInvitationCode, shouldResumeRoomSession } from './multiplayer/invitations'
import { REQUEST_TIMEOUT_MS, socket } from './multiplayer/socket'
import { createRoomRestorer, loadRoomSession, type RestoreStatus, type RoomRestorer } from './multiplayer/roomSession'
import { RoomRestoreNotice, SelfConnectionNotice } from './components/RoomRestoreNotice'
import { normalizeRoute, type Route } from './routing'
import { historyIndex, resolveHistoryMove } from './navigation/history'
import './App.css'

type Mode = 'home' | 'multiplayer' | 'learning' | 'daily' | 'help'
type PageCopy = { title: string; description: string; socialTitle?: string; socialDescription?: string }
type InvitationCode = string | null
type ExitKind = 'game' | 'room'
const PUBLIC_SITE_ORIGIN = 'https://penjat.cat'
const LEARNING_UNIT_KEY = 'penjat-learning-unit'

function readInvitationCode(): InvitationCode {
  const params = new URLSearchParams(window.location.search)
  return params.has('sala') ? normalizeInvitationCode(params.get('sala')) : null
}

const routeDescriptions: Record<Route, { mode: Mode; copy: Record<Language, PageCopy> }> = {
  '/': {
    mode: 'home',
    copy: {
      ca: { title: 'Penjat — Joc del penjat online en català', description: 'Juga al Penjat online en català. Endevina paraules, juga amb amics i aprèn vocabulari català de manera divertida.' },
      es: { title: 'Penjat — Juego del ahorcado online', description: 'Juega a Penjat online en español. Adivina palabras, juega con amigos y aprende vocabulario de forma divertida.' },
    },
  },
  '/multijugador/': {
    mode: 'multiplayer',
    copy: {
      ca: { title: 'Penjat multijugador — Juga online amb amics', description: 'Juga a Penjat multijugador online amb amics. Crea una sala, comparteix el codi i competeix en català o castellà.' },
      es: { title: 'Penjat multijugador — Juega online con amigos', description: 'Juega a Penjat multijugador online con amigos. Crea una sala, comparte el código y compite en catalán o español.' },
    },
  },
  '/aprendre/': {
    mode: 'learning',
    copy: {
      ca: { title: 'Aprèn vocabulari català jugant al penjat | Penjat', description: 'Aprèn vocabulari català jugant al penjat. Paraules per temes (natura, animals, menjar, casa, ciutat, emocions) amb definicions, exemples i traducció al castellà.' },
      es: { title: 'Aprende vocabulario en catalán jugando | Penjat', description: 'Aprende catalán jugando al ahorcado: palabras por temas (naturaleza, animales, comida, casa, ciudad, emociones) con definiciones, ejemplos y traducción al español.' },
    },
  },
  '/paraula-del-dia/': {
    mode: 'daily',
    copy: {
      ca: {
        title: 'El penjat del dia: endevina una paraula en català | Penjat',
        description: 'Juga al penjat del dia en català. Cada dia hi ha una nova paraula, la mateixa per a tothom. Endevina-la i comparteix el resultat.',
        socialTitle: 'Paraula del dia | Penjat',
        socialDescription: 'Endevina la paraula catalana del dia jugant al Penjat i comparteix el resultat sense revelar-la.',
      },
      es: {
        title: 'El ahorcado del día: adivina una palabra en catalán | Penjat',
        description: 'Juega al ahorcado del día en catalán. Cada día hay una palabra nueva, la misma para todos. Adivínala y comparte el resultado.',
        socialTitle: 'Palabra del día | Penjat',
        socialDescription: 'Adivina la palabra catalana del día jugando a Penjat y comparte el resultado sin revelarla.',
      },
    },
  },
  '/com-es-juga/': {
    mode: 'help',
    copy: {
      ca: { title: 'Com es juga a Penjat? | Penjat', description: 'Descobreix com es juga a Penjat, tant en multijugador com en mode d’aprenentatge de vocabulari.' },
      es: { title: '¿Cómo se juega a Penjat? | Penjat', description: 'Descubre cómo jugar a Penjat, tanto en multijugador como en el modo de aprendizaje de vocabulario.' },
    },
  },
}

const notFoundPage: { mode: Mode; copy: Record<Language, PageCopy> } = { mode: 'home', copy: notFoundTranslations }

function App() {
  const [route, setRoute] = useState<Route | null>(() => {
    const current = normalizeRoute(window.location.pathname)
    window.history.replaceState({ penjatIndex: historyIndex(window.history.state) ?? 0 }, '', `${current ?? window.location.pathname}${window.location.search}${window.location.hash}`)
    return current
  })
  // The shown history entry: popstate compares against it to undo a guarded Back/Forward until the player decides.
  const historyPosition = useRef(historyIndex(window.history.state) ?? 0)
  const shownUrl = useRef(`${window.location.pathname}${window.location.search}`)
  const allowHistoryMove = useRef(false)
  const popStateHandler = useRef(() => {})
  const [interfaceLanguage, setInterfaceLanguage] = useState<Language>(() => readInterfaceLanguage(localStorage))
  const [gameLanguage, setGameLanguage] = useState<Language>(() => {
    const stored = localStorage.getItem('hangman-game-language')
    return stored === 'es' || stored === 'ca' ? stored : 'ca'
  })
  const [room, setRoom] = useState<PlayerGameView | null>(null)
  const [leavingRoom, setLeavingRoom] = useState(false)
  const { state: chatState, history: chatHistory, message: chatMessage, reaction: chatReaction, markRead: markChatRead, notificationHandled, reset: resetChat } = useChatInbox()
  const messages = chatState.messages
  const [chatDraft, setChatDraft] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [playerId, setPlayerId] = useState(() => loadRoomSession()?.playerId ?? '')
  const [notice, setNotice] = useState('')
  // Restoring a stored room starts before the first paint, so a refresh shows the reconnecting state, not the home page.
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(() => {
    const session = loadRoomSession()
    return session && shouldResumeRoomSession(session.roomCode, readInvitationCode()) ? 'restoring' : 'idle'
  })
  const restorer = useRef<RoomRestorer | null>(null)
  const [typingPlayers, setTypingPlayers] = useState<Record<string, { playerId: string; playerName: string }>>({})
  const [view, setView] = useState<Mode>(() => route ? routeDescriptions[route].mode : 'home')
  // The open learning unit; null shows the unit list. A refresh reopens it; any page change returns to the list (progress is saved).
  const [learningUnit, setLearningUnit] = useState<string | null>(() => {
    try { return normalizeRoute(window.location.pathname) === '/aprendre/' ? sessionStorage.getItem(LEARNING_UNIT_KEY) : null } catch { return null }
  })
  const [dailyGameActive, setDailyGameActive] = useState(false)
  const [invitedRoomCode, setInvitedRoomCode] = useState<InvitationCode>(() => readInvitationCode())
  const [pendingExit, setPendingExit] = useState<{ kind: ExitKind; exit: () => void } | null>(null)
  const page = route ? routeDescriptions[route] : notFoundPage

  useEffect(() => {
    const onPopState = () => popStateHandler.current()
    window.addEventListener('popstate', onPopState)
    const update = (state: PlayerGameView) => {
      if (!shouldResumeRoomSession(state.code, readInvitationCode())) return
      setRoom(state); setGameLanguage(state.gameLanguage); localStorage.setItem('hangman-game-language', state.gameLanguage)
    }
    socket.on('room:state', update)
    const history = chatHistory
    const message = chatMessage
    socket.on('chat:history', history)
    socket.on('chat:message', message)
    const reaction = chatReaction
    socket.on('chat:reaction-updated', reaction)
    const typing = (payload: { playerId: string; playerName: string; isTyping: boolean }) => setTypingPlayers((current) => {
      const next = { ...current }
      if (payload.isTyping) next[payload.playerId] = payload
      else delete next[payload.playerId]
      return next
    })
    socket.on('chat:typing', typing)
    const roomRestorer = createRoomRestorer({
      socket, invitation: readInvitationCode, timeoutMs: REQUEST_TIMEOUT_MS,
      onStatus: (status) => {
        setRestoreStatus(status)
        if (status === 'replaced' || status === 'left') { setRoom(null); resetChat(); setChatDraft(''); setChatOpen(false); setTypingPlayers({}) }
      },
      onRestored: (session, view) => { setPlayerId(session.playerId); setNotice(''); setRoom(view) },
      onInvalid: (error) => { setPlayerId(''); setRoom(null); resetChat(); setChatDraft(''); setChatOpen(false); setTypingPlayers({}); setNotice(error) },
    })
    restorer.current = roomRestorer
    return () => {
      window.removeEventListener('popstate', onPopState)
      socket.off('room:state', update); socket.off('chat:history', history); socket.off('chat:message', message); socket.off('chat:reaction-updated', reaction); socket.off('chat:typing', typing)
      roomRestorer.dispose()
      if (restorer.current === roomRestorer) restorer.current = null
      socket.disconnect()
    }
  }, [chatHistory, chatMessage, chatReaction, resetChat])

  // A saved session restores even on a public route; ordinary visitors never need a transport there.
  const needsConnection = route === '/multijugador/' || Boolean(room) || leavingRoom || restoreStatus === 'restoring' || restoreStatus === 'failed'
  useEffect(() => {
    if (!needsConnection) { socket.disconnect(); return }
    const wake = () => {
      if (document.visibilityState !== 'visible' || socket.connected) return
      restorer.current?.resume()
      if (!socket.active) socket.connect()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    window.addEventListener('pageshow', wake)
    if (!socket.active) socket.connect(); else if (socket.connected) restorer.current?.resume()
    return () => {
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', wake); window.removeEventListener('pageshow', wake)
    }
  }, [needsConnection])

  // A tab that lost its seat reflects what other tabs store next (a new room to continue, or none).
  const [, setStorageVersion] = useState(0)
  useEffect(() => {
    if (restoreStatus !== 'replaced' && restoreStatus !== 'left') return
    const changed = () => setStorageVersion((version) => version + 1)
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [restoreStatus])

  useEffect(() => {
    try { if (learningUnit) sessionStorage.setItem(LEARNING_UNIT_KEY, learningUnit); else sessionStorage.removeItem(LEARNING_UNIT_KEY) } catch { /* the list shows after a refresh */ }
  }, [learningUnit])

  useEffect(() => {
    const copy = page.copy[interfaceLanguage]
    document.documentElement.lang = interfaceLanguage
    document.title = copy.title
    const canonical = route ? new URL(canonicalPath(route), PUBLIC_SITE_ORIGIN).href : null
    const description = copy.description
    const setMeta = (selector: string, attrs: Record<string, string>) => {
      let element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector)
      if (!element) {
        element = selector.startsWith('link') ? document.createElement('link') : document.createElement('meta')
        document.head.append(element)
      }
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value)
    }
    const removeIfPresent = (selector: string) => document.head.querySelectorAll(selector).forEach((node) => node.remove())
    setMeta('meta[name="description"]', { name: 'description', content: description })
    setMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' })
    setMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: 'Penjat' })
    setMeta('meta[property="og:title"]', { property: 'og:title', content: copy.socialTitle ?? copy.title })
    setMeta('meta[property="og:description"]', { property: 'og:description', content: copy.socialDescription ?? description })
    if (canonical) setMeta('meta[property="og:url"]', { property: 'og:url', content: canonical })
    else removeIfPresent('meta[property="og:url"]')
    setMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary' })
    setMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: copy.socialTitle ?? copy.title })
    setMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: copy.socialDescription ?? description })
    if (canonical) setMeta('link[rel="canonical"]', { rel: 'canonical', href: canonical })
    else removeIfPresent('link[rel="canonical"]')
    removeIfPresent('link[rel="alternate"][hreflang]')
  }, [interfaceLanguage, page, route])

  const goTo = (next: Route | null, options: { replace?: boolean; pathname?: string } = {}) => {
    const pathname = next ?? options.pathname ?? window.location.pathname
    if (next !== route || window.location.search) {
      const method = options.replace ? 'replaceState' : 'pushState'
      window.history[method]({ penjatIndex: options.replace ? historyPosition.current : ++historyPosition.current }, '', pathname)
    }
    shownUrl.current = pathname
    allowHistoryMove.current = false
    setRoute(next)
    setView(next ? routeDescriptions[next].mode : 'home')
    setInvitedRoomCode(null)
    setLearningUnit(null)
  }

  const changeInterfaceLanguage = (next: Language) => {
    setInterfaceLanguage(next)
    localStorage.setItem(INTERFACE_LANGUAGE_STORAGE_KEY, next)
  }
  const leaveRoom = () => {
    socket.emit('chat:typing', { isTyping: false })
    // Wait for departure before closing the transport; queued packets can otherwise lose to DISCONNECT.
    if (socket.connected) {
      setLeavingRoom(true)
      socket.timeout(REQUEST_TIMEOUT_MS).emit('room:leave', () => setLeavingRoom(false))
    } else socket.emit('room:leave')
    restorer.current?.forget()
    setPlayerId('')
    setRoom(null)
    resetChat()
    setChatDraft(''); setChatOpen(false)
    setTypingPlayers({})
  }
  const leave = (destination: Route = '/multijugador/') => {
    leaveRoom()
    goTo(destination, { replace: true })
  }
  const enterRoom = (view: PlayerGameView, id: string) => {
    restorer.current?.reset()
    setChatDraft(''); setChatOpen(false)
    resetChat()
    setPlayerId(id)
    setNotice('')
    setRoom(view)
    if (route === '/multijugador/' && window.location.search) goTo('/multijugador/', { replace: true })
  }

  useEffect(() => {
    if (room) return
    if (view !== page.mode) setView(page.mode)
  }, [page.mode, room, view])

  const startMultiplayer = () => goTo('/multijugador/')
  const startLearning = () => goTo('/aprendre/')
  const startDaily = () => goTo('/paraula-del-dia/')
  const startHelp = () => goTo('/com-es-juga/')
  const returnHome = () => goTo('/')

  // Visible exit labels say what the button ends rather than a generic "back"; ordinary navigation lives in the header.
  const navigationCopy = interfaceLanguage === 'ca'
    ? { backToUnits: 'Torna a les unitats', leaveRoom: 'Surt de la sala', leaveMatch: 'Surt de la partida' }
    : { backToUnits: 'Volver a las unidades', leaveRoom: 'Salir de la sala', leaveMatch: 'Salir de la partida' }
  // What leaving the current page would end: a waiting room, an active match, or an unfinished daily game.
  // Learning is never guarded: every guess and finished word is already saved.
  // A room still being restored is guarded like a room: going elsewhere then gives it up.
  const restoringRoom = !room && (restoreStatus === 'restoring' || restoreStatus === 'failed')
  const lostSeat = restoreStatus === 'replaced' || restoreStatus === 'left'
  const exitGuard = (): ExitKind | null => room
    ? room.roomStatus === 'waiting' ? 'room' : room.roomStatus === 'active' ? 'game' : null
    : restoringRoom ? 'room' : view === 'daily' && dailyGameActive ? 'game' : null
  const requestConfirmedExit = (exit: () => void, confirmation: ExitKind | null) => {
    if (!confirmation) { exit(); return }
    setPendingExit({ kind: confirmation, exit })
  }
  const cancelExit = () => setPendingExit(null)
  const confirmExit = () => {
    const exit = pendingExit?.exit
    setPendingExit(null)
    exit?.()
  }
  // Header links never drop a room or an unfinished game silently: leaving asks first, then goes to the chosen page.
  const navigate = (next: Route) => {
    if (room || restoringRoom) { requestConfirmedExit(() => leave(next), exitGuard()); return }
    if (lostSeat) setRestoreStatus('idle')
    if (next === route) { goTo(next); return }
    requestConfirmedExit(() => goTo(next), exitGuard())
  }
  // Browser Back/Forward follow the same guard as header links. A guarded move is undone first, so the dialog stays on
  // the page (and game) it belongs to: Cancel keeps playing, Confirm replays the move. Dialogs never outlive a page change.
  const handlePopState = () => {
    const targetIndex = historyIndex(window.history.state)
    const next = normalizeRoute(window.location.pathname)
    const nextPath = next ?? window.location.pathname
    const move = resolveHistoryMove({ currentIndex: historyPosition.current, targetIndex, currentUrl: shownUrl.current,
      targetUrl: `${window.location.pathname}${window.location.search}`, guarded: exitGuard() !== null, allowed: allowHistoryMove.current })
    allowHistoryMove.current = false
    if (move.action === 'ignore') return
    if (move.action === 'confirm') {
      const { delta } = move
      if (delta) window.history.go(-delta)
      else window.history.pushState({ penjatIndex: ++historyPosition.current }, '', shownUrl.current)
      setPendingExit({ kind: exitGuard() ?? 'game', exit: delta ? () => { allowHistoryMove.current = true; window.history.go(delta) } : () => { if (room || restoringRoom) leaveRoom(); goTo(next, { replace: Boolean(room || restoringRoom), pathname: nextPath }) } })
      return
    }
    setPendingExit(null)
    historyPosition.current = targetIndex ?? historyPosition.current + 1
    window.history.replaceState({ penjatIndex: historyPosition.current }, '', `${nextPath}${window.location.search}${window.location.hash}`)
    shownUrl.current = `${nextPath}${window.location.search}`
    if (room || restoringRoom) leaveRoom()
    if (lostSeat) setRestoreStatus('idle')
    setRoute(next)
    setView(next ? routeDescriptions[next].mode : 'home')
    setInvitedRoomCode(next === '/multijugador/' ? readInvitationCode() : null)
    setLearningUnit(null)
    const session = loadRoomSession()
    if (session && !shouldResumeRoomSession(session.roomCode, readInvitationCode())) {
      setRoom(null); resetChat(); setChatDraft(''); setChatOpen(false); setTypingPlayers({}); setPlayerId(''); setNotice('')
      socket.disconnect()
      if (next === '/multijugador/') socket.connect()
    }
  }
  useEffect(() => { popStateHandler.current = handlePopState })
  const exitDialog = pendingExit ? <ExitConfirmationDialog language={interfaceLanguage} kind={pendingExit.kind} onCancel={cancelExit} onConfirm={confirmExit} /> : null
  const section = !route ? undefined : room || restoreStatus !== 'idle' ? 'multiplayer' : view
  const header = (exit?: { label: string; onExit: () => void }) => <SiteHeader language={interfaceLanguage} current={section} onLanguage={changeInterfaceLanguage}
    onNavigate={navigate} exit={exit} sticky={!room && (view === 'home' || view === 'help' || view === 'multiplayer')} />
  const footer = <SiteFooter language={interfaceLanguage} onNavigate={navigate} />

  const retryRestore = () => restorer.current?.retry()
  const connectionNotice = <SelfConnectionNotice language={interfaceLanguage} status={restoreStatus} onRetry={retryRestore} />
  if (!route) return <>{header()}<NotFoundPage language={interfaceLanguage} onHome={() => navigate('/')} />{footer}{exitDialog}</>
  if (!room && restoreStatus !== 'idle') return <>{header()}<RoomRestoreNotice language={interfaceLanguage} status={restoreStatus} roomCode={loadRoomSession()?.roomCode ?? null} lostToken={restorer.current?.lostToken() ?? null}
    onRetry={retryRestore} onLeave={() => leave()} onDismiss={() => { setRestoreStatus('idle'); goTo('/multijugador/') }} />{exitDialog}</>
  if (!room && view === 'learning') return <>{header(learningUnit ? { label: navigationCopy.backToUnits, onExit: () => setLearningUnit(null) } : undefined)}<LearningPage language={interfaceLanguage} unitId={learningUnit} onUnit={setLearningUnit} />{exitDialog}</>
  if (!room && view === 'daily') return <>{header()}<DailyChallengePage language={interfaceLanguage} onActiveGameChange={setDailyGameActive} onHome={returnHome} />{exitDialog}</>
  if (!room && view === 'multiplayer') return <>{header()}<HomePage interfaceLanguage={interfaceLanguage} gameLanguage={gameLanguage} notice={notice} invitedRoomCode={invitedRoomCode} onEnter={enterRoom} onResume={retryRestore} onLearn={startLearning} onMultiplayer={startMultiplayer} onHelp={startHelp} mode="multiplayer" />{footer}{exitDialog}</>
  if (!room && view === 'help') return <>{header()}<HowToPlayPage language={interfaceLanguage} onNavigate={navigate} />{footer}{exitDialog}</>
  if (!room) return <>{header()}<HomePage interfaceLanguage={interfaceLanguage} gameLanguage={gameLanguage} notice={notice} onEnter={enterRoom} onResume={retryRestore} onLearn={startLearning} onDaily={startDaily} onMultiplayer={startMultiplayer} onHelp={startHelp} mode="home" />{footer}{exitDialog}</>
  const chat = <RoomChat messages={messages} currentPlayerId={playerId} typingPlayers={Object.values(typingPlayers)} t={multiplayerTranslations[interfaceLanguage]} language={interfaceLanguage} draft={chatDraft} onDraftChange={setChatDraft} mobileOpen={chatOpen} onMobileOpenChange={setChatOpen} enabled={restoreStatus === 'idle'} unreadIds={chatState.unreadIds} olderUnread={chatState.olderUnread} notification={chatState.notification} onRead={markChatRead} onNotificationHandled={notificationHandled} />
  if (room.roomStatus === 'waiting') return <>{header({ label: navigationCopy.leaveRoom, onExit: () => leave() })}{connectionNotice}<LobbyPage state={room} interfaceLanguage={interfaceLanguage} chat={chat} messages={messages} playerId={playerId} typingPlayers={Object.values(typingPlayers)} />{exitDialog}</>
  return <>{header({ label: room.roomStatus === 'active' ? navigationCopy.leaveMatch : navigationCopy.leaveRoom, onExit: () => requestConfirmedExit(() => leave(), room.roomStatus === 'active' ? 'game' : null) })}{connectionNotice}<GamePage onLeave={() => leave()} onExitToMenu={() => leave('/')} state={room} interfaceLanguage={interfaceLanguage} chat={chat} messages={messages} playerId={playerId} typingPlayers={Object.values(typingPlayers)} />{exitDialog}</>
}

export default App

function canonicalPath(route: Route): string {
  return route === '/' ? '/' : route.replace(/\/$/, '')
}

function ExitConfirmationDialog({ language, kind, onCancel, onConfirm }: { language: Language; kind: ExitKind; onCancel: () => void; onConfirm: () => void }) {
  const copy = {
    ca: {
      game: { title: 'Vols acabar la partida?', body: "Si surts ara, la partida actual s'acabarà.", confirm: 'Acaba la partida' },
      room: { title: 'Vols sortir de la sala?', body: 'Si surts, hauràs de tornar a entrar amb el codi de la sala.', confirm: 'Surt de la sala' },
      cancel: 'Cancel·la',
    },
    es: {
      game: { title: '¿Quieres terminar la partida?', body: 'Si sales ahora, la partida actual terminará.', confirm: 'Terminar partida' },
      room: { title: '¿Quieres salir de la sala?', body: 'Si sales, tendrás que volver a entrar con el código de la sala.', confirm: 'Salir de la sala' },
      cancel: 'Cancelar',
    },
  }[language]

  return <Modal className="exit-confirmation-dialog" labelledBy="exit-confirmation-title" describedBy="exit-confirmation-copy" onCancel={onCancel}>
      <h2 id="exit-confirmation-title">{copy[kind].title}</h2>
      <p id="exit-confirmation-copy">{copy[kind].body}</p>
      <div className="exit-confirmation-actions">
        <button type="button" className="secondary-action" data-modal-initial-focus onClick={onCancel}>{copy.cancel}</button>
        <button type="button" className="primary-action danger-action" onClick={onConfirm}>{copy[kind].confirm}</button>
      </div>
  </Modal>
}
