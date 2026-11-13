import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../App'
import { ConfirmDialog, ErrorBanner } from '../components/ui'

interface ImportResult {
  tournaments: number
  matches: number
  players: number
  games?: number
  teams?: number
  duplicates?: number
  replaced?: boolean
}

interface BackupPreview extends ImportResult {
  reused_players: number
  reused_teams: number
  duplicate_tournaments: number
  duplicate_games: number
  backup: {
    players: number
    tournaments: number
    matches: number
    friendlies: number
    teams: number
  }
}

export default function ImportPage({ embedded = false }: { embedded?: boolean }) {
  const { canEdit } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [replace, setReplace] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  const [confirmReplace, setConfirmReplace] = useState(false)

  async function doImport() {
    if (!file || !preview) return
    setImporting(true)
    setError('')
    try {
      const r = (await api.importFullTimeBackup(file, replace)) as ImportResult
      setResult(r)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
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
    setPreviewing(true)
    setError('')
    setResult(null)
    setPreview(null)
    try {
      const summary = await api.previewFullTimeBackup(file, replace) as BackupPreview
      setPreview(summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewing(false)
    }
  }

  function beginImport() {
    if (!preview) return
    if (replace) {
      setConfirmReplace(true)
      return
    }
    void doImport()
  }

  return (
    <div id={embedded ? 'backup-import' : undefined}>
      {embedded ? (
        <h2 style={{ marginTop: 0 }}>Backup &amp; import</h2>
      ) : (
        <h1>Backup &amp; import</h1>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Export</h2>
        <p className="muted">
          Download a full, portable backup of this app's database (all players and tournaments).
          To restore the complete database, drop it into <code>./data/fulltime.db</code>. You can also import its
          tournament data below; accounts and API settings on this installation are kept.
        </p>
        <a className="btn primary" href={api.exportBackupUrl()}>
          ⬇ Download backup (.db)
        </a>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Import a FullTime Local backup</h2>
        {!canEdit ? (
          <p className="muted">Viewers cannot import. Ask an admin.</p>
        ) : (
          <>
          <p className="muted">
            Upload a SQLite <code>.db</code> backup exported from FullTime Local. Players, tournaments,
            matches, friendlies and club crests are imported. Preview the effect before applying it.
          </p>
          <form onSubmit={submit}>
            <div className="row" style={{ marginBottom: '0.75rem' }}>
              <input
                type="file"
                accept=".db,.sqlite,.sqlite3,application/octet-stream"
                aria-label="FullTime Local backup file"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setPreview(null)
                  setResult(null)
                  setError('')
                }}
              />
              <button className="primary" type="submit" disabled={!file || previewing || importing}>
                {previewing ? 'Checking backup…' : preview ? 'Refresh preview' : 'Preview backup'}
              </button>
            </div>
            <label className="row" style={{ color: 'var(--text)', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => {
                  setReplace(e.target.checked)
                  setPreview(null)
                  setResult(null)
                }}
              />
              Replace existing tournament data (clean slate)
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
        {preview && (
          <div className="backup-preview">
            <h3 style={{ marginTop: 0 }}>{replace ? 'Replace preview' : 'Merge preview'}</h3>
            <p className="muted small">
              Backup contains {preview.backup.players} players, {preview.backup.tournaments} tournaments,
              {` ${preview.backup.matches} matches, ${preview.backup.friendlies} friendlies and ${preview.backup.teams} clubs.`}
            </p>
            <ul className="small">
              <li>{preview.players} players will be added; {preview.reused_players} matching players reused.</li>
              <li>{preview.tournaments} tournaments and {preview.matches} matches will be imported.</li>
              <li>
                {preview.games ?? 0} friendlies and {preview.teams ?? 0} club records will be imported;
                {' '}{preview.reused_teams} existing club records reused.
              </li>
              {(preview.duplicates ?? 0) > 0 && (
                <li>
                  {preview.duplicate_tournaments} duplicate tournaments and {preview.duplicate_games} duplicate
                  friendlies will be skipped.
                </li>
              )}
            </ul>
            <p className="muted small">
              User accounts and API settings on this installation are not changed.
            </p>
            <button className="primary" type="button" disabled={importing} onClick={beginImport}>
              {importing ? 'Importing…' : replace ? 'Replace tournament data' : 'Import backup'}
            </button>
          </div>
        )}
        {result && (
          <div className="banner" style={{ marginTop: '1rem' }}>
            {result.replaced ? 'Replaced tournament data. ' : ''}
            Imported {result.tournaments} tournaments, {result.matches} matches, {result.games ?? 0} friendlies and {result.players} new players.
            {result.duplicates ? ` ${result.duplicates} duplicate records skipped.` : ''}{' '}
            <Link to="/tournaments">View tournaments →</Link>
          </div>
        )}
      </div>
      {confirmReplace && (
        <ConfirmDialog
          title="Replace tournament data?"
          message="Replace all players, tournaments, matches, friendlies and cached club teams with this backup? User accounts and API settings on this installation will remain unchanged. This cannot be undone."
          confirmLabel="Replace tournament data"
          onConfirm={doImport}
          onCancel={() => setConfirmReplace(false)}
          busy={importing}
        />
      )}
    </div>
  )
}
