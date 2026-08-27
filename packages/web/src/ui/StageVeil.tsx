import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'

const VEIL_EXIT_MS = 260

/** About the READ, never about the town: an unfetched graph, an unanswered ties endpoint and a
 *  tieless town all draw the same field of unconnected people, so the wait has to name itself. */
const LOADING_COPY = 'Reading the town’s ties…'

/** Lives out here so App can show it while the Bonds lens's own chunk is still downloading. */
export function BondsVeil() {
  return (
    <p className="society-empty" aria-busy="true">
      {LOADING_COPY}
    </p>
  )
}

// Cold-boot veil only: once a snapshot has ever landed, the world on screen is fact
// and link trouble speaks through the topbar pill instead.
export function StageVeil({ store }: { store: WorldStore }) {
  const awake = useSyncExternalStore(store.subscribe, () => store.getState() !== null)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!awake) return
    const t = setTimeout(() => {
      setGone(true)
    }, VEIL_EXIT_MS)
    return () => {
      clearTimeout(t)
    }
  }, [awake])

  if (gone) return null
  return (
    <div className={awake ? 'stage-veil leaving' : 'stage-veil'} role="status">
      <div className="veil-slab">
        <span className="veil-title">Waking the town</span>
        <span className="veil-loader" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="veil-sub">listening for the first morning bell</span>
      </div>
    </div>
  )
}
