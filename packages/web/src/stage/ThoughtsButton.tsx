import type { ThoughtsSetting } from '../ui/thoughts.js'
import { PixelGlyph } from './PixelGlyph.js'

/** The wisp itself, on the same 8x8 grid the weather glyphs and the sun token are drawn on: a
 *  cloud with the two beads trailing under it. The one mark a viewer can read having never been
 *  told, because the thing it draws is on the screen behind the button. */
const WISP: readonly (readonly [number, number])[] = [
  [2, 0],
  [3, 0],
  [4, 0],
  [5, 0],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [6, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [4, 2],
  [5, 2],
  [6, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
  [2, 5],
  [0, 7],
]

/** ★ OFF IS A MARK, NEVER A DARKER GROUND. The sheet learned this on `.legend-chip.off`: a struck
 *  chip says "switched off", where a dark one says "selected" — which is exactly what a pressed
 *  signpost arm means. Inverting also takes the slab's own ink ring to 1.47:1 against `--deep`,
 *  and `forced-colors` overrides a ground away entirely; an emptied silhouette survives both.
 *  Hollow and beadless, so the two states differ in shape before they differ in any colour. */
const WISP_OFF: readonly (readonly [number, number])[] = [
  [2, 0],
  [3, 0],
  [4, 0],
  [5, 0],
  [1, 1],
  [6, 1],
  [1, 2],
  [6, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
]

/** ★ A real two-state switch, so `aria-pressed` and not the signpost arms' `aria-expanded`: this
 *  opens nothing. It stands in the corner cluster beside the help button rather than on the post,
 *  because the four arms are the town's four sections and how the town is SHOWN is not a fifth. */
export function ThoughtsButton({
  thoughts,
  onToggle,
}: {
  thoughts: ThoughtsSetting
  onToggle: () => void
}) {
  const shown = thoughts === 'shown'
  return (
    <button
      type="button"
      className="thoughts-button"
      // Pressed means the wisps are up, the way a pressed switch means the thing is on — the
      // polarity `.legend-chip` already set. The label stays put and lets the state carry it.
      aria-pressed={shown}
      aria-label="Thought bubbles"
      onClick={onToggle}
    >
      <PixelGlyph className="thoughts-glyph" pixels={shown ? WISP : WISP_OFF} />
    </button>
  )
}
