import type { Subject } from '../stage/index.js'

/** One door, everywhere the paper prints somebody's name. The paper already threads `onSubject`
 *  into every page and two of them used it, so a name that is not this is a name that is not a door. */
export function PersonLink({
  id,
  name,
  onSubject,
}: {
  id: string
  name: string
  onSubject: (subject: Subject) => void
}) {
  return (
    <button
      type="button"
      className="person-link"
      onClick={() => {
        onSubject({ id, kind: 'agent', name })
      }}
    >
      {name}
    </button>
  )
}
