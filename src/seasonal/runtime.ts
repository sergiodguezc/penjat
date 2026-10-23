import { getSeason } from './config'

export function installSeason(override?: string) {
  const update = () => {
    const season = getSeason(new Date(), override)
    if (season) document.documentElement.dataset.season = season
    else delete document.documentElement.dataset.season
  }
  let timer: number
  const tick = () => {
    update()
    // Align to calendar-minute boundaries, including Madrid midnight; no gameplay state is touched.
    timer = window.setTimeout(tick, 60_000 - Date.now() % 60_000)
  }
  tick()
  window.addEventListener('focus', update)
  document.addEventListener('visibilitychange', update)
  return () => {
    window.clearTimeout(timer)
    window.removeEventListener('focus', update)
    document.removeEventListener('visibilitychange', update)
  }
}
