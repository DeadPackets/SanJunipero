import type { Scene } from '../render/scene.js'
import { subjectPoint, useStageAnchor, type StageSubject, type WorldPoint } from './anchor.js'

/** A plate nailed under the figure, the way a name is written on a thing in the town — not a
 *  tooltip about it. */
export function Nameplate({
  subject,
  scene,
  selected = false,
  point,
}: {
  subject: StageSubject | null
  scene: Scene | null
  /** the plate a viewer has committed to, drawn in honey rather than brown */
  selected?: boolean
  /** a structure has no sprite anchor: give its world point here */
  point?: () => WorldPoint | null
}) {
  const ref = useStageAnchor(scene, () =>
    subject === null || scene === null ? null : (point?.() ?? subjectPoint(scene, subject)),
  )
  if (subject === null) return null
  return (
    <div ref={ref} className={selected ? 'stage-plate selected' : 'stage-plate'} aria-hidden="true">
      {subject.name}
    </div>
  )
}
