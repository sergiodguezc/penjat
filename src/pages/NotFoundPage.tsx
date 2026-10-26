import type { Language } from '../../shared/game'
import { notFoundTranslations } from '../../shared/notFound'
import { routeClick } from '../navigation/links'

export function NotFoundPage({ language, onHome }: { language: Language; onHome: () => void }) {
  const t = notFoundTranslations[language]
  return <main className="home-page not-found-page" lang={language}>
    <header className="page-head">
      <p className="page-eyebrow">404</p>
      <h1>{t.heading}</h1>
      <p className="page-lede">{t.description}</p>
      <a className="howto-link" href="/" onClick={routeClick(onHome)}>{t.home}</a>
    </header>
  </main>
}
