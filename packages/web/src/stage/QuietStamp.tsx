import { useEffect, useState, useSyncExternalStore } from 'react'
import { simTimeFromTick, tickToMoment } from '@sj/shared'
import type { LinkStatus } from '../net/socket.js'
import type { WorldStore } from '../state/worldStore.js'

/** How long the stamp stays after the last input, and how long it takes to go (chrome.css). */
export const STAMP_HOLD_MS = 3000

export type StampWord = 'LIVE' | 'REPLAY' | 'OFFLINE'

/** A clock nobody can know is stale is worse than no clock: a dropped socket or a town that
 *  has not woken yet says OFFLINE rather than printing the last tick as the time. */
export function stampWord(live: boolean, awake: boolean, link?: LinkStatus): StampWord {
  if (!awake || link === 'reconnecting' || link === 'connecting') return 'OFFLINE'
  return live ? 'LIVE' : 'REPLAY'
}

export function stampText(tick: number, word: StampWord): string {
  const m = tickToMoment(tick)
  const season = simTimeFromTick(tick).season.toUpperCase()
  return `DAY ${m.day} · ${season} · ${m.time} · ${word}`
}

/** The time, chiselled in the corner, only while somebody is asking. The town is the picture;
 *  a clock that is always up is a clock nobody reads. */
export function QuietStamp({ store, link }: { store: WorldStore; link?: LinkStatus }) {
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const live = useSyncExternalStore(store.subscribe, () => store.getMode().live)
  const awake = useSyncExternalStore(store.subscribe, () => store.getState() !== null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    let timer = 0
    const wake = (): void => {
      setShown(true)
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        setShown(false)
      }, STAMP_HOLD_MS)
    }
    window.addEventListener('pointermove', wake, { passive: true })
    window.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  // Not a live region: a clock announcing itself every minute of town time is one nobody can
  // listen past. It stays in the tree to be read on demand.
  return (
    <div className={shown ? 'stage-stamp shown' : 'stage-stamp'}>
      {stampText(tick, stampWord(live, awake, link))}
    </div>
  )
}
