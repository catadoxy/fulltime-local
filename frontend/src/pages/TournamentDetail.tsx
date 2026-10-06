import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { Match, Table, TournamentDetail as TDetail } from '../types'

const KNOCKOUT_ORDER = ['r64', 'r32', 'r16', 'qf', 'sf', 'third', 'final']
const TABLE_STAGES = ['league', 'league_phase', 'group', 'swiss']
const STAGE_LABELS: Record<string, string> = {
  r64: 'Round of 64',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-finals',
  sf: 'Semi-finals',
  third: 'Third place',
  final: 'Final',
  league: 'League',
  league_phase: 'League phase',
  group: 'Group stage',
  swiss: 'Swiss rounds',
}
const isKnockout = (stage: string) => KNOCKOUT_ORDER.includes(stage)

export default function TournamentDetail() {
  const { id } = useParams()
  const tid = Number(id)
  const navigate = useNavigate()
  const [t, setT] = useState<TDetail | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [tables, setTables] = useState<Table[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [dateDraft, setDateDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const [detail, ms, st] = await Promise.all([
        api.tournament(tid),
        api.matches(tid),
        api.standings(tid),
      ])
      setT(detail)
      setMatches(ms)
      setTables(st.tables)
    } catch (e: any) {
      setError(e.message)
    }
  }

  useEffect(() => {
    load()
  }, [tid])

  const playerNames = useMemo(() => {
    const map = new Map<number, string>()
    t?.participants.forEach((p) => map.set(p.player_id, p.player.name))
    return map
  }, [t])

  const groupNames = useMemo(() => {
    const map = new Map<number, string>()
    t?.groups.forEach((g) => map.set(g.id, g.name))
    return map
  }, [t])

  const hasBracket = matches.some((m) => isKnockout(m.stage))
  const hasTables = matches.some((m) => TABLE_STAGES.includes(m.stage))
  const champion = t?.champion_id ? playerNames.get(t.champion_id) : null
  const qualifiers =
    t?.format === 'groups_knockout'
      ? Number(t.settings.qualifiers_per_group ?? 2)
      : t?.format === 'champions_league'
        ? Number(t.settings.qualifiers ?? 8)
        : 1

  async function removeTournament() {
    if (!t) return
    if (!confirm(`Delete tournament "${t.name}" and all its matches? This cannot be undone.`)) return
    try {
      await api.deleteTournament(t.id)
      navigate('/tournaments')
    } catch (e: any) {
      setError(e.message)
    }
  }

  const allPlayed = matches.length > 0 && matches.every((m) => m.played)

  async function saveDetails() {
    if (!t) return
    setSaving(true)
    setError('')
    try {
      await api.updateTournament(t.id, {
        name: nameDraft.trim() || t.name,
        note: noteDraft.trim() || null,
        start_date: dateDraft || null,
      })
      setEditing(false)
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function closeTournament() {
    if (!t) return
    const msg = allPlayed
      ? `Close "${t.name}"? It will be marked as completed.`
      : `"${t.name}" still has unplayed matches. Close it anyway?`
    if (!confirm(msg)) return
    try {
      await api.closeTournament(t.id)
      load()
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (!t) return <div className="panel">{error || 'Loading…'}</div>

  return (
    <div>
      <div className="row between page-head">
        <div className="grow">
          {editing ? (
            <div style={{ display: 'grid', gap: '0.55rem', maxWidth: 560 }}>
              <div>
                <label htmlFor="t-name">Name</label>
                <input
                  id="t-name"
                  value={nameDraft}
                  autoFocus
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
                  style={{ width: '100%', fontSize: '1.1rem', fontWeight: 700 }}
                />
              </div>
              <div>
                <label htmlFor="t-note">Game / note</label>
                <input
                  id="t-note"
                  value={noteDraft}
                  placeholder="e.g. FIFA 24, Rocket League"
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveDetails()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label htmlFor="t-date">Start date</label>
                <input
                  id="t-date"
                  type="date"
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                />
              </div>
              <div className="row">
                <button className="primary" disabled={saving} onClick={saveDetails}>
                  Save
                </button>
                <button onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h1 style={{ marginBottom: t.note ? 2 : 6 }}>
                {t.name}{' '}
                <button
                  className="btn"
                  style={{ marginLeft: 8, verticalAlign: 'middle', fontWeight: 400 }}
                  onClick={() => {
                    setNameDraft(t.name)
                    setNoteDraft(t.note ?? '')
                    setDateDraft(t.start_date ?? '')
                    setEditing(true)
                  }}
                >
                  ✎ Edit
                </button>
              </h1>
              {t.note && (
                <div className="muted small" style={{ marginBottom: 4 }}>
                  {t.note}
                </div>
              )}
              <div className="row small">
                <span className="muted">{STAGE_LABELS[t.format] ?? t.format}</span>
                <span className={`badge ${t.status === 'completed' ? 'done' : 'live'}`}>{t.status}</span>
                <span className="muted">{t.nb_pitches} pitch(es)</span>
                {champion && <span className="badge done">🏆 {champion}</span>}
              </div>
            </>
          )}
        </div>
        <div className="row">
          {t.status === 'active' && (
            <button className="primary" title="Mark this tournament as completed" onClick={closeTournament}>
              Close tournament
            </button>
          )}
          <button className="danger" onClick={removeTournament}>
            Delete
          </button>
          <Link className="btn" to="/tournaments">
            ← All tournaments
          </Link>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {hasTables && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Standings</h3>
          {tables.map((table, i) => (
            <div key={i} style={{ marginBottom: i < tables.length - 1 ? '1rem' : 0 }}>
              {table.group_name && <div className="row-header">{table.group_name}</div>}
              <StandingsTable table={table} qualifiers={qualifiers} />
            </div>
          ))}
        </div>
      )}

      <Fixtures matches={matches} groupNames={groupNames} nbPitches={t.nb_pitches} tid={tid} onChange={load} />

      {hasBracket && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Bracket</h3>
          <Bracket matches={matches} />
        </div>
      )}
    </div>
  )
}

function StandingsTable({ table, qualifiers = 1 }: { table: Table; qualifiers?: number }) {
  return (
    <table>
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Player</th>
          <th className="num">P</th>
          <th className="num">W</th>
          <th className="num">D</th>
          <th className="num">L</th>
          <th className="num">GF</th>
          <th className="num">GA</th>
          <th className="num">GD</th>
          <th className="num">Pts</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={r.player_id} className={i < qualifiers ? 'leader' : undefined}>
            <td className="num">{i + 1}</td>
            <td>
              <Link to={`/players/${r.player_id}`}>{r.player_name}</Link>
            </td>
            <td className="num">{r.played}</td>
            <td className="num">{r.won}</td>
            <td className="num">{r.drawn}</td>
            <td className="num">{r.lost}</td>
            <td className="num">{r.goals_for}</td>
            <td className="num">{r.goals_against}</td>
            <td className="num">{r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}</td>
            <td className="num score">{r.points}</td>
          </tr>
        ))}
        {table.rows.length === 0 && (
          <tr>
            <td colSpan={10} className="muted">
              No results yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

function Fixtures({
  matches,
  groupNames,
  nbPitches,
  tid,
  onChange,
}: {
  matches: Match[]
  groupNames: Map<number, string>
  nbPitches: number
  tid: number
  onChange: () => void
}) {
  // Group into sections: stage (+ group), then by round within the section.
  const sections = useMemo(() => {
    const keyed = new Map<string, { title: string; order: number; matches: Match[] }>()
    for (const m of matches) {
      const stageRank = isKnockout(m.stage) ? KNOCKOUT_ORDER.indexOf(m.stage) : -1
      const key = `${m.stage}:${m.group_id ?? ''}`
      let title = STAGE_LABELS[m.stage] ?? m.stage
      if (m.stage === 'group') title = groupNames.get(m.group_id ?? -1) ?? 'Group'
      const entry = keyed.get(key) ?? { title, order: stageRank, matches: [] }
      entry.matches.push(m)
      keyed.set(key, entry)
    }
    const arr = [...keyed.values()]
    arr.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
    arr.forEach((s) =>
      s.matches.sort(
        (x, y) =>
          x.round_number - y.round_number || x.slot - y.slot || (x.pitch ?? 0) - (y.pitch ?? 0),
      ),
    )
    return arr
  }, [matches, groupNames])

  if (matches.length === 0) return <div className="panel muted">No fixtures.</div>

  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Fixtures &amp; results</h3>
      {sections.map((section) => {
        const knockoutSection = isKnockout(section.matches[0]?.stage ?? '')
        const rounds = [...new Set(section.matches.map((m) => m.round_number))]
        return (
          <div className="round" key={section.title + rounds[0]}>
            <div className="round-header">
              {section.title}
              {!knockoutSection && <span className="muted small">Matchday {rounds[0]}</span>}
            </div>
            {rounds.map((round) => (
              <div key={round}>
                {!knockoutSection && round !== rounds[0] && (
                  <div className="round-header muted">Matchday {round}</div>
                )}
                {section.matches
                  .filter((m) => m.round_number === round)
                  .map((m) => (
                    <MatchRow key={m.id} match={m} tid={tid} nbPitches={nbPitches} onChange={onChange} />
                  ))}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

const asStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))

function MatchRow({
  match,
  tid,
  nbPitches,
  onChange,
}: {
  match: Match
  tid: number
  nbPitches: number
  onChange: () => void
}) {
  const [home, setHome] = useState(asStr(match.home_score))
  const [away, setAway] = useState(asStr(match.away_score))
  const [hp, setHp] = useState(asStr(match.home_pen))
  const [ap, setAp] = useState(asStr(match.away_pen))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setHome(asStr(match.home_score))
    setAway(asStr(match.away_score))
    setHp(asStr(match.home_pen))
    setAp(asStr(match.away_pen))
    // Only re-sync when this match's stored values change — not on every
    // refetch (which would wipe scores typed into other rows).
  }, [match.id, match.home_score, match.away_score, match.home_pen, match.away_pen])

  const ready = match.home_id != null && match.away_id != null
  const knockout = isKnockout(match.stage)
  const tied = home !== '' && away !== '' && Number(home) === Number(away)
  const dirty =
    home !== asStr(match.home_score) ||
    away !== asStr(match.away_score) ||
    hp !== asStr(match.home_pen) ||
    ap !== asStr(match.away_pen)
  const canSave = ready && home !== '' && away !== '' && dirty

  async function save() {
    setBusy(true)
    setError('')
    try {
      await api.setResult(tid, match.id, {
        home_score: Number(home),
        away_score: Number(away),
        home_pen: hp === '' ? null : Number(hp),
        away_pen: ap === '' ? null : Number(ap),
      })
      onChange()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const homeWin = match.played && match.winner_id != null && match.winner_id === match.home_id
  const awayWin = match.played && match.winner_id != null && match.winner_id === match.away_id

  return (
    <div>
      <div className="match">
        <div className="match-gutter" aria-hidden="true" />
        <div className={`team home ${homeWin ? 'won' : ''}`}>
          {nbPitches > 1 && match.pitch != null && <span className="badge small">P{match.pitch}</span>}
          <span className="team-name">{match.home_name ?? <span className="muted">TBD</span>}</span>
          {homeWin && ' ✓'}
        </div>
        <div className="score-box">
          <input
            className="score-input no-spin"
            type="number"
            inputMode="numeric"
            min={0}
            aria-label={`${match.home_name ?? 'Home'} score`}
            value={home}
            disabled={!ready || busy}
            onChange={(e) => setHome(e.target.value)}
          />
          <span className="muted">-</span>
          <input
            className="score-input no-spin"
            type="number"
            inputMode="numeric"
            min={0}
            aria-label={`${match.away_name ?? 'Away'} score`}
            value={away}
            disabled={!ready || busy}
            onChange={(e) => setAway(e.target.value)}
          />
        </div>
        <div className={`team away ${awayWin ? 'won' : ''}`}>
          {awayWin && '✓ '}
          <span className="team-name">{match.away_name ?? <span className="muted">TBD</span>}</span>
        </div>
        <div className="match-actions">
          {canSave && (
            <button className="primary" disabled={busy} onClick={save}>
              Save
            </button>
          )}
        </div>
      </div>
      {ready && knockout && tied && (
        <div className="row small muted" style={{ margin: '0 0 0.4rem 0.6rem' }}>
          Penalties:
          <input className="no-spin" type="number" inputMode="numeric" min={0} aria-label="Home penalties" style={{ width: 52 }} value={hp} disabled={busy} onChange={(e) => setHp(e.target.value)} />
          <span>-</span>
          <input className="no-spin" type="number" inputMode="numeric" min={0} aria-label="Away penalties" style={{ width: 52 }} value={ap} disabled={busy} onChange={(e) => setAp(e.target.value)} />
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  )
}

function Bracket({ matches }: { matches: Match[] }) {
  const byStage = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of matches) {
      if (!isKnockout(m.stage)) continue
      const arr = map.get(m.stage) ?? []
      arr.push(m)
      map.set(m.stage, arr)
    }
    map.forEach((arr) => arr.sort((a, b) => a.match_number - b.match_number))
    return map
  }, [matches])

  const stages = KNOCKOUT_ORDER.filter((s) => byStage.has(s))

  return (
    <div
      className="bracket"
      style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
    >
      {stages.map((stage) => (
        <div className="bracket-col" key={stage}>
          <div className="round-header">{STAGE_LABELS[stage] ?? stage}</div>
          <div className="bracket-round">
            {byStage.get(stage)!.map((m) => (
              <div className="match bracket-match" key={m.id}>
                <div className={m.winner_id === m.home_id ? 'team won' : 'team'}>
                  {m.home_name ?? <span className="muted">TBD</span>}
                </div>
                <div className="score" style={{ textAlign: 'center' }}>
                  {m.played
                    ? m.home_score != null && m.away_score != null
                      ? `${m.home_score}–${m.away_score}`
                      : 'bye'
                    : '–'}
                  {m.home_pen != null && m.away_pen != null && (
                    <div className="small muted">
                      ({m.home_pen}–{m.away_pen})
                    </div>
                  )}
                </div>
                <div className={`team away ${m.winner_id === m.away_id ? 'won' : ''}`}>
                  {m.away_name ?? <span className="muted">TBD</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
