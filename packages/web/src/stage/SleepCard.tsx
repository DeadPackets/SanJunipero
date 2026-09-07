import { useSyncExternalStore } from 'react'
import { WAKE_HOUR } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { townAsleep } from '../ui/directorCut.js'

/** The hour the card promises, written the way the stamp writes a clock. Read off the world's
 *  one waking hour, so the card and the night's own end can never disagree. */
export const wakeTime = (): string => `${String(WAKE_HOUR).padStart(2, '0')}:00`

/** Honest, and in the town's voice: it says nothing is happening and says when that ends. An
 *  empty frame at 02:00 that never explained itself is what this replaces. */
export const SLEEP_COPY = {
  head: `The town sleeps until ${wakeTime()}.`,
  note: 'It wakes with the light, and the camera waits with it.',
}

/** Only when EVERY living body is asleep. One mind up at two in the morning is a town with
 *  something to watch, and this card would be lying over the top of it. */
export function SleepCard({ store }: { store: WorldStore }) {
  const sleeping = (): boolean => townAsleep(store.getState()?.agents)
  const asleep = useSyncExternalStore(store.subscribe, sleeping, sleeping)
  if (!asleep) return null
  return (
    <div className="sleep-card" role="status">
      <p className="sleep-card-line">{SLEEP_COPY.head}</p>
      <p className="sleep-card-note">{SLEEP_COPY.note}</p>
    </div>
  )
}
