import { useEffect, useState, useSyncExternalStore } from 'react'
import { simTimeFromTick, tickToMoment } from '@sj/shared'
import { tickBadgeState, type BadgeState, type LinkState } from '../ui/broadcastReady.js'
import type { WorldStore } from '../state/worldStore.js'

/** How long the stamp stays after the last input, and how long it takes to go (chrome.css). */
export const STAMP_HOLD_MS = 3000

export type StampWord = 'LIVE' | 'REPLAY' | 'OFFLINE' | 'PAUSED'

/** The badge's four states said in three words: R8's law is one law, and the stamp is not a
 *  second answer to it. A clock nobody can know is stale reads OFFLINE rather than a time. */
const STAMP_OF: Readonly<Record<BadgeState, StampWord>> = {
  live: 'LIVE',
  past: 'REPLAY',
  stale: 'OFFLINE',
  waking: 'OFFLINE',
}

export function stampWord(
  live: boolean,
  awake: boolean,
  link: LinkState = 'online',
  paused = false,
): StampWord {
  const word = STAMP_OF[tickBadgeState(link, live, awake)]
  // Only over LIVE: a stopped clock behind a scrub or a dropped socket is the lesser fact.
  return paused && word === 'LIVE' ? 'PAUSED' : word
}

export function stampText(tick: number, word: StampWord): string {
  const m = tickToMoment(tick)
  const season = simTimeFromTick(tick).season.toUpperCase()
  return `DAY ${m.day} · ${season} · ${m.time} · ${word}`
}

/** The time, chiselled in the corner, only while somebody is asking. The town is the picture;
 *  a clock that is always up is a clock nobody reads. */
export function QuietStamp({ store, link }: { store: WorldStore; link?: LinkState }) {
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  const live = useSyncExternalStore(store.subscribe, () => store.getMode().live)
  const awake = useSyncExternalStore(store.subscribe, () => store.getState() !== null)
  const paused = useSyncExternalStore(store.subscribe, store.getPaused)
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
      {stampText(tick, stampWord(live, awake, link, paused))}
    </div>
  )
}
