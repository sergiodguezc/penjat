import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ALPHABETS, displayWord, normalizeGuess } from '../../shared/game'
import type { Language } from '../../shared/game'
import { HangmanDrawing } from '../components/HangmanDrawing'
import { ErrorMeter } from '../components/ErrorMeter'
import { HangmanWord } from '../components/HangmanWord'
import { AccentTitle } from '../components/AccentTitle'
import { Modal } from '../components/Modal'
import { Keyboard } from '../components/Keyboard'
import { VocabularyCard } from '../components/VocabularyCard'
import { applyLearningGuess, createLearningRound } from '../learning/game'
import { learningTranslations } from '../learning/i18n'
import { acknowledge, currentWordId, readLearning, recordFinish, replaySession, reviewSession, saveGuesses, startSession, toggleBookmark, unitStats, writeLearning } from '../learning/progress'
import type { LearningProgress, UnitSession, UnitStats } from '../learning/progress'
import { browserStorage } from '../storage'
import type { LearningUnit } from '../learning/types'
import { emblemUrl, illustrationUrl, learningUnits, unitTitle } from '../learning/units'

type Props = { language: Language; units?: readonly LearningUnit[]; unitId: string | null; onUnit: (unitId: string | null) => void }
type Change = (progress: LearningProgress) => LearningProgress

/** Units → play → vocabulary card → summary. Everything is saved on every change, so leaving never loses progress. */
export function LearningPage({ language, units = learningUnits, unitId, onUnit }: Props) {
  const t = learningTranslations[language]
  const [progress, setProgress] = useState(() => readLearning(browserStorage(), units))
  const progressRef = useRef(progress)
  const commit = useCallback((change: Change) => {
    const next = change(progressRef.current)
    if (next === progressRef.current) return
    progressRef.current = next
    writeLearning(browserStorage(), next)
    setProgress(next)
  }, [])
  const unit = units.find((item) => item.id === unitId)
  const session = unit && progress.sessions[unit.id]
  const word = unit && session && unit.words.find((item) => item.id === currentWordId(session))
  const round = useMemo(() => word && session && !session.pending ? createLearningRound(word.word, session.guesses) : null, [word, session])

  const guess = useCallback((letter: string) => {
    if (!unit) return
    commit((current) => {
      const active = current.sessions[unit.id]
      const playing = active && !active.pending && unit.words.find((item) => item.id === currentWordId(active))
      if (!playing) return current
      const next = applyLearningGuess(createLearningRound(playing.word, active.guesses), letter)
      if (next.guesses.size === active.guesses.length) return current
      return next.result ? recordFinish(current, unit.id, { result: next.result, errors: next.errors }) : saveGuesses(current, unit.id, [...next.guesses])
    })
  }, [commit, unit])

  useEffect(() => {
    if (!round) return
    const keydown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return
      const target = event.target
      if (target instanceof HTMLElement && (target.matches('input, textarea, select, button') || target.isContentEditable)) return
      const normalized = normalizeGuess(event.key, 'ca')
      if (normalized) guess(normalized)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [guess, round])

  const open = (target: LearningUnit) => {
    commit((current) => current.sessions[target.id] || unitStats(current, target).discovered === target.words.length ? current : startSession(current, target))
    onUnit(target.id)
  }
  const restart = (start: (progress: LearningProgress, unit: LearningUnit) => LearningProgress) => { if (unit) commit((current) => start(current, unit)) }

  if (!unit) return <main className="learning-page" lang={language}>
    <header className="page-head learning-header">
      <h1><AccentTitle text={t.title} /></h1>
      <p className="learning-lede">{t.lede}</p>
    </header>
    {units.length === 0 ? <p className="learning-empty">{t.noUnits}</p> : <ul className="unit-list" aria-label={t.units}>
      {units.map((item, index) => <UnitListItem key={item.id} unit={item} position={index + 1} progress={progress} language={language} onOpen={() => open(item)} />)}
    </ul>}
  </main>

  const position = units.indexOf(unit) + 1
  const pill = <p className="unit-pill">{t.unitLabel(position, unitTitle(unit, language))}</p>
  const stats = unitStats(progress, unit)

  if (!session) return <main className="learning-page" lang={language}>
    <UnitSummary unit={unit} pill={pill} progress={progress} stats={stats} language={language}
      onReview={() => restart(reviewSession)} onReplay={() => restart(replaySession)} onUnits={() => onUnit(null)} />
  </main>

  const heading = session.kind === 'review' ? t.reviewOf(session.index + 1, session.queue.length) : t.wordOf(unit.words.indexOf(word!) + 1, unit.words.length)
  const header = <header className="unit-head">{pill}<h1>{heading}</h1><UnitStrip unit={unit} progress={progress} currentId={word!.id} language={language} /></header>

  if (session.pending) return <main className="learning-page" lang={language}>
    <CardView key={word!.id} unit={unit} session={session} header={header} progress={progress} stats={stats} language={language}
      onNext={() => commit((current) => acknowledge(current, unit.id))} onBookmark={() => commit((current) => toggleBookmark(current, word!.id))} />
  </main>

  return <main className="learning-page" lang={language}>
    <div className="learning-play">
      {header}
      <section className="learning-game">
        <div className="learning-hint"><span>{t.hint}</span><strong lang="es">{word!.translationEs}</strong></div>
        <div className="learning-columns">
          <div className="drawing-panel"><HangmanDrawing errors={round!.errors} />
            <div className="error-copy"><span>{t.errors}</span><strong>{round!.errors} / 6</strong><ErrorMeter errors={round!.errors} /></div></div>
          <div className="guess-area">
            <div className="learning-word-scroll" tabIndex={0}>
              <HangmanWord word={word!.word} guesses={round!.guesses} language="ca" reveal={false} label={t.progress} />
            </div>
            <div className="incorrect-list"><span>{t.incorrect}</span><strong>{round!.incorrect.size ? [...round!.incorrect].join(' · ') : t.none}</strong></div>
            <Keyboard alphabet={ALPHABETS.ca} guesses={round!.guesses} incorrect={round!.incorrect} disabled={false} label={t.keyboard} onGuess={guess} />
          </div>
        </div>
      </section>
      <span className="sr-only" aria-live="polite">{displayWord(word!.word, round!.guesses, 'ca').join(' ')}</span>
    </div>
  </main>
}

function UnitListItem({ unit, position, progress, language, onOpen }: { unit: LearningUnit; position: number; progress: LearningProgress; language: Language; onOpen: () => void }) {
  const t = learningTranslations[language]
  const stats = unitStats(progress, unit)
  const action = progress.sessions[unit.id] || (stats.discovered > 0 && stats.discovered < stats.total) ? t.continue : stats.discovered === stats.total ? t.revisit : t.start
  const art = illustrationUrl(unit.words[0]) ?? emblemUrl(unit)
  return <li className="unit-card">
    <img className="unit-card-art" src={art} alt="" width="160" height="100" />
    <div className="unit-card-text">
      <h2><span className="unit-card-number">{position}</span> {unitTitle(unit, language)}{unit.status === 'draft' && <span className="unit-draft">{t.draft}</span>}</h2>
      <p>{t.discoveredLine(stats.discovered, stats.total, stats.percent)}</p>
      <UnitStrip unit={unit} progress={progress} language={language} />
    </div>
    <button type="button" className="primary-action" onClick={onOpen} aria-label={`${action}: ${unitTitle(unit, language)}`}>{action}</button>
  </li>
}

/** One segment per word: discovered (oliva), current (saffron), to practise (outline with a magrana dot), new (outline). */
function UnitStrip({ unit, progress, currentId, language }: { unit: LearningUnit; progress: LearningProgress; currentId?: string; language: Language }) {
  const stats = unitStats(progress, unit)
  return <div className="unit-strip" role="img" aria-label={learningTranslations[language].stripLabel(stats.discovered, stats.total)}>
    {unit.words.map((item) => <span key={item.id} className={item.id === currentId ? 'is-current' : progress.words[item.id] === 'correct' ? 'is-correct' : progress.words[item.id] === 'failed' ? 'is-failed' : undefined} />)}
  </div>
}

function ProgressPanel({ unit, stats, language }: { unit: LearningUnit; stats: UnitStats; language: Language }) {
  const t = learningTranslations[language]
  const id = useId()
  return <section className="progress-panel" aria-labelledby={id}>
    <h2 id={id}>{t.yourProgress}</h2>
    <div className="progress-donut-row">
      <svg className="progress-donut" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
        <circle cx="22" cy="22" r="18" pathLength="100" />
        <circle cx="22" cy="22" r="18" pathLength="100" strokeDasharray={`${stats.percent} 100`} transform="rotate(-90 22 22)" />
      </svg>
      <p><strong>{stats.percent}%</strong><span>{t.unitCaption(unitTitle(unit, language))}</span></p>
    </div>
    <dl className="progress-tiles">
      <div><dt>{t.discovered}</dt><dd>{stats.discovered}/{stats.total}</dd></div>
      <div><dt>{t.correct}</dt><dd>{stats.correct}</dd></div>
      <div><dt>{t.failed}</dt><dd>{stats.failed}</dd></div>
    </dl>
  </section>
}

function WordChips({ unit, ids, progress, currentId, language, onOpen }: { unit: LearningUnit; ids: readonly string[]; progress: LearningProgress; currentId?: string; language: Language; onOpen: (id: string) => void }) {
  const t = learningTranslations[language]
  return <ul className="word-chips">
    {unit.words.filter((item) => ids.includes(item.id)).map((item) => <li key={item.id}>
      <button type="button" lang="ca" className={item.id === currentId ? 'is-current' : undefined} aria-current={item.id === currentId || undefined} onClick={() => onOpen(item.id)}>
        {item.word}{progress.bookmarks.includes(item.id) && <BookmarkIcon className="word-chip-saved" label={t.saved} />}
      </button>
    </li>)}
  </ul>
}

function BookmarkIcon({ className, label }: { className?: string; label?: string }) {
  return <svg className={className} viewBox="0 0 24 24" width="18" height="18" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M6 3h12v18l-6-5-6 5z" /></svg>
}

function WordDialog({ unit, wordId, language, onClose }: { unit: LearningUnit; wordId: string; language: Language; onClose: () => void }) {
  const id = useId()
  const word = unit.words.find((item) => item.id === wordId)
  if (!word) return null
  return <Modal className="vocab-dialog" labelledBy={id} onCancel={onClose}>
    <VocabularyCard word={word} unit={unit} language={language} headingId={id} />
    <button type="button" className="secondary-action" data-modal-initial-focus onClick={onClose}>{learningTranslations[language].close}</button>
  </Modal>
}

type CardViewProps = { unit: LearningUnit; session: UnitSession; header: ReactNode; progress: LearningProgress; stats: UnitStats; language: Language; onNext: () => void; onBookmark: () => void }
function CardView({ unit, session, header, progress, stats, language, onNext, onBookmark }: CardViewProps) {
  const t = learningTranslations[language]
  const id = useId()
  const [openWord, setOpenWord] = useState<string | null>(null)
  const wordId = currentWordId(session)
  const word = unit.words.find((item) => item.id === wordId)!
  const saved = progress.bookmarks.includes(wordId)
  return <div className="vocab-layout">
    {header}
    <VocabularyCard word={word} unit={unit} language={language} headingId={id} outcome={session.pending!} />
    <div className="vocab-side">
      <ProgressPanel unit={unit} stats={stats} language={language} />
      <section className="unit-words" aria-labelledby={`${id}-words`}>
        <h2 id={`${id}-words`}>{t.unitWords}</h2>
        <WordChips unit={unit} ids={Object.keys(progress.words)} progress={progress} currentId={wordId} language={language} onOpen={setOpenWord} />
      </section>
      <div className="vocab-actions">
        <button type="button" className="primary-action" onClick={onNext}>{session.index + 1 < session.queue.length ? t.next : t.finish}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
        <button type="button" className="secondary-action vocab-bookmark" aria-pressed={saved} aria-label={t.bookmark} onClick={onBookmark}><BookmarkIcon className={saved ? 'is-saved' : undefined} /></button>
      </div>
    </div>
    {openWord && <WordDialog unit={unit} wordId={openWord} language={language} onClose={() => setOpenWord(null)} />}
  </div>
}

type SummaryProps = { unit: LearningUnit; pill: ReactNode; progress: LearningProgress; stats: UnitStats; language: Language; onReview: () => void; onReplay: () => void; onUnits: () => void }
export function UnitSummary({ unit, pill, progress, stats, language, onReview, onReplay, onUnits }: SummaryProps) {
  const t = learningTranslations[language]
  const [openWord, setOpenWord] = useState<string | null>(null)
  const byResult = (result: 'correct' | 'failed') => unit.words.filter((item) => progress.words[item.id] === result).map((item) => item.id)
  const groups = [[t.correct, byResult('correct')], [t.failed, byResult('failed')], [t.saved, progress.bookmarks]] as const
  return <div className="unit-summary">
    <header className="unit-head">{pill}<h1>{stats.discovered === stats.total ? t.complete : t.summaryTitle}</h1><UnitStrip unit={unit} progress={progress} language={language} /></header>
    <ProgressPanel unit={unit} stats={stats} language={language} />
    <div className="unit-summary-groups">
      {groups.filter(([, ids]) => unit.words.some((item) => ids.includes(item.id))).map(([label, ids]) => <section key={label} className="unit-words">
        <h2>{label}</h2>
        <WordChips unit={unit} ids={ids} progress={progress} language={language} onOpen={setOpenWord} />
      </section>)}
    </div>
    <div className="unit-summary-actions">
      {stats.failed > 0 && <button type="button" className="primary-action" onClick={onReview}>{t.reviewFailed}</button>}
      <button type="button" className={stats.failed > 0 ? 'secondary-action' : 'primary-action'} onClick={onReplay}>{t.replay}</button>
      <button type="button" className="text-button" onClick={onUnits}>{t.otherUnits}</button>
    </div>
    {openWord && <WordDialog unit={unit} wordId={openWord} language={language} onClose={() => setOpenWord(null)} />}
  </div>
}
