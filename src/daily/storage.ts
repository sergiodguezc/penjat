import { ALPHABETS } from '../../shared/game'

export const DAILY_CHALLENGE_STORAGE_KEY = 'penjat-daily-challenge'

export type StoredDailyAttempt = {
  challengeId: string
  guesses: string[]
  completed: boolean
  won: boolean | null
  mistakes: number
}

export function readDailyAttempt(storage: Pick<Storage, 'getItem'> | null, challengeId: string): StoredDailyAttempt | null {
  try {
    const raw = storage?.getItem(DAILY_CHALLENGE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDailyAttempt>
    if (parsed.challengeId !== challengeId || !Array.isArray(parsed.guesses)) return null
    const guesses = parsed.guesses.filter((guess): guess is string => typeof guess === 'string' && ALPHABETS.ca.includes(guess))
    return {
      challengeId,
      guesses: [...new Set(guesses)],
      completed: parsed.completed === true,
      won: typeof parsed.won === 'boolean' ? parsed.won : null,
      mistakes: typeof parsed.mistakes === 'number' ? parsed.mistakes : 0,
    }
  } catch {
    return null
  }
}

/** Blocked storage or a full quota never interrupts the game; today's progress then lasts only for this visit. */
export function writeDailyAttempt(storage: Pick<Storage, 'setItem'> | null, attempt: StoredDailyAttempt): void {
  try { storage?.setItem(DAILY_CHALLENGE_STORAGE_KEY, JSON.stringify(attempt)) } catch { /* play continues without saving */ }
}
