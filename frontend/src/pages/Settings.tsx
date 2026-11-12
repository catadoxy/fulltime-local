import { useEffect, useState } from 'react'
import { THEMES, useAuth } from '../App'
import { api } from '../api'
import { ConfirmDialog, ErrorBanner } from '../components/ui'
import Users from './Users'

export default function Settings() {
  const { auth, canEdit, theme, setTheme } = useAuth()
  const [configured, setConfigured] = useState(false)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const isAdmin = auth.user?.role === 'admin'

  useEffect(() => {
    const ctrl = new AbortController()
    api.settings(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setConfigured(data.football_data_configured)
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      })
    return () => ctrl.abort()
  }, [])

  async function saveToken(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.saveFootballDataToken(token.trim())
      setConfigured(true)
      setToken('')
      setNotice('Token verified and saved. Club teams are now available when creating a tournament.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeToken() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api.removeFootballDataToken()
      setConfigured(false)
      setConfirmRemove(false)
      setNotice('Football-data.org has been disconnected. Existing tournament crests are kept.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Settings</h1>
      <ErrorBanner message={error} />
      {notice && <div className="banner" role="status">{notice}</div>}

      <section className="panel" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" style={{ marginTop: 0 }}>Appearance</h2>
        <p className="muted">Choose a theme for this browser. Your preference is saved locally.</p>
        <div style={{ maxWidth: 320 }}>
          <label htmlFor="theme">Theme</label>
          <select id="theme" className="full" value={theme} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel" aria-labelledby="football-data-heading">
        <div className="row between">
          <h2 id="football-data-heading" style={{ marginTop: 0 }}>Football data</h2>
          <span className={`badge ${configured ? 'done' : ''}`}>
            {configured ? 'Connected' : 'Optional'}
          </span>
        </div>
        <p className="muted">
          Connect your football-data.org account to search supported competitions and assign club crests
          to players in a tournament. The token is encrypted in the app database and never sent to the browser.
        </p>
        {canEdit ? (
          <>
            <form className="row" onSubmit={saveToken}>
              <div className="grow" style={{ minWidth: 240 }}>
                <label htmlFor="football-token">API token</label>
                <input
                  id="football-token"
                  className="full"
                  type="password"
                  autoComplete="new-password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={configured ? 'Token saved — enter a new token to replace it' : 'Paste your football-data.org token'}
                  maxLength={500}
                />
              </div>
              <button className="primary" type="submit" disabled={!token.trim() || busy} style={{ alignSelf: 'flex-end' }}>
                {busy ? 'Checking…' : configured ? 'Verify & replace' : 'Verify & save'}
              </button>
              {configured && (
                <button type="button" className="danger" disabled={busy} onClick={() => setConfirmRemove(true)} style={{ alignSelf: 'flex-end' }}>
                  Disconnect
                </button>
              )}
            </form>
            <p className="muted small" style={{ marginBottom: 0 }}>
              The free plan currently covers 12 competitions and has a 10-request-per-minute limit. Team badges already
              attached to tournaments remain available if you disconnect.
            </p>
          </>
        ) : (
          <p className="muted small">{configured ? 'Connected by an admin. Team selection is enabled for tournament setup.' : 'An admin can connect an API token to enable optional club selection.'}</p>
        )}
      </section>

      {isAdmin && (
        <section aria-label="Account management">
          <Users />
        </section>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Disconnect football-data.org?"
          message="Team assignment will be unavailable for new tournaments. Existing team assignments and crests will remain saved."
          confirmLabel="Disconnect"
          onConfirm={() => void removeToken()}
          onCancel={() => setConfirmRemove(false)}
          busy={busy}
        />
      )}
    </div>
  )
}
