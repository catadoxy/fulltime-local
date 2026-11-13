import { useRef, useState } from 'react'
import { api } from '../api'
import { TeamCrest } from './TeamLabel'
import type { FootballCompetition, FootballTeam } from '../types'

interface Assignment {
  key: string
  label: string
}

export default function FootballTeamAssignments({
  assignments,
  values,
  onChange,
  initialTeams = [],
}: {
  assignments: Assignment[]
  values: Record<string, number>
  onChange: (key: string, teamId: number | null) => void
  initialTeams?: FootballTeam[]
}) {
  const [expanded, setExpanded] = useState(false)
  const [competitions, setCompetitions] = useState<FootballCompetition[]>([])
  const [competitionCode, setCompetitionCode] = useState('')
  const [teams, setTeams] = useState<FootballTeam[]>(initialTeams)
  const [loadingCompetitions, setLoadingCompetitions] = useState(false)
  const [loadingTeams, setLoadingTeams] = useState(false)
  const [error, setError] = useState('')
  const teamRequest = useRef<AbortController | null>(null)

  async function toggle() {
    const opening = !expanded
    setExpanded(opening)
    setError('')
    if (!opening || competitions.length) return
    setLoadingCompetitions(true)
    try {
      setCompetitions(await api.footballCompetitions())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingCompetitions(false)
    }
  }

  async function loadCompetitionTeams(code: string) {
    teamRequest.current?.abort()
    setCompetitionCode(code)
    if (!code) {
      setLoadingTeams(false)
      return
    }
    const ctrl = new AbortController()
    teamRequest.current = ctrl
    setLoadingTeams(true)
    setError('')
    try {
      const next = await api.footballTeams(code, ctrl.signal)
      if (!ctrl.signal.aborted) {
        setTeams((current) => {
          const merged = new Map(current.map((team) => [team.id, team]))
          next.forEach((team) => merged.set(team.id, team))
          return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
        })
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!ctrl.signal.aborted) setLoadingTeams(false)
    }
  }

  return (
    <section className="team-assignment-section" aria-label="Optional club team assignment">
      <div className="row between">
        <div>
          <h3 style={{ margin: '1rem 0 0.2rem' }}>Club teams <span className="muted small">(optional)</span></h3>
          <p className="muted small" style={{ margin: 0 }}>
            Assign a club to each player. Switch competitions to add clubs from different leagues; loaded clubs stay available.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void toggle()}>
          {expanded ? 'Hide team options' : 'Choose teams'}
        </button>
      </div>
      {expanded && (
        <div className="team-assignment-panel">
          <div style={{ maxWidth: 420 }}>
            <label htmlFor="team-competition">Add a competition</label>
            <select
              id="team-competition"
              className="full"
              value={competitionCode}
              disabled={loadingCompetitions}
              onChange={(e) => void loadCompetitionTeams(e.target.value)}
            >
              <option value="">{loadingCompetitions ? 'Loading competitions…' : 'Choose a competition'}</option>
              {competitions.map((competition) => (
                <option key={competition.code} value={competition.code}>{competition.name}</option>
              ))}
            </select>
          </div>
          {loadingTeams && <p className="muted small">Loading teams…</p>}
          {assignments.length === 0 && <p className="muted small">Select players first to assign club teams.</p>}
          {assignments.length > 0 && teams.length === 0 && !loadingTeams && (
            <p className="muted small">Choose a competition to load teams. With no search text, players remain set to No team.</p>
          )}
          {assignments.length > 0 && teams.length > 0 && (
            <div className="team-assignment-list">
              {assignments.map((assignment) => (
                <div className="team-assignment-row" key={`${assignment.key}:${assignment.label}`}>
                  <span className="team-assignment-player">{assignment.label}</span>
                  <TeamSearch
                    teams={teams}
                    selectedId={values[assignment.key] ?? null}
                    label={assignment.label}
                    onChange={(teamId) => onChange(assignment.key, teamId)}
                  />
                </div>
              ))}
            </div>
          )}
          {error && <div className="error" role="alert">{error}</div>}
        </div>
      )}
    </section>
  )
}

function TeamSearch({
  teams,
  selectedId,
  label,
  onChange,
}: {
  teams: FootballTeam[]
  selectedId: number | null
  label: string
  onChange: (teamId: number | null) => void
}) {
  const [query, setQuery] = useState('')
  const selected = teams.find((team) => team.id === selectedId) ?? null
  const term = query.trim().toLocaleLowerCase()
  const results = term
    ? teams.filter((team) =>
        team.name.toLocaleLowerCase().includes(term) ||
        (team.short_name ?? '').toLocaleLowerCase().includes(term),
      ).slice(0, 8)
    : []

  function choose(teamId: number) {
    onChange(teamId)
    setQuery('')
  }

  return (
    <div className="team-picker">
      {selected ? (
        <span className="team-selected">
          <TeamCrest team={selected} />
          {selected.name}
          <button type="button" className="team-clear" onClick={() => onChange(null)} aria-label={`Remove ${selected.name} from ${label}`} title="Remove team">
            ×
          </button>
        </span>
      ) : (
        <span className="badge team-none">No team</span>
      )}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
        placeholder="Search teams…"
        aria-label={`Search team for ${label}`}
        autoComplete="off"
      />
      {term.length > 0 && (
        <div className="team-search-results" role="listbox" aria-label={`Team results for ${label}`}>
          {results.map((team) => (
            <button
              type="button"
              role="option"
              aria-selected={team.id === selectedId}
              className="team-search-option"
              key={team.id}
              onClick={() => choose(team.id)}
            >
              <TeamCrest team={team} />
              <span>{team.name}</span>
            </button>
          ))}
          {results.length === 0 && <span className="muted small">No matching clubs in loaded competitions.</span>}
        </div>
      )}
    </div>
  )
}
