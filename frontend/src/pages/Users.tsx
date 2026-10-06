import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import { ConfirmDialog, EmptyState, ErrorBanner } from '../components/ui'

interface AppUser {
  id: number
  username: string
  role: string
}

export default function Users() {
  const { auth } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<AppUser | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const data = await api.users(signal)
      if (!signal?.aborted) setUsers(data)
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

  if (auth.required && (!auth.user || auth.user.role !== 'admin')) {
    return <Navigate to="/tournaments" replace />
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.createUser({ username: username.trim(), password, role })
      setUsername('')
      setPassword('')
      setRole('viewer')
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
      await api.deleteUser(pendingDelete.id)
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
      <h1>Users</h1>
      <p className="muted">
        Admins can do everything. Viewers are read-only — they can browse but not create, edit, or
        delete anything.
      </p>

      <form className="panel row" onSubmit={add}>
        <div className="grow">
          <label htmlFor="u-name">Username</label>
          <input
            id="u-name"
            className="full"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            maxLength={80}
          />
        </div>
        <div className="grow">
          <label htmlFor="u-pass">Password (min 4)</label>
          <input
            id="u-pass"
            type="password"
            autoComplete="new-password"
            className="full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={4}
          />
        </div>
        <div>
          <label htmlFor="u-role">Role</label>
          <select id="u-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer (read-only)</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="primary" type="submit" disabled={busy} style={{ alignSelf: 'flex-end' }}>
          {busy ? 'Adding…' : 'Add user'}
        </button>
      </form>
      <ErrorBanner message={error} onRetry={() => load()} />

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>
                  <span className={`badge ${u.role === 'admin' ? 'done' : ''}`}>{u.role}</span>
                </td>
                <td className="actions">
                  <button className="danger" onClick={() => setPendingDelete(u)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          users.length === 0 && <EmptyState>No users yet.</EmptyState>
        )}
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete user"
          message={`Delete user "${pendingDelete.username}"? They will be logged out immediately.`}
          onConfirm={confirmRemove}
          onCancel={() => setPendingDelete(null)}
          busy={deleting}
        />
      )}
    </div>
  )
}
