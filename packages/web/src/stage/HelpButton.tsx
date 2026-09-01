import { KEY_MAP_KEY } from './KeyMap.js'

/** The class the key map's own click-away handler must not count as "outside": without it the
 *  pointerdown closes the sheet and the click that follows opens it again. */
export const HELP_BUTTON_CLASS = 'help-button'

/** ★ One 44px target with the glyph everyone already knows. `?` opened the key map and nothing
 *  said so, which is an affordance only a viewer who already knew could find. */
export function HelpButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={HELP_BUTTON_CLASS}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="What the town answers to"
      onClick={onToggle}
    >
      <span aria-hidden="true">{KEY_MAP_KEY}</span>
    </button>
  )
}
