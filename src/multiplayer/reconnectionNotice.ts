import type { ServerToClientEvents } from '../../shared/protocol'
import type { socket } from './socket'

/** Only live reconnections start the timer; snapshots and restored sessions never do. */
export function listenForReconnections(target: Pick<typeof socket, 'on' | 'off'>, roomCode: string, playerId: string, show: (visible: boolean) => void) {
  show(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const dismiss = () => { clearTimeout(timer); show(false) }
  const reconnected: ServerToClientEvents['room:player-reconnected'] = (event) => {
    if (event.roomCode !== roomCode || event.playerId === playerId) return
    clearTimeout(timer)
    show(true)
    timer = setTimeout(() => show(false), 4_000)
  }
  target.on('room:player-reconnected', reconnected)
  target.on('disconnect', dismiss)
  return () => {
    clearTimeout(timer)
    target.off('room:player-reconnected', reconnected)
    target.off('disconnect', dismiss)
  }
}
