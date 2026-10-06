import { createContext, useContext, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import Tournaments from './pages/Tournaments'
import TournamentDetail from './pages/TournamentDetail'
import Players from './pages/Players'
import PlayerDetail from './pages/PlayerDetail'
import Friendlies from './pages/Friendlies'
import Compare from './pages/Compare'
import ImportPage from './pages/ImportPage'
import Users from './pages/Users'

const THEMES = [
  { id: 'floodlights', label: 'Floodlights' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'terrace', label: 'Terrace' },
  { id: 'programme', label: 'Programme' },
]
const THEME_KEY = 'ftl-theme'

export interface AuthUser {
  id: number
  username: string
  role: string
  legacy?: boolean
}

interface AuthState {
  required: boolean
  authed: boolean
  setupRequired: boolean
  user: AuthUser | null
}

const AuthCtx = createContext<{ auth: AuthState; canEdit: boolean; refresh: () => void }>({
  auth: { required: false, authed: true, setupRequired: false, user: null },
  canEdit: true,
  refresh: () => {},
})

export const useAuth = () => useContext(AuthCtx)

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
  const [auth, setAuth] = useState<AuthState | null>(null)

  const refresh = () => {
    api
      .authStatus()
      .then((s) =>
        setAuth({
          required: s.auth_required,
          authed: s.authenticated,
          setupRequired: s.setup_required ?? false,
          user: (s.user as AuthUser | null) ?? null,
        }),
      )
      .catch(() =>
        setAuth({ required: false, authed: true, setupRequired: false, user: null }),
      )
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(refresh, [])

  if (!auth) {
    return (
      <div className="content">
        <div className="panel muted">Loading…</div>
      </div>
    )
  }

  if (auth.setupRequired) {
    return <Setup onDone={refresh} />
  }

  if (auth.required && !auth.authed) {
    return <Login onSuccess={refresh} />
  }

  const canEdit = !auth.required || !auth.user || auth.user.role === 'admin'
  const isAdmin = !!auth.user && auth.user.role === 'admin'

  return (
    <AuthCtx.Provider value={{ auth, canEdit, refresh }}>
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
            <NavLink to="/friendlies">Friendlies</NavLink>
            <NavLink to="/compare">Compare</NavLink>
            <NavLink to="/import">Data</NavLink>
            {isAdmin && <NavLink to="/users">Users</NavLink>}
          </nav>
          {auth.user && (
            <span className={`badge ${auth.user.role === 'admin' ? 'done' : ''}`} title={auth.user.username}>
              {auth.user.username} · {auth.user.role}
            </span>
          )}
          {auth.required && (
            <button
              onClick={async () => {
                await api.authLogout()
                refresh()
              }}
            >
              Log out
            </button>
          )}
        </header>
        <main className="content" id="main">
          {!canEdit && (
            <div className="banner" role="note">
              Viewer — read only. Ask an admin to make changes.
            </div>
          )}
          <Routes>
            <Route path="/" element={<Navigate to="/tournaments" replace />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/t/:id" element={<TournamentDetail />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:id" element={<PlayerDetail />} />
            <Route path="/friendlies" element={<Friendlies />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/users" element={<Users />} />
          </Routes>
        </main>
      </div>
    </AuthCtx.Provider>
  )
}

function Setup({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.authSetup(username.trim(), password)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
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
          Create the first admin account to secure this app. Viewers you add later are read-only.
        </p>
        <div>
          <label htmlFor="setup-user">Username</label>
          <input
            id="setup-user"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label htmlFor="setup-pass">Password (min 4 characters)</label>
          <input
            id="setup-pass"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
            style={{ width: '100%' }}
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create admin'}
        </button>
        {error && (
          <div className="error" style={{ margin: 0 }} role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  )
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.authLogin(username.trim(), password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
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
        <div>
          <label htmlFor="login-user">Username</label>
          <input
            id="login-user"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%' }}
          />
        </div>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        {error && (
          <div className="error" style={{ margin: 0 }} role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  )
}
