import type { Language } from '../../shared/game'
import { loadRoomSession, lostSeatNotice, type RestoreStatus } from '../multiplayer/roomSession'
import { multiplayerTranslations } from '../multiplayer/i18n'

type Props = { language: Language; status: Exclude<RestoreStatus, 'idle'>; roomCode: string | null; lostToken: string | null; onRetry: () => void; onLeave: () => void; onDismiss: () => void }

/** Shown instead of a page while a stored room is being restored, could not be reached yet, or after another tab took
 the seat over or gave it up. "Continue here" is offered only while this profile has a saved session to resume. */
export function RoomRestoreNotice({ language, status, roomCode, lostToken, onRetry, onLeave, onDismiss }: Props) {
  const t = multiplayerTranslations[language]
  const current = loadRoomSession()
  const lostSeat = status === 'replaced' || status === 'left' ? lostSeatNotice(status, lostToken, current) : null
  const copy = status === 'restoring' ? { title: t.restoringTitle, body: roomCode ? t.restoringBody(roomCode) : '' }
    : status === 'failed' ? { title: t.restoreFailedTitle, body: t.restoreFailedBody }
    : lostSeat === 'takeover' ? { title: t.replacedTitle, body: t.replacedBody }
    : lostSeat === 'moved' ? { title: t.movedTitle, body: t.movedBody(current!.roomCode) }
    : { title: t.leftTitle, body: t.leftBody }
  return <main className="home-page home-page--multiplayer">
    <section className="home-card invitation-card room-restore-card" aria-busy={status === 'restoring'}>
      <h1>{copy.title}</h1>
      <p role={status === 'failed' ? 'alert' : 'status'}>{copy.body}</p>
      <div className="invitation-error-actions">
        {status === 'failed' && <button type="button" className="primary-action" onClick={onRetry}>{t.restoreRetry}</button>}
        {(lostSeat === 'takeover' || lostSeat === 'moved') && <button type="button" className="primary-action" onClick={onRetry}>{t.replacedContinue}</button>}
        {lostSeat
          ? <button type="button" className={lostSeat === 'left' ? 'primary-action' : 'secondary-action'} onClick={onDismiss}>{t.replacedDismiss}</button>
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
