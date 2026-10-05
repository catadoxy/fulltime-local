import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Player } from '../types'

export default function Players() {
  const [players, setPlayers] = useState<Player[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

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
              <th>Name</th>
              <th style={{ width: 90 }}>Rating</th>
              <th style={{ width: 130 }}>Tournaments</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link to={`/players/${p.id}`}>{p.name}</Link>
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
                  No players yet. Add some above, or import your legacy database.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
