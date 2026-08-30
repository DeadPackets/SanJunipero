import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { simTimeFromTick, tickToMoment } from '@sj/shared'
import { tickBadgeState, type BadgeState, type LinkState } from '../ui/broadcastReady.js'
import type { WorldStore } from '../state/worldStore.js'

/** How long the stamp stays after the last input, and how long it takes to go (chrome.css). */
export const STAMP_HOLD_MS = 3000
/** One wake per this, however fast the pointer reports. */
const WAKE_THROTTLE_MS = 200
/** Everything that counts as somebody asking. */
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const

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
  link: LinkState,
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
export function QuietStamp({ store, link }: { store: WorldStore; link: LinkState }) {
  const isLive = (): boolean => store.getMode().live
  const isAwake = (): boolean => store.getState() !== null
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const live = useSyncExternalStore(store.subscribe, isLive, isLive)
  const awake = useSyncExternalStore(store.subscribe, isAwake, isAwake)
  const paused = useSyncExternalStore(store.subscribe, store.getPaused, store.getPaused)
  const [shown, setShown] = useState(false)
  const isShown = useRef(false)

  useEffect(() => {
    let timer = 0
    let woke = 0
    const wake = (): void => {
      // A high-poll mouse fires a thousand times a second, and each one cleared and re-set the
      // timeout.
      const now = performance.now()
      if (now - woke < WAKE_THROTTLE_MS) return
      woke = now
      if (!isShown.current) {
        isShown.current = true
        setShown(true)
      }
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        isShown.current = false
        setShown(false)
      }, STAMP_HOLD_MS)
    }
    // `pointermove` never fires on a phone that has not been touched, so a phone visitor never
    // learned the day, the season or that the town is live. The stamp opens the session instead.
    wake()
    for (const ev of WAKE_EVENTS) window.addEventListener(ev, wake, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const ev of WAKE_EVENTS) window.removeEventListener(ev, wake)
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
