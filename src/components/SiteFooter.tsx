import type { Language } from '../../shared/game'
import { navigationTranslations } from '../navigation/i18n'
import { routeClick, sectionLinks } from '../navigation/links'
import type { Route } from '../routing'

type Props = { language: Language; onNavigate: (route: Route) => void }

export function SiteFooter({ language, onNavigate }: Props) {
  const t = navigationTranslations[language]
  const labels = { multiplayer: t.multiplayer, local: t.local, learning: t.learning, daily: t.daily, help: t.help }
  return <footer className="site-footer">
    <div className="site-footer-inner">
      <div>
        {/* Same guarded navigation as the header brand (a room or an unfinished game asks first). */}
        <a className="site-footer-brand" href="/" aria-label={t.brand} onClick={routeClick(() => onNavigate('/'))}>penjat<span>.cat</span></a>
        <p className="site-footer-tagline">{t.tagline}</p>
      </div>
      <nav aria-label={t.footerNav}>
        <ul>{sectionLinks.map(({ section, href, route }) => <li key={section}><a href={href} onClick={routeClick(() => onNavigate(route))}>{labels[section]}</a></li>)}</ul>
      </nav>
    </div>
  </footer>
}
