import type { ReactNode } from 'react'
import type { FootballTeam } from '../types'

export function TeamCrest({ team }: { team?: FootballTeam | null }) {
  if (!team?.crest_url) return null
  return (
    <img
      className="team-crest"
      src={team.crest_url}
      alt={`${team.name} crest`}
      title={team.name}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  )
}

export function TeamLabel({ team, children }: { team?: FootballTeam | null; children: ReactNode }) {
  return (
    <span className="team-label">
      <TeamCrest team={team} />
      {children}
    </span>
  )
}
