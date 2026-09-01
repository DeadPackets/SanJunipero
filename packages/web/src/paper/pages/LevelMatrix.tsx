import { MATRIX_LEVELS, MATRIX_LEVEL_WORD, type LevelMatrix } from '../../ui/bondMatrix.js'

/** ★ 3B — a fixed grid with fixed addresses. Colour carries the level and the warmth number
 *  carries it a second time, so the ladder survives a reader who cannot separate honey from
 *  sand; an empty cell is two people who have never met, and says so. */
export function LevelMatrixTable({
  matrix,
  centreId,
  onCentre,
}: {
  matrix: LevelMatrix
  centreId: string | null
  onCentre: (id: string) => void
}) {
  return (
    <div className="matrix">
      <div className="matrix-scroll">
        <table className="matrix-grid">
          <caption className="stage-sr">
            Every pair in the town and how close they stand. Choose a row to open that person’s
            orbit.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="stage-sr">Person</span>
              </th>
              {matrix.heads.map((h) => (
                <th key={h.id} scope="col" className="matrix-head">
                  <abbr title={h.name}>{h.short}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.id} className={row.id === centreId ? 'matrix-row on' : 'matrix-row'}>
                <th scope="row" className="matrix-name">
                  <button
                    type="button"
                    aria-pressed={row.id === centreId}
                    onClick={() => {
                      onCentre(row.id)
                    }}
                  >
                    {row.name}
                  </button>
                </th>
                {row.cells.map((cell, i) => (
                  <td
                    key={matrix.heads[i]?.id ?? String(i)}
                    className="matrix-cell"
                    aria-label={cell.self ? undefined : cell.words}
                  >
                    {/* the square is an inner mark, so the ROW can be 44px of reach for the
                        name beside it while the grid keeps its own drawn size */}
                    <i className="matrix-fill" data-level={cell.self ? 'self' : cell.level}>
                      {cell.self || cell.level === 'strangers' ? null : (
                        <span className="matrix-warmth">{cell.warmth}</span>
                      )}
                    </i>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="matrix-key">
        {MATRIX_LEVELS.map((level) => (
          <li key={level}>
            <i className="matrix-swatch" data-level={level} aria-hidden="true" />
            {MATRIX_LEVEL_WORD[level]}
          </li>
        ))}
      </ul>
    </div>
  )
}
