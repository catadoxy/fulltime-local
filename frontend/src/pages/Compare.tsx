import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { CompareResult, Player } from '../types'

function Row({
  label,
  a,
  b,
  lower = false,
}: {
  label: string
  a: number | string
  b: number | string
  lower?: boolean
}) {
  const av = typeof a === 'number' ? a : null
  const bv = typeof b === 'number' ? b : null
  let aWin = false
  let bWin = false
  if (av !== null && bv !== null && av !== bv) {
    if (lower) {
      aWin = av < bv
      bWin = bv < av
    } else {
      aWin = av > bv
      bWin = bv > av
    }
  }
  return (
    <tr>
      <td className={`num ${aWin ? 'won' : ''}`}>{a}</td>
      <td className="muted small" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
        {label}
      </td>
      <td className={`num ${bWin ? 'won' : ''}`}>{b}</td>
    </tr>
  )
}

export default function Compare() {
  const [players, setPlayers] = useState<Player[]>([])
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [data, setData] = useState<CompareResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.players().then(setPlayers).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    setError('')
    if (!a || !b || a === b) {
      setData(null)
      return
    }
    api
      .compare(Number(a), Number(b))
      .then(setData)
      .catch((e) => setError(e.message))
  }, [a, b])

  return (
    <div>
      <div className="page-head">
        <h1 style={{ marginBottom: 4 }}>Compare players</h1>
        <div className="small muted">Pick two players to compare their records and head-to-head.</div>
      </div>

      <div className="panel">
        <div className="row" style={{ gap: '0.75rem', alignItems: 'flex-end' }}>
          <div className="grow">
            <label htmlFor="cmp-a">Player A</label>
            <select id="cmp-a" value={a} onChange={(e) => setA(e.target.value)} style={{ width: '100%' }}>
              <option value="">—</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <span className="muted" style={{ paddingBottom: 8 }}>
            vs
          </span>
          <div className="grow">
            <label htmlFor="cmp-b">Player B</label>
            <select id="cmp-b" value={b} onChange={(e) => setB(e.target.value)} style={{ width: '100%' }}>
              <option value="">—</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {a && b && a === b && <div className="error">Pick two different players.</div>}
        {error && <div className="error">{error}</div>}
      </div>

      {data && (
        <>
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Head to head</h3>
            <div className="h2h">
              <div className="h2h-name">{data.a.player.name}</div>
              <div className="h2h-score">
                {data.head_to_head.a_wins}
                <span className="muted">–</span>
                {data.head_to_head.b_wins}
              </div>
              <div className="h2h-name away">{data.b.player.name}</div>
            </div>
            <div className="small muted" style={{ marginBottom: '0.75rem' }}>
              {data.head_to_head.played} played · {data.head_to_head.draws} drawn · goals{' '}
              {data.head_to_head.a_goals}–{data.head_to_head.b_goals}
            </div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Competition</th>
                  <th className="num">Score</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {data.head_to_head.matches.map((m, i) => (
                  <tr key={i}>
                    <td className="muted small">{m.date ?? '—'}</td>
                    <td>{m.kind === 'friendly' ? 'Friendly' : m.competition}</td>
                    <td className="num score">
                      {m.a_score}–{m.b_score}
                    </td>
                    <td>
                      {m.result === 'A' ? (
                        <span className="badge done">{data.a.player.name}</span>
                      ) : m.result === 'B' ? (
                        <span className="badge done">{data.b.player.name}</span>
                      ) : (
                        <span className="badge">Draw</span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.head_to_head.matches.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      These two haven't played each other yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Overall</h3>
            <table className="compare-table">
              <thead>
                <tr>
                  <th className="num">
                    <Link to={`/players/${data.a.player.id}`}>{data.a.player.name}</Link>
                  </th>
                  <th style={{ textAlign: 'center' }}>Metric</th>
                  <th className="num">
                    <Link to={`/players/${data.b.player.id}`}>{data.b.player.name}</Link>
                  </th>
                </tr>
              </thead>
              <tbody>
                <Row label="Rating" a={data.a.rating} b={data.b.rating} />
                <Row label="Elo" a={data.a.elo} b={data.b.elo} />
                <Row label="Titles" a={data.a.tournaments.titles ?? 0} b={data.b.tournaments.titles ?? 0} />
                <Row label="Tournament matches" a={data.a.tournaments.played} b={data.b.tournaments.played} />
                <Row label="Tournament wins" a={data.a.tournaments.won} b={data.b.tournaments.won} />
                <Row label="Tournament draws" a={data.a.tournaments.drawn} b={data.b.tournaments.drawn} />
                <Row label="Tournament losses" a={data.a.tournaments.lost} b={data.b.tournaments.lost} lower />
                <Row
                  label="Tournament goals"
                  a={`${data.a.tournaments.goals_for}/${data.a.tournaments.goals_against}`}
                  b={`${data.b.tournaments.goals_for}/${data.b.tournaments.goals_against}`}
                />
                <Row label="Tournament win rate" a={`${data.a.tournaments.win_rate}%`} b={`${data.b.tournaments.win_rate}%`} />
                <Row label="Friendlies" a={data.a.friendlies.played} b={data.b.friendlies.played} />
                <Row label="Friendly wins" a={data.a.friendlies.won} b={data.b.friendlies.won} />
                <Row label="Friendly win rate" a={`${data.a.friendlies.win_rate}%`} b={`${data.b.friendlies.win_rate}%`} />
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
