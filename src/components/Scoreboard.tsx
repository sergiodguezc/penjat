import { useId, useState } from 'react'
import type { PublicPlayer } from '../../shared/protocol'
import type { MultiplayerTranslations } from '../multiplayer/i18n'
import { liveRanking } from '../multiplayer/liveRanking'

type Props = { players: PublicPlayer[]; setterId: string | null; currentId: string; t: MultiplayerTranslations; defaultExpanded?: boolean }

export function Scoreboard({ players, setterId, currentId, t, defaultExpanded = false }: Props) {
  // Lives as long as the active match, so live score updates never collapse a ranking the player opened.
  const [expanded, setExpanded] = useState(defaultExpanded)
  const id = useId()
  const { ranked, departed, leaders, self, selfShared, namedLeaders, showSelfLine, collapsible } = liveRanking(players, currentId)
  const status = (player: PublicPlayer) => player.connectionState === 'reconnecting' ? t.statusReconnecting : player.connectionState === 'disconnected' ? t.statusDisconnected
    : player.id === setterId ? t.setterStatus : player.roundStatus === 'spectating' ? t.statusSpectating : player.roundStatus === 'solved' ? t.solved : player.roundStatus === 'awaiting-forgiveness' ? t.awaitingForgiveness
    : player.roundStatus === 'failed' || player.roundStatus === 'eliminated' ? t.eliminated : t.guessing
  const selfBadge = <span className="player-self">{t.you}</span>
  return <aside className={`scoreboard${collapsible ? ' is-collapsible' : ''}${expanded ? ' is-expanded' : ''}`} aria-labelledby={`${id}-title`}>
    <div className="scoreboard-head">
      <h2 id={`${id}-title`}>{t.ranking}</h2>
      <span className="scoreboard-count">{t.playerCount(ranked.length)}{departed.length > 0 && ` · ${t.departedCount(departed.length)}`}</span>
    </div>
    {/* Below the three-column layout only (hidden by CSS from 1300px): leaders and the player's own place stay visible while collapsed. */}
    {collapsible && leaders.length > 0 && <div className="scoreboard-summary">
      <p className="ranking-summary-row is-leader">
        <span className="ranking-summary-place">{t.placeLabel(t.ordinal(1))}</span>
        <span className="ranking-summary-who">{namedLeaders
          ? leaders.map(({ player }, index) => <span className="player-identity" key={player.id}>{index > 0 && <span className="ranking-summary-joiner" aria-hidden="true">·</span>}<span className="player-name">{player.name}</span>{player.id === currentId && selfBadge}</span>)
          : <span className="player-name">{t.tiedPlayers(leaders.length)}</span>}</span>
        <span className="ranking-summary-score">{t.points(leaders[0].player.score)}</span>
      </p>
      {showSelfLine && self && <p className="ranking-summary-row is-self">
        <span className="ranking-summary-place">{t.placeLabel(t.ordinal(self.rank))}{selfShared && <span className="ranking-summary-tie"> · {t.tied}</span>}</span>
        <span className="ranking-summary-who">{selfBadge}</span>
        <span className="ranking-summary-score">{t.points(self.player.score)}</span>
      </p>}
    </div>}
    {collapsible && <button type="button" className="scoreboard-toggle" aria-expanded={expanded} aria-controls={`${id}-full`} onClick={() => setExpanded((current) => !current)}>
      {expanded ? t.showLessRanking : t.showFullRanking}<span className="scoreboard-toggle-chevron" aria-hidden="true" />
    </button>}
    <div className="scoreboard-full" id={`${id}-full`}>
      <ol>{ranked.map(({ player, rank }) => {
        const isSelf = player.id === currentId
        return <li key={player.id} className={isSelf ? 'is-self' : undefined}>
          <span className="rank">{rank}</span>
          {/* The self badge stays outside the name so wrapping a long name can never hide it. */}
          <span className="player-identity"><span className="player-name">{player.name}</span>{isSelf && selfBadge}</span>
          <strong>{player.score}</strong>
          <small className={player.connectionState !== 'connected' ? 'is-reconnecting' : undefined}>{status(player)}</small>
        </li>
      })}</ol>
      {departed.length > 0 && <section className="departed-players" aria-labelledby={`${id}-departed`}>
        <h3 id={`${id}-departed`}>{t.departedPlayers}</h3>
        <ul>{departed.map((player) => <li key={player.id}>
          <span className="player-name" title={player.name}>{player.name}</span>
          <strong>{player.score}</strong>
        </li>)}</ul>
      </section>}
    </div>
  </aside>
}
