import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import { useSubjectAnchor, type Subject } from './anchor.js'

/** A plate nailed under the figure, the way a name is written on a thing in the town — not a
 *  tooltip about it. */
export function Nameplate({
  subject,
  scene,
  store,
  selected = false,
}: {
  subject: Subject | null
  scene: Scene | null
  /** only a `structure` subject needs it — a body carries its own sprite anchor */
  store?: WorldStore
  /** the plate a viewer has committed to, drawn in honey rather than brown */
  selected?: boolean
}) {
  const ref = useSubjectAnchor(scene, subject, store)
  if (subject === null) return null
  return (
    <div ref={ref} className={selected ? 'stage-plate selected' : 'stage-plate'} aria-hidden="true">
      {subject.name}
    </div>
  )
}
