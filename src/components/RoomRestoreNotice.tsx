import type { Language } from '../../shared/game'
import type { RestoreStatus } from '../multiplayer/roomSession'
import { multiplayerTranslations } from '../multiplayer/i18n'

type Props = { language: Language; status: Exclude<RestoreStatus, 'idle'>; roomCode: string | null; onRetry: () => void; onLeave: () => void; onDismiss: () => void }

/** Shown instead of a page while a stored room is being restored, could not be reached yet, or moved to another tab. */
export function RoomRestoreNotice({ language, status, roomCode, onRetry, onLeave, onDismiss }: Props) {
  const t = multiplayerTranslations[language]
  const copy = status === 'restoring' ? { title: t.restoringTitle, body: roomCode ? t.restoringBody(roomCode) : '' }
    : status === 'failed' ? { title: t.restoreFailedTitle, body: t.restoreFailedBody }
    : { title: t.replacedTitle, body: t.replacedBody }
  return <main className="home-page home-page--multiplayer">
    <section className="home-card invitation-card room-restore-card" aria-busy={status === 'restoring'}>
      <h1>{copy.title}</h1>
      <p role={status === 'failed' ? 'alert' : 'status'}>{copy.body}</p>
      <div className="invitation-error-actions">
        {status === 'failed' && <button type="button" className="primary-action" onClick={onRetry}>{t.restoreRetry}</button>}
        {status === 'replaced' && <button type="button" className="primary-action" onClick={onRetry}>{t.replacedContinue}</button>}
        {status === 'replaced'
          ? <button type="button" className="secondary-action" onClick={onDismiss}>{t.replacedDismiss}</button>
          : <button type="button" className="secondary-action" onClick={onLeave}>{t.restoreLeave}</button>}
      </div>
    </section>
  </main>
}

/** The player's own connection dropped while a room is on screen; the room stays visible until it is restored. */
export function SelfConnectionNotice({ language, status, onRetry }: { language: Language; status: RestoreStatus; onRetry: () => void }) {
  if (status !== 'restoring' && status !== 'failed') return null
  const t = multiplayerTranslations[language]
  return <div className="connection-notice" role="status">
    {status === 'restoring' ? t.selfReconnecting : t.selfReconnectFailed}
    {status === 'failed' && <button type="button" className="text-button" onClick={onRetry}>{t.restoreRetry}</button>}
  </div>
}
