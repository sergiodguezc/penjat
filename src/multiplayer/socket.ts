import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol'

const configuredUrl = import.meta.env?.VITE_SERVER_URL as string | undefined
const serverUrl = configuredUrl || '/'

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  autoConnect: false,
  timeout: 5_000,
})

/** Create/join replies give up after this, so a lost acknowledgement never leaves the UI busy. */
export const REQUEST_TIMEOUT_MS = 10_000

export type ConnectionTarget = Pick<typeof socket, 'connected' | 'active' | 'connect' | 'once' | 'off'>
/** Calls `ready` once the socket is connected, or `failed` if this attempt errors. It never restarts a connection that is
 already being established or kept alive (`active`, e.g. App's connect on load or automatic reconnection): calling
 connect() again while the CONNECT handshake is pending re-sends CONNECT, the server drops the transport, and a request
 sent meanwhile is lost. */
export function whenConnected(target: ConnectionTarget, ready: () => void, failed: () => void) {
  if (target.connected) { ready(); return }
  const onConnect = () => { target.off('connect_error', onError); ready() }
  const onError = () => { target.off('connect', onConnect); failed() }
  target.once('connect', onConnect)
  target.once('connect_error', onError)
  if (!target.active) target.connect()
}
