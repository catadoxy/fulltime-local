import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { Match, Table, TournamentDetail as TDetail } from '../types'

const KNOCKOUT_ORDER = ['r64', 'r32', 'r16', 'qf', 'sf', 'third', 'final']
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
  const [tab, setTab] = useState<'fixtures' | 'standings' | 'bracket'>('fixtures')
  const [error, setError] = useState('')

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
  const champion = t?.champion_id ? playerNames.get(t.champion_id) : null

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

  if (!t) return <div className="panel">{error || 'Loading…'}</div>

  return (
    <div>
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 4 }}>{t.name}</h1>
          <div className="row small">
            <span className="muted">{STAGE_LABELS[t.format] ?? t.format}</span>
            <span className={`badge ${t.status === 'completed' ? 'done' : 'live'}`}>{t.status}</span>
            <span className="muted">{t.nb_pitches} pitch(es)</span>
            {champion && <span className="badge done">🏆 {champion}</span>}
          </div>
        </div>
        <div className="row">
          <button className="danger" onClick={removeTournament}>
            Delete
          </button>
          <Link className="btn" to="/tournaments">
            ← All tournaments
          </Link>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="tabs">
        <button className={tab === 'fixtures' ? 'active' : ''} onClick={() => setTab('fixtures')}>
          Fixtures & results
        </button>
        <button className={tab === 'standings' ? 'active' : ''} onClick={() => setTab('standings')}>
          Standings
        </button>
        {hasBracket && (
          <button className={tab === 'bracket' ? 'active' : ''} onClick={() => setTab('bracket')}>
            Bracket
          </button>
        )}
      </div>

      {tab === 'fixtures' && (
        <Fixtures
          matches={matches}
          groupNames={groupNames}
          nbPitches={t.nb_pitches}
          onChange={load}
          tid={tid}
        />
      )}

      {tab === 'standings' && (
        <div>
          {tables.map((table, i) => (
            <div className="panel" key={i}>
              {table.group_name && <h3>{table.group_name}</h3>}
              <StandingsTable table={table} />
            </div>
          ))}
        </div>
      )}

      {tab === 'bracket' && <Bracket matches={matches} />}
    </div>
  )
}

function StandingsTable({ table }: { table: Table }) {
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Player</th>
          <th>P</th>
          <th>W</th>
          <th>D</th>
          <th>L</th>
          <th>GF</th>
          <th>GA</th>
          <th>GD</th>
          <th>Pts</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={r.player_id}>
            <td>{i + 1}</td>
            <td>{r.player_name}</td>
            <td>{r.played}</td>
            <td>{r.won}</td>
            <td>{r.drawn}</td>
            <td>{r.lost}</td>
            <td>{r.goals_for}</td>
            <td>{r.goals_against}</td>
            <td>{r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}</td>
            <td className="score">{r.points}</td>
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

  return (
    <div>
      {sections.map((section) => {
        const knockoutSection = isKnockout(section.matches[0]?.stage ?? '')
        const rounds = [...new Set(section.matches.map((m) => m.round_number))]
        return (
          <div className="panel" key={section.title + rounds[0]}>
            <h3>{section.title}</h3>
            {rounds.map((round) => (
              <div className="round" key={round}>
                {!knockoutSection && <div className="small muted">Matchday {round}</div>}
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
      {sections.length === 0 && <div className="panel muted">No fixtures.</div>}
    </div>
  )
}

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
  const [home, setHome] = useState(match.home_score ?? '')
  const [away, setAway] = useState(match.away_score ?? '')
  const [hp, setHp] = useState(match.home_pen ?? '')
  const [ap, setAp] = useState(match.away_pen ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setHome(match.home_score ?? '')
    setAway(match.away_score ?? '')
    setHp(match.home_pen ?? '')
    setAp(match.away_pen ?? '')
  }, [match])

  const ready = match.home_id != null && match.away_id != null
  const knockout = isKnockout(match.stage)

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

  async function clear() {
    if (!confirm('Clear this result?')) return
    setBusy(true)
    try {
      await api.clearResult(tid, match.id)
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
        <div className={`team home ${homeWin ? 'won' : ''}`}>
          {nbPitches > 1 && match.pitch != null && <span className="badge small">P{match.pitch}</span>}
          <span className="team-name">{match.home_name ?? <span className="muted">TBD</span>}</span>
          {homeWin && ' ✓'}
        </div>
        <div className="score-box">
          <input
            className="score-input"
            type="number"
            min={0}
            value={home}
            disabled={!ready || busy}
            onChange={(e) => setHome(e.target.value)}
          />
          <span className="muted">-</span>
          <input
            className="score-input"
            type="number"
            min={0}
            value={away}
            disabled={!ready || busy}
            onChange={(e) => setAway(e.target.value)}
          />
        </div>
        <div className={`team away ${awayWin ? 'won' : ''}`}>
          {awayWin && '✓ '}
          <span className="team-name">{match.away_name ?? <span className="muted">TBD</span>}</span>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {ready && (
            <>
              <button className="primary" disabled={busy || home === '' || away === ''} onClick={save}>
                Save
              </button>
              {match.played && (
                <button className="danger" disabled={busy} onClick={clear}>
                  ✕
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {ready && knockout && (
        <div className="row small muted" style={{ margin: '0 0 0.4rem 0.6rem' }}>
          Penalties (if level):
          <input type="number" min={0} style={{ width: 52 }} value={hp} disabled={busy} onChange={(e) => setHp(e.target.value)} />
          <span>-</span>
          <input type="number" min={0} style={{ width: 52 }} value={ap} disabled={busy} onChange={(e) => setAp(e.target.value)} />
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
    <div className="panel">
      <div className="row" style={{ alignItems: 'stretch', gap: '1rem', overflowX: 'auto' }}>
        {stages.map((stage) => (
          <div className="bracket-col" key={stage}>
            <h3>{STAGE_LABELS[stage] ?? stage}</h3>
            <div className="bracket-round">
              {byStage.get(stage)!.map((m) => (
                <div className="match" key={m.id} style={{ gridTemplateColumns: '1fr 60px 1fr' }}>
                  <div className={m.winner_id === m.home_id ? 'team won' : 'team'}>
                    {m.home_name ?? <span className="muted">TBD</span>}
                  </div>
                  <div className="score" style={{ textAlign: 'center' }}>
                    {m.played ? `${m.home_score}-${m.away_score}` : '–'}
                    {m.home_pen != null && m.away_pen != null && (
                      <div className="small muted">
                        ({m.home_pen}-{m.away_pen})
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
    </div>
  )
}
