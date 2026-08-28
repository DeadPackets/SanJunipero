import { ARMS, PAGE_TITLE, type Arm, type PageKey } from './pageModel.js'

/** Four arms on a post in the corner of the town: the only standing chrome on the stage. */
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
    <nav className="signpost" aria-label="Signpost" ref={ref}>
      {ARMS.map((arm) => (
        <button
          key={arm}
          type="button"
          className="signpost-arm"
          data-arm={arm}
          aria-pressed={open === arm}
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
