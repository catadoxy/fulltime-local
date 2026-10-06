import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { ConfirmDialog, EmptyState, ErrorBanner, SearchInput, SortableTh } from '../components/ui'
import type { Player } from '../types'

export default function Players() {
  const [players, setPlayers] = useState<Player[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Player | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sort, setSort] = useState<{ key: 'name' | 'rating' | 'tournaments'; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  })

  const load = async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const data = await api.players({ limit: 500 }, signal)
      if (!signal?.aborted) setPlayers(data)
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.createPlayer({ name: name.trim() })
      setName('')
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function confirmRemove() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deletePlayer(pendingDelete.id)
      setPendingDelete(null)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  function toggleSort(key: string) {
    setSort((s) =>
      s.key === key
        ? { key: key as typeof s.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: key as typeof s.key, dir: 'asc' },
    )
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return players
    return players.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.real_name ?? '').toLowerCase().includes(q),
    )
  }, [players, query])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let av: number | string
      let bv: number | string
      if (sort.key === 'name') {
        av = a.name.toLowerCase()
        bv = b.name.toLowerCase()
      } else if (sort.key === 'rating') {
        av = a.rating
        bv = b.rating
      } else {
        av = a.tournaments ?? 0
        bv = b.tournaments ?? 0
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [filtered, sort])

  return (
    <div>
      <h1>Players</h1>

      <form className="panel row" onSubmit={add}>
        <div className="grow">
          <label htmlFor="player-name">Name</label>
          <input
            id="player-name"
            className="full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        </div>
        <button className="primary" type="submit" style={{ alignSelf: 'flex-end' }}>
          Add player
        </button>
      </form>
      <ErrorBanner message={error} onRetry={() => load()} />

      <div className="panel">
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} label="players" placeholder="Search players…" />
          <span className="muted small" aria-live="polite">
            {sorted.length} of {players.length}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <SortableTh label="Name" sortKey="name" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
              <SortableTh label="Rating" sortKey="rating" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} numeric />
              <SortableTh
                label="Tournaments"
                sortKey="tournaments"
                activeKey={sort.key}
                dir={sort.dir}
                onToggle={toggleSort}
                numeric
              />
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/players/${p.id}`}>{p.name}</Link>
                  {p.real_name && <div className="muted small">{p.real_name}</div>}
                </td>
                <td>
                  <span className="badge" title={`Elo ${p.elo ?? 1000}`}>
                    {p.rating}
                  </span>
                </td>
                <td>
                  <span className="badge">{p.tournaments ?? 0}</span>
                  {!!p.titles && (
                    <span className="badge done" style={{ marginLeft: 6 }}>
                      🏆 {p.titles}
                    </span>
                  )}
                </td>
                <td>
                  <button className="danger" onClick={() => setPendingDelete(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          sorted.length === 0 && (
            <EmptyState>
              {players.length === 0
                ? 'No players yet. Add some above, or import a legacy database.'
                : 'No players match this search.'}
            </EmptyState>
          )
        )}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete player"
          message={`Delete player "${pendingDelete.name}"? Only possible when they are not in any tournament.`}
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
          busy={deleting}
        />
      )}
    </div>
  )
}
