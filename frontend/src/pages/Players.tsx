import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import { ConfirmDialog, EmptyState, ErrorBanner, SortableTh } from '../components/ui'
import type { Player } from '../types'

export default function Players() {
  const { canEdit } = useAuth()
  const [players, setPlayers] = useState<Player[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Player | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [sort, setSort] = useState<{ key: 'name' | 'rating' | 'tournaments'; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  })

  // Debounce server search so typing doesn't spam the API.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError('')
    api
      .players({ limit: 500, q: debouncedQuery || undefined }, ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setPlayers(data)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [debouncedQuery])

  const reload = () => {
    const ctrl = new AbortController()
    setLoading(true)
    api
      .players({ limit: 500, q: debouncedQuery || undefined }, ctrl.signal)
      .then(setPlayers)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.createPlayer({ name: name.trim() })
      setName('')
      reload()
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
      reload()
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

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...players].sort((a, b) => {
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
  }, [players, sort])

  return (
    <div>
      <h1>Players</h1>

      {canEdit && (
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
      )}
      <ErrorBanner message={error} onRetry={reload} />

      <div className="panel">
        <div className="toolbar">
          <div className="search-field grow">
            <label htmlFor="search-players-list">Search players</label>
            <div className="row" style={{ gap: '0.4rem' }}>
              <input
                id="search-players-list"
                type="search"
                value={query}
                placeholder="Name or real name…"
                onChange={(e) => setQuery(e.target.value)}
                className="full"
              />
              {query && (
                <button type="button" className="btn" onClick={() => setQuery('')}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <span className="muted small" aria-live="polite">
            {debouncedQuery ? `${sorted.length} match${sorted.length === 1 ? '' : 'es'}` : `${sorted.length} players`}
            {loading ? ' · searching…' : ''}
          </span>
        </div>
        <table className="players-table">
          <thead>
            <tr>
              <SortableTh label="Name" sortKey="name" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
              <SortableTh label="Rating" sortKey="rating" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
              <SortableTh
                label="Tournaments"
                sortKey="tournaments"
                activeKey={sort.key}
                dir={sort.dir}
                onToggle={toggleSort}
              />
              <th style={{ width: 90 }}>{canEdit ? '' : null}</th>
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
                  {!!p.titles && <span className="badge done titles-badge">🏆 {p.titles}</span>}
                </td>
                <td className="actions">
                  {canEdit && (
                    <button className="danger" onClick={() => setPendingDelete(p)}>
                      Delete
                    </button>
                  )}
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
              {debouncedQuery
                ? `No players match “${debouncedQuery}”.`
                : 'No players yet. Add some above, or import a legacy database.'}
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
