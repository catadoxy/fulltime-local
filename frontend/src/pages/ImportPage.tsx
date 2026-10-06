import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    if (
      replace &&
      !confirm('Replace ALL current data (players, tournaments, matches, friendlies) with this file? This cannot be undone.')
    )
      return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.importLegacy(file, replace))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1>Backup &amp; import</h1>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Export</h2>
        <p className="muted">
          Download a full, portable backup of this app's database (all players and tournaments).
          Keep it somewhere safe — to restore, drop it into <code>./data/fulltime.db</code>.
        </p>
        <a className="btn primary" href={`${import.meta.env.VITE_API_URL ?? ''}/api/export/backup`}>
          ⬇ Download backup (.db)
        </a>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Import a legacy database</h2>
        <p className="muted">
          Upload an unencrypted SQLite <code>.sqlite</code> database (the source app's schema).
          Imported tournaments are added as completed history. Encrypted exports aren't supported.
          Tournaments already imported from the same file are skipped, so re-importing is safe.
        </p>
        <form onSubmit={submit}>
          <div className="row" style={{ marginBottom: '0.75rem' }}>
            <input
              type="file"
              accept=".db,.sqlite,.sqlite3,application/octet-stream"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <button className="primary" type="submit" disabled={!file || busy}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
          <label className="row" style={{ color: 'var(--text)', gap: '0.5rem' }}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace all existing data (clean slate)
          </label>
        </form>
        {error && <div className="error">{error}</div>}
        {result && (
          <div className="banner" style={{ marginTop: '1rem' }}>
            {result.replaced ? 'Replaced everything. ' : ''}
            Imported {result.tournaments} tournaments, {result.matches} matches and {result.players} new
            players.
            {result.duplicates ? ` ${result.duplicates} already-imported tournaments skipped.` : ''}
            {result.skipped ? ` ${result.skipped} skipped (no matches).` : ''}{' '}
            <Link to="/tournaments">View tournaments →</Link>
          </div>
        )}
      </div>
    </div>
  )
}
