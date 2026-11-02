// "Passa el mòbil": a whole match on one device. Pure and deterministic: no React, storage, sockets or clocks.
// Guessing and scoring come from shared/round.ts, so points and round order match online play.
import { ALPHABETS, displayWord, isCorrectGuess, normalizeGuess, validateSecretWord, type Language } from '../../shared/game'
import { MAX_ROOM_PLAYERS, SUPPORTED_VOLTES, type MatchResult, type PlayerRoundStatus, type RoundResultEntry, type Voltes } from '../../shared/protocol'
import { applyGuess, scoreRound, type GuessOutcome, type GuessProgress } from '../../shared/round'

export const LOCAL_MATCH_VERSION = 1
export const MIN_LOCAL_PLAYERS = 2
export const MAX_LOCAL_PLAYERS = MAX_ROOM_PLAYERS
/** Same limit as the online name field. */
export const MAX_PLAYER_NAME_LENGTH = 24

export type LocalGuesserStatus = Exclude<PlayerRoundStatus, 'setter'>
/** `activeMs` is the time this guesser has spent on their unlocked board; it is their round time. */
export type LocalGuesser = { playerId: string; guessed: string[]; errors: number; forgiven: boolean; status: LocalGuesserStatus; activeMs: number }
export type LocalPlayer = { id: string; name: string; score: number }
/** The logical phase. Whether someone has unlocked their private screen is never stored: that is transient UI state. */
export type LocalStep = 'set-word' | 'guess' | 'forgive' | 'round-over' | 'match-over'
export type LocalMatch = {
  version: typeof LOCAL_MATCH_VERSION
  gameLanguage: Language
  voltes: Voltes
  /** Seating order: the phone travels this way. */
  players: LocalPlayer[]
  /** Seating order rotated so the first setter comes first; setters follow it for roster × voltes turns. */
  roster: string[]
  turnIndex: number
  step: LocalStep
  word: string | null
  /** This turn's guessers, in seating order after the setter; they play one at a time. */
  guessers: LocalGuesser[]
  /** The guesser holding (or about to hold) the phone; equals `guessers.length` once everyone has played. */
  current: number
}
export type LocalSettings = { gameLanguage: Language; voltes: Voltes }
export type LocalSetupError = 'player-count' | 'invalid-name' | 'duplicate-name' | 'invalid-settings'

export type LocalAction =
  | { type: 'set-word'; word: string }
  /** `elapsedMs` is the active time since the last flush, recorded in the same step as the letter. */
  | { type: 'guess'; letter: string; elapsedMs: number }
  | { type: 'add-time'; elapsedMs: number }
  | { type: 'decide-forgiveness'; forgive: boolean }
  | { type: 'next-turn' }
  /** `random` in [0, 1) picks the first setter, as `Math.random()` does online. */
  | { type: 'rematch'; random: number }

/** What must be shown, and to whom, before anything private: the privacy contract for the interface. */
export type LocalGate =
  | { kind: 'write-word'; playerId: string }
  | { kind: 'guess'; playerId: string; resuming: boolean }
  | { kind: 'forgive'; playerId: string; guesserId: string }
  | { kind: 'reveal' }

export function normalizePlayerName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const name = input.trim().replace(/\s+/g, ' ')
  return name && [...name].length <= MAX_PLAYER_NAME_LENGTH ? name : null
}

export function createLocalMatch(names: readonly unknown[], settings: LocalSettings, random: () => number = Math.random): { ok: true; match: LocalMatch } | { ok: false; error: LocalSetupError } {
  if (names.length < MIN_LOCAL_PLAYERS || names.length > MAX_LOCAL_PLAYERS) return { ok: false, error: 'player-count' }
  if (!Object.hasOwn(ALPHABETS, settings.gameLanguage) || !SUPPORTED_VOLTES.includes(settings.voltes)) return { ok: false, error: 'invalid-settings' }
  const normalized = names.map(normalizePlayerName)
  if (normalized.some((name) => !name)) return { ok: false, error: 'invalid-name' }
  if (new Set(normalized.map((name) => name!.toLocaleLowerCase())).size !== normalized.length) return { ok: false, error: 'duplicate-name' }
  const players = normalized.map((name, index) => ({ id: `p${index + 1}`, name: name!, score: 0 }))
  const base = { version: LOCAL_MATCH_VERSION, gameLanguage: settings.gameLanguage, voltes: settings.voltes, players } as const
  return { ok: true, match: startMatch({ ...base, roster: [], turnIndex: 0, step: 'set-word', word: null, guessers: [], current: 0 }, random()) }
}

/** Invalid or out-of-phase actions return the same object, unchanged. */
export function reduceLocalMatch(match: LocalMatch, action: LocalAction): LocalMatch {
  switch (action.type) {
    case 'set-word': {
      if (match.step !== 'set-word') return match
      const word = validateSecretWord(action.word, match.gameLanguage)
      return word ? { ...match, step: 'guess', word } : match
    }
    case 'guess': {
      const guesser = playingGuesser(match)
      if (!guesser || !isElapsed(action.elapsedMs)) return match
      let outcome
      try { outcome = applyGuess(match.word!, progressOf(guesser), action.letter, match.gameLanguage) } catch { return match }
      if (!outcome) return match
      return afterGuesserChange(match, { ...guesser, guessed: [...guesser.guessed, outcome.guess], errors: outcome.errors, status: outcome.status, activeMs: guesser.activeMs + action.elapsedMs })
    }
    case 'add-time': {
      const guesser = playingGuesser(match)
      if (!guesser || !isElapsed(action.elapsedMs) || action.elapsedMs === 0) return match
      return { ...match, guessers: match.guessers.with(match.current, { ...guesser, activeMs: guesser.activeMs + action.elapsedMs }) }
    }
    case 'decide-forgiveness': {
      if (match.step !== 'forgive' || typeof action.forgive !== 'boolean') return match
      const guesser = match.guessers[match.current]
      return afterGuesserChange(match, action.forgive ? { ...guesser, forgiven: true, status: 'playing' } : { ...guesser, status: 'failed' })
    }
    case 'next-turn': return match.step === 'round-over' ? startTurn(match, match.turnIndex + 1) : match
    case 'rematch': return match.step === 'match-over' ? startMatch(match, action.random) : match
    default: return match
  }
}

export const totalTurns = (match: LocalMatch) => match.roster.length * match.voltes
export const setterId = (match: LocalMatch) => match.roster[match.turnIndex % match.roster.length]
export const roundNumber = (match: LocalMatch) => match.turnIndex + 1
export const voltaNumber = (match: LocalMatch) => Math.floor(match.turnIndex / match.roster.length) + 1
export const nextSetterId = (match: LocalMatch) => match.turnIndex + 1 < totalTurns(match) ? match.roster[(match.turnIndex + 1) % match.roster.length] : null
export const playerName = (match: LocalMatch, id: string) => match.players.find((player) => player.id === id)?.name ?? ''

export function requiredGate(match: LocalMatch): LocalGate {
  const guesser = match.guessers[match.current]
  if (match.step === 'set-word') return { kind: 'write-word', playerId: setterId(match) }
  if (match.step === 'guess') return { kind: 'guess', playerId: guesser.playerId, resuming: guesser.guessed.length > 0 || guesser.activeMs > 0 }
  if (match.step === 'forgive') return { kind: 'forgive', playerId: setterId(match), guesserId: guesser.playerId }
  return { kind: 'reveal' }
}

/** The unlocked guesser's own board, and nothing else: no word, no other guesser. Null outside a guessing step. */
export function guesserBoard(match: LocalMatch) {
  const guesser = playingGuesser(match)
  if (!guesser) return null
  const word = match.word!
  return {
    playerId: guesser.playerId, guessed: [...guesser.guessed], errors: guesser.errors, forgiven: guesser.forgiven,
    displayWord: displayWord(word, new Set(guesser.guessed), match.gameLanguage),
    wrongLetters: guesser.guessed.filter((letter) => !isCorrectGuess(word, letter, match.gameLanguage)),
  }
}

/** The normalized letter when guessing it would change the match (the UI flushes the clock only then); otherwise null. */
export function playableGuess(match: LocalMatch, input: string): string | null {
  const guesser = playingGuesser(match)
  const letter = guesser ? normalizeGuess(input, match.gameLanguage) : null
  return letter && !guesser!.guessed.includes(letter) ? letter : null
}

/** The finished turn's results, in the online shape (guessers ranked, then the setter); empty before the reveal. */
export function roundResults(match: LocalMatch): RoundResultEntry[] {
  if (match.step !== 'round-over' && match.step !== 'match-over') return []
  return [...scoreRound(match.guessers.map(finished), match.roster),
    { playerId: setterId(match), position: null, status: 'setter', forgiven: false, errors: null, resolutionTimeMs: null, pointsAwarded: 0 }]
}

/** Total score, then roster order, as online; null until the match is over. */
export function localMatchResult(match: LocalMatch): MatchResult {
  if (match.step !== 'match-over') return null
  const score = (id: string) => match.players.find((player) => player.id === id)!.score
  const ranking = [...match.roster].sort((a, b) => score(b) - score(a) || match.roster.indexOf(a) - match.roster.indexOf(b))
  return { ranking, scores: Object.fromEntries(match.players.map((player) => [player.id, player.score])) }
}

/** A stored match, or null unless it is a state this reducer could have produced. */
export function parseLocalMatch(value: unknown): LocalMatch | null {
  if (!isRecord(value) || value.version !== LOCAL_MATCH_VERSION) return null
  const { gameLanguage, voltes, players, roster, turnIndex, step, word, guessers, current } = value
  if ((gameLanguage !== 'ca' && gameLanguage !== 'es') || !SUPPORTED_VOLTES.includes(voltes as Voltes)) return null
  if (!Array.isArray(players) || players.length < MIN_LOCAL_PLAYERS || players.length > MAX_LOCAL_PLAYERS) return null
  if (!players.every((player) => isRecord(player) && typeof player.id === 'string' && normalizePlayerName(player.name) === player.name && isCount(player.score))) return null
  const seated: LocalPlayer[] = players.map((player) => ({ id: player.id, name: player.name, score: player.score }))
  if (new Set(seated.map((player) => player.id)).size !== seated.length || new Set(seated.map((player) => player.name.toLocaleLowerCase())).size !== seated.length) return null
  const first = seated.findIndex((player) => Array.isArray(roster) && player.id === roster[0])
  if (first < 0 || (roster as unknown[]).length !== seated.length || !seated.every((_, index) => (roster as unknown[])[index] === seated[(first + index) % seated.length].id)) return null
  if (!isCount(turnIndex) || turnIndex >= seated.length * (voltes as Voltes) || !STEPS.includes(step as LocalStep)) return null
  const match: LocalMatch = { version: LOCAL_MATCH_VERSION, gameLanguage, voltes: voltes as Voltes, players: seated, roster: [...roster as string[]], turnIndex, step: step as LocalStep, word: null, guessers: [], current: 0 }
  if (match.step === 'set-word' ? word !== null : typeof word !== 'string' || validateSecretWord(word, gameLanguage) !== word) return null
  match.word = word as string | null
  const expected = turnGuesserIds(seated, setterId(match))
  if (!Array.isArray(guessers) || guessers.length !== expected.length || !isCount(current) || current > expected.length) return null
  for (const [index, raw] of guessers.entries()) {
    if (!isRecord(raw) || raw.playerId !== expected[index] || !Array.isArray(raw.guessed) || !isCount(raw.errors) || typeof raw.forgiven !== 'boolean'
      || !GUESSER_STATUSES.includes(raw.status as LocalGuesserStatus) || typeof raw.activeMs !== 'number' || !isElapsed(raw.activeMs)) return null
    if (!raw.guessed.every((letter) => typeof letter === 'string' && normalizeGuess(letter, gameLanguage) === letter)) return null
    match.guessers.push({ playerId: raw.playerId, guessed: [...raw.guessed], errors: raw.errors, forgiven: raw.forgiven, status: raw.status as LocalGuesserStatus, activeMs: raw.activeMs })
  }
  match.current = current
  const fresh = (guesser: LocalGuesser) => guesser.status === 'playing' && !guesser.guessed.length && !guesser.errors && !guesser.forgiven && !guesser.activeMs
  // Everyone before `current` has finished; everyone after it has not started; `current` matches the step.
  if (match.step === 'set-word') return current === 0 && match.guessers.every(fresh) ? match : null
  const atCurrent = { guess: 'playing', forgive: 'awaiting-forgiveness' }[match.step as 'guess' | 'forgive']
  if (atCurrent ? current === expected.length || match.guessers[current].status !== atCurrent : current !== expected.length) return null
  if (!match.guessers.every((guesser, index) => index < current ? isTerminal(guesser.status) : index > current ? fresh(guesser) : true)) return null
  if (!match.guessers.every((guesser) => replays(guesser, match.word!, gameLanguage))) return null
  const last = match.turnIndex + 1 === totalTurns(match)
  if ((match.step === 'round-over' && last) || (match.step === 'match-over' && !last)) return null
  return match
}

const STEPS: readonly LocalStep[] = ['set-word', 'guess', 'forgive', 'round-over', 'match-over']
const GUESSER_STATUSES: readonly LocalGuesserStatus[] = ['playing', 'awaiting-forgiveness', 'solved', 'failed', 'eliminated']
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0
const isElapsed = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isTerminal = (status: LocalGuesserStatus) => status === 'solved' || status === 'failed' || status === 'eliminated'
const progressOf = (guesser: LocalGuesser): GuessProgress => ({ guessedLetters: new Set(guesser.guessed), errors: guesser.errors, forgiven: guesser.forgiven })
const finished = (guesser: LocalGuesser) => ({ playerId: guesser.playerId, status: guesser.status, errors: guesser.errors, forgiven: guesser.forgiven, resolutionTimeMs: guesser.activeMs })
const newGuesser = (playerId: string): LocalGuesser => ({ playerId, guessed: [], errors: 0, forgiven: false, status: 'playing', activeMs: 0 })

function playingGuesser(match: LocalMatch) {
  const guesser = match.step === 'guess' ? match.guessers[match.current] : undefined
  return guesser?.status === 'playing' ? guesser : null
}

function turnGuesserIds(players: readonly LocalPlayer[], setter: string) {
  const index = players.findIndex((player) => player.id === setter)
  return [...players.slice(index + 1), ...players.slice(0, index)].map((player) => player.id)
}

function startMatch(match: LocalMatch, random: number): LocalMatch {
  const ids = match.players.map((player) => player.id)
  const first = Math.floor(random * ids.length)
  return startTurn({ ...match, players: match.players.map((player) => ({ ...player, score: 0 })), roster: ids.slice(first).concat(ids.slice(0, first)) }, 0)
}

function startTurn(match: LocalMatch, turnIndex: number): LocalMatch {
  const next = { ...match, turnIndex, step: 'set-word' as const, word: null, current: 0 }
  return { ...next, guessers: turnGuesserIds(match.players, setterId(next)).map(newGuesser) }
}

function afterGuesserChange(match: LocalMatch, guesser: LocalGuesser): LocalMatch {
  const updated = { ...match, guessers: match.guessers.with(match.current, guesser) }
  if (guesser.status === 'playing') return { ...updated, step: 'guess' }
  if (guesser.status === 'awaiting-forgiveness') return { ...updated, step: 'forgive' }
  if (match.current + 1 < match.guessers.length) return { ...updated, step: 'guess', current: match.current + 1 }
  // Everyone has played: points are added exactly once, on this transition.
  const points = new Map(scoreRound(updated.guessers.map(finished), match.roster).map((result) => [result.playerId, result.pointsAwarded]))
  const players = match.players.map((player) => ({ ...player, score: player.score + (points.get(player.id) ?? 0) }))
  return { ...updated, players, current: updated.guessers.length, step: match.turnIndex + 1 < totalTurns(match) ? 'round-over' : 'match-over' }
}

/** Stored progress must be reachable: replaying the letters gives the same errors, status and forgiveness. */
function replays(guesser: LocalGuesser, word: string, language: Language): boolean {
  let progress: GuessProgress = { guessedLetters: new Set(), errors: 0, forgiven: false }
  let status: LocalGuesserStatus = 'playing'
  for (const letter of guesser.guessed) {
    if (status === 'awaiting-forgiveness' && guesser.forgiven) { status = 'playing'; progress = { ...progress, forgiven: true } }
    const outcome: GuessOutcome | null = status === 'playing' ? applyGuess(word, progress, letter, language) : null
    if (!outcome) return false
    progress = { ...progress, guessedLetters: new Set([...progress.guessedLetters, outcome.guess]), errors: outcome.errors }
    status = outcome.status
  }
  if (guesser.errors !== progress.errors) return false
  if (status === 'awaiting-forgiveness') return guesser.forgiven ? guesser.status === 'playing' : guesser.status === 'awaiting-forgiveness' || guesser.status === 'failed'
  return guesser.status === status && guesser.forgiven === progress.forgiven
}
