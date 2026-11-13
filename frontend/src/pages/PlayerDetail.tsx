import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import { TrendChart } from '../components/charts'
import { csvFilename, downloadCsv, type CsvCell } from '../csv'
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
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [historyClub, setHistoryClub] = useState('')
  const [historyResult, setHistoryResult] = useState<'all' | 'champion' | 'win' | 'draw' | 'loss'>('all')
  const [friendlyDateFrom, setFriendlyDateFrom] = useState('')
  const [friendlyDateTo, setFriendlyDateTo] = useState('')
  const [friendlyClub, setFriendlyClub] = useState('')
  const [friendlyResult, setFriendlyResult] = useState<'all' | 'W' | 'D' | 'L'>('all')
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
    setHistoryDateFrom('')
    setHistoryDateTo('')
    setHistoryClub('')
    setHistoryResult('all')
    setFriendlyDateFrom('')
    setFriendlyDateTo('')
    setFriendlyClub('')
    setFriendlyResult('all')
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
  const historyClubOptions = [...new Set(tr.history.map((item) => item.team_name).filter(Boolean))].sort(
    (a, b) => (a ?? '').localeCompare(b ?? ''),
  ) as string[]
  const friendlyClubOptions = [...new Set(
    fr.matches.flatMap((match) => [match.team_name, match.opponent_team_name]).filter(Boolean),
  )].sort((a, b) => (a ?? '').localeCompare(b ?? '')) as string[]
  const historySearch = historyQuery.trim().toLowerCase()
  const filteredHistory = tr.history.filter((item) => {
    if (historySearch && !`${item.name} ${item.note ?? ''}`.toLowerCase().includes(historySearch)) return false
    if (historyDateFrom && (!item.start_date || item.start_date < historyDateFrom)) return false
    if (historyDateTo && (!item.start_date || item.start_date > historyDateTo)) return false
    if (historyClub && item.team_name !== historyClub) return false
    if (historyResult === 'champion' && !item.champion) return false
    if (historyResult === 'win' && item.won === 0) return false
    if (historyResult === 'draw' && item.drawn === 0) return false
    if (historyResult === 'loss' && item.lost === 0) return false
    return true
  })
  const historyPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize))
  const currentHistoryPage = Math.min(historyPage, historyPages)
  const visibleHistory = filteredHistory.slice((currentHistoryPage - 1) * pageSize, currentHistoryPage * pageSize)
  const friendlySearch = friendlyQuery.trim().toLowerCase()
  const filteredFriendlies = fr.matches.filter((match) => {
    if (friendlySearch && !`${match.opponent_name} ${match.opponent_team_name ?? ''} ${match.team_name ?? ''} ${match.note ?? ''}`.toLowerCase().includes(friendlySearch)) return false
    if (friendlyDateFrom && match.played_at < friendlyDateFrom) return false
    if (friendlyDateTo && match.played_at > friendlyDateTo) return false
    if (friendlyClub && match.team_name !== friendlyClub && match.opponent_team_name !== friendlyClub) return false
    if (friendlyResult !== 'all' && match.result !== friendlyResult) return false
    return true
  })
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

  function exportPlayerProfile() {
    const columns = [
      'Record type', 'Player', 'Real name', 'Date', 'Event', 'Game / note', 'Format',
      'Opponent', 'Club', 'Opponent club', 'Side', 'Result', 'Played', 'Wins', 'Draws',
      'Losses', 'Goals for', 'Goals against', 'Win rate (%)', 'Titles', 'Champion', 'Rank',
      'Elo', 'Rating',
    ] as const
    type Column = (typeof columns)[number]
    const row = (values: Partial<Record<Column, CsvCell>>) =>
      columns.map((column) => values[column] ?? '')
    const rows: CsvCell[][] = [
      row({
        'Record type': 'Summary',
        Player: player.name,
        'Real name': player.real_name,
        Event: 'Tournaments',
        Played: tr.totals.played,
        Wins: tr.totals.won,
        Draws: tr.totals.drawn,
        Losses: tr.totals.lost,
        'Goals for': tr.totals.goals_for,
        'Goals against': tr.totals.goals_against,
        'Win rate (%)': tr.totals.win_rate,
        Titles: tr.totals.titles ?? 0,
        Elo: rating.elo,
        Rating: rating.rating,
      }),
      row({
        'Record type': 'Summary',
        Player: player.name,
        'Real name': player.real_name,
        Event: 'Friendlies',
        Played: fr.totals.played,
        Wins: fr.totals.won,
        Draws: fr.totals.drawn,
        Losses: fr.totals.lost,
        'Goals for': fr.totals.goals_for,
        'Goals against': fr.totals.goals_against,
        'Win rate (%)': fr.totals.win_rate,
        Elo: friendly_rating.elo,
        Rating: friendly_rating.rating,
      }),
      ...tr.history.map((item) => row({
        'Record type': 'Tournament',
        Player: player.name,
        'Real name': player.real_name,
        Date: item.start_date,
        Event: item.name,
        'Game / note': item.note,
        Format: item.format,
        Club: item.team_name,
        Result: item.champion ? 'Champion' : item.rank ? ordinal(item.rank) : '',
        Played: item.played,
        Wins: item.won,
        Draws: item.drawn,
        Losses: item.lost,
        'Goals for': item.goals_for,
        'Goals against': item.goals_against,
        'Win rate (%)': item.played ? Math.round((item.won / item.played) * 100) : 0,
        Titles: item.champion ? 1 : 0,
        Champion: item.champion ? 'Yes' : 'No',
        Rank: item.rank,
      })),
      ...fr.matches.map((match) => row({
        'Record type': 'Friendly',
        Player: player.name,
        'Real name': player.real_name,
        Date: match.played_at,
        Event: 'Friendly',
        'Game / note': match.note,
        Opponent: match.opponent_name,
        Club: match.team_name,
        'Opponent club': match.opponent_team_name,
        Side: match.home ? 'Home' : 'Away',
        Result: match.result,
        Played: 1,
        Wins: match.result === 'W' ? 1 : 0,
        Draws: match.result === 'D' ? 1 : 0,
        Losses: match.result === 'L' ? 1 : 0,
        'Goals for': match.goals_for,
        'Goals against': match.goals_against,
      })),
    ]
    downloadCsv(`${csvFilename(player.name)}-profile.csv`, [...columns], rows)
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
        <div className="row">
          <button type="button" className="btn" onClick={exportPlayerProfile}>
            Export profile CSV
          </button>
          <Link className="btn" to="/players">
            ← All players
          </Link>
        </div>
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
                    placeholder="Tournament or game…"
                    onChange={(e) => {
                      setHistoryQuery(e.target.value)
                      setHistoryPage(1)
                    }}
                  />
                </div>
              )}
            </div>
            <details className="history-filter-details">
              <summary>Filter tournament history</summary>
              <div className="history-filter-grid">
                <div>
                  <label htmlFor="history-from">From</label>
                  <input id="history-from" type="date" value={historyDateFrom} onChange={(e) => { setHistoryDateFrom(e.target.value); setHistoryPage(1) }} />
                </div>
                <div>
                  <label htmlFor="history-to">To</label>
                  <input id="history-to" type="date" value={historyDateTo} onChange={(e) => { setHistoryDateTo(e.target.value); setHistoryPage(1) }} />
                </div>
                <div>
                  <label htmlFor="history-club">Club</label>
                  <select id="history-club" className="full" value={historyClub} onChange={(e) => { setHistoryClub(e.target.value); setHistoryPage(1) }}>
                    <option value="">All clubs</option>
                    {historyClubOptions.map((club) => <option key={club} value={club}>{club}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="history-result">Result</label>
                  <select id="history-result" className="full" value={historyResult} onChange={(e) => { setHistoryResult(e.target.value as typeof historyResult); setHistoryPage(1) }}>
                    <option value="all">Any result</option>
                    <option value="champion">Champion</option>
                    <option value="win">Won a match</option>
                    <option value="draw">Drew a match</option>
                    <option value="loss">Lost a match</option>
                  </select>
                </div>
                <button type="button" onClick={() => {
                  setHistoryDateFrom('')
                  setHistoryDateTo('')
                  setHistoryClub('')
                  setHistoryResult('all')
                  setHistoryQuery('')
                  setHistoryPage(1)
                }}>
                  Clear filters
                </button>
              </div>
            </details>
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
                  <label htmlFor="friendly-search">Search opponent, game or club</label>
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
            <details className="history-filter-details">
              <summary>Filter friendly results</summary>
              <div className="history-filter-grid">
                <div>
                  <label htmlFor="friendly-from">From</label>
                  <input id="friendly-from" type="date" value={friendlyDateFrom} onChange={(e) => { setFriendlyDateFrom(e.target.value); setFriendlyPage(1) }} />
                </div>
                <div>
                  <label htmlFor="friendly-to">To</label>
                  <input id="friendly-to" type="date" value={friendlyDateTo} onChange={(e) => { setFriendlyDateTo(e.target.value); setFriendlyPage(1) }} />
                </div>
                <div>
                  <label htmlFor="friendly-club-filter">Club</label>
                  <select id="friendly-club-filter" className="full" value={friendlyClub} onChange={(e) => { setFriendlyClub(e.target.value); setFriendlyPage(1) }}>
                    <option value="">All clubs</option>
                    {friendlyClubOptions.map((club) => <option key={club} value={club}>{club}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="friendly-result-filter">Result</label>
                  <select id="friendly-result-filter" className="full" value={friendlyResult} onChange={(e) => { setFriendlyResult(e.target.value as typeof friendlyResult); setFriendlyPage(1) }}>
                    <option value="all">Any result</option>
                    <option value="W">Win</option>
                    <option value="D">Draw</option>
                    <option value="L">Loss</option>
                  </select>
                </div>
                <button type="button" onClick={() => {
                  setFriendlyDateFrom('')
                  setFriendlyDateTo('')
                  setFriendlyClub('')
                  setFriendlyResult('all')
                  setFriendlyQuery('')
                  setFriendlyPage(1)
                }}>
                  Clear filters
                </button>
              </div>
            </details>
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
