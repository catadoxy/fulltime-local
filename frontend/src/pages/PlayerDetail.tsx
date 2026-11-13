import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import { TrendChart } from '../components/charts'
import { ErrorBanner, LoadingSkeleton, TableWrap } from '../components/ui'
import { FORMAT_LABELS } from '../labels'
import type { PlayerStats, PlayerTimeline, TimelinePoint, TournamentFormat } from '../types'

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

function shortDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function fullDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function FormCharts({ points }: { points: TimelinePoint[] }) {
  const [metric, setMetric] = useState<'elo' | 'rating' | 'goals'>('elo')

  // A career can span years; axis labels need the year or Apr→Oct looks like
  // a single season. Tooltips always show the full date.
  const years = new Set(points.map((p) => p.date?.slice(0, 4)).filter(Boolean))
  const multiYear = years.size > 1
  const span =
    points.length > 1 ? `${fullDate(points[0].date)} – ${fullDate(points[points.length - 1].date)}` : ''

  const meta = points.map((p) => ({
    label: `${fullDate(p.date)} · ${p.opponent_name}`,
    axisLabel: multiYear ? fullDate(p.date) : shortDate(p.date),
    detail: p.competition,
    result: p.result,
  }))

  const series =
    metric === 'elo'
      ? [{ name: 'Elo', color: 'var(--floodlight)', values: points.map((p) => p.elo) }]
      : metric === 'rating'
        ? [{ name: 'Rating', color: 'var(--amber)', values: points.map((p) => p.rating) }]
        : [
            { name: 'Goals for', color: 'var(--grass)', values: points.map((p) => p.cumulative_goals_for) },
            { name: 'Goals against', color: 'var(--red)', values: points.map((p) => p.cumulative_goals_against) },
          ]

  return (
    <div className="panel">
      <div className="row between" style={{ marginBottom: '0.25rem' }}>
        <h3 style={{ margin: 0 }}>Form over time</h3>
        <div className="segmented" role="group" aria-label="Chart metric">
          {(['elo', 'rating', 'goals'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={metric === m ? 'active' : ''}
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
            >
              {m === 'elo' ? 'Elo' : m === 'rating' ? 'Rating' : 'Goals'}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {metric === 'goals'
          ? 'Cumulative goals across matches.'
          : `Match-by-match ${metric === 'elo' ? 'Elo' : 'rating'}.`}
        {span && <> · {span}</>}
      </p>
      <TrendChart
        series={series}
        points={meta}
        emptyLabel="No matches recorded yet — play one to start the chart."
      />
    </div>
  )
}

export default function PlayerDetail() {
  const { canEdit } = useAuth()
  const { id } = useParams()
  const pid = Number(id)
  const [search, setSearch] = useSearchParams()
  const tab = search.get('tab') === 'friendlies' ? 'friendlies' : 'tournaments'
  const setTab = (v: 'tournaments' | 'friendlies') => {
    const next = new URLSearchParams(search)
    next.set('tab', v)
    setSearch(next, { replace: true })
  }
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [timeline, setTimeline] = useState<PlayerTimeline | null>(null)
  const [metric, setMetric] = useState<'elo' | 'rating' | 'goals'>('elo')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyQuery, setHistoryQuery] = useState('')
  const [friendlyQuery, setFriendlyQuery] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [friendlyPage, setFriendlyPage] = useState(1)
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [realDraft, setRealDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    api
      .playerStats(pid)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    api
      .playerTimeline(pid)
      .then(setTimeline)
      .catch(() => {
        /* charts are optional; stats already show the error */
      })
  }
  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setTimeline(null)
    setHistoryPage(1)
    setFriendlyPage(1)
    setHistoryQuery('')
    setFriendlyQuery('')
    api
      .playerStats(pid, ctrl.signal)
      .then((s) => {
        if (!ctrl.signal.aborted) setStats(s)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    api
      .playerTimeline(pid, ctrl.signal)
      .then((t) => {
        if (!ctrl.signal.aborted) setTimeline(t)
      })
      .catch(() => {
        /* ignore: chart panel simply stays hidden */
      })
    return () => ctrl.abort()
  }, [pid])

  if (loading && !stats) return <LoadingSkeleton rows={6} label="Loading player…" />
  if (!stats)
    return (
      <div className="panel">
        <ErrorBanner message={error || 'Player not found'} />
      </div>
    )

  const { player, rating, friendly_rating, tournaments: tr, friendlies: fr } = stats
  const pageSize = 10
  const filteredHistory = tr.history.filter((item) =>
    historyQuery.trim()
      ? item.name.toLowerCase().includes(historyQuery.trim().toLowerCase())
      : true,
  )
  const historyPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize))
  const currentHistoryPage = Math.min(historyPage, historyPages)
  const visibleHistory = filteredHistory.slice((currentHistoryPage - 1) * pageSize, currentHistoryPage * pageSize)
  const filteredFriendlies = fr.matches.filter((match) =>
    friendlyQuery.trim()
      ? `${match.opponent_name} ${match.note ?? ''}`.toLowerCase().includes(friendlyQuery.trim().toLowerCase())
      : true,
  )
  const friendlyPages = Math.max(1, Math.ceil(filteredFriendlies.length / pageSize))
  const currentFriendlyPage = Math.min(friendlyPage, friendlyPages)
  const visibleFriendlies = filteredFriendlies.slice((currentFriendlyPage - 1) * pageSize, currentFriendlyPage * pageSize)

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
                {canEdit && (
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
                )}
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

      <ErrorBanner message={error} onRetry={load} />

      <div className="tabs" role="tablist" aria-label="Player record">
        <button
          role="tab"
          aria-selected={tab === 'tournaments'}
          className={tab === 'tournaments' ? 'active' : ''}
          onClick={() => setTab('tournaments')}
        >
          Tournaments
        </button>
        <button
          role="tab"
          aria-selected={tab === 'friendlies'}
          className={tab === 'friendlies' ? 'active' : ''}
          onClick={() => setTab('friendlies')}
        >
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

          {timeline && timeline.tournaments.length > 0 && (
            <FormCharts points={timeline.tournaments} />
          )}

          <div className="panel">
            <div className="row between" style={{ marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Tournament history</h3>
              {tr.history.length > 3 && (
                <div className="search-field" style={{ minWidth: 200 }}>
                  <label htmlFor="history-search">Search history</label>
                  <input
                    id="history-search"
                    type="search"
                    value={historyQuery}
                    placeholder="Tournament name…"
                    onChange={(e) => {
                      setHistoryQuery(e.target.value)
                      setHistoryPage(1)
                    }}
                  />
                </div>
              )}
            </div>
            <TableWrap size="wide">
              <table className="history-table">
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
                {visibleHistory.map((h) => (
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
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted">
                      {historyQuery.trim() ? `No tournaments match “${historyQuery.trim()}”.` : 'No tournaments played yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
              </table>
            </TableWrap>
            {filteredHistory.length > pageSize && (
              <div className="record-pagination">
                <span className="muted small">
                  Showing {(currentHistoryPage - 1) * pageSize + 1}–{Math.min(currentHistoryPage * pageSize, filteredHistory.length)} of {filteredHistory.length}
                </span>
                <div className="row">
                  <button type="button" disabled={currentHistoryPage <= 1} onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}>
                    Previous
                  </button>
                  <span className="muted small">Page {currentHistoryPage} of {historyPages}</span>
                  <button type="button" disabled={currentHistoryPage >= historyPages} onClick={() => setHistoryPage((current) => Math.min(historyPages, current + 1))}>
                    Next
                  </button>
                </div>
              </div>
            )}
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

          {timeline && timeline.friendlies.length > 0 && (
            <FormCharts points={timeline.friendlies} />
          )}

          <div className="panel">
            <div className="row between" style={{ marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0 }}>Friendly results</h3>
              {fr.matches.length > 3 && (
                <div className="search-field" style={{ minWidth: 200 }}>
                  <label htmlFor="friendly-search">Search friendlies</label>
                  <input
                    id="friendly-search"
                    type="search"
                    value={friendlyQuery}
                    placeholder="Opponent or note…"
                    onChange={(e) => {
                      setFriendlyQuery(e.target.value)
                      setFriendlyPage(1)
                    }}
                  />
                </div>
              )}
            </div>
            <TableWrap size="comfortable">
              <table className="friendlies-history-table">
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
                {visibleFriendlies.map((m) => (
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
                {filteredFriendlies.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {friendlyQuery.trim() ? `No friendlies match “${friendlyQuery.trim()}”.` : 'No friendlies recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
              </table>
            </TableWrap>
            {filteredFriendlies.length > pageSize && (
              <div className="record-pagination">
                <span className="muted small">
                  Showing {(currentFriendlyPage - 1) * pageSize + 1}–{Math.min(currentFriendlyPage * pageSize, filteredFriendlies.length)} of {filteredFriendlies.length}
                </span>
                <div className="row">
                  <button type="button" disabled={currentFriendlyPage <= 1} onClick={() => setFriendlyPage((current) => Math.max(1, current - 1))}>
                    Previous
                  </button>
                  <span className="muted small">Page {currentFriendlyPage} of {friendlyPages}</span>
                  <button type="button" disabled={currentFriendlyPage >= friendlyPages} onClick={() => setFriendlyPage((current) => Math.min(friendlyPages, current + 1))}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
