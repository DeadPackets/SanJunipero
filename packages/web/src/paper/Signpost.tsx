import { ARMS, PAGE_TITLE, type Arm, type PageKey } from './pageModel.js'

export function Signpost({
  open,
  onOpen,
  ref,
}: {
  /** the page the paper is showing, so an arm can read as pressed */
  open: PageKey | null
  onOpen: (arm: Arm) => void
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
      <span className="signpost-post" aria-hidden="true" />
    </nav>
  )
}
