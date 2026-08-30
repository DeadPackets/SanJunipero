import type { Scene } from '../../render/scene.js'
import type { WorldStore } from '../../state/worldStore.js'
import type { Subject } from '../../stage/index.js'

/** A thing on the ground the viewer clicked. A structure is a `Subject`; these are not. */
export type Thing = { kind: 'item' | 'crop'; id: string }

/** A leaf on purpose: `index.tsx` imports every page, so the props cannot live there without
 *  every page importing it back. */
export type PageProps = {
  tab: string
  subject: Subject | null
  /** the item or crop the viewer last clicked on the town, for Found › Things to open at */
  thing: Thing | null
  /** the recorded day the address bar names, for Chronicle › Moments to open at */
  momentId: number | null
  store: WorldStore
  scene: Scene | null
  operatorToken: string | null
  /** which interior the camera is standing in, so the Inside page knows which way the door goes */
  insideId: string | null
  /** how far the town moved while nobody was looking, or `null` when it did not */
  gapTicks: number | null
  onSubject: (subject: Subject) => void
  onInside: (structureId: string | null) => void
  /** Go to one minute of the town's history: the socket scrubs and the address bar follows. */
  onJump: (tick: number) => void
  onLive: () => void
  /** The recorded day the filmstrip has open, so the address bar names it. */
  onMoment: (id: number | null) => void
}
