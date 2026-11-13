import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import FootballTeamAssignments from '../components/FootballTeamAssignments'
import { TeamLabel } from '../components/TeamLabel'
import { ConfirmDialog, EmptyState, ErrorBanner } from '../components/ui'
import type { Game, Player } from '../types'

const today = () => new Date().toISOString().slice(0, 10)
const PAGE_SIZE = 10

export default function Friendlies() {
  const { canEdit } = useAuth()
  const [games, setGames] = useState<Game[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [homeId, setHomeId] = useState('')
  const [awayId, setAwayId] = useState('')
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [playedAt, setPlayedAt] = useState(today())
  const [note, setNote] = useState('')
  const [gameTags, setGameTags] = useState<string[]>([])
  const [footballConfigured, setFootballConfigured] = useState(false)
  const [teamAssignments, setTeamAssignments] = useState<Record<string, number>>({})
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<Game | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const [gs, ps, appSettings, meta] = await Promise.all([
        api.games({ limit: 1000 }, signal),
        api.players({ limit: 500 }, signal),
        api.settings(signal),
        api.meta(signal),
      ])
      if (!signal?.aborted) {
        setGames(gs)
        setPlayers(ps)
        setFootballConfigured(appSettings.football_data_configured)
        setGameTags(meta.game_tags ?? [])
      }
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    void load(ctrl.signal)
    return () => ctrl.abort()
  }, [])

  const pageCount = Math.max(1, Math.ceil(games.length / PAGE_SIZE))
  const visibleGames = games.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  function updatePlayer(side: 'home' | 'away', playerId: string) {
    if (side === 'home') setHomeId(playerId)
    else setAwayId(playerId)
    setTeamAssignments((current) => {
      const next = { ...current }
      delete next[side]
      return next
    })
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!homeId || !awayId) return setError('Pick both players')
    if (homeId === awayId) return setError('Pick two different players')
    if (homeScore === '' || awayScore === '') return setError('Enter both scores')
    setBusy(true)
    try {
      await api.createGame({
        home_id: Number(homeId),
        away_id: Number(awayId),
        home_team_id: teamAssignments.home ?? null,
        away_team_id: teamAssignments.away ?? null,
        home_score: Number(homeScore),
        away_score: Number(awayScore),
        played_at: playedAt,
        note: note.trim() || null,
      })
      setHomeScore('')
      setAwayScore('')
      setNote('')
      setTeamAssignments({})
      setPage(1)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemove() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteGame(pendingDelete.id)
      setPendingDelete(null)
      void load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 style={{ marginBottom: 4 }}>Friendlies</h1>
        <div className="small muted">
          Record friendly matches outside a tournament. They count toward each player's stats and
          rating.
        </div>
      </div>

      {canEdit && (
        <form className="panel friendly-form" onSubmit={add}>
        <div className="row" style={{ alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="fr-home">Home</label>
            <select id="fr-home" value={homeId} onChange={(e) => updatePlayer('home', e.target.value)}>
              <option value="">—</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="game-home-score">Score</label>
            <div className="row" style={{ gap: '0.35rem' }}>
              <input
                id="game-home-score"
                className="no-spin score-narrow"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                aria-label="Home score"
                value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
              />
              <span className="muted">-</span>
              <input
                className="no-spin score-narrow"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                aria-label="Away score"
                value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label htmlFor="fr-away">Away</label>
            <select id="fr-away" value={awayId} onChange={(e) => updatePlayer('away', e.target.value)}>
              <option value="">—</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fr-date">Date</label>
            <input id="fr-date" type="date" value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} />
          </div>
          <div className="grow">
            <label htmlFor="fr-note">Note (optional)</label>
            <input
              id="fr-note"
              className="full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Rocket League, best of 3"
              list="friendly-game-tags"
              maxLength={500}
            />
            <datalist id="friendly-game-tags">
              {gameTags.map((tag) => <option key={tag} value={tag} />)}
            </datalist>
          </div>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Adding…' : 'Add friendly'}
          </button>
        </div>
        {canEdit && footballConfigured && (homeId || awayId) && (
          <FootballTeamAssignments
            assignments={[
              ...(homeId ? [{ key: 'home', label: `${players.find((p) => String(p.id) === homeId)?.name ?? 'Home'} (home)` }] : []),
              ...(awayId ? [{ key: 'away', label: `${players.find((p) => String(p.id) === awayId)?.name ?? 'Away'} (away)` }] : []),
            ]}
            values={teamAssignments}
            onChange={(key, teamId) => {
              setTeamAssignments((current) => {
                const next = { ...current }
                if (teamId == null) delete next[key]
                else next[key] = teamId
                return next
              })
            }}
          />
        )}
        {players.length < 2 && <div className="muted small">Add at least two players first.</div>}
      </form>
      )}
      <ErrorBanner message={error} onRetry={() => load()} />

      <div className="muted small friendly-tip">
        Tip: a player's full record (tournaments + friendlies) is on their{' '}
        <Link to="/players">profile</Link>.
      </div>
      <div className="panel">
        <table className="friendly-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>Date</th>
              <th className="home">Home</th>
              <th className="score" style={{ width: 90 }}>
                Score
              </th>
              <th className="away">Away</th>
              <th>Note</th>
              <th style={{ width: 170 }}></th>
            </tr>
          </thead>
          <tbody>
            {visibleGames.map((g) => {
              const homeWin = g.home_score > g.away_score
              const awayWin = g.away_score > g.home_score
              return (
                <tr key={g.id}>
                  <td className="muted small">{g.played_at}</td>
                  <td className={`home ${homeWin ? 'won' : ''}`}>
                    <TeamLabel team={g.home_team}>
                      <Link to={`/players/${g.home_id}`}>{g.home_name}</Link>
                    </TeamLabel>
                  </td>
                  <td className="score">
                    {g.home_score}–{g.away_score}
                  </td>
                  <td className={`away ${awayWin ? 'won' : ''}`}>
                    <TeamLabel team={g.away_team}>
                      <Link to={`/players/${g.away_id}`}>{g.away_name}</Link>
                    </TeamLabel>
                  </td>
                  <td className="muted small">{g.note || '—'}</td>
                  <td className="friendly-actions">
                    <Link className="btn" to={`/compare?a=${g.home_id}&b=${g.away_id}`}>
                      Compare
                    </Link>
                    {canEdit && (
                      <button className="danger" onClick={() => setPendingDelete(g)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          games.length === 0 && <EmptyState>No games recorded yet.</EmptyState>
        )}
        {!loading && games.length > PAGE_SIZE && (
          <div className="friendly-pagination">
            <span className="muted small">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, games.length)} of {games.length}
            </span>
            <div className="row">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                Previous
              </button>
              <span className="muted small">Page {page} of {pageCount}</span>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete friendly"
          message={`Delete ${pendingDelete.home_name} ${pendingDelete.home_score}-${pendingDelete.away_score} ${pendingDelete.away_name}?`}
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
          busy={deleting}
        />
      )}
    </div>
  )
}
