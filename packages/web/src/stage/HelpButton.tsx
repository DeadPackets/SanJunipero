import { KEY_MAP_ID, KEY_MAP_KEY } from './KeyMap.js'

/** ★ One 44px target with the glyph everyone already knows. `?` opened the key map and nothing
 *  said so, which is an affordance only a viewer who already knew could find. */
export function HelpButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="help-button"
      aria-haspopup="dialog"
      // A disclosure names what it opens, which is also how the key map's own click-away knows
      // this button is not "outside" it.
      aria-controls={KEY_MAP_ID}
      aria-expanded={open}
      aria-label="What the town answers to"
      onClick={onToggle}
    >
      <span aria-hidden="true">{KEY_MAP_KEY}</span>
    </button>
  )
}
