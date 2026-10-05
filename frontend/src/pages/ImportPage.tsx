import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      setResult(await api.importLegacy(file))
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
          Upload either your decrypted <code>.sqlite</code> file or the original encrypted legacy
          export (e.g. <code>legacy_database_&lt;timestamp&gt;.db</code>). Encrypted files are decrypted
          automatically. Imported tournaments are added as completed history.
        </p>
        <form onSubmit={submit}>
          <input
            type="file"
            accept=".db,.sqlite,.sqlite3,application/octet-stream"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button className="primary" type="submit" disabled={!file || busy} style={{ marginLeft: '0.75rem' }}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </form>
        {error && <div className="error">{error}</div>}
        {result && (
          <div className="banner" style={{ marginTop: '1rem' }}>
            Imported {result.tournaments} tournaments, {result.matches} matches and {result.players} new
            players.
            {result.skipped ? ` (${result.skipped} skipped)` : ''}{' '}
            <Link to="/tournaments">View tournaments →</Link>
          </div>
        )}
      </div>
    </div>
  )
}
