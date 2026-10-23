import assert from 'node:assert/strict'
import { GameRoom } from '../server/game/GameRoom'
import { chatSticksToBottom, multiplayerPhase } from '../src/multiplayer/presentation'
import * as presentation from '../src/multiplayer/presentation'
import { rankByScore } from '../shared/ranking'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicPlayer, RoundResultEntry } from '../shared/protocol'
import { ForgivenessTray } from '../src/components/ForgivenessTray'
import { ObserverSelector } from '../src/components/ObserverSelector'
import { PlayerRoundStatusNotice } from '../src/components/PlayerRoundStatusNotice'
import { RoundResults } from '../src/components/RoundResults'
import { Scoreboard } from '../src/components/Scoreboard'
import { AbsenceNotice } from '../src/components/AbsenceNotice'
import { LobbyPage } from '../src/pages/LobbyPage'
import { RoomChat } from '../src/components/RoomChat'
import { liveRanking } from '../src/multiplayer/liveRanking'
import { FinalStandings } from '../src/components/MatchResults'
import { matchStandings } from '../src/multiplayer/matchResults'
import { multiplayerTranslations } from '../src/multiplayer/i18n'
import { MultiplayerWord } from '../src/components/MultiplayerWord'
import { groupDisplayWord, splitWord, spokenWord } from '../src/multiplayer/wordRows'

const solvedCa = renderToStaticMarkup(<PlayerRoundStatusNotice phase="guessing" status="solved" t={multiplayerTranslations.ca} />)
const solvedEs = renderToStaticMarkup(<PlayerRoundStatusNotice phase="guessing" status="solved" t={multiplayerTranslations.es} />)
const eliminated = renderToStaticMarkup(<PlayerRoundStatusNotice phase="guessing" status="eliminated" t={multiplayerTranslations.ca} />)
assert.match(solvedCa, /Has encertat la paraula!/)
assert.match(solvedCa, /role="status"/)
assert.match(solvedEs, /¡Has acertado la palabra!/)
assert.match(eliminated, /Has quedat fora/)

const players: PublicPlayer[] = [
  { id: 'A', name: 'Player A', score: 0, connectionState: 'connected', active: true, roundStatus: 'setter' },
  { id: 'B', name: 'Winner', score: 2, connectionState: 'connected', active: true, roundStatus: 'solved' },
  { id: 'D', name: 'Forgiven', score: 1, connectionState: 'connected', active: true, roundStatus: 'solved' },
  { id: 'C', name: 'Out', score: 0, connectionState: 'connected', active: true, roundStatus: 'failed' },
]
const results: RoundResultEntry[] = [
  { playerId: 'B', position: 1, status: 'solved', forgiven: false, errors: 1, resolutionTimeMs: 1250, pointsAwarded: 3 },
  { playerId: 'D', position: 2, status: 'solved', forgiven: true, errors: 6, resolutionTimeMs: 31000, pointsAwarded: 1 },
  { playerId: 'C', position: 3, status: 'failed', forgiven: false, errors: 6, resolutionTimeMs: 2500, pointsAwarded: 0 },
  { playerId: 'A', position: null, status: 'setter', forgiven: false, errors: null, resolutionTimeMs: null, pointsAwarded: 0 },
]
const resultMarkup = renderToStaticMarkup(<RoundResults results={results} players={players} t={multiplayerTranslations.es} />)
assert.match(resultMarkup, /class="round-result-points"[^>]*>\+3/)
assert.match(resultMarkup, /class="round-result-row outcome-solved"/)
assert.match(resultMarkup, /Winner/)
assert.match(resultMarkup, /class="sr-only">Palabra acertada<\/span>/)
assert.match(resultMarkup, /1 error · 1.3 s/)
assert.match(resultMarkup, /Forgiven/)
assert.match(resultMarkup, /class="round-result-row outcome-forgiven"/)
assert.match(resultMarkup, /class="sr-only">Palabra acertada después del perdón<\/span>/)
assert.match(resultMarkup, /6 errores · 31 s · Perdonada/)
assert.match(resultMarkup, /Ahorcado/)
assert.match(resultMarkup, /class="round-result-row outcome-failed"/)
assert.doesNotMatch(resultMarkup, /2.5 s/)
assert.match(resultMarkup, /Player A/)
assert.match(resultMarkup, /Palabra/)
assert.match(resultMarkup, /class="round-result-row outcome-setter"/)
assert.equal((resultMarkup.match(/round-result-status-dot/g) ?? []).length, 0)
assert.doesNotMatch(resultMarkup, /round-result-status-dot|round-result-outcome|🟢|🟡|🔴|✏️/)
assert.match(resultMarkup, /\+0/)
assert.doesNotMatch(resultMarkup, /<table|<thead|Pos\./)
assert.ok(resultMarkup.indexOf('Winner') < resultMarkup.indexOf('Forgiven'))
assert.ok(resultMarkup.indexOf('Forgiven') < resultMarkup.indexOf('Out'))
assert.ok(resultMarkup.indexOf('Out') < resultMarkup.indexOf('Player A'))

const catalanResults = renderToStaticMarkup(<RoundResults results={results} players={players} t={multiplayerTranslations.ca} />)
assert.match(catalanResults, /1 error · 1.3 s/)
assert.match(catalanResults, /6 errors · 31 s · Perdonada/)
assert.match(catalanResults, /Penjat/)
assert.match(catalanResults, /Paraula/)

const observerPlayers = Array.from({ length: 9 }, (_, index) => ({ ...players[(index % players.length)], id: `player-${index}`, name: `Player ${index} with a long name` }))
const observerMarkup = renderToStaticMarkup(<ObserverSelector players={observerPlayers} selectedPlayerId="player-7" t={multiplayerTranslations.ca} onSelect={() => {}} />)
assert.match(observerMarkup, /role="tablist"/)
assert.match(observerMarkup, /role="tab"[^>]*aria-selected="true"/)
assert.match(observerMarkup, /title="Player 7 with a long name"/)
assert.match(observerMarkup, /class="observer-tabs"/)
assert.doesNotMatch(observerMarkup, /<strong>Observar jugador<\/strong>/)

const scoreboardPlayers: PublicPlayer[] = [
  { id: 'A', name: 'Manolo 1', score: 4, connectionState: 'disconnected', active: false, roundStatus: 'eliminated' },
  { id: 'B', name: 'Manolo 2', score: 4, connectionState: 'connected', active: true, roundStatus: 'solved' },
  { id: 'C', name: 'Manolo 3', score: 2, connectionState: 'connected', active: true, roundStatus: 'setter' },
]
const scoreboardMarkup = renderToStaticMarkup(<Scoreboard players={scoreboardPlayers} setterId="C" currentId="B" t={multiplayerTranslations.es} />)
const activeClassification = scoreboardMarkup.match(/<ol>.*?<\/ol>/)?.[0] ?? ''
// The self badge is a separate element after the full name, so long names can wrap without hiding it.
assert.match(activeClassification, /<li class="is-self"><span class="rank">1<\/span><span class="player-identity"><span class="player-name">Manolo 2<\/span><span class="player-self">tú<\/span><\/span>/)
assert.match(activeClassification, /<li><span class="rank">2<\/span><span class="player-identity"><span class="player-name">Manolo 3<\/span><\/span>/)
assert.equal(activeClassification.match(/class="player-self"/g)?.length, 1)
assert.doesNotMatch(activeClassification, /· tú/)
assert.doesNotMatch(activeClassification, /Manolo 1|>3<\/span>/)
assert.match(scoreboardMarkup, /Ya no están en la sala/)
assert.match(scoreboardMarkup, /<section class="departed-players"[^>]*>.*Manolo 1.*<strong>4<\/strong>/)
assert.doesNotMatch(scoreboardMarkup.match(/<section class="departed-players"[\s\S]*?<\/section>/)?.[0] ?? '', /<span class="rank"|ha acertado|elige la palabra/)

// An away player keeps a ranked seat and score, labelled as disconnected (not departed), and never blocks a rematch.
{
  const withAway: PublicPlayer[] = [...scoreboardPlayers, { id: 'D', name: 'Lluna', score: 3, connectionState: 'disconnected', active: true, roundStatus: 'eliminated' }]
  for (const [language, label] of [['ca', 'Desconnectat'], ['es', 'Desconectado']] as const) {
    const markup = renderToStaticMarkup(<Scoreboard players={withAway} setterId="C" currentId="B" t={multiplayerTranslations[language]} />)
    const ranked = markup.match(/<ol>.*?<\/ol>/)?.[0] ?? ''
    assert.match(ranked, new RegExp(`Lluna.*<strong>3</strong><small class="is-reconnecting">${label}</small>`))
  }
  const match = { status: 'match-over' as const, ownerId: 'B', turnOrder: [], turnIndex: 0, voltaNumber: 1, completedTurns: 0, totalTurns: 0, rematchReadyPlayerIds: ['B', 'C'] }
  const rematch = presentation.rematchAvailability({ players: withAway, match, roomStatus: 'match-over' })
  assert.equal(rematch.total, 2); assert.deepEqual(rematch.readyIds, ['B', 'C'])
}

// Back after an absence: a neutral "next turn" notice, never "Has quedat fora"; the scoreboard says the same.
for (const language of ['ca', 'es'] as const) {
  const t = multiplayerTranslations[language]
  const markup = renderToStaticMarkup(<PlayerRoundStatusNotice phase="guessing" status="eliminated" spectating t={t} />)
  assert.ok(markup.includes(t.spectatingTitle) && markup.includes(t.spectatingBody))
  assert.ok(!markup.includes(t.youAreOut))
  const board = renderToStaticMarkup(<Scoreboard players={[...scoreboardPlayers, { id: 'E', name: 'Torna', score: 1, connectionState: 'connected', active: true, roundStatus: 'spectating' }]} setterId="C" currentId="B" t={t} />)
  assert.ok(board.includes(t.statusSpectating))
}
// The absence strip names who is reconnecting; its action appears only for players the server lets this viewer skip.
{
  const base = new GameRoom('ABSNT', 'ca', 1, () => 0)
  base.addPlayer('h', 's-h', 't-h', 'Host'); base.addPlayer('g', 's-g', 't-g', 'Guest'); base.addPlayer('x', 's-x', 't-x', 'Xènia')
  base.markReconnecting('h', 's-h')
  for (const [viewer, offered] of [['g', true], ['x', false]] as const) {
    const markup = renderToStaticMarkup(<AbsenceNotice state={base.viewFor(viewer)} t={multiplayerTranslations.ca} language="ca" />)
    assert.ok(markup.includes('Host ha perdut la connexió. Té 2 minuts per tornar.'))
    assert.equal(markup.includes('Continua sense Host'), offered)
  }
  const es = renderToStaticMarkup(<AbsenceNotice state={base.viewFor('g')} t={multiplayerTranslations.es} language="es" />)
  assert.ok(es.includes('Host ha perdido la conexión. Tiene 2 minutos para volver.') && es.includes('Continuar sin Host'))
  assert.equal(renderToStaticMarkup(<AbsenceNotice state={base.viewFor('x')} t={multiplayerTranslations.ca} language="ca" onlyWhenBlocking />), '')
}

// Lobby rules: a compact summary (two pills) for everyone; only the host gets "Configura", which opens the dialog.
{
  const lobby = new GameRoom('LOBBY', 'es', 1, () => 0)
  lobby.addPlayer('h', 's-h', 't-h', 'Host'); lobby.addPlayer('g', 's-g', 't-g', 'Guest')
  for (const language of ['ca', 'es'] as const) {
    const t = multiplayerTranslations[language]
    const render = (id: string) => renderToStaticMarkup(<LobbyPage state={lobby.viewFor(id)} interfaceLanguage={language} messages={[]} playerId={id} typingPlayers={[]} />)
    const host = render('h'), guest = render('g')
    const pills = `<ul class="lobby-rules-pills" aria-live="polite"><li>${t.languagePill('es')}</li><li>${t.roundsPill(1)}</li></ul>`
    assert.ok(host.includes(pills) && guest.includes(pills), 'same live summary for everyone')
    assert.ok(host.includes(`<h2 id="lobby-rules-title">${t.invitationRules}</h2><button type="button" class="secondary-action lobby-rules-configure" aria-haspopup="dialog">${t.configure}</button>`))
    assert.ok(!guest.includes('lobby-rules-configure') && !guest.includes(t.startMatch))
    assert.ok(!host.includes('target-selector') && !host.includes('lobby-settings-dialog'), 'controls only inside the dialog, closed at first')
    assert.ok(host.includes(t.startMatch) && guest.includes(t.waitingForHost('Host')))
    assert.ok(!host.includes(`${t.voltes}: `), 'rules are not repeated in the meta line')
    assert.equal(t.roundsPill(3), language === 'ca' ? '3 rondes' : '3 rondas')
    assert.equal(t.languagePill('ca'), language === 'ca' ? 'En català' : 'En catalán')
  }
}

const catalanScoreboard = renderToStaticMarkup(<Scoreboard players={scoreboardPlayers} setterId="C" currentId="B" t={multiplayerTranslations.ca} />)
assert.match(catalanScoreboard, /Ja no són a la sala/)
const noDepartedScoreboard = renderToStaticMarkup(<Scoreboard players={players} setterId="A" currentId="B" t={multiplayerTranslations.es} />)
assert.doesNotMatch(noDepartedScoreboard, /departed-players|Ya no están en la sala/)

// Phase 2C compact live ranking (stacked layouts): leaders + own place while collapsed; the full list stays in the DOM.
const roster = (scores: number[], extra: Partial<Record<number, Partial<PublicPlayer>>> = {}, names?: string[]): PublicPlayer[] =>
  scores.map((score, index) => ({ id: `p${index}`, name: names?.[index] ?? `Jugador ${index}`, score, connectionState: 'connected', active: true, roundStatus: 'playing', ...extra[index] }))
const render = (list: PublicPlayer[], currentId = 'p0', language: 'ca' | 'es' = 'ca', setterId: string | null = null) =>
  renderToStaticMarkup(<Scoreboard players={list} setterId={setterId} currentId={currentId} t={multiplayerTranslations[language]} />)
const summaryOf = (markup: string) => markup.match(/<div class="scoreboard-summary">[\s\S]*?<\/div><button/)?.[0] ?? ''
const fullOf = (markup: string) => markup.match(/<div class="scoreboard-full"[\s\S]*$/)?.[0] ?? ''

// Two and three players: short enough to stay a full list.
for (const count of [2, 3]) {
  const markup = render(roster([3, 1, 0].slice(0, count)))
  assert.doesNotMatch(markup, /scoreboard-summary|scoreboard-toggle|is-collapsible/, `${count} players need no disclosure`)
  assert.equal(liveRanking(roster([3, 1, 0].slice(0, count)), 'p0').collapsible, false)
}

// Ten players, current player in the middle: one leader named, own place shown, disclosure collapsed by default.
const tenScores = [8, 12, 11, 10, 8, 6, 5, 3, 2, 0]
for (const language of ['ca', 'es'] as const) {
  const t = multiplayerTranslations[language]
  const ten = render(roster(tenScores), 'p0', language)
  assert.match(ten, /class="scoreboard is-collapsible"/)
  const toggle = ten.match(/<button type="button" class="scoreboard-toggle" aria-expanded="false" aria-controls="([^"]+)">/)
  assert.ok(toggle, 'native button with aria-expanded/aria-controls')
  assert.match(ten, new RegExp(`<div class="scoreboard-full" id="${toggle[1]}">`))
  assert.ok(ten.includes(`>${t.showFullRanking}<`))
  assert.ok(ten.includes(t.playerCount(10)))
  const summary = summaryOf(ten)
  assert.ok(summary.includes('Jugador 1') && summary.includes(t.points(12)), 'unique leader with score')
  assert.equal(summary.match(/class="player-self"/g)?.length, 1)
  assert.ok(summary.includes(t.placeLabel(t.ordinal(4))) && summary.includes(`${t.tied}<`), 'shared fourth place is marked as a tie')
  assert.ok(summary.includes(t.points(8)))
  assert.equal(fullOf(ten).match(/<li/g)?.length, 10, 'complete classification preserved')
  assert.match(fullOf(ten), /<span class="rank">4<\/span><span class="player-identity"><span class="player-name">Jugador 0<\/span><span class="player-self">/)
  assert.match(fullOf(ten), /<span class="rank">4<\/span><span class="player-identity"><span class="player-name">Jugador 4<\/span><\/span>/)
}
const t = multiplayerTranslations.ca
// Current player first (unique leader): named among the leaders with the badge, no separate own line.
const first = summaryOf(render(roster([20, 12, 11, 10, 8])))
assert.equal(first.match(/ranking-summary-row/g)?.length, 1)
assert.match(first, /Jugador 0<\/span><span class="player-self">tu<\/span>/)
// Current player last.
const last = summaryOf(render(roster([0, 12, 11, 10, 8])))
assert.ok(last.includes(t.placeLabel(t.ordinal(5))) && !last.includes(`${t.tied}<`))
// Tied with one leader: both names in the leader row, one badge, no own line.
const tiedWithLeader = summaryOf(render(roster([12, 12, 11, 10, 8])))
assert.equal(tiedWithLeader.match(/ranking-summary-row/g)?.length, 1)
assert.ok(tiedWithLeader.includes('Jugador 0') && tiedWithLeader.includes('Jugador 1'))
assert.equal(tiedWithLeader.match(/class="player-self"/g)?.length, 1)
// Three or more leaders stay compact (count only); own line still states the shared first place.
const manyLeaders = summaryOf(render(roster([9, 9, 9, 9, 2, 0])))
assert.ok(manyLeaders.includes(t.tiedPlayers(4)) && !manyLeaders.includes('Jugador 1'))
assert.ok(manyLeaders.includes(`${t.placeLabel(t.ordinal(1))}<span class="ranking-summary-tie"> · ${t.tied}`))
const allZero = summaryOf(render(roster(Array(10).fill(0))))
assert.ok(allZero.includes(t.tiedPlayers(10)))
// Duplicate and long names: identity follows the ID, never the name.
const dup = render(roster([5, 7, 5, 1], {}, ['Sergio', 'Sergio', 'Maria Antònia Fernández de Castro i Vilallonga', 'Sergio']), 'p3')
assert.equal(summaryOf(dup).match(/class="player-self"/g)?.length, 1)
assert.ok(summaryOf(dup).includes(t.placeLabel(t.ordinal(4))))
assert.equal(fullOf(dup).match(/class="player-self"/g)?.length, 1)
assert.match(fullOf(dup), /<span class="rank">4<\/span><span class="player-identity"><span class="player-name">Sergio<\/span><span class="player-self">/)
assert.ok(fullOf(dup).includes('Maria Antònia Fernández de Castro i Vilallonga'))
// Departed players: counted apart, excluded from active ranks and from the summary, kept with their score.
const departed = render(roster([4, 30, 6, 5, 3], { 1: { active: false, connectionState: 'disconnected' } }))
assert.ok(departed.includes(`${t.playerCount(4)} · ${t.departedCount(1)}`))
assert.ok(!summaryOf(departed).includes('Jugador 1'), 'a departed high score does not lead the live ranking')
assert.ok(summaryOf(departed).includes('Jugador 2') && summaryOf(departed).includes(t.points(6)))
assert.match(fullOf(departed), /<section class="departed-players"[^>]*>.*Jugador 1.*<strong>30<\/strong>/)
assert.equal(fullOf(departed).match(/<span class="rank">/g)?.length, 4)
assert.equal(multiplayerTranslations.es.departedCount(2), '2 han salido')
// Reconnecting players stay ranked but say so instead of a round status.
const reconnecting = render(roster([4, 6, 5, 3], { 2: { connectionState: 'reconnecting', roundStatus: 'solved' } }), 'p0', 'es', 'p3')
assert.match(fullOf(reconnecting), /Jugador 2<\/span><\/span><strong>5<\/strong><small class="is-reconnecting">Reconectando…<\/small>/)
assert.match(fullOf(reconnecting), /Jugador 3<\/span><\/span><strong>3<\/strong><small>elige la palabra<\/small>/)
// Expanded state is local UI state; a caller-provided default renders the open state with matching aria.
assert.match(renderToStaticMarkup(<Scoreboard players={roster(tenScores)} setterId={null} currentId="p0" t={t} defaultExpanded />), /class="scoreboard is-collapsible is-expanded"[\s\S]*aria-expanded="true"[\s\S]*Veure menys/)
// Live updates keep the component mounted (same React type and position in GamePage), so the state survives; see the
// Phase 2C browser checks for the real expand/collapse, keyboard and live-update interaction.
// An empty chat is marked so it can stay a compact secondary card; messages restore the normal panel.
const emptyChat = renderToStaticMarkup(<RoomChat messages={[]} currentPlayerId="p0" typingPlayers={[]} t={t} />)
assert.match(emptyChat, /<section class="room-chat is-empty" aria-label="Xat">/)
assert.match(emptyChat, /class="chat-empty">Encara no hi ha missatges\./)
const fullChat = renderToStaticMarkup(<RoomChat messages={[{ id: 'm1', senderId: 'p1', senderName: 'Júlia', text: 'Hola', timestamp: 1, reactions: { '❤️': [], '😂': [], '💀': [] } }]} currentPlayerId="p0" typingPlayers={[]} t={t} />)
assert.match(fullChat, /<section class="room-chat" aria-label="Xat">/)
assert.match(fullChat, /class="reaction-trigger" aria-label="Reacciona al missatge de Júlia" aria-expanded="false"/)
console.log('Compact live ranking regressions passed')

const request = { id: 'request-1', roundId: 'round-1', playerId: 'C', setterId: 'A', status: 'pending' as const, createdAt: 1, decidedAt: null }
assert.equal(renderToStaticMarkup(<ForgivenessTray requests={[]} players={players} t={multiplayerTranslations.ca} onDecide={() => {}} />), '')
const trayMarkup = renderToStaticMarkup(<ForgivenessTray requests={[request]} players={players} t={multiplayerTranslations.ca} onDecide={() => {}} />)
assert.match(trayMarkup, /Peticions de perdó/)
assert.match(trayMarkup, /Out/)
assert.match(trayMarkup, /Perdonar la vida/)

console.log('Multiplayer terminal-state and round-result UI checks passed')

// Actual domain transitions supply the phase; no independent UI waiting flag.
for (const count of [2, 3]) {
  const room = new GameRoom('ABC23', 'ca', 1, () => 0)
  for (let index = 0; index < count; index++) room.addPlayer(String(index), `s${index}`, `t${index}`, `P${index}`)
  room.start('0')
  const notice = (playerId: string) => {
    const view = room.viewFor(playerId)
    return renderToStaticMarkup(<PlayerRoundStatusNotice phase={multiplayerPhase(view)} status={view.self?.status ?? 'setter'} t={multiplayerTranslations.ca} />)
  }
  assert.equal(notice('1'), '')
  for (let turn = 0; turn < count; turn++) {
    const setter = String(turn)
    room.setWord(setter, 'A')
    const guessers = room.activePlayers.filter((player) => player.id !== setter)
    room.guess(guessers[0].id, 'A')
    if (count > 2) assert.match(notice(guessers[0].id), /Espera/)
    for (const player of guessers.slice(1)) room.guess(player.id, 'A')
    assert.equal(notice(guessers[0].id), '')
    if (turn + 1 < count) room.continue(String(turn + 1))
  }
  assert.equal(multiplayerPhase(room.viewFor('0')), 'match-over')
  for (const player of room.activePlayers) room.requestRematch(player.id)
  assert.equal(multiplayerPhase(room.viewFor('0')), 'choosing-word')
  assert.equal(notice('1'), '')
  room.setWord('0', 'A')
  assert.equal(notice('1'), '')
}
const abandoned = new GameRoom('ABC23', 'ca', 1, () => 0)
abandoned.addPlayer('a', 'sa', 'ta', 'A'); abandoned.addPlayer('b', 'sb', 'tb', 'B')
abandoned.start('a'); abandoned.disconnect('b')
assert.equal(abandoned.viewFor('a').round?.status, 'choosing-word')
assert.equal(multiplayerPhase(abandoned.viewFor('a')), 'match-over', 'match completion overrides retained round state')

for (const scores of [[1, 1], [5, 5, 5, 3, 3, 1], [3, 1, 2, 2]]) {
  const tiedPlayers = scores.map((score, index) => ({ ...players[0], id: String(index), name: `P${index}`, score }))
  const expected = scores.map((score) => 1 + scores.filter((other) => other > score).length)
  const ranked = rankByScore(tiedPlayers)
  for (const { player, rank } of ranked) assert.equal(rank, expected[Number(player.id)])
  const sidebar = renderToStaticMarkup(<Scoreboard players={tiedPlayers} setterId={null} currentId="" t={multiplayerTranslations.ca} />)
  const standings = matchStandings({ players: tiedPlayers, matchResult: { ranking: tiedPlayers.map((p) => p.id).reverse(), scores: Object.fromEntries(tiedPlayers.map((p) => [p.id, p.score])) } }, '')
  const final = renderToStaticMarkup(<FinalStandings standings={standings ?? []} t={multiplayerTranslations.ca} />)
  for (const { player, rank } of ranked) {
    assert.ok(sidebar.includes(`<span class="rank">${rank}</span><span class="player-identity"><span class="player-name">${player.name}</span></span>`))
    assert.match(final, new RegExp(`<span class="standing-rank" aria-hidden="true">${rank}</span><span class="standing-player">[^]*?<span class="standing-name">${player.name}</span>[^]*?<span aria-hidden="true">${player.score}</span>`))
  }
}
console.log('Audit phase transitions and shared score-tie regressions passed')

// P0 presentation follows actual server snapshots, including reconnect grace and departures.
const { rematchAvailability, hasSelectedWord } = await import('../src/multiplayer/presentation')
const { GamePage } = await import('../src/pages/GamePage')
function completedRoom(count: number) {
  const room = new GameRoom('P0234', 'ca', 1, () => 0)
  for (let i = 0; i < count; i++) room.addPlayer(String(i), `s${i}`, `t${i}`, `Player ${i}`)
  room.start('0')
  for (let i = 0; i < count; i++) {
    room.setWord(String(i), 'A')
    for (const player of room.activePlayers.filter((p) => p.id !== String(i))) room.guess(player.id, 'A')
    if (i + 1 < count) room.continue(String(i + 1))
  }
  return room
}
function gameMarkup(room: GameRoom, language: 'ca' | 'es' = 'ca', playerId = '0') {
  return renderToStaticMarkup(<GamePage state={room.viewFor(playerId)} interfaceLanguage={language} messages={[]} playerId={playerId} typingPlayers={[]} onLeave={() => {}} onExitToMenu={() => {}} />)
}
// Forgiveness retains six errors: the current resolved status must drive both players' illustrations.
for (const language of ['ca', 'es'] as const) for (const outcome of ['solved', 'failed', 'eliminated'] as const) {
  const room = new GameRoom('FIRE6', 'ca', 1, () => 0)
  for (let i = 0; i < 3; i++) room.addPlayer(String(i), `s${i}`, `t${i}`, `Player ${i}`)
  room.start('0'); room.setWord('0', 'A'); room.observePlayer('0', '1')
  for (const letter of ['B', 'C', 'D', 'E', 'F', 'G']) room.guess('1', letter)
  assert.equal(room.viewFor('1').self?.status, 'awaiting-forgiveness')
  for (const viewer of ['0', '1']) assert.match(gameMarkup(room, language, viewer), /data-expression="sad"/)
  const request = room.viewFor('0').forgivenessRequests[0]
  room.decideForgiveness('0', request.id, outcome !== 'failed')
  if (outcome !== 'failed') {
    assert.equal(room.viewFor('1').self?.errors, 6, 'forgiving a life does not erase mistakes')
    assert.equal(room.viewFor('1').self?.status, 'playing')
    room.guess('1', outcome === 'solved' ? 'A' : 'H')
  }
  assert.equal(room.viewFor('1').self?.status, outcome)
  assert.equal(room.viewFor('1').self?.errors, outcome === 'eliminated' ? 7 : 6)
  for (const viewer of ['0', '1']) {
    const beforeRender = structuredClone(room.viewFor(viewer))
    const html = gameMarkup(room, language, viewer)
    assert.deepEqual(room.viewFor(viewer), beforeRender, 'outcome illustration/rendering cannot mutate authoritative gameplay state')
    assert.match(html, new RegExp(`data-expression="${outcome === 'solved' ? 'warm' : 'sad'}"`))
    assert.equal((html.match(/data-flame=/g) ?? []).length, 0, 'the expression never rewrites the fire/mistake count')
  }
}
console.log('Castanyera forgiveness → solved/denied/eliminated rendering passed for guesser and chooser in CA/ES')
const two = completedRoom(2)
assert.deepEqual(rematchAvailability(two.viewFor('0')), { available: true, total: 2, readyIds: [] })
assert.match(gameMarkup(two), /Revenja/)
two.requestRematch('0')
two.markReconnecting('1', 's1')
assert.deepEqual(rematchAvailability(two.viewFor('0')), { available: true, total: 2, readyIds: ['0'] })
assert.match(gameMarkup(two), /1 de 2 jugadors|Esperant que torni/)
const validResult = two.viewFor('0').matchResult
two.disconnect('1')
assert.deepEqual(two.viewFor('0').matchResult, validResult, 'Departure preserves completed-match ranking and scores')
assert.deepEqual(rematchAvailability(two.viewFor('0')), { available: false, total: 1, readyIds: ['0'] })
assert.equal(hasSelectedWord(two.viewFor('0')), true)
for (const language of ['ca', 'es'] as const) {
  const markup = gameMarkup(two, language)
  assert.ok(markup.includes(multiplayerTranslations[language].rematchNotEnough))
  assert.ok(markup.includes(multiplayerTranslations[language].createNewRoom))
  assert.ok(!markup.includes(`>${multiplayerTranslations[language].rematch}</button>`))
  assert.ok(!markup.includes(multiplayerTranslations[language].roundInterrupted))
  assert.match(markup, /standing-name">Player [01]<\/span>[^]*?<span aria-hidden="true">1<\/span>/)
}
const three = completedRoom(3)
three.requestRematch('0'); three.requestRematch('1'); three.disconnect('1')
assert.deepEqual(rematchAvailability(three.viewFor('0')), { available: true, total: 2, readyIds: ['0'] })
assert.equal(three.roomStatus, 'match-over', 'Remaining active player still must consent')
three.requestRematch('2')
assert.equal(three.roomStatus, 'active')
const autoRestart = completedRoom(3)
autoRestart.requestRematch('0'); autoRestart.requestRematch('1'); autoRestart.disconnect('2')
assert.equal(autoRestart.roomStatus, 'active', 'Existing unanimity rule applies when unready participant departs')
for (const departing of ['0', '1']) {
  const room = new GameRoom('P0234', 'ca', 1, () => 0)
  room.addPlayer('0', 's0', 't0', 'Setter'); room.addPlayer('1', 's1', 't1', 'Guesser')
  room.start('0'); room.disconnect(departing)
  const remaining = departing === '0' ? '1' : '0'
  assert.equal(hasSelectedWord(room.viewFor(remaining)), false)
  for (const language of ['ca', 'es'] as const) {
    const markup = gameMarkup(room, language, remaining)
    assert.ok(markup.includes(multiplayerTranslations[language].roundInterrupted))
    assert.ok(!markup.includes(multiplayerTranslations[language].wordWas))
    assert.doesNotMatch(markup, /class="keyboard|class="round-results|class="game-columns|class="word-form|class="round-result"/)
  }
}
console.log('P0 rematch roster, reconnection, readiness and wordless-round regressions passed')

// Phase 2D: long words wrap onto the fewest balanced rows instead of scrolling; the mark-carrying rows respect `perRow`.
const lengths = (rows: unknown[][]) => rows.map((row) => row.length)
const long = [...'ELECTROENCEFALOGRAFISTA']
assert.deepEqual(lengths(splitWord(long, 23)), [23], 'a word that fits stays whole')
assert.deepEqual(lengths(splitWord(long, null)), [23], 'unmeasured (server render) stays whole')
assert.deepEqual(lengths(splitWord(long, 12, 11)), [11, 12], '320px board: two rows, spare letter on the last row')
assert.deepEqual(lengths(splitWord(long, 15, 14)), [11, 12])
assert.deepEqual(lengths(splitWord(long, 8, 7)), [5, 6, 6, 6], 'narrow board: rows with the mark stay within perRow')
assert.deepEqual(splitWord(long, 12, 11).flat().join(''), long.join(''), 'no letter lost or reordered')
assert.deepEqual(lengths(splitWord([...'INTERNACIONALITZACIÓ'], 12, 11)), [10, 10])
assert.deepEqual(lengths(splitWord([...'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWX'], 12, 11)), [10, 10, 10, 10, 10], 'a 50-letter word')
assert.deepEqual(groupDisplayWord([...'DE TANT']).map(({ start, characters }) => [start, characters.join('')]), [[0, 'DE'], [3, 'TANT']])
assert.equal(spokenWord(groupDisplayWord(['C', '_', 'L', '·', '_', ' ', 'A']), 'buit'), 'C buit L · buit, A')
const wordMarkup = (language: 'ca' | 'es') => renderToStaticMarkup(<MultiplayerWord displayWord={['C', '_', 'L', '·', 'L', '_', ' ', '_']} language="ca" label={multiplayerTranslations[language].wordProgress} blank={multiplayerTranslations[language].hiddenLetter} />)
assert.match(wordMarkup('ca'), /role="group" aria-label="Progrés de la paraula, 6 lletres"/, 'named group counts letters, not punctuation or spaces')
assert.match(wordMarkup('es'), /aria-label="Progreso de la palabra, 6 letras"/)
assert.match(wordMarkup('ca'), /<p class="sr-only">C buit L · L buit, buit<\/p>/, 'blanks are spoken, words separated')
assert.match(wordMarkup('ca'), /<div class="multiplayer-word" aria-hidden="true">/, 'visual tiles are not read letter by letter')
assert.doesNotMatch(wordMarkup('ca'), /tabindex/, 'a board that does not scroll is not a tab stop')

// Match header: the game language is named in the interface language.
const header = (language: 'ca' | 'es', game: 'ca' | 'es') => {
  const room = new GameRoom('K7QF2', game, 1, () => 0)
  room.addPlayer('0', 's0', 't0', 'Marc'); room.addPlayer('1', 's1', 't1', 'Júlia')
  room.start('0')
  return gameMarkup(room, language).match(/<div class="match-meta">.*?<\/div>/)![0]
}
assert.match(header('ca', 'ca'), /<span>Codi de sala <b>K7QF2<\/b><\/span>.*<span>Català<\/span>/)
assert.match(header('es', 'ca'), /<span>Código de sala <b>K7QF2<\/b><\/span>.*<span>Catalán<\/span>/)
assert.match(header('ca', 'es'), /<span>Castellà<\/span>/)
assert.match(header('es', 'es'), /<span>Español<\/span>/)
console.log('Phase 2D long-word rows, word text alternative and match header regressions passed')

// QA-A1: the setter's secret-word field is named by an associated, localized label (not just its placeholder).
const choosing = new GameRoom('L4BEL', 'ca', 1, () => 0)
choosing.addPlayer('0', 's0', 't0', 'Setter')
choosing.addPlayer('1', 's1', 't1', 'Guesser')
choosing.start('0')
for (const language of ['ca', 'es'] as const) {
  const markup = gameMarkup(choosing, language)
  const label = markup.match(/<label class="role-badge setter" for="secret-word-input">(.*?)<\/label>/)
  assert.ok(label, 'Secret-word label is associated with its input')
  assert.equal(label[1].replace(/<span aria-hidden="true">.*?<\/span>/, ''), multiplayerTranslations[language].chooseWord, 'Accessible name excludes the decorative pencil')
  assert.match(markup, /<input id="secret-word-input" type="text"/)
  assert.ok(!gameMarkup(choosing, language, '1').includes('secret-word-input'), 'Guessers get no secret field')
}
console.log('Secret-word label regressions passed in CA/ES')

// --- Chat scroll: follow the conversation only when the reader is at the end, or sent the message ---
{
  const other = { id: 'm2', senderId: 'p1' }, own = { id: 'm2', senderId: 'p0' }
  assert.equal(chatSticksToBottom(undefined, undefined, 'p0', false), false, 'empty chat: nothing to scroll')
  assert.equal(chatSticksToBottom(undefined, other, 'p0', false), true, 'initial history shows the latest messages')
  assert.equal(chatSticksToBottom('m1', other, 'p0', true), true, 'new message at the bottom follows')
  assert.equal(chatSticksToBottom('m1', other, 'p0', false), false, 'new message while reading older ones keeps the position')
  assert.equal(chatSticksToBottom('m1', own, 'p0', false), true, 'your own message always scrolls to the end')
  assert.equal(chatSticksToBottom('m2', own, 'p0', false), false, 'a reaction on your own last message while reading does not move the list')
  assert.equal(chatSticksToBottom('m2', other, 'p0', false), false, 'reactions while reading keep the position')
  assert.equal(chatSticksToBottom('m2', other, 'p0', true), true, 'reactions at the bottom keep the end visible')
  console.log('Chat scroll decisions passed')
}
