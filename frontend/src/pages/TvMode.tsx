import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { FORMAT_LABELS } from '../labels'
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

const CYCLE_MS = 12_000
const REFRESH_MS = 15_000

type Panel = { key: string; title: string; body: ReactNode }

function stagesOf(m: Match) {
  return KNOCKOUT_ORDER.includes(m.stage)
}

function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m}m`
  return m ? `${h}h ${m}m` : `${h}h`
}

function buildPanels(t: TDetail, matches: Match[], tables: Table[]): Panel[] {
  const panels: Panel[] = []
  const names = new Map(t.participants.map((p) => [p.player_id, p.player.name]))

  if (t.champion_id) {
    panels.push({
      key: 'champion',
      title: 'Champion',
      body: (
        <div className="tv-champion">
          <div className="tv-trophy" aria-hidden="true">
            🏆
          </div>
          <div className="tv-champion-name">{names.get(t.champion_id) ?? '—'}</div>
          <div className="tv-champion-sub">{t.name}</div>
        </div>
      ),
    })
  }

  const shownTables = tables.filter((table) => table.rows.length > 0)
  if (shownTables.length) {
    panels.push({
      key: 'standings',
      title: shownTables.length > 1 ? 'Standings' : (shownTables[0].group_name ?? 'Standings'),
      body: (
        <div className={`tv-tables${shownTables.length === 1 ? ' single' : ''}`}>
          {shownTables.map((table, ti) => (
            <div key={table.group_id ?? `t${ti}`} className="tv-table-block">
              {shownTables.length > 1 && table.group_name && (
                <div className="tv-table-title">{table.group_name}</div>
              )}
              <table className="tv-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Player</th>
                    <th className="num">P</th>
                    <th className="num">W</th>
                    <th className="num">D</th>
                    <th className="num">L</th>
                    <th className="num">GD</th>
                    <th className="num">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={row.player_id} className={i === 0 ? 'leader' : undefined}>
                      <td className="num">{i + 1}</td>
                      <td>{row.player_name}</td>
                      <td className="num">{row.played}</td>
                      <td className="num">{row.won}</td>
                      <td className="num">{row.drawn}</td>
                      <td className="num">{row.lost}</td>
                      <td className="num">
                        {row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}
                      </td>
                      <td className="num score">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ),
    })
  }

  const next = matches
    .filter((m) => !m.played && m.home_name && m.away_name)
    .sort(
      (a, b) =>
        a.round_number - b.round_number ||
        a.slot - b.slot ||
        (a.pitch ?? 0) - (b.pitch ?? 0) ||
        a.match_number - b.match_number,
    )
    .slice(0, 8)

  if (next.length) {
    panels.push({
      key: 'next',
      title: 'Up next',
      body: (
        <div className="tv-list">
          {next.map((m) => (
            <div className="tv-match" key={m.id}>
              <div className="tv-side home">{m.home_name}</div>
              <div className="tv-vs">vs</div>
              <div className="tv-side">{m.away_name}</div>
              <div className="tv-match-meta">
                {STAGE_LABELS[m.stage] ?? m.stage}
                {m.stage !== 'final' && m.round_number ? ` · R${m.round_number}` : ''}
                {m.pitch ? ` · Pitch ${m.pitch}` : ''}
              </div>
            </div>
          ))}
        </div>
      ),
    })
  }

  const knockout = matches.filter((m) => stagesOf(m))
  if (knockout.length) {
    const byStage = new Map<string, Match[]>()
    for (const m of knockout) {
      const arr = byStage.get(m.stage) ?? []
      arr.push(m)
      byStage.set(m.stage, arr)
    }
    byStage.forEach((arr) => arr.sort((a, b) => a.match_number - b.match_number))
    const stages = KNOCKOUT_ORDER.filter((s) => byStage.has(s))

    panels.push({
      key: 'bracket',
      title: 'Bracket',
      body: (
        <div className="tv-bracket">
          {stages.map((stage) => (
            <div className="tv-bracket-col" key={stage}>
              <div className="tv-bracket-title">{STAGE_LABELS[stage] ?? stage}</div>
              <div className="tv-bracket-round">
                {byStage.get(stage)!.map((m) => (
                  <div className="tv-bracket-match" key={m.id}>
                    <div className={m.winner_id === m.home_id ? 'won' : ''}>
                      {m.home_name ?? '—'}
                    </div>
                    <div className="tv-bracket-score">
                      {m.played
                        ? m.home_score != null && m.away_score != null
                          ? `${m.home_score}–${m.away_score}`
                          : 'bye'
                        : '–'}
                      {m.home_pen != null && m.away_pen != null && (
                        <span className="tv-pens">
                          ({m.home_pen}–{m.away_pen})
                        </span>
                      )}
                    </div>
                    <div className={m.winner_id === m.away_id ? 'won' : ''}>
                      {m.away_name ?? '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ),
    })
  }

  const recent = matches
    .filter((m) => m.played && m.home_score != null && m.away_score != null)
    .sort(
      (a, b) =>
        b.round_number - a.round_number ||
        b.slot - a.slot ||
        (b.pitch ?? 0) - (a.pitch ?? 0),
    )
    .slice(0, 8)

  if (recent.length) {
    panels.push({
      key: 'results',
      title: 'Latest results',
      body: (
        <div className="tv-list">
          {recent.map((m) => (
            <div className="tv-match result" key={m.id}>
              <div className={`tv-side home ${m.winner_id === m.home_id ? 'won' : ''}`}>
                {m.home_name}
              </div>
              <div className="tv-score">
                {m.home_score}–{m.away_score}
              </div>
              <div className={`tv-side ${m.winner_id === m.away_id ? 'won' : ''}`}>
                {m.away_name}
              </div>
              <div className="tv-match-meta">
                {STAGE_LABELS[m.stage] ?? m.stage}
                {m.stage !== 'final' && m.round_number ? ` · R${m.round_number}` : ''}
              </div>
            </div>
          ))}
        </div>
      ),
    })
  }

  return panels
}

export default function TvMode() {
  const { id } = useParams()
  const tid = Number(id)
  const [t, setT] = useState<TDetail | null>(null)
  const [matches, setMatches] = useState<Match[]>([])
  const [tables, setTables] = useState<Table[]>([])
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [clock, setClock] = useState(() => new Date())

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [detail, ms, st] = await Promise.all([
          api.tournament(tid, signal),
          api.matches(tid, signal),
          api.standings(tid, signal),
        ])
        if (signal?.aborted) return
        setT(detail)
        setMatches(ms)
        setTables(st.tables)
        setError('')
      } catch (e) {
        if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e))
      }
    },
    [tid],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    const timer = setInterval(() => void load(ctrl.signal), REFRESH_MS)
    return () => {
      ctrl.abort()
      clearInterval(timer)
    }
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const panels = useMemo(() => (t ? buildPanels(t, matches, tables) : []), [t, matches, tables])

  useEffect(() => {
    if (index >= panels.length) setIndex(0)
  }, [panels.length, index])

  useEffect(() => {
    if (paused || panels.length < 2) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % panels.length), CYCLE_MS)
    return () => clearInterval(timer)
  }, [paused, panels.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        setPaused((p) => !p)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (!panels.length) return
        setIndex((i) =>
          e.key === 'ArrowRight'
            ? (i + 1) % panels.length
            : (i - 1 + panels.length) % panels.length,
        )
      } else if (e.key.toLowerCase() === 'f') {
        void document.documentElement.requestFullscreen?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panels.length])

  if (!t) {
    return (
      <div className="tv">
        <div className="tv-loading muted">{error || 'Loading tournament…'}</div>
      </div>
    )
  }

  const panel = panels[index] ?? null
  const estimate = t.estimate

  return (
    <div className="tv">
      <header className="tv-head">
        <div className="tv-head-main">
          <div className="tv-title">{t.name}</div>
          <div className="tv-sub">
            {FORMAT_LABELS[t.format] ?? t.format}
            {t.note ? ` · ${t.note}` : ''}
            {t.nb_pitches > 1 ? ` · ${t.nb_pitches} pitches` : ''}
            {estimate && estimate.minutes > 0
              ? ` · about ${formatDuration(estimate.minutes)}`
              : ''}
          </div>
        </div>
        <div className="tv-controls">
          <span className="tv-clock">
            {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button type="button" onClick={() => setPaused((p) => !p)} title="Pause / resume (space)">
            {paused ? '▶' : '⏸'}
          </button>
          <button
            type="button"
            onClick={() =>
              void (document.fullscreenElement
                ? document.exitFullscreen()
                : document.documentElement.requestFullscreen?.())
            }
            title="Fullscreen (F)"
          >
            ⛶
          </button>
          <Link className="btn" to={`/t/${t.id}`}>
            Exit
          </Link>
        </div>
      </header>

      {error && <div className="tv-error">{error}</div>}

      <main className="tv-body">
        {panel ? (
          <section className="tv-panel" key={panel.key}>
            <h2 className="tv-panel-title">{panel.title}</h2>
            {panel.body}
          </section>
        ) : (
          <div className="tv-empty muted">No standings or fixtures yet.</div>
        )}
      </main>

      <footer className="tv-foot">
        <div className="tv-dots">
          {panels.map((p, i) => (
            <button
              key={p.key}
              type="button"
              className={i === index ? 'active' : ''}
              aria-label={`Show ${p.title}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        <span>space pause · ← → switch · F fullscreen</span>
      </footer>
      {!paused && panels.length > 1 && (
        <div className="tv-progress" aria-hidden="true">
          <span key={index} style={{ animationDuration: `${CYCLE_MS}ms` }} />
        </div>
      )}
    </div>
  )
}
