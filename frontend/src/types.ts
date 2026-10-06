export type TournamentFormat =
  | 'league'
  | 'knockout'
  | 'groups_knockout'
  | 'swiss'
  | 'champions_league'

export interface Player {
  id: number
  name: string
  real_name?: string | null
  email?: string | null
  picture?: string | null
  rating: number
  elo?: number
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

export interface TournamentSettings {
  points_win?: number
  points_draw?: number
  points_loss?: number
  home_away?: boolean
  double_round?: boolean
  third_place?: boolean
  seeded?: boolean
  groups?: number
  nb_groups?: number
  qualify_per_group?: number
  qualifiers_per_group?: number
  qualifiers?: number
  rounds?: number
  current_round?: number
  knockout_seeded?: boolean
  imported?: boolean
  source_id?: number
  import_hash?: string
  [key: string]: number | boolean | string | null | undefined
}

export interface Tournament {
  id: number
  name: string
  note: string | null
  format: TournamentFormat
  players?: number
  status: 'active' | 'completed'
  nb_pitches: number
  settings: TournamentSettings
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
  default_settings: Record<string, TournamentSettings>
}

export interface PlayerTotals {
  tournaments?: number
  titles?: number
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  win_rate: number
}

export interface PlayerHistoryRow {
  tournament_id: number
  name: string
  format: string
  status: string
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

export interface Game {
  id: number
  played_at: string
  home_id: number
  away_id: number
  home_name: string | null
  away_name: string | null
  home_score: number
  away_score: number
  note: string | null
}

export interface FriendlyMatch {
  id: number
  played_at: string
  opponent_id: number | null
  opponent_name: string
  home: boolean
  goals_for: number
  goals_against: number
  result: 'W' | 'D' | 'L'
  note: string | null
}

export interface PlayerStats {
  player: Player
  rating: { elo: number; rating: number }
  friendly_rating: { elo: number; rating: number }
  tournaments: { totals: PlayerTotals; history: PlayerHistoryRow[] }
  friendlies: { totals: PlayerTotals; matches: FriendlyMatch[] }
}

export interface CompareSection extends PlayerTotals {
  elo: number
  rating: number
}

export interface CompareSummary {
  player: { id: number; name: string }
  tournaments: CompareSection
  friendlies: CompareSection
}

export interface HeadToHeadMatch {
  date: string | null
  competition: string
  kind: string
  a_score: number
  b_score: number
  result: 'A' | 'B' | 'D'
  note?: string | null
}

export interface CompareResult {
  a: CompareSummary
  b: CompareSummary
  head_to_head: {
    a_wins: number
    b_wins: number
    draws: number
    a_goals: number
    b_goals: number
    played: number
    matches: HeadToHeadMatch[]
  }
}
