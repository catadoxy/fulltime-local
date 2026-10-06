import { useEffect, useRef } from 'react'

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const dateOnly = value.length === 10
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(value)
  const iso = dateOnly || hasTz ? value : `${value}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state muted">{children}</div>
}

export function LoadingSkeleton({ rows = 4, label = 'Loading…' }: { rows?: number; label?: string }) {
  return (
    <div className="panel" aria-busy="true" aria-label={label}>
      <div className="skeleton-block" style={{ width: '38%' }} />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-block" style={{ opacity: 1 - i * 0.12 }} />
      ))}
      <span className="muted small">{label}</span>
    </div>
  )
}

export function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
  numeric,
}: {
  label: string
  sortKey: string
  activeKey: string
  dir: 'asc' | 'desc'
  onToggle: (key: string) => void
  numeric?: boolean
}) {
  const active = activeKey === sortKey
  return (
    <th className={`sortable${numeric ? ' num' : ''}`} onClick={() => onToggle(sortKey)}>
      <button
        type="button"
        className="th-button"
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={(e) => {
          e.stopPropagation()
          onToggle(sortKey)
        }}
      >
        {label} {active && <span className="arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label: string
}) {
  return (
    <div className="search-field">
      <label htmlFor={`search-${label}`}>{label}</label>
      <input
        id={`search-${label}`}
        type="search"
        value={value}
        placeholder={placeholder ?? `Search…`}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  busy,
}: {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="dialog-backdrop" onClick={onCancel} role="presentation">
      <div
        className="panel dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p className="muted">{message}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="danger"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
