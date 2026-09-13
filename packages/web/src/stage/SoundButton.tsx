import type { SoundSetting } from '../ui/sound.js'
import { PixelGlyph } from './PixelGlyph.js'

/** The note, on the same 8×8 grid the wisp, the weather and the sun token are drawn on. The
 *  sheet's `--font-px` has no ♪ at any size, so the mark is drawn, not set. */
const NOTE: readonly (readonly [number, number])[] = [
  [5, 0],
  [5, 1],
  [6, 1],
  [5, 2],
  [6, 2],
  [7, 2],
  [5, 3],
  [5, 4],
  [2, 5],
  [3, 5],
  [4, 5],
  [5, 5],
  [1, 6],
  [2, 6],
  [3, 6],
  [4, 6],
  [5, 6],
  [1, 7],
  [2, 7],
  [3, 7],
  [4, 7],
]

/** ★ OFF IS A MARK, NEVER A DARKER GROUND, the rule the old bonds key set and the wisp keeps.
 *  The flag is gone and the head is hollow, so the two states differ in SHAPE before they
 *  differ in any colour, which is the only signal a `forced-colors` viewer is left with. */
const NOTE_OFF: readonly (readonly [number, number])[] = [
  [5, 0],
  [5, 1],
  [5, 2],
  [5, 3],
  [5, 4],
  [2, 5],
  [3, 5],
  [4, 5],
  [1, 6],
  [5, 6],
  [1, 7],
  [2, 7],
  [3, 7],
  [4, 7],
]

/** A switch, so `aria-pressed`: it opens nothing. It stands third in the corner cluster, under
 *  the same rule the wisp does — how the town is SHOWN is not a fifth arm of the signpost. */
export function SoundButton({
  setting,
  onToggle,
}: {
  setting: SoundSetting
  onToggle: () => void
}) {
  const on = setting === 'on'
  return (
    <button
      type="button"
      className="sound-button"
      aria-pressed={on}
      aria-label="Town sound"
      onClick={onToggle}
    >
      <PixelGlyph className="sound-glyph" pixels={on ? NOTE : NOTE_OFF} />
    </button>
  )
}
