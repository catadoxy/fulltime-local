import type {
  Match,
  Meta,
  Player,
  PlayerStats,
  Table,
  Tournament,
  TournamentDetail,
} from './types'

const BASE = import.meta.env.VITE_API_URL ?? ''

async function http<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = await res.json()
      message = data.detail ?? message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  meta: () => http<Meta>('/api/meta'),

  players: () => http<Player[]>('/api/players'),
  createPlayer: (data: Partial<Player>) =>
    http<Player>('/api/players', { method: 'POST', body: JSON.stringify(data) }),
  updatePlayer: (id: number, data: Partial<Player>) =>
    http<Player>(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePlayer: (id: number) => http<void>(`/api/players/${id}`, { method: 'DELETE' }),
  playerStats: (id: number) => http<PlayerStats>(`/api/players/${id}/stats`),

  tournaments: () => http<Tournament[]>('/api/tournaments'),
  tournament: (id: number) => http<TournamentDetail>(`/api/tournaments/${id}`),
  createTournament: (data: Record<string, unknown>) =>
    http<TournamentDetail>('/api/tournaments', { method: 'POST', body: JSON.stringify(data) }),
  updateTournament: (id: number, data: Record<string, unknown>) =>
    http<TournamentDetail>(`/api/tournaments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTournament: (id: number) =>
    http<void>(`/api/tournaments/${id}`, { method: 'DELETE' }),

  matches: (id: number) => http<Match[]>(`/api/tournaments/${id}/matches`),
  standings: (id: number) => http<{ tables: Table[] }>(`/api/tournaments/${id}/standings`),
  setResult: (tid: number, mid: number, data: Record<string, unknown>) =>
    http<Match>(`/api/tournaments/${tid}/matches/${mid}/result`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  clearResult: (tid: number, mid: number) =>
    http<Match>(`/api/tournaments/${tid}/matches/${mid}/result`, { method: 'DELETE' }),

  importLegacy: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/api/import/legacy`, { method: 'POST', body: form })
    if (!res.ok) {
      let message = res.statusText
      try {
        message = (await res.json()).detail ?? message
      } catch {
        /* ignore */
      }
      throw new Error(message)
    }
    return res.json()
  },
}
