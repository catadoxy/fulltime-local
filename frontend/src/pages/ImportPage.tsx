import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import { ConfirmDialog, ErrorBanner } from '../components/ui'

interface ImportResult {
  tournaments: number
  matches: number
  players: number
  duplicates?: number
  skipped?: number
  replaced?: boolean
}

export default function ImportPage() {
  const { canEdit } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)

  async function doImport() {
    if (!file) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const r = (await api.importLegacy(file, replace)) as ImportResult
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setConfirmReplace(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    if (file.size > 100 * 1024 * 1024) {
      setError('File is too large (max 100 MB).')
      return
    }
    if (replace) {
      setConfirmReplace(true)
      return
    }
    void doImport()
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
        <a className="btn primary" href={api.exportBackupUrl()}>
          ⬇ Download backup (.db)
        </a>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Import a legacy database</h2>
        {!canEdit ? (
          <p className="muted">Viewers cannot import. Ask an admin.</p>
        ) : (
          <>
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
              aria-label="Legacy SQLite file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setResult(null)
                setError('')
              }}
            />
            <button className="primary" type="submit" disabled={!file || busy}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
          <label className="row" style={{ color: 'var(--text)', gap: '0.5rem' }}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace all existing data (clean slate)
          </label>
          {file && (
            <p className="muted small">
              Selected: {file.name} ({Math.round(file.size / 1024)} KB)
            </p>
          )}
        </form>
        </>
        )}
        <ErrorBanner message={error} />
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
      {confirmReplace && (
        <ConfirmDialog
          title="Replace all data?"
          message="Replace ALL current data (players, tournaments, matches, friendlies) with this file? This cannot be undone."
          confirmLabel="Replace everything"
          onConfirm={doImport}
          onCancel={() => setConfirmReplace(false)}
          busy={busy}
        />
      )}
    </div>
  )
}
