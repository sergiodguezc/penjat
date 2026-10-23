// End dates are exclusive, in Europe/Madrid, independently of the game/daily calendar.
export const SEASONS = [
  { id: 'spooky', start: '2026-10-26', end: '2026-11-09' },
] as const

export type Season = typeof SEASONS[number]['id']

const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function getSeason(date = new Date(), override?: string): Season | null {
  if (override === 'none') return null
  const forced = SEASONS.find((season) => season.id === override)
  if (forced) return forced.id
  const dateKey = calendar.format(date)
  return SEASONS.find((season) => dateKey >= season.start && dateKey < season.end)?.id ?? null
}
