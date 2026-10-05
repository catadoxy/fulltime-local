import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Tournaments from './pages/Tournaments'
import TournamentDetail from './pages/TournamentDetail'
import Players from './pages/Players'
import PlayerDetail from './pages/PlayerDetail'
import Games from './pages/Games'
import ImportPage from './pages/ImportPage'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚽ FullTime Local</div>
        <nav>
          <NavLink to="/tournaments">Tournaments</NavLink>
          <NavLink to="/players">Players</NavLink>
          <NavLink to="/games">Games</NavLink>
          <NavLink to="/import">Data</NavLink>
        </nav>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/tournaments" replace />} />
          <Route path="/tournaments" element={<Tournaments />} />
          <Route path="/t/:id" element={<TournamentDetail />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:id" element={<PlayerDetail />} />
          <Route path="/games" element={<Games />} />
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </main>
    </div>
  )
}
