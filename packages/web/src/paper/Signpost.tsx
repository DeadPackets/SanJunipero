import { KEY_MAP_KEY } from '../stage/KeyMap.js'
import { ARMS, PAGE_TITLE, type Arm, type PageKey } from './pageModel.js'

export function Signpost({
  open,
  onOpen,
  onHelp,
  ref,
}: {
  /** the page the paper is showing, so an arm can read as pressed */
  open: PageKey | null
  onOpen: (arm: Arm) => void
  /** the key map, which until now only a viewer who already knew to press ? could find */
  onHelp: () => void
  ref?: React.Ref<HTMLElement>
}) {
  return (
    <nav
      id="signpost"
      className="signpost"
      aria-label="Town sections"
      data-open={open === null ? 'no' : 'yes'}
      ref={ref}
    >
      {ARMS.map((arm) => (
        <button
          key={arm}
          type="button"
          className="signpost-arm"
          data-arm={arm}
          // A disclosure set, not four toggles: each arm opens the one sheet on its own page.
          aria-expanded={open === arm}
          aria-controls="paper-sheet"
          onClick={() => {
            onOpen(arm)
          }}
        >
          {PAGE_TITLE[arm]}
        </button>
      ))}
      <button
        type="button"
        className="signpost-arm"
        aria-label="Keyboard shortcuts"
        onClick={onHelp}
      >
        {KEY_MAP_KEY}
      </button>
      <span className="signpost-post" aria-hidden="true" />
    </nav>
  )
}
