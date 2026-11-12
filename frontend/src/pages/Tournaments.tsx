import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import { ErrorBanner, SearchInput, SortableTh, TableWrap, formatDate } from '../components/ui'
import { FORMAT_LABELS } from '../labels'
import type { FootballCompetition, FootballTeam, Player, Tournament, TournamentFormat, TournamentSettings } from '../types'

type SortKey = 'name' | 'format' | 'status' | 'champion' | 'players' | 'date'

export default function Tournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all')
  const [formatFilter, setFormatFilter] = useState<'all' | TournamentFormat>('all')

  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [startDate, setStartDate] = useState('')
  const [format, setFormat] = useState<TournamentFormat>('league')
  const [nbPitches, setNbPitches] = useState(1)
  const [randomDraw, setRandomDraw] = useState(true)
  const [matchMinutes, setMatchMinutes] = useState(10)
  const [changeoverMinutes, setChangeoverMinutes] = useState(5)
  const [calibration, setCalibration] = useState<{
    samples: number
    median_slot_minutes: number
  } | null>(null)
  const timeTouchedRef = useRef(false)
  const [selected, setSelected] = useState<number[]>([])
  const [footballConfigured, setFootballConfigured] = useState(false)
  const [showTeamOptions, setShowTeamOptions] = useState(false)
  const [competitions, setCompetitions] = useState<FootballCompetition[]>([])
  const [competitionCode, setCompetitionCode] = useState('')
  const [footballTeams, setFootballTeams] = useState<FootballTeam[]>([])
  const [teamAssignments, setTeamAssignments] = useState<Record<number, number>>({})
  const [loadingCompetitions, setLoadingCompetitions] = useState(false)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const teamRequest = useRef<AbortController | null>(null)
  const [settings, setSettings] = useState<TournamentSettings>({})
  const [submitting, setSubmitting] = useState(false)

  const navigate = useNavigate()
  const { canEdit } = useAuth()

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    Promise.all([
      api.tournaments(undefined, ctrl.signal),
      api.players(undefined, ctrl.signal),
      api.meta(ctrl.signal),
      api.settings(ctrl.signal),
    ])
      .then(([ts, ps, meta, appSettings]) => {
        if (ctrl.signal.aborted) return
        setTournaments(ts)
        setPlayers(ps)
        setFootballConfigured(appSettings.football_data_configured)
        const cal = meta.calibration
        if (cal && cal.samples >= 2 && cal.median_slot_minutes) {
          setCalibration({
            samples: cal.samples,
            median_slot_minutes: cal.median_slot_minutes,
          })
          // Pre-fill the changeover from how long slots really took, unless
          // the form was already edited.
          if (!timeTouchedRef.current) {
            setChangeoverMinutes(Math.max(0, Math.round(cal.median_slot_minutes) - 10))
          }
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [])

  const championNames = useMemo(() => {
    const map = new Map<number, string>()
    players.forEach((p) => map.set(p.id, p.name))
    return map
  }, [players])

  function toggle(playerId: number) {
    if (selected.includes(playerId)) {
      setSelected((prev) => prev.filter((id) => id !== playerId))
      setTeamAssignments((assignments) => {
        const next = { ...assignments }
        delete next[playerId]
        return next
      })
    } else {
      setSelected((prev) => [...prev, playerId])
    }
  }

  async function toggleTeamOptions() {
    const opening = !showTeamOptions
    setShowTeamOptions(opening)
    setError('')
    if (!opening || competitions.length) return
    setLoadingCompetitions(true)
    try {
      const data = await api.footballCompetitions()
      setCompetitions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingCompetitions(false)
    }
  }

  async function loadCompetitionTeams(code: string) {
    teamRequest.current?.abort()
    setCompetitionCode(code)
    setTeamAssignments({})
    setFootballTeams([])
    if (!code) {
      setLoadingTeams(false)
      return
    }
    const ctrl = new AbortController()
    teamRequest.current = ctrl
    setLoadingTeams(true)
    setError('')
    try {
      const data = await api.footballTeams(code, ctrl.signal)
      if (!ctrl.signal.aborted) setFootballTeams(data)
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!ctrl.signal.aborted) setLoadingTeams(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const t = await api.createTournament({
        name,
        note: note.trim() || null,
        start_date: startDate || null,
        format,
        player_ids: selected,
        participant_teams: teamAssignments,
        nb_pitches: nbPitches,
        settings: {
          ...settings,
          match_minutes: matchMinutes,
          changeover_minutes: changeoverMinutes,
          random_draw: randomDraw,
        },
      })
      navigate(`/t/${t.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function toggleSort(key: string) {
    setSort((s) =>
      s.key === key
        ? { key: key as SortKey, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: key as SortKey, dir: key === 'date' ? 'desc' : 'asc' },
    )
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tournaments.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (formatFilter !== 'all' && t.format !== formatFilter) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        (t.note ?? '').toLowerCase().includes(q)
      )
    })
  }, [tournaments, query, statusFilter, formatFilter])

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      let av: number | string
      let bv: number | string
      switch (sort.key) {
        case 'format':
          av = FORMAT_LABELS[a.format] ?? a.format
          bv = FORMAT_LABELS[b.format] ?? b.format
          break
        case 'status':
          av = a.status
          bv = b.status
          break
        case 'champion':
          av = a.champion_id ? championNames.get(a.champion_id) ?? '' : ''
          bv = b.champion_id ? championNames.get(b.champion_id) ?? '' : ''
          break
        case 'players':
          av = a.players ?? 0
          bv = b.players ?? 0
          break
        case 'date':
          av = a.start_date ?? a.created_at
          bv = b.start_date ?? b.created_at
          break
        default:
          av = a.name.toLowerCase()
          bv = b.name.toLowerCase()
      }
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [filtered, sort, championNames])

  return (
    <div>
      <div className="row between">
        <h1>Tournaments</h1>
        {canEdit && (
          <button className="primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Close' : '+ New tournament'}
          </button>
        )}
      </div>

      {canEdit && showCreate && (
        <form className="panel create-form" onSubmit={submit}>
          <div className="row">
            <div className="grow">
              <label htmlFor="t-name">Name</label>
              <input
                id="t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="full"
              />
            </div>
            <div className="grow">
              <label htmlFor="t-format">Format</label>
              <select
                id="t-format"
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value as TournamentFormat)
                  setSettings({})
                }}
                className="full"
              >
                {Object.entries(FORMAT_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="t-pitches">Pitches / TVs</label>
              <input
                id="t-pitches"
                type="number"
                min={1}
                max={64}
                value={nbPitches}
                onChange={(e) => setNbPitches(Number(e.target.value))}
                className="num-input"
              />
            </div>
          </div>

          <div className="row" style={{ alignItems: 'flex-end', marginBottom: '0.75rem' }}>
            <div className="grow">
              <label htmlFor="new-note">Game / note (optional)</label>
              <input
                id="new-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. FIFA 24, Rocket League"
                className="full"
              />
            </div>
            <div>
              <label htmlFor="new-date">Start date (optional)</label>
              <input
                id="new-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="new-match-len">Match length (min)</label>
              <input
                id="new-match-len"
                type="number"
                min={1}
                max={600}
                value={matchMinutes}
                onChange={(e) => {
                  timeTouchedRef.current = true
                  setMatchMinutes(Number(e.target.value))
                }}
                className="num-input"
                title="How long one match is expected to take"
              />
            </div>
            <div>
              <label htmlFor="new-changeover">Changeover (min)</label>
              <input
                id="new-changeover"
                type="number"
                min={0}
                max={120}
                value={changeoverMinutes}
                onChange={(e) => {
                  timeTouchedRef.current = true
                  setChangeoverMinutes(Number(e.target.value))
                }}
                className="num-input"
                title="Extra time between matches (teams swapping, setup…)"
              />
            </div>
          </div>

          {calibration && (
            <p className="muted small" style={{ marginTop: '-0.35rem' }}>
              Defaults use {calibration.samples} completed event
              {calibration.samples === 1 ? '' : 's'}: about {calibration.median_slot_minutes} min per
              slot.
            </p>
          )}

          <FormatSettings format={format} settings={settings} setSettings={setSettings} />

          <div className="row between" style={{ alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Players ({selected.length})</h3>
            <label className="row" style={{ color: 'var(--text)', margin: 0 }}>
              <input
                type="checkbox"
                checked={randomDraw}
                onChange={(e) => setRandomDraw(e.target.checked)}
              />
              Random draw
            </label>
          </div>
          <p className="muted small">
            {randomDraw
              ? 'Participants are shuffled, so nobody gets a systematically easy or hard run of matches.'
              : 'Order matters: the first selected is seed 1.'}
          </p>
          <div className="grid">
            {players.map((p) => {
              const idx = selected.indexOf(p.id)
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`player-pick ${idx >= 0 ? 'selected' : ''}`}
                  onClick={() => toggle(p.id)}
                  aria-pressed={idx >= 0}
                >
                  <span className="badge">
                    {idx >= 0 ? (randomDraw ? '✓' : `#${idx + 1}`) : '—'}
                  </span>
                  <span>{p.name}</span>
                </button>
              )
            })}
            {players.length === 0 && <p className="muted">Add players first.</p>}
          </div>

          {footballConfigured && (
            <section className="team-assignment-section" aria-label="Optional club team assignment">
              <div className="row between">
                <div>
                  <h3 style={{ margin: '1rem 0 0.2rem' }}>Club teams <span className="muted small">(optional)</span></h3>
                  <p className="muted small" style={{ margin: 0 }}>Assign one club to each player. Multiple players can share a club.</p>
                </div>
                <button type="button" className="btn" onClick={() => void toggleTeamOptions()}>
                  {showTeamOptions ? 'Hide team options' : 'Choose teams'}
                </button>
              </div>
              {showTeamOptions && (
                <div className="team-assignment-panel">
                  <div style={{ maxWidth: 420 }}>
                    <label htmlFor="team-competition">Competition</label>
                    <select
                      id="team-competition"
                      className="full"
                      value={competitionCode}
                      disabled={loadingCompetitions}
                      onChange={(e) => void loadCompetitionTeams(e.target.value)}
                    >
                      <option value="">{loadingCompetitions ? 'Loading competitions…' : 'Choose a competition'}</option>
                      {competitions.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                  </div>
                  {loadingTeams && <p className="muted small">Loading teams…</p>}
                  {competitionCode && !loadingTeams && footballTeams.length === 0 && (
                    <p className="muted small">No teams returned for this competition.</p>
                  )}
                  {selected.length > 0 && footballTeams.length > 0 && (
                    <div className="team-assignment-list">
                      {selected.map((playerId) => {
                        const player = players.find((p) => p.id === playerId)
                        const assignedId = teamAssignments[playerId]
                        const assigned = footballTeams.find((team) => team.id === assignedId)
                        return (
                          <div className="team-assignment-row" key={playerId}>
                            <span className="team-assignment-player">{player?.name}</span>
                            <select
                              aria-label={`Club team for ${player?.name ?? 'player'}`}
                              value={assignedId ?? ''}
                              onChange={(e) => {
                                const next = { ...teamAssignments }
                                if (e.target.value) next[playerId] = Number(e.target.value)
                                else delete next[playerId]
                                setTeamAssignments(next)
                              }}
                            >
                              <option value="">No club</option>
                              {footballTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                            </select>
                            {assigned?.crest_url ? (
                              <img className="team-crest" src={assigned.crest_url} alt="" loading="lazy" />
                            ) : <span className="team-crest-placeholder" aria-hidden="true" />}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {selected.length === 0 && <p className="muted small">Select players first to assign club teams.</p>}
                </div>
              )}
            </section>
          )}

          <div className="row" style={{ marginTop: '1rem' }}>
            <button className="primary" type="submit" disabled={selected.length < 2 || submitting}>
              {submitting ? 'Creating…' : 'Create tournament'}
            </button>
            {selected.length < 2 && <span className="muted small">Select at least 2 players.</span>}
          </div>
        </form>
      )}

      <ErrorBanner message={error} />

      {!showCreate && (
        <div className="panel">
          <div className="toolbar">
            <SearchInput value={query} onChange={setQuery} label="Search tournaments" placeholder="Search name or game…" />
            <div>
              <label htmlFor="flt-status">Status</label>
              <select
                id="flt-status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label htmlFor="flt-format">Format</label>
              <select
                id="flt-format"
                value={formatFilter}
                onChange={(e) => setFormatFilter(e.target.value as typeof formatFilter)}
              >
                <option value="all">All formats</option>
                {Object.entries(FORMAT_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <span className="muted small" aria-live="polite">
              {sorted.length} of {tournaments.length}
            </span>
          </div>
          <TableWrap size="wide">
            <table className="tournaments-table">
              <thead>
              <tr>
                <SortableTh label="Name" sortKey="name" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
                <SortableTh label="Format" sortKey="format" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
                <SortableTh label="Status" sortKey="status" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
                <SortableTh label="Champion" sortKey="champion" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
                <SortableTh label="Players" sortKey="players" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} numeric />
                <SortableTh label="Date" sortKey="date" activeKey={sort.key} dir={sort.dir} onToggle={toggleSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/t/${t.id}`}>{t.name}</Link>
                    {t.note && <div className="muted small">{t.note}</div>}
                  </td>
                  <td className="muted">{FORMAT_LABELS[t.format] ?? t.format}</td>
                  <td>
                    <span className={`badge ${t.status === 'completed' ? 'done' : 'live'}`}>{t.status}</span>
                  </td>
                  <td>{t.champion_id ? championNames.get(t.champion_id) ?? `#${t.champion_id}` : '—'}</td>
                  <td className="num">{t.players ?? 0}</td>
                  <td className="muted small">{formatDate(t.start_date ?? t.created_at)}</td>
                  <td>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <Link className="btn" to={`/t/${t.id}`}>
                        Open
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </TableWrap>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            sorted.length === 0 && (
              <div className="empty-state">
                {tournaments.length === 0 ? 'No tournaments yet. Create one above.' : 'No tournaments match these filters.'}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

function FormatSettings({
  format,
  settings,
  setSettings,
}: {
  format: TournamentFormat
  settings: TournamentSettings
  setSettings: (s: TournamentSettings) => void
}) {
  const set = (key: string, value: number | boolean | undefined) =>
    setSettings({ ...settings, [key]: value })

  const numberField = (key: string, label: string, min = 1, max = 64) => (
    <div>
      <label>{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={(settings[key] as number) ?? ''}
        onChange={(e) => set(key, e.target.value === '' ? undefined : Number(e.target.value))}
        className="num-input"
      />
    </div>
  )

  const checkbox = (key: string, label: string) => (
    <label className="row" style={{ color: 'var(--text)', marginTop: '1.4rem' }}>
      <input
        type="checkbox"
        checked={Boolean(settings[key])}
        onChange={(e) => set(key, e.target.checked)}
      />
      {label}
    </label>
  )

  return (
    <div className="row" style={{ marginTop: '0.5rem' }}>
      {format === 'league' && checkbox('double_round', 'Home & away (double round)')}
      {format === 'knockout' && checkbox('third_place', 'Play a third-place match')}
      {format === 'swiss' && numberField('rounds', 'Number of rounds (blank = auto)', 1, 30)}
      {format === 'champions_league' && (
        <>
          {numberField('qualifiers', 'Teams into knockout', 2, 32)}
          {checkbox('double_round', 'Double round league phase')}
        </>
      )}
      {format === 'groups_knockout' && (
        <>
          {numberField('nb_groups', 'Number of groups', 1, 16)}
          {numberField('qualifiers_per_group', 'Qualifiers per group', 1, 8)}
          {checkbox('double_round', 'Home & away group games')}
        </>
      )}
    </div>
  )
}
