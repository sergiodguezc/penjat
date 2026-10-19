import type { PlayerGameView } from '../../shared/protocol'
import { rankByScore } from '../../shared/ranking'
import type { MultiplayerTranslations } from './i18n'

export type StandingPresence = 'connected' | 'reconnecting' | 'disconnected' | 'departed'
export type Standing = { id: string; name: string | null; score: number; rank: number; isSelf: boolean; isLeader: boolean; presence: StandingPresence }
type Leader = Pick<Standing, 'id' | 'name'>
export type MatchOutcome =
  | { kind: 'unavailable' }
  | { kind: 'self-won'; score: number }
  | { kind: 'other-won'; winner: Leader; score: number; self: Standing | null }
  | { kind: 'self-tied'; others: Leader[]; score: number }
  | { kind: 'others-tied'; leaders: Leader[]; score: number; self: Standing | null }

/** Final standings from the authoritative result snapshot: every result participant, including departed
 * players, with competition ranks. Returns null when the snapshot is missing or incomplete, so callers never
 * fabricate scores. Equal scores keep the server's roster order but always share the same rank. */
export function matchStandings(state: Pick<PlayerGameView, 'players' | 'matchResult'>, selfId: string): Standing[] | null {
  const result = state.matchResult
  if (!result || !result.ranking.length) return null
  const ids = [...new Set(result.ranking)]
  if (!ids.every((id) => Number.isFinite(result.scores[id]))) return null
  const players = new Map(state.players.map((player) => [player.id, player]))
  const ranked = rankByScore(ids.map((id) => ({ id, score: result.scores[id] })))
  return ranked.map(({ player: { id, score }, rank }) => {
    const player = players.get(id)
    const presence: StandingPresence = !player?.active ? 'departed' : player.connectionState === 'connected' ? 'connected' : player.connectionState
    return { id, name: player?.name ?? null, score, rank, isSelf: id === selfId, isLeader: rank === 1, presence }
  })
}

/** Lower-place ties never make the match a draw; only the top-score group decides the outcome. */
export function matchOutcome(standings: Standing[] | null): MatchOutcome {
  if (!standings?.length) return { kind: 'unavailable' }
  const leaders = standings.filter((standing) => standing.isLeader)
  const self = standings.find((standing) => standing.isSelf) ?? null
  const score = leaders[0].score
  const leader = ({ id, name }: Standing): Leader => ({ id, name })
  if (leaders.length === 1) return self?.isLeader ? { kind: 'self-won', score } : { kind: 'other-won', winner: leader(leaders[0]), score, self }
  if (self?.isLeader) return { kind: 'self-tied', others: leaders.filter((standing) => !standing.isSelf).map(leader), score }
  return { kind: 'others-tied', leaders: leaders.map(leader), score, self }
}

const MAX_LISTED_NAMES = 3

export function listNames(names: string[], language: 'ca' | 'es') {
  return new Intl.ListFormat(language, { type: 'conjunction' }).format(names)
}

export function outcomeCopy(outcome: MatchOutcome, standings: Standing[] | null, t: MultiplayerTranslations, language: 'ca' | 'es') {
  const name = (player: Leader) => player.name ?? t.unknownPlayer
  const selfPlace = (self: Standing | null) => {
    if (!self) return ''
    const shared = (standings ?? []).filter((standing) => standing.rank === self.rank).length > 1
    return t.selfPlaceLede(t.ordinal(self.rank), t.points(self.score), shared)
  }
  switch (outcome.kind) {
    case 'unavailable': return { heading: t.resultsUnavailable, lede: t.resultsUnavailableBody }
    case 'self-won': return { heading: t.resultsOutcomeWon, lede: t.selfWonLede(t.points(outcome.score)) }
    case 'other-won': return {
      heading: t.resultsOutcomeOtherWon.replace('{player}', name(outcome.winner)),
      lede: outcome.self ? selfPlace(outcome.self) : t.otherWonLede(name(outcome.winner), t.points(outcome.score)),
    }
    case 'self-tied': {
      const others = outcome.others.length <= MAX_LISTED_NAMES ? listNames(outcome.others.map(name), language) : t.otherPlayerCount(outcome.others.length)
      return { heading: t.resultsOutcomeTie, lede: t.selfTiedLede(others, t.points(outcome.score)) }
    }
    case 'others-tied': {
      const leaders = outcome.leaders.length <= MAX_LISTED_NAMES ? listNames(outcome.leaders.map(name), language) : t.playerCount(outcome.leaders.length)
      return { heading: t.resultsOutcomeTie, lede: [t.othersTiedLede(leaders, t.points(outcome.score)), selfPlace(outcome.self)].filter(Boolean).join(' ') }
    }
  }
}
