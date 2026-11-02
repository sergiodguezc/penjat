import { useEffect, useState } from 'react'

/** `unsupported`: development, or no service workers; the game simply needs the network. */
export type OfflineReadiness = 'unsupported' | 'preparing' | 'ready' | 'needs-connection' | 'failed'
type Status = { version: string; complete: boolean }

const supported = () => Boolean(import.meta.env?.PROD) && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
let registration: Promise<ServiceWorkerRegistration | null> = Promise.resolve(null)

/** Production only. A failed registration leaves the site exactly as without offline support. */
export function registerServiceWorker() {
  if (!supported()) return
  // After the page's own load, so the offline download never competes with the first render.
  registration = new Promise((resolve) => {
    const register = () => navigator.serviceWorker.register('/sw.js').then(resolve, () => resolve(null))
    if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true })
  })
}

/** Asks the worker that controls this page whether its cache holds every file; null when it does not answer in time. */
function askStatus(worker: ServiceWorker, timeoutMs = 5000) {
  return new Promise<Status | null>((resolve) => {
    const channel = new MessageChannel()
    const done = (status: Status | null) => { clearTimeout(timer); channel.port1.close(); resolve(status) }
    const timer = setTimeout(() => done(null), timeoutMs)
    channel.port1.onmessage = ({ data }) => done(data)
    worker.postMessage({ type: 'status' }, [channel.port2])
  })
}

/** Ready only when this page is controlled by a worker whose own cache is complete, as an offline launch needs. */
export async function checkOfflineReadiness(found: ServiceWorkerRegistration | null, controller: ServiceWorker | null, online: boolean): Promise<OfflineReadiness> {
  if (!found) return 'failed'
  if (controller && (await askStatus(controller))?.complete) return 'ready'
  if (!online) return 'needs-connection'
  return found.installing || found.waiting || found.active ? 'preparing' : 'failed'
}

export function useOfflineReadiness(): OfflineReadiness {
  const [state, setState] = useState<OfflineReadiness>(() => supported() ? 'preparing' : 'unsupported')
  useEffect(() => {
    if (!supported()) return
    const container = navigator.serviceWorker
    let disposed = false
    let found: ServiceWorkerRegistration | null = null
    const check = () => { void checkOfflineReadiness(found, container.controller, navigator.onLine).then((next) => { if (!disposed) setState(next) }) }
    const watch = () => found?.installing?.addEventListener('statechange', check)
    void registration.then((result) => {
      if (disposed) return
      found = result
      watch()
      found?.addEventListener('updatefound', watch)
      check()
    })
    const visible = () => { if (document.visibilityState === 'visible') check() }
    container.addEventListener('controllerchange', check)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      found?.removeEventListener('updatefound', watch)
      container.removeEventListener('controllerchange', check)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', check)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return state
}
