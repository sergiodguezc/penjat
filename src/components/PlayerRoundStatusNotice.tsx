import type { PlayerRoundStatus } from '../../shared/protocol'
import type { MultiplayerTranslations } from '../multiplayer/i18n'
import type { MultiplayerPhase } from '../multiplayer/presentation'

export function PlayerRoundStatusNotice({ status, phase, spectating = false, t }: { status: PlayerRoundStatus; phase: MultiplayerPhase; spectating?: boolean; t: MultiplayerTranslations }) {
  if (phase !== 'guessing') return null
  // Back after an absence: not beaten, just waiting for the next turn.
  if (spectating) return <div className="player-terminal-state spectating-state" role="status">
    <strong>{t.spectatingTitle}</strong><span>{t.spectatingBody}</span>
  </div>
  if (status === 'solved') return <div className="player-terminal-state solved-state" role="status">
    <strong>{t.youSolved}</strong><span>{t.waitingForOthers}</span>
  </div>
  if (status === 'failed' || status === 'eliminated') return <div className="player-terminal-state eliminated-state" role="status">
    <strong>{t.youAreOut}</strong><span>{t.roundFinishedForYou}</span>
  </div>
  return null
}
