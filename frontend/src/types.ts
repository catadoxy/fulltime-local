export type TournamentFormat =
  | 'league'
  | 'knockout'
  | 'groups_knockout'
  | 'swiss'
  | 'champions_league'

export interface Player {
  id: number
  name: string
  email?: string | null
  picture?: string | null
  rating: number
  tournaments?: number
  titles?: number
}

export interface Group {
  id: number
  name: string
  sort_order: number
}

export interface Participant {
  id: number
  player_id: number
  player: Player
  seed: number | null
  group_id: number | null
}

export interface Tournament {
  id: number
  name: string
  format: TournamentFormat
  status: 'active' | 'completed'
  nb_pitches: number
  settings: Record<string, any>
  start_date: string | null
  end_date: string | null
  champion_id: number | null
  created_at: string
}

export interface TournamentDetail extends Tournament {
  groups: Group[]
  participants: Participant[]
}

export interface Match {
  id: number
  stage: string
  group_id: number | null
  round_number: number
  match_number: number
  slot: number
  pitch: number | null
  home_id: number | null
  away_id: number | null
  home_name: string | null
  away_name: string | null
  home_score: number | null
  away_score: number | null
  home_pen: number | null
  away_pen: number | null
  played: boolean
  winner_id: number | null
  leg: number
  note: string | null
}

export interface StandingRow {
  player_id: number
  player_name: string
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_diff: number
  points: number
}

export interface Table {
  group_id: number | null
  group_name: string | null
  rows: StandingRow[]
}

export interface Meta {
  formats: { id: TournamentFormat; label: string }[]
  default_settings: Record<string, Record<string, any>>
}

export interface PlayerTotals {
  tournaments: number
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  titles: number
  win_rate: number
}

export interface PlayerHistoryRow {
  tournament_id: number
  name: string
  format: TournamentFormat
  status: 'active' | 'completed'
  start_date: string | null
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  champion: boolean
  rank: number | null
}

export interface PlayerStats {
  player: Player
  totals: PlayerTotals
  history: PlayerHistoryRow[]
}
