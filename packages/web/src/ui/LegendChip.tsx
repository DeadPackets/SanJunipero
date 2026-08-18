import type { LegendRow } from './relationGraph.js'

/**
 * THE LEGEND'S OFF STATE IS A MARK, NOT A DIMMING (audit M4).
 *
 * A struck-through chip says "filtered out"; a faded one says "less important", which is a
 * different claim and the one the landed lens accidentally made. De-emphasis by `opacity` is
 * also how four of the audit's six AA failures happened, so the state is an ELEMENT.
 *
 * It lives in its own file because `SocietyLens.tsx` imports `react-force-graph-2d`, which
 * touches `window` at module load and therefore cannot be imported by a node test.
 */
export function LegendChip(
  { row, off, onToggle }: { row: LegendRow; off: boolean; onToggle: () => void },
) {
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
