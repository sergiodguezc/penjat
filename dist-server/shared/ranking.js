/** Competition ranks: equal totals share a place (1, 1, 3).
 * Stable input order only orders rows; it never breaks a score tie.
 * Round points have their own ordering (`scoreRound` in shared/round.ts) and do not use this helper.
 */
export function rankByScore(players) {
    const ordered = [...players].sort((a, b) => b.score - a.score);
    let rank = 0;
    return ordered.map((player, index) => {
        if (index === 0 || player.score !== ordered[index - 1].score)
            rank = index + 1;
        return { player, rank };
    });
}
