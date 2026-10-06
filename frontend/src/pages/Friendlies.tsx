import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { ConfirmDialog, EmptyState, ErrorBanner } from '../components/ui'
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
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<Game | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const [gs, ps] = await Promise.all([
        api.games({ limit: 500 }, signal),
        api.players({ limit: 500 }, signal),
      ])
      if (!signal?.aborted) {
        setGames(gs)
        setPlayers(ps)
      }
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
    if (!homeId || !awayId) return setError('Pick both players')
    if (homeId === awayId) return setError('Pick two different players')
    if (homeScore === '' || awayScore === '') return setError('Enter both scores')
    setBusy(true)
    try {
      await api.createGame({
        home_id: Number(homeId),
        away_id: Number(awayId),
        home_score: Number(homeScore),
        away_score: Number(awayScore),
        played_at: playedAt,
        note: note.trim() || null,
      })
      setHomeScore('')
      setAwayScore('')
      setNote('')
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemove() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteGame(pendingDelete.id)
      setPendingDelete(null)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
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
            <label htmlFor="fr-home">Home</label>
            <select id="fr-home" value={homeId} onChange={(e) => setHomeId(e.target.value)}>
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
                className="no-spin score-narrow"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                aria-label="Home score"
                value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
              />
              <span className="muted">-</span>
              <input
                className="no-spin score-narrow"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                aria-label="Away score"
                value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="fr-away">Away</label>
            <select id="fr-away" value={awayId} onChange={(e) => setAwayId(e.target.value)}>
              <option value="">—</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fr-date">Date</label>
            <input id="fr-date" type="date" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} />
          </div>
          <div className="grow">
            <label htmlFor="fr-note">Note (optional)</label>
            <input
              id="fr-note"
              className="full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Rocket League, best of 3"
              maxLength={500}
            />
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add friendly'}
          </button>
        </div>
        {players.length < 2 && <div className="muted small">Add at least two players first.</div>}
      </form>
      <ErrorBanner message={error} onRetry={() => load()} />

      <div className="panel">
        <table className="friendly-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Date</th>
              <th className="home">Home</th>
              <th className="score" style={{ width: 90 }}>
                Score
              </th>
              <th className="away">Away</th>
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
                  <td className={`home ${homeWin ? 'won' : ''}`}>{g.home_name}</td>
                  <td className="score">
                    {g.home_score}–{g.away_score}
                  </td>
                  <td className={`away ${awayWin ? 'won' : ''}`}>{g.away_name}</td>
                  <td className="muted small">{g.note || '—'}</td>
                  <td>
                    <button className="danger" onClick={() => setPendingDelete(g)}>
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          games.length === 0 && <EmptyState>No games recorded yet.</EmptyState>
        )}
      </div>

      <div className="muted small">
        Tip: a player's full record (tournaments + friendlies) is on their{' '}
        <Link to="/players">profile</Link>.
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete friendly"
          message={`Delete ${pendingDelete.home_name} ${pendingDelete.home_score}-${pendingDelete.away_score} ${pendingDelete.away_name}?`}
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
          busy={deleting}
        />
      )}
    </div>
  )
}
