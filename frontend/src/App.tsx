import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import Tournaments from './pages/Tournaments'
import TournamentDetail from './pages/TournamentDetail'
import Players from './pages/Players'
import PlayerDetail from './pages/PlayerDetail'
import Games from './pages/Games'
import ImportPage from './pages/ImportPage'

const THEMES = [
  { id: 'floodlights', label: 'Floodlights' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'terrace', label: 'Terrace' },
  { id: 'programme', label: 'Programme' },
]
const THEME_KEY = 'ftl-theme'

function BrandMark() {
  return (
    <svg className="mark" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) ?? 'floodlights')
  const [auth, setAuth] = useState<{ required: boolean; authed: boolean } | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setAuth({ required: s.auth_required, authed: s.authenticated }))
      .catch(() => setAuth({ required: false, authed: true }))
  }, [])

  if (!auth) {
    return (
      <div className="content">
        <div className="panel muted">Loading…</div>
      </div>
    )
  }

  if (auth.required && !auth.authed) {
    return <Login onSuccess={() => setAuth({ required: true, authed: true })} />
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          FullTime Local
        </div>
        <div className="theme-picker">
          <label htmlFor="theme">Theme</label>
          <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <nav>
          <NavLink to="/tournaments">Tournaments</NavLink>
          <NavLink to="/players">Players</NavLink>
          <NavLink to="/games">Games</NavLink>
          <NavLink to="/import">Data</NavLink>
        </nav>
        {auth.required && (
          <button
            onClick={async () => {
              await api.authLogout()
              setAuth({ required: true, authed: false })
            }}
          >
            Log out
          </button>
        )}
      </header>
      <main className="content" id="main">
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

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.authLogin(password)
      onSuccess()
    } catch (err: any) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <form className="panel auth-card" onSubmit={submit}>
        <div className="brand">
          <BrandMark />
          FullTime Local
        </div>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>
          Enter the shared password to continue.
        </p>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {error && <div className="error" style={{ margin: 0 }}>{error}</div>}
      </form>
    </div>
  )
}
