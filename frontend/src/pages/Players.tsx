import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Player } from '../types'

export default function Players() {
  const [players, setPlayers] = useState<Player[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [sort, setSort] = useState<{ key: 'name' | 'rating' | 'tournaments'; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  })

  const load = () => api.players().then(setPlayers).catch((e) => setError(e.message))

  useEffect(() => {
    load()
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await api.createPlayer({ name: name.trim() })
      setName('')
      load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function remove(p: Player) {
    if (!confirm(`Delete player "${p.name}"?`)) return
    try {
      await api.deletePlayer(p.id)
      load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  function toggleSort(key: 'name' | 'rating' | 'tournaments') {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
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

  const arrow = (key: string) =>
    sort.key === key ? <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null

  return (
    <div>
      <h1>Players</h1>

      <form className="panel row" onSubmit={add}>
        <div className="grow">
          <label>Name</label>
          <input className="grow" style={{ width: '100%' }} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <button className="primary" type="submit" style={{ alignSelf: 'flex-end' }}>
          Add player
        </button>
      </form>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('name')}>
                Name {arrow('name')}
              </th>
              <th className="sortable" style={{ width: 90 }} onClick={() => toggleSort('rating')}>
                Rating {arrow('rating')}
              </th>
              <th className="sortable" style={{ width: 130 }} onClick={() => toggleSort('tournaments')}>
                Tournaments {arrow('tournaments')}
              </th>
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
                  <button className="danger" onClick={() => remove(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {players.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No players yet. Add some above, or import a legacy database.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
