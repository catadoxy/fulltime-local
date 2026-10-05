import type { TournamentFormat } from './types'

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  league: 'Championship / round-robin',
  knockout: 'Knockout',
  groups_knockout: 'Group stage + finals',
  swiss: 'Swiss system',
  champions_league: 'Champions League',
}

export const FORMAT_BADGES: Record<TournamentFormat, string> = {
  league: 'League',
  knockout: 'Cup',
  groups_knockout: 'Groups+G',
  swiss: 'Swiss',
  champions_league: 'Champions L.',
}
