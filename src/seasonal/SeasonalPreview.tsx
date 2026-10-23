import { useState } from 'react'
import { MAX_ERRORS } from '../../shared/game'
import type { Language } from '../../shared/game'
import { CastanyeraScene } from './CastanyeraScene'
import { seasonalTranslations } from './i18n'

/** Loaded only by the development entry; no public route or production bundle. */
export function SeasonalPreview() {
  const [language, setLanguage] = useState<Language>('ca')
  const t = seasonalTranslations[language]
  return <main className="seasonal-preview">
    <div className="exit-confirmation-actions">{(['ca', 'es'] as const).map((lang) => <button key={lang} type="button" className="secondary-action" aria-pressed={language === lang} onClick={() => setLanguage(lang)}>{lang === 'ca' ? 'Català' : 'Español'}</button>)}</div>
    <h1>{t.preview}</h1><p>{t.rule}</p>
    <div className="seasonal-preview-grid">{Array.from({ length: MAX_ERRORS + 1 }, (_, errors) => <figure key={errors}>
      <svg viewBox="0 0 240 260" role="img" aria-label={`${t.errors}: ${errors} / ${MAX_ERRORS}. ${t.flames}: ${MAX_ERRORS - errors}`}><CastanyeraScene errors={errors} /></svg>
      <figcaption><strong>{t.errors}: {errors} / {MAX_ERRORS}</strong><span>{t.flames}: {MAX_ERRORS - errors}</span></figcaption>
    </figure>)}</div>
  </main>
}
