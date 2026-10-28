import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ALPHABETS, displayWord, normalizeGuess } from '../../shared/game'
import type { Language } from '../../shared/game'
import { HangmanDrawing } from '../components/HangmanDrawing'
import { ErrorMeter } from '../components/ErrorMeter'
import { HangmanWord } from '../components/HangmanWord'
import { AccentTitle } from '../components/AccentTitle'
import { Keyboard } from '../components/Keyboard'
import { getDailyChallenge, getDailyChallengeUrl, formatDailyShareData } from '../daily/challenge'
import { applyDailyGuess, createDailyRound, type DailyRound } from '../daily/game'
import { dailyTranslations } from '../daily/i18n'
import { readDailyAttempt, writeDailyAttempt } from '../daily/storage'
import { browserStorage } from '../storage'

type Props = { language: Language; onActiveGameChange?: (active: boolean) => void; onHome?: () => void }

export function DailyChallengePage({ language, onActiveGameChange, onHome }: Props) {
  const challenge = useMemo(() => getDailyChallenge(), [])
  const [round, setRound] = useState<DailyRound>(() => {
    const stored = readDailyAttempt(browserStorage(), challenge.id)
    return createDailyRound(challenge.entry, stored?.guesses)
  })
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const t = dailyTranslations[language]
  const completed = round.result !== null
  // Restored from storage on load (already played today) rather than finished in this visit.
  const [completedOnLoad] = useState(completed)

  useEffect(() => {
    writeDailyAttempt(browserStorage(), {
      challengeId: challenge.id,
      guesses: [...round.guesses],
      completed,
      won: round.result ? round.result === 'win' : null,
      mistakes: round.errors,
    })
  }, [challenge.id, completed, round.errors, round.guesses, round.result])

  useEffect(() => {
    onActiveGameChange?.(!completed && round.guesses.size > 0)
    return () => onActiveGameChange?.(false)
  }, [completed, onActiveGameChange, round.guesses.size])

  const guess = useCallback((letter: string) => {
    setRound((current) => applyDailyGuess(current, letter))
  }, [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (completed || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea, select, button') || target.isContentEditable)) return
      const normalized = normalizeGuess(event.key, 'ca')
      if (normalized) guess(normalized)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [completed, guess])

  const share = async () => {
    if (!round.result) return
    const url = getDailyChallengeUrl(window.location.origin)
    const shareData = formatDailyShareData({ language, challengeNumber: challenge.number, result: round.result, errors: round.errors, url })
    setShareStatus('idle')
    try {
      if (navigator.share) await navigator.share(shareData)
      else await navigator.clipboard.writeText(shareData.text ?? '')
      setShareStatus('copied')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShareStatus('failed')
    }
  }

  return <main className="daily-page" lang={language}>
    <header className="page-head daily-header">
      <div>
        <p className="page-eyebrow page-eyebrow--safra">{t.eyebrow}</p>
        <h1 id="daily-title"><AccentTitle text={t.gameTitle} /></h1>
        <p className="page-lede daily-intro">{t.intro}</p>
      </div>
      <p className="daily-date"><span>{t.heading(challenge.number)}</span> <span>{challenge.displayDate[language]}</span></p>
    </header>

    <section className="daily-game" aria-labelledby="daily-title">
      {completed ? <DailyResult round={round} language={language} alreadyPlayed={completedOnLoad} shareStatus={shareStatus} onShare={share} onHome={onHome} />
      : <div className="daily-columns">
        <div className="drawing-panel">
          <HangmanDrawing errors={round.errors} />
          <div className="error-copy"><span>{t.errors}</span><strong>{round.errors} / 6</strong><ErrorMeter errors={round.errors} /></div>
        </div>
        <div className="guess-area">
          <span className="daily-today-label">{t.today}</span>
          <div className="daily-word-scroll" tabIndex={0}>
            <HangmanWord word={challenge.entry.answerCa} guesses={round.guesses} language="ca" reveal={false} label={t.progress} />
          </div>
          <div className="incorrect-list"><span>{t.incorrect}</span><strong>{round.incorrect.size ? [...round.incorrect].join(' · ') : t.none}</strong></div>
          <Keyboard alphabet={ALPHABETS.ca} guesses={round.guesses} incorrect={round.incorrect} disabled={false} label={t.keyboard} onGuess={guess} />
        </div>
      </div>}
      <span className="sr-only" aria-live="polite">{completed ? '' : displayWord(challenge.entry.answerCa, round.guesses, 'ca').join(' ')}</span>
    </section>

    <section className="daily-about" aria-labelledby="daily-about-title">
      <h2 id="daily-about-title">{t.aboutTitle}</h2>
      <p>{t.aboutFirst}</p>
      <p>{t.aboutSecond}</p>
    </section>
  </main>
}

/** Same completed-word presentation as learning: outcome and mistakes beside a small drawing, the word once as the heading. */
function DailyResult({ round, language, alreadyPlayed, shareStatus, onShare, onHome }: { round: DailyRound; language: Language; alreadyPlayed: boolean; shareStatus: 'idle' | 'copied' | 'failed'; onShare: () => void; onHome?: () => void }) {
  const t = dailyTranslations[language]
  const won = round.result === 'win'
  const id = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Finishing in this visit moves focus from the vanished alphabet to the word; a restored result does not steal focus.
  useEffect(() => {
    if (alreadyPlayed) return
    const active = document.activeElement
    if (!active || active === document.body) headingRef.current?.focus({ preventScroll: true })
  }, [alreadyPlayed])
  return <section className={`daily-result ${won ? 'win' : 'loss'}`} aria-labelledby={`${id}-word`}>
    <div className="daily-result-main">
      {alreadyPlayed && <p className="daily-already">{t.alreadyPlayed}</p>}
      <div className="learning-result-status">
        <span className="learning-result-drawing"><HangmanDrawing errors={round.errors} mood={won ? 'win' : 'loss'} size="compact" /></span>
        <div>
          <p className="daily-result-message" id={`${id}-message`}>{won ? t.won : t.lost}</p>
          <p className="daily-mistakes">{t.mistakes(round.errors)}</p>
        </div>
      </div>
      <span className="daily-word-label">{t.word}</span>
      <h2 lang="ca" id={`${id}-word`} ref={headingRef} tabIndex={-1} aria-describedby={`${id}-message`}>{round.entry.answerCa}</h2>
      <dl>
        <div><dt>{t.definition}</dt><dd lang="ca">{round.entry.definitionCa}</dd></div>
        <div><dt>{t.spanish}</dt><dd lang="es">{round.entry.translationEs}</dd></div>
      </dl>
    </div>
    <div className="daily-result-actions">
      <button type="button" className="primary-action" onClick={onShare}>{t.share}</button>
      <p className={`daily-share-status ${shareStatus}`} role="status">{shareStatus === 'copied' ? t.copied : shareStatus === 'failed' ? t.shareFailed : ''}</p>
      <p className="daily-tomorrow">{t.tomorrow}</p>
      {onHome && <button type="button" className="text-button" onClick={onHome}>{t.home}</button>}
    </div>
  </section>
}
