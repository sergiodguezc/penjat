import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import type { Language } from '../../shared/game'
import { navigationTranslations } from '../navigation/i18n'
import { routeClick, sectionLinks, type Section } from '../navigation/links'
import type { Route } from '../routing'
import { InterfaceLanguageSelector } from './InterfaceLanguageSelector'
import { LanguageSelector } from './LanguageSelector'

type Props = {
  language: Language
  current?: Section
  onLanguage: (language: Language) => void
  onNavigate: (route: Route) => void
  /** Contextual exit (leave the room or match, end the learning session); its label names the consequence. */
  exit?: { label: string; onExit: () => void }
  /** Content pages keep the header in view on large screens; gameplay never gives up the vertical space. */
  sticky?: boolean
}

// Same width as the desktop navigation breakpoint in App.css.
const DESKTOP_NAVIGATION = '(min-width: 62.5em)'

export function BrandMark() {
  return <span className="brand-badge" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      <path d="M6 21V4h10v3" /><circle cx="16" cy="10" r="2.5" />
    </svg>
  </span>
}

export function SiteHeader({ language, current, onLanguage, onNavigate, exit, sticky = false }: Props) {
  const t = navigationTranslations[language]
  const [open, setOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const labels: Record<Exclude<Section, 'home'>, string> = { multiplayer: t.multiplayer, learning: t.learning, daily: t.daily, help: t.help }

  // A new page, or a layout with the full navigation, never keeps the menu open.
  useEffect(() => setOpen(false), [current])
  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_NAVIGATION)
    const close = () => { if (desktop.matches) setOpen(false) }
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [])
  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    const pointerdown = (event: PointerEvent) => { if (!headerRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', pointerdown)
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', pointerdown) }
  }, [open])

  const go = (route: Route) => routeClick(() => { setOpen(false); onNavigate(route) })
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.querySelector('main')
    if (!main) return
    event.preventDefault()
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
    main.focus()
  }
  const links = (className: string) => <ul className={className}>
    {sectionLinks.map(({ section, href, route }) => <li key={section}>
      <a href={href} aria-current={current === section ? 'page' : undefined} onClick={go(route)}>{labels[section]}</a>
    </li>)}
  </ul>

  return <header ref={headerRef} className={`site-header${sticky ? ' is-sticky' : ''}${open ? ' is-menu-open' : ''}`}
    onBlur={(event) => { if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <a className="skip-link" href="#contingut" onClick={skip}>{t.skip}</a>
    <div className="site-header-inner">
      <a className="site-brand" href="/" aria-label={t.brand} aria-current={current === 'home' ? 'page' : undefined} onClick={go('/')}>
        <BrandMark /><span className="brand-word" aria-hidden="true">penjat<span>.cat</span></span>
      </a>
      <nav className="site-nav" aria-label={t.primary}>{links('site-nav-list')}</nav>
      <div className="site-actions">
        {exit && <button type="button" className="global-back-button" aria-label={exit.label} title={exit.label} onClick={exit.onExit}>
          <span className="global-back-arrow" aria-hidden="true">←</span><span className="global-back-text" aria-hidden="true">{exit.label}</span>
        </button>}
        <InterfaceLanguageSelector language={language} onChange={onLanguage} />
        <button ref={toggleRef} type="button" className="site-menu-toggle" aria-expanded={open} aria-controls={menuId}
          aria-label={open ? t.closeMenu : t.openMenu} onClick={() => setOpen((value) => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
        </button>
      </div>
    </div>
    <div id={menuId} className="site-menu" hidden={!open}>
      <nav aria-label={t.primary}>
        <ul className="site-menu-list">
          <li><a href="/" aria-current={current === 'home' ? 'page' : undefined} onClick={go('/')}>{t.home}</a></li>
          {sectionLinks.map(({ section, href, route }) => <li key={section}>
            <a href={href} aria-current={current === section ? 'page' : undefined} onClick={go(route)}>{labels[section]}</a>
          </li>)}
        </ul>
      </nav>
      <div className="site-menu-language">
        <span aria-hidden="true">{t.interfaceLanguage}</span>
        <LanguageSelector language={language} label={t.interfaceLanguage} onChange={onLanguage} variant="names" />
      </div>
    </div>
  </header>
}
