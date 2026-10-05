import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Game, Player } from '../types'

const today = () => new Date().toISOString().slice(0, 10)

export default function Friendlies() {
  const [games, setGames] = useState<Game[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [homeId, setHomeId] = useState('')
  const [awayId, setAwayId] = useState('')
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [playedAt, setPlayedAt] = useState(today())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.games().then(setGames).catch((e) => setError(e.message))
    api.players().then(setPlayers).catch(() => {})
  }
  useEffect(load, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!homeId || !awayId) return setError('Pick both players')
    if (homeId === awayId) return setError('Pick two different players')
    setBusy(true)
    try {
      await api.createGame({
        home_id: Number(homeId),
        away_id: Number(awayId),
        home_score: Number(homeScore || 0),
        away_score: Number(awayScore || 0),
        played_at: playedAt,
        note: note || null,
      })
      setHomeScore('')
      setAwayScore('')
      setNote('')
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(g: Game) {
    if (!confirm(`Delete ${g.home_name} ${g.home_score}-${g.away_score} ${g.away_name}?`)) return
    try {
      await api.deleteGame(g.id)
      load()
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 style={{ marginBottom: 4 }}>Friendlies</h1>
        <div className="small muted">
          Record friendly matches outside a tournament. They count toward each player's stats and
          rating.
        </div>
      </div>

      <form className="panel" onSubmit={add}>
        <div className="row" style={{ alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <label>Home</label>            <select value={homeId} onChange={(e) => setHomeId(e.target.value)}>
              <option value="">—</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="game-home-score">Score</label>
            <div className="row" style={{ gap: '0.35rem' }}>
              <input
                id="game-home-score"
                className="no-spin"
                type="number"
                inputMode="numeric"
                min={0}
                aria-label="Home score"
                style={{ width: 64, textAlign: 'center' }}
                value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
              />
              <span className="muted">-</span>
              <input
                className="no-spin"
                type="number"
                inputMode="numeric"
                min={0}
                aria-label="Away score"
                style={{ width: 64, textAlign: 'center' }}
                value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label>Away</label>
            <select value={awayId} onChange={(e) => setAwayId(e.target.value)}>
              <option value="">—</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} />
          </div>
          <div className="grow">
            <label>Note (optional)</label>
            <input
              style={{ width: '100%' }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Rocket League, best of 3"
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            Add friendly
          </button>
        </div>
        {players.length < 2 && <div className="muted small">Add at least two players first.</div>}
        {error && <div className="error">{error}</div>}
      </form>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Date</th>
              <th className="team away">Home</th>
              <th style={{ width: 80, textAlign: 'center' }}>Score</th>
              <th className="team">Away</th>
              <th>Note</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => {
              const homeWin = g.home_score > g.away_score
              const awayWin = g.away_score > g.home_score
              return (
                <tr key={g.id}>
                  <td className="muted small">{g.played_at}</td>
                  <td className={`team away ${homeWin ? 'won' : ''}`}>{g.home_name}</td>
                  <td className="score" style={{ textAlign: 'center' }}>
                    {g.home_score} - {g.away_score}
                  </td>
                  <td className={`team ${awayWin ? 'won' : ''}`}>{g.away_name}</td>
                  <td className="muted small">{g.note || '—'}</td>
                  <td>
                    <button className="danger" onClick={() => remove(g)}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
            {games.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No games recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="muted small">
        Tip: a player's full record (tournaments + friendlies) is on their{' '}
        <Link to="/players">profile</Link>.
      </div>
    </div>
  )
}
