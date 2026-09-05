import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { agentName } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { captionFor, chapterIndex, type Chapter } from '../ui/chapterCaption.js'
import { chaptersFeed } from '../ui/feeds.js'
import { useFeed } from '../ui/useEndpoint.js'
import { SCENE_TOTAL_MS } from '../ui/sceneTransition.js'
import {
  TITLE_CARD_MS,
  castNames,
  dipAlpha,
  momentDateline,
  type MomentPlay,
} from '../ui/replayRun.js'

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The dip, written straight to the DOM: 300 ms of curtain through React state would re-render
 *  the whole overlay eighteen times for one transition. */
function useDip(play: MomentPlay | null, ref: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (play === null || el === null) return
    if (reducedMotion()) return
    let raf = 0
    const began = performance.now()
    const frame = (now: number): void => {
      const a = dipAlpha(now - began)
      el.style.opacity = String(a)
      if (now - began < SCENE_TOTAL_MS) raf = requestAnimationFrame(frame)
      else el.style.opacity = '0'
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      el.style.opacity = '0'
    }
  }, [play, ref])
}

const NO_CHAPTERS: Chapter[] = []

/** The narrator's own paragraph for whatever just happened, held until the next one lands.
 *  Nothing is fetched for a replay: the chapters are already on the wire for the Chapters tab. */
function useNarratorCaption(store: WorldStore, play: MomentPlay | null): string | null {
  const chapters = useFeed(chaptersFeed).data ?? NO_CHAPTERS
  const index = useMemo(() => chapterIndex(chapters), [chapters])
  // Kept WITH the moment it belongs to, so leaving one clears its caption by derivation rather
  // than by a second write — a setState in an effect body is a cascading render.
  const [line, setLine] = useState<{ play: MomentPlay; text: string } | null>(null)

  useEffect(() => {
    if (play === null) return
    return store.onEvents((evts) => {
      const next = captionFor(index, evts)
      if (next !== null) setLine({ play, text: next })
    })
  }, [store, play, index])

  return line !== null && line.play === play ? line.text : null
}

/** Up for two seconds, and down the moment the town does anything — the card must never stand
 *  over the thing it announced. */
function useTitleCard(store: WorldStore, play: MomentPlay | null): boolean {
  // WHICH moment the card has finished with, not whether one is up: a new moment is up by
  // derivation, so nothing writes state from the effect body.
  const [done, setDone] = useState<MomentPlay | null>(null)
  useEffect(() => {
    if (play === null || play.title === '') return
    const timer = setTimeout(() => {
      setDone(play)
    }, TITLE_CARD_MS)
    const off = store.onEvents(() => {
      setDone(play)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [store, play])
  return play !== null && play.title !== '' && done !== play
}

/** What the past looks like: a dip through black on the way in, a warm grade a tenth less
 *  saturated than now, and a card that names the minute and leaves. NEVER sepia — the town has
 *  to stay worth watching once it is old. */
export function ReplayScene({ store, play }: { store: WorldStore; play: MomentPlay | null }) {
  const dipRef = useRef<HTMLDivElement>(null)
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  useDip(play, dipRef)
  const cardUp = useTitleCard(store, play)
  const caption = useNarratorCaption(store, play)

  const who = play === null ? '' : castNames(play.cast, (id) => agentName(state?.agents, id))
  // ONE plate, two things to say: the moment's own name while it opens, then the narrator's
  // paragraph about it. Never both, so the slot is never two marks deep.
  const titled = play !== null && play.title !== '' && cardUp
  const up = titled || (play !== null && caption !== null)

  return (
    <>
      <div className="replay-grade" data-on={play === null ? 'no' : 'yes'} aria-hidden="true" />
      <div className="replay-dip" ref={dipRef} aria-hidden="true" />
      {play !== null && (
        // Non-modal and unfocusable: the plate is a caption on the town, not a thing to dismiss.
        <div className="replay-card" data-up={up ? 'yes' : 'no'} aria-hidden="true">
          <p className="replay-card-when">{momentDateline(play.tick)}</p>
          {titled ? (
            <>
              <p className="replay-card-title">{play.title}</p>
              {who !== '' && <p className="replay-card-cast">{who}</p>}
            </>
          ) : (
            <p className="replay-card-prose">{caption}</p>
          )}
        </div>
      )}
    </>
  )
}
