import { isCorrectGuess, isWordComplete, MAX_ERRORS, normalizeGuess } from './game.js';
/** One letter from a guesser who is still playing; null for a repeated letter, which changes nothing.
 * The sixth error waits for forgiveness; once forgiven, one more error eliminates. Throws `invalid-guess`. */
export function applyGuess(word, progress, input, language) {
    if (typeof input !== 'string')
        throw new Error('invalid-guess');
    const guess = normalizeGuess(input, language);
    if (!guess)
        throw new Error('invalid-guess');
    if (progress.guessedLetters.has(guess))
        return null;
    if (isWordComplete(word, new Set([...progress.guessedLetters, guess]), language))
        return { guess, errors: progress.errors, status: 'solved' };
    if (isCorrectGuess(word, guess, language))
        return { guess, errors: progress.errors, status: 'playing' };
    const errors = progress.errors + 1;
    const status = !progress.forgiven && errors >= MAX_ERRORS ? 'awaiting-forgiveness' : progress.forgiven && errors > MAX_ERRORS ? 'eliminated' : 'playing';
    return { guess, errors, status };
}
/** Ranks a finished turn's guessers: solved first, fewer errors, shorter time, then roster order.
 * With G guessers, a solved entry at index i earns G−i points; every other entry earns none. The setter is not included. */
export function scoreRound(guessers, rosterOrder) {
    const time = (guesser) => guesser.resolutionTimeMs ?? Number.POSITIVE_INFINITY;
    const ranked = [...guessers].sort((a, b) => Number(b.status === 'solved') - Number(a.status === 'solved') || a.errors - b.errors
        || time(a) - time(b) || rosterOrder.indexOf(a.playerId) - rosterOrder.indexOf(b.playerId));
    return ranked.map((guesser, index) => ({
        playerId: guesser.playerId,
        position: index + 1,
        status: guesser.status,
        forgiven: guesser.forgiven,
        errors: guesser.errors,
        resolutionTimeMs: guesser.resolutionTimeMs,
        pointsAwarded: guesser.status === 'solved' ? ranked.length - index : 0,
    }));
}
