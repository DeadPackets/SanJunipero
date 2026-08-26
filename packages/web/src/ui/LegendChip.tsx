import type { LegendRow } from './relationGraph.js'

/** Its own file: `SocietyLens.tsx` imports `react-force-graph-2d`, which touches `window` at
 *  module load and so cannot be imported by a node test. The off state is a mark, never opacity. */
export function LegendChip({
  row,
  off,
  onToggle,
}: {
  row: LegendRow
  off: boolean
  onToggle: () => void
}) {
  const y = row.strokeCount === 2 ? 3.5 : 5
  const dash = row.dash === null ? {} : { strokeDasharray: row.dash.join(' ') }
  return (
    <button
      type="button"
      className={off ? 'legend-chip off' : 'legend-chip'}
      data-legend={`${row.axis}:${row.key}`}
      aria-pressed={!off}
      onClick={onToggle}
    >
      <svg className="legend-mark" width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
        <line x1="1" y1={y} x2="25" y2={y} stroke={row.swatch} strokeWidth="2" {...dash} />
        {row.strokeCount === 2 && (
          <line x1="1" y1="7" x2="25" y2="7" stroke={row.swatch} strokeWidth="2" {...dash} />
        )}
      </svg>
      <span className="legend-word">{row.words}</span>
      {off && <span className="legend-strike" aria-hidden="true" />}
    </button>
  )
}
