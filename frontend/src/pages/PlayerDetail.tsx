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

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

function ResultBadge({ result }: { result: 'W' | 'D' | 'L' }) {
  const cls = result === 'W' ? 'badge done' : result === 'L' ? 'badge loss' : 'badge'
  const label = result === 'W' ? 'Win' : result === 'L' ? 'Loss' : 'Draw'
  return <span className={cls}>{label}</span>
}

export default function PlayerDetail() {
  const { id } = useParams()
  const pid = Number(id)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'tournaments' | 'friendlies'>('tournaments')
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [realDraft, setRealDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    api.playerStats(pid).then(setStats).catch((e) => setError(e.message))
  }
  useEffect(load, [pid])

  if (!stats) return <div className="panel">{error || 'Loading…'}</div>

  const { player, rating, friendly_rating, tournaments: tr, friendlies: fr } = stats

  async function savePlayer() {
    setSaving(true)
    setError('')
    try {
      await api.updatePlayer(pid, {
        name: nameDraft.trim() || player.name,
        real_name: realDraft.trim() || null,
      })
      setEditing(false)
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="row between page-head">
        <div className="grow">
          {editing ? (
            <div style={{ display: 'grid', gap: '0.55rem', maxWidth: 460 }}>
              <div>
                <label htmlFor="p-name">Nickname</label>
                <input
                  id="p-name"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label htmlFor="p-real">Real name</label>
                <input
                  id="p-real"
                  value={realDraft}
                  placeholder="e.g. Cătălin Popescu"
                  onChange={(e) => setRealDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') savePlayer()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="row">
                <button className="primary" disabled={saving} onClick={savePlayer}>
                  Save
                </button>
                <button onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h1 style={{ marginBottom: player.real_name ? 2 : 6 }}>
                {player.name}{' '}
                <button
                  className="btn"
                  style={{ marginLeft: 8, verticalAlign: 'middle', fontWeight: 400 }}
                  onClick={() => {
                    setNameDraft(player.name)
                    setRealDraft(player.real_name ?? '')
                    setEditing(true)
                  }}
                >
                  ✎ Edit
                </button>
              </h1>
              {player.real_name && (
                <div className="small muted" style={{ marginBottom: 4 }}>
                  {player.real_name}
                </div>
              )}
            </>
          )}
          <div className="row small muted">
            <span>
              Participated in <strong>{tr.totals.tournaments}</strong>{' '}
              {tr.totals.tournaments === 1 ? 'tournament' : 'tournaments'}
            </span>
            <span>·</span>
            <span>
              <strong>{fr.totals.played}</strong> {fr.totals.played === 1 ? 'friendly' : 'friendlies'}
            </span>
            {!!tr.totals.titles && (
              <>
                <span>·</span>
                <span className="won">🏆 {tr.totals.titles} titles</span>
              </>
            )}
          </div>
        </div>
        <Link className="btn" to="/players">
          ← All players
        </Link>
      </div>

      <div className="tabs">
        <button className={tab === 'tournaments' ? 'active' : ''} onClick={() => setTab('tournaments')}>
          Tournaments
        </button>
        <button className={tab === 'friendlies' ? 'active' : ''} onClick={() => setTab('friendlies')}>
          Friendlies
        </button>
      </div>

      {tab === 'tournaments' ? (
        <div>
          <div className="stats-grid" style={{ marginBottom: '0.75rem' }}>
            <Stat label="Rating" value={rating.rating} />
            <Stat label="Elo" value={rating.elo} />
            <Stat label="Tournaments" value={tr.totals.tournaments ?? 0} />
            <Stat label="🏆 Titles" value={tr.totals.titles ?? 0} />
          </div>
          <div className="stats-grid" style={{ marginBottom: '0.75rem' }}>
            <Stat label="Matches played" value={tr.totals.played} />
            <Stat label="Won" value={tr.totals.won} />
            <Stat label="Drawn" value={tr.totals.drawn} />
            <Stat label="Lost" value={tr.totals.lost} />
          </div>
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            <Stat label="Goals for" value={tr.totals.goals_for} />
            <Stat label="Goals against" value={tr.totals.goals_against} />
            <Stat label="Win rate" value={`${tr.totals.win_rate}%`} />
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Tournament history</h3>
            <table>
              <thead>
                <tr>
                  <th>Tournament</th>
                  <th>Date</th>
                  <th>Format</th>
                  <th className="num">P</th>
                  <th className="num">W</th>
                  <th className="num">D</th>
                  <th className="num">L</th>
                  <th className="num">GF</th>
                  <th className="num">GA</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {tr.history.map((h) => (
                  <tr key={h.tournament_id}>
                    <td>
                      <Link to={`/t/${h.tournament_id}`}>{h.name}</Link>
                    </td>
                    <td className="muted small">{formatDate(h.start_date)}</td>
                    <td className="muted small">{FORMAT_LABELS[h.format as TournamentFormat] ?? h.format}</td>
                    <td className="num">{h.played}</td>
                    <td className="num">{h.won}</td>
                    <td className="num">{h.drawn}</td>
                    <td className="num">{h.lost}</td>
                    <td className="num">{h.goals_for}</td>
                    <td className="num">{h.goals_against}</td>
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
                {tr.history.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted">
                      No tournaments played yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          <div className="stats-grid" style={{ marginBottom: '0.75rem' }}>
            <Stat label="Friendly rating" value={friendly_rating.rating} />
            <Stat label="Friendly Elo" value={friendly_rating.elo} />
            <Stat label="Friendlies" value={fr.totals.played} />
            <Stat label="Won" value={fr.totals.won} />
          </div>
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            <Stat label="Drawn" value={fr.totals.drawn} />
            <Stat label="Lost" value={fr.totals.lost} />
            <Stat label="Goals for" value={fr.totals.goals_for} />
            <Stat label="Goals against" value={fr.totals.goals_against} />
          </div>
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            <Stat label="Win rate" value={`${fr.totals.win_rate}%`} />
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Friendly results</h3>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th>Side</th>
                  <th className="num">Score</th>
                  <th>Result</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {fr.matches.map((m) => (
                  <tr key={m.id}>
                    <td className="muted small">{m.played_at}</td>
                    <td>
                      {m.opponent_id ? (
                        <Link to={`/players/${m.opponent_id}`}>{m.opponent_name}</Link>
                      ) : (
                        m.opponent_name
                      )}
                    </td>
                    <td className="muted small">{m.home ? 'Home' : 'Away'}</td>
                    <td className="num score">
                      {m.goals_for}–{m.goals_against}
                    </td>
                    <td>
                      <ResultBadge result={m.result} />
                    </td>
                    <td className="muted small">{m.note || '—'}</td>
                  </tr>
                ))}
                {fr.matches.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No friendlies recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
