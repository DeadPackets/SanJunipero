// The footprint plate's ROWS — what a hover is allowed to say, with no canvas in the way, so
// the words can be read off the world state and tested without a renderer.

/** Three short lines is the ceiling; a fourth answer has nowhere to go. */
export const PLATE_MAX_ROWS = 3
/** Per row. Press Start 2P sets one em per character, so 22 is already 352 world pixels. */
const PLATE_MAX_CHARS = 22

/** What a row is FOR, which is also how it is set.
 *  `kind` the pixel face in capitals · `name` the face with lowercase · `quiet` the same face on
 *  a shaded band. De-emphasis is a different PAPER, never a lighter ink: `--ink-quiet` measures
 *  3.57:1 on cream under the deep-night multiply, where the ink on parchment holds 4.67:1. */
export type PlateTone = 'kind' | 'name' | 'quiet'
export type PlateRow = { text: string; tone: PlateTone }

/** One row, clipped to the plate's own ceiling. A `kind` row shouts because Silkscreen has no
 *  lowercase to say it in. */
export function plateRowText(row: PlateRow): string {
  const text = row.tone === 'kind' ? row.text.toUpperCase() : row.text
  return text.length > PLATE_MAX_CHARS ? `${text.slice(0, PLATE_MAX_CHARS - 1)}…` : text
}

/** The rows a plate will actually draw: a row with nothing to say is not a row, and three is
 *  the ceiling. */
export function plateRows(rows: readonly (PlateRow | null)[]): PlateRow[] {
  return rows
    .filter((r): r is PlateRow => r !== null && r.text.trim().length > 0)
    .slice(0, PLATE_MAX_ROWS)
}
