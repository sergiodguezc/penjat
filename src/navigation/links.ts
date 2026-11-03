import type { MouseEvent } from 'react'
import type { Route } from '../routing'

export type Section = 'home' | 'multiplayer' | 'local' | 'learning' | 'daily' | 'help'

// Public hrefs (no trailing slash, as in the sitemap) for the routed sections, in the homepage's order (friends, then solo, then rules).
export const sectionLinks: { section: Exclude<Section, 'home'>; href: string; route: Route }[] = [
  { section: 'multiplayer', href: '/multijugador', route: '/multijugador/' },
  { section: 'local', href: '/passa-el-mobil', route: '/passa-el-mobil/' },
  { section: 'daily', href: '/paraula-del-dia', route: '/paraula-del-dia/' },
  { section: 'learning', href: '/aprendre', route: '/aprendre/' },
  { section: 'help', href: '/com-es-juga', route: '/com-es-juga/' },
]

/** Plain left clicks stay in the app; modified and middle clicks keep the browser's native link behaviour. */
export function routeClick(action?: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (!action || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    action()
  }
}
