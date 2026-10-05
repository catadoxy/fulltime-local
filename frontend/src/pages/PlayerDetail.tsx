import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { FORMAT_LABELS } from '../labels'
import type { PlayerStats, TournamentFormat } from '../types'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  )
}

export default function PlayerDetail() {
  const { id } = useParams()
  const pid = Number(id)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .playerStats(pid)
      .then(setStats)
      .catch((e) => setError(e.message))
  }, [pid])

  if (!stats) return <div className="panel">{error || 'Loading…'}</div>

  const { player, totals, history } = stats

  return (
    <div>
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 4 }}>{player.name}</h1>
          <div className="small muted">
            {player.email && <span>{player.email} · </span>}
            Participated in <strong>{totals.tournaments}</strong>{' '}
            {totals.tournaments === 1 ? 'tournament' : 'tournaments'}
            {totals.titles > 0 && (
              <>
                {' · '}
                <span className="won">
                  🏆 {totals.titles} {totals.titles === 1 ? 'title' : 'titles'}
                </span>
              </>
            )}
          </div>
        </div>
        <Link className="btn" to="/players">
          ← All players
        </Link>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <Stat label="Rating" value={totals.rating} />
        <Stat label="Elo" value={totals.elo} />
        <Stat label="Tournaments" value={totals.tournaments} />
        <Stat label="🏆 Titles" value={totals.titles} />
        <Stat label="Matches played" value={totals.played} />
        <Stat label="Won" value={totals.won} />
        <Stat label="Drawn" value={totals.drawn} />
        <Stat label="Lost" value={totals.lost} />
        <Stat label="Goals for" value={totals.goals_for} />
        <Stat label="Goals against" value={totals.goals_against} />
        <Stat label="Win rate" value={`${totals.win_rate}%`} />
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>History</h3>
        <table>
          <thead>
            <tr>
              <th>Tournament</th>
              <th>Format</th>
              <th>P</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>GF</th>
              <th>GA</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.tournament_id}>
                <td>
                  {h.tournament_id ? (
                    <Link to={`/t/${h.tournament_id}`}>{h.name}</Link>
                  ) : (
                    h.name
                  )}
                </td>
                <td className="muted small">
                  {FORMAT_LABELS[h.format as TournamentFormat] ??
                    (h.format === 'friendly' ? 'Friendlies' : h.format)}
                </td>
                <td>{h.played}</td>
                <td>{h.won}</td>
                <td>{h.drawn}</td>
                <td>{h.lost}</td>
                <td>{h.goals_for}</td>
                <td>{h.goals_against}</td>
                <td>
                  {h.champion ? (
                    <span className="badge done">🏆 Champion</span>
                  ) : h.rank ? (
                    <span className="badge">{ordinal(h.rank)}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No tournaments played yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
