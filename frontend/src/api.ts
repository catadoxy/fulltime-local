import type {
  CompareResult,
  Game,
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
    credentials: 'same-origin',
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
    throw new Error(typeof message === 'string' ? message : res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    const detail = (data as { detail?: unknown }).detail
    return typeof detail === 'string' ? detail : res.statusText
  } catch {
    return res.statusText
  }
}

export const api = {
  meta: (signal?: AbortSignal) => http<Meta>('/api/meta', { signal }),

  players: (params?: { limit?: number; offset?: number }, signal?: AbortSignal) => {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const suffix = q.toString() ? `?${q}` : ''
    return http<Player[]>(`/api/players${suffix}`, { signal })
  },
  createPlayer: (data: Partial<Player>) =>
    http<Player>('/api/players', { method: 'POST', body: JSON.stringify(data) }),
  updatePlayer: (id: number, data: Partial<Player>) =>
    http<Player>(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePlayer: (id: number) => http<void>(`/api/players/${id}`, { method: 'DELETE' }),
  playerStats: (id: number, signal?: AbortSignal) =>
    http<PlayerStats>(`/api/players/${id}/stats`, { signal }),
  compare: (a: number, b: number, signal?: AbortSignal) =>
    http<CompareResult>(`/api/compare?a=${a}&b=${b}`, { signal }),

  games: (params?: { limit?: number; offset?: number }, signal?: AbortSignal) => {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const suffix = q.toString() ? `?${q}` : ''
    return http<Game[]>(`/api/games${suffix}`, { signal })
  },
  createGame: (data: Record<string, unknown>) =>
    http<Game>('/api/games', { method: 'POST', body: JSON.stringify(data) }),
  deleteGame: (id: number) => http<void>(`/api/games/${id}`, { method: 'DELETE' }),

  authStatus: () =>
    http<{ auth_required: boolean; authenticated: boolean }>('/api/auth/status'),
  authLogin: (password: string) =>
    http<{ ok: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  authLogout: () => http<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  tournaments: (params?: { limit?: number; offset?: number }, signal?: AbortSignal) => {
    const q = new URLSearchParams()
    if (params?.limit != null) q.set('limit', String(params.limit))
    if (params?.offset != null) q.set('offset', String(params.offset))
    const suffix = q.toString() ? `?${q}` : ''
    return http<Tournament[]>(`/api/tournaments${suffix}`, { signal })
  },
  tournament: (id: number, signal?: AbortSignal) =>
    http<TournamentDetail>(`/api/tournaments/${id}`, { signal }),
  createTournament: (data: Record<string, unknown>) =>
    http<TournamentDetail>('/api/tournaments', { method: 'POST', body: JSON.stringify(data) }),
  updateTournament: (id: number, data: Record<string, unknown>) =>
    http<TournamentDetail>(`/api/tournaments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTournament: (id: number) =>
    http<void>(`/api/tournaments/${id}`, { method: 'DELETE' }),
  closeTournament: (id: number) =>
    http<TournamentDetail>(`/api/tournaments/${id}/close`, { method: 'POST' }),

  matches: (id: number, signal?: AbortSignal) =>
    http<Match[]>(`/api/tournaments/${id}/matches`, { signal }),
  standings: (id: number, signal?: AbortSignal) =>
    http<{ tables: Table[] }>(`/api/tournaments/${id}/standings`, { signal }),
  setResult: (tid: number, mid: number, data: Record<string, unknown>) =>
    http<Match>(`/api/tournaments/${tid}/matches/${mid}/result`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  clearResult: (tid: number, mid: number) =>
    http<Match>(`/api/tournaments/${tid}/matches/${mid}/result`, { method: 'DELETE' }),

  importLegacy: async (file: File, replace = false) => {
    const form = new FormData()
    form.append('file', file)
    form.append('replace', replace ? 'true' : 'false')
    const res = await fetch(`${BASE}/api/import/legacy`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    })
    if (!res.ok) throw new Error(await parseError(res))
    return res.json() as Promise<unknown>
  },
  exportBackupUrl: () => `${BASE}/api/export/backup`,
}
