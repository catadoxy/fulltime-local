import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { FORMAT_LABELS } from '../labels'
import type { Player, Tournament, TournamentFormat } from '../types'

type SortKey = 'name' | 'format' | 'status' | 'champion' | 'players' | 'date'

export default function Tournaments() {
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })

  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [startDate, setStartDate] = useState('')
  const [format, setFormat] = useState<TournamentFormat>('league')
  const [nbPitches, setNbPitches] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [settings, setSettings] = useState<Record<string, any>>({})

  const navigate = useNavigate()

  const load = () => {
    api.tournaments().then(setTournaments).catch((e) => setError(e.message))
    api.players().then(setPlayers).catch(() => {})
  }
  useEffect(load, [])

  const championNames = useMemo(() => {
    const map = new Map<number, string>()
    players.forEach((p) => map.set(p.id, p.name))
    return map
  }, [players])

  function toggle(playerId: number) {
    setSelected((prev) =>
      prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId],
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const t = await api.createTournament({
        name,
        note: note.trim() || null,
        start_date: startDate || null,
        format,
        player_ids: selected,
        nb_pitches: nbPitches,
        settings,
      })
      navigate(`/t/${t.id}`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' },
    )
  }

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...tournaments].sort((a, b) => {
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
  }, [tournaments, sort, championNames])

  const arrow = (key: string) =>
    sort.key === key ? <span className="arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null

  return (
    <div>
      <div className="row between">
        <h1>Tournaments</h1>
        <button className="primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Close' : '+ New tournament'}
        </button>
      </div>

      {showCreate && (
        <form className="panel" onSubmit={submit}>
          <div className="row">
            <div className="grow">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%' }} />
            </div>
            <div className="grow">
              <label>Format</label>
              <select value={format} onChange={(e) => { setFormat(e.target.value as TournamentFormat); setSettings({}) }} style={{ width: '100%' }}>
                {Object.entries(FORMAT_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Pitches / TVs</label>
              <input type="number" min={1} value={nbPitches} onChange={(e) => setNbPitches(Number(e.target.value))} style={{ width: 90 }} />
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
                style={{ width: '100%' }}
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
          </div>

          <FormatSettings format={format} settings={settings} setSettings={setSettings} />

          <h3>Players ({selected.length})</h3>
          <p className="muted small">Order matters: the first selected is seed 1.</p>
          <div className="grid">
            {players.map((p) => {
              const idx = selected.indexOf(p.id)
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`player-pick ${idx >= 0 ? 'selected' : ''}`}
                  onClick={() => toggle(p.id)}
                >
                  <span className="badge">{idx >= 0 ? `#${idx + 1}` : '—'}</span>
                  <span>{p.name}</span>
                </button>
              )
            })}
            {players.length === 0 && <p className="muted">Add players first.</p>}
          </div>

          <div className="row" style={{ marginTop: '1rem' }}>
            <button className="primary" type="submit" disabled={selected.length < 2}>
              Create tournament
            </button>
            {selected.length < 2 && <span className="muted small">Select at least 2 players.</span>}
          </div>
          {error && <div className="error">{error}</div>}
        </form>
      )}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('name')}>
                Name {arrow('name')}
              </th>
              <th className="sortable" onClick={() => toggleSort('format')}>
                Format {arrow('format')}
              </th>
              <th className="sortable" onClick={() => toggleSort('status')}>
                Status {arrow('status')}
              </th>
              <th className="sortable" onClick={() => toggleSort('champion')}>
                Champion {arrow('champion')}
              </th>
              <th className="sortable num" onClick={() => toggleSort('players')}>
                Players {arrow('players')}
              </th>
              <th className="sortable" onClick={() => toggleSort('date')}>
                Date {arrow('date')}
              </th>
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
            {tournaments.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No tournaments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatDate(value: string): string {
  if (!value) return '—'
  const dateOnly = value.length === 10
  const hasTz = /[zZ]|[+-]\d\d:\d\d$/.test(value)
  const iso = dateOnly || hasTz ? value : `${value}Z` // timestamps are stored in UTC
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function FormatSettings({
  format,
  settings,
  setSettings,
}: {
  format: TournamentFormat
  settings: Record<string, any>
  setSettings: (s: Record<string, any>) => void
}) {
  const set = (key: string, value: any) => setSettings({ ...settings, [key]: value })

  const numberField = (key: string, label: string, min = 1, max = 64) => (
    <div>
      <label>{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={settings[key] ?? ''}
        onChange={(e) => set(key, e.target.value === '' ? undefined : Number(e.target.value))}
        style={{ width: 110 }}
      />
    </div>
  )

  const checkbox = (key: string, label: string) => (
    <label className="row" style={{ color: 'var(--text)', marginTop: '1.4rem' }}>
      <input type="checkbox" checked={!!settings[key]} onChange={(e) => set(key, e.target.checked)} />
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
