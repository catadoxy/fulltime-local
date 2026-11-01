import { useMemo, useRef, useState } from 'react'

export interface ChartSeries {
  name: string
  color: string
  values: number[]
}

export interface ChartPointMeta {
  label: string
  axisLabel?: string
  detail?: string
  result?: 'W' | 'D' | 'L'
}

/**
 * Lightweight SVG line chart — no chart dependency.
 * Values are plotted on a shared y-axis; x is match order.
 */
export function TrendChart({
  series,
  points,
  height = 220,
  valueSuffix = '',
  emptyLabel = 'Not enough matches yet.',
}: {
  series: ChartSeries[]
  points: ChartPointMeta[]
  height?: number
  valueSuffix?: string
  emptyLabel?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const width = 720
  const pad = { top: 14, right: 16, bottom: 26, left: 44 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom

  const allValues = series.flatMap((s) => s.values)
  const { min, max } = useMemo(() => {
    if (allValues.length === 0) return { min: 0, max: 1 }
    let lo = Math.min(...allValues)
    let hi = Math.max(...allValues)
    if (lo === hi) {
      lo -= 1
      hi += 1
    }
    const span = hi - lo
    const padding = Math.max(span * 0.12, 1)
    return { min: lo - padding, max: hi + padding }
  }, [allValues])

  const n = points.length
  const xAt = (i: number) => (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const yAt = (v: number) => innerH - ((v - min) / (max - min)) * innerH

  const ticks = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i <= 4; i++) out.push(min + ((max - min) * i) / 4)
    return out
  }, [min, max])

  if (n === 0) {
    return <div className="chart-empty muted small">{emptyLabel}</div>
  }
  if (n === 1) {
    return <div className="chart-empty muted small">Only one match so far — play another to see a trend.</div>
  }

  const fmt = (v: number) =>
    Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1)
  const tickFmt = (v: number) => (max - min >= 10 ? String(Math.round(v)) : v.toFixed(1))

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || n === 0) return
    const x = ((e.clientX - rect.left) / rect.width) * width - pad.left
    const ratio = n <= 1 ? 0 : x / innerW
    const idx = Math.round(ratio * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, idx)))
  }

  const hovered = hover != null ? points[hover] : null
  const tooltipLeft = hover != null ? Math.min(86, Math.max(14, ((xAt(hover) + pad.left) / width) * 100)) : 0

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="trend-chart"
        role="img"
        aria-label={`Line chart: ${series.map((s) => s.name).join(', ')} over ${n} matches.`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={0}
                x2={innerW}
                y1={yAt(t)}
                y2={yAt(t)}
                className="chart-grid"
              />
              <text x={-8} y={yAt(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">
                {tickFmt(t)}
              </text>
            </g>
          ))}

          {series.map((s) => {
            const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(v)}`).join(' ')
            const area =
              n > 0
                ? `${d} L${xAt(n - 1)},${innerH} L${xAt(0)},${innerH} Z`
                : ''
            return (
              <g key={s.name}>
                {series.length === 1 && <path d={area} fill={s.color} className="chart-area" />}
                <path d={d} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) => (
                  <circle
                    key={i}
                    cx={xAt(i)}
                    cy={yAt(v)}
                    r={hover === i ? 4.2 : n > 24 ? 0 : 2.2}
                    fill={s.color}
                    className="chart-dot"
                  />
                ))}
              </g>
            )
          })}

          {hover != null && (
            <line
              x1={xAt(hover)}
              x2={xAt(hover)}
              y1={0}
              y2={innerH}
              className="chart-guide"
            />
          )}

          {/* x labels: first, middle, last — skip repeated dates */}
          {(() => {
            const seen = new Set<string>()
            return [0, Math.floor((n - 1) / 2), n - 1]
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .map((i) => {
                const text = points[i]?.axisLabel ?? points[i]?.label ?? ''
                if (seen.has(text)) return null
                seen.add(text)
                return (
                  <text
                    key={i}
                    x={xAt(i)}
                    y={innerH + 18}
                    className="chart-axis"
                    textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  >
                    {text}
                  </text>
                )
              })
          })()}
        </g>
      </svg>

      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name} className="chart-key">
            <span className="chart-swatch" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <span className="muted small">hover the chart for match details</span>
      </div>

      {hovered && (
        <div className="chart-tooltip" style={{ left: `${tooltipLeft}%` }}>
          <div className="chart-tooltip-date">
            {hovered.label}
            {hovered.result && (
              <span className={`badge ${hovered.result === 'W' ? 'done' : hovered.result === 'L' ? 'loss' : ''}`}>
                {hovered.result === 'W' ? 'Win' : hovered.result === 'L' ? 'Loss' : 'Draw'}
              </span>
            )}
          </div>
          {hovered.detail && <div className="small muted">{hovered.detail}</div>}
          <div className="chart-tooltip-values">
            {series.map((s) => (
              <span key={s.name}>
                <span className="chart-swatch" style={{ background: s.color }} />
                {s.name}: <strong>{fmt(s.values[hover!] ?? 0)}{valueSuffix}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
