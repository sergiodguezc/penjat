import type { DailyChallenge } from './challenge'
import { createDailyRound } from './game'
import { readDailyAttempt } from './storage'

export function getHomeDailyStatus(challenge: DailyChallenge, storage: Pick<Storage, 'getItem'> | null): { status: 'new' | 'won' | 'lost'; mistakes: number } {
  const attempt = readDailyAttempt(storage, challenge.id)
  const round = createDailyRound(challenge.entry, attempt?.guesses)
  return { status: round.result === 'win' ? 'won' : round.result === 'loss' ? 'lost' : 'new', mistakes: round.errors }
}
