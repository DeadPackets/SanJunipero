import { useEffect, useMemo, useRef, useState } from 'react'
import { agentName, type ChronicleEntry } from '@sj/shared'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import { typedChars, typingMs } from '../render/converse.js'
import {
  CAPTION_HOLD_MS,
  TICKER_PX_PER_S,
  TICKER_SEP,
  lowerThirdLine,
  tickerText,
  type SpokenLine,
} from '../ui/broadcast.js'
import { bustStyle, useDressed } from '../ui/bustStyle.js'
import { editions } from '../ui/dispatches.js'
import { chronicleFeed, dispatchesFeed } from '../ui/feeds.js'
import { endpoint, useFeed } from '../ui/useEndpoint.js'
import { joinStageLoop } from './anchor.js'

/** The face beside the caption, in CSS pixels of the source frame. The stream frame is a
 *  quarter of its source on a phone player; the desk is read at arm's length. */
export const BUST_PX = 96
export const BUST_DESK_PX = 28

const NO_ENTRIES: ChronicleEntry[] = []

/** The desk never reads the paper. Its caption is somebody in the shot talking, so a poll for a
 *  headline it would never print is a request an idle tab makes forever. */
const NO_PAPER: typeof dispatchesFeed = endpoint(null)

/** A caption that is still arriving must not be read out a letter at a time, and a viewer who
 *  asked for stillness is asking for exactly that. */
const STILL =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

type LiveLine = SpokenLine & { bornMs: number }

/** The line the town is saying now, while its speaker is in the shot. It goes the frame the
 *  camera moves off them: a caption over somebody else's face is a lie about who spoke. */
function useSpokenInShot(store: WorldStore, shot: readonly string[]): LiveLine | null {
  const [spoken, setSpoken] = useState<LiveLine | null>(null)

  useEffect(() => {
    let timer = 0
    const off = store.onEvents((evts) => {
      for (const ev of evts) {
        if (ev.type !== 'agent_spoke') continue
        const p = ev.payload as { agentId: string; text: string }
        const name = agentName(store.getState()?.agents, p.agentId)
        setSpoken({ agentId: p.agentId, name, words: p.text, bornMs: performance.now() })
        clearTimeout(timer)
        // The hold is time to READ, so it starts when the line has finished arriving.
        timer = window.setTimeout(
          () => {
            setSpoken(null)
          },
          CAPTION_HOLD_MS + (STILL ? 0 : typingMs(p.text.length)),
        )
      }
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [store])

  return spoken !== null && shot.includes(spoken.agentId) ? spoken : null
}

/** Writes the line in at reading pace, straight onto the node: a caption re-rendered per
 *  character would re-render the overlay twenty-eight times a second. */
function useTypedInto(words: string, bornMs: number) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const node = ref.current
    if (node === null) return
    if (STILL) {
      node.textContent = words
      return
    }
    const whole = typingMs(words.length)
    let shown = -1
    let off = (): void => undefined
    off = joinStageLoop(() => {
      const since = performance.now() - bornMs
      const n = typedChars(words.length, since)
      if (n !== shown) {
        shown = n
        node.textContent = words.slice(0, n)
      }
      if (since >= whole) off()
    })
    return () => {
      off()
    }
  }, [words, bornMs])
  return ref
}

export function LowerThird({
  store,
  shot,
  broadcast = false,
}: {
  store: WorldStore
  /** who the director has in frame; the caption lives and dies with it */
  shot: readonly string[]
  broadcast?: boolean
}) {
  const spoken = useSpokenInShot(store, shot)
  const dressed = useDressed(store)
  const paper = useFeed(broadcast ? dispatchesFeed : NO_PAPER).data
  const latest = useMemo(() => (paper === null ? null : (editions(paper)[0] ?? null)), [paper])

  const line = lowerThirdLine(
    spoken,
    latest === null ? null : { title: latest.title, body: latest.caption ?? latest.body },
  )
  // The ghost holds the slab at the width of the finished line, so the box does not grow a
  // letter at a time under the words arriving in it.
  const words = line?.words ?? ''
  const typed = useTypedInto(words, spoken?.bornMs ?? 0)
  if (line === null) return null
  const bust =
    line.kind === 'speech' && dressed
      ? bustStyle(store.assetRecords(), line.agentId, broadcast ? BUST_PX : BUST_DESK_PX)
      : null

  return (
    <div className="lower-third">
      {line.kind === 'speech' && (
        <span
          className={bust === null ? 'lower-third-bust none' : 'lower-third-bust'}
          style={bust ?? undefined}
          aria-hidden="true"
        />
      )}
      <span className="lower-third-body">
        <span className="lower-third-name">{line.name}</span>
        <span className="lower-third-words">
          <span className="lower-third-ghost" aria-hidden="true">
            {words}
          </span>
          <span className="lower-third-typed" ref={typed} />
        </span>
      </span>
    </div>
  )
}

/** The line is written twice so the wrap is seamless, and it is moved on the stage's own frame
 *  rather than by a keyframe: a crawl is not a response to anything the motion table names. */
export function Ticker({ scene }: { scene: Scene | null }) {
  const entries = useFeed(chronicleFeed).data ?? NO_ENTRIES
  const text = useMemo(() => tickerText(entries), [entries])
  const lineRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = lineRef.current
    if (node === null || text === '' || scene?.wantsMotion() !== true) return
    let x = 0
    let last = performance.now()
    // Measured once: reading `scrollWidth` inside the loop forces a layout on every frame, and
    // the line only changes width when `text` does, which re-runs this effect.
    const once = node.scrollWidth / 2
    return joinStageLoop(() => {
      const now = performance.now()
      x -= (TICKER_PX_PER_S * (now - last)) / 1000
      last = now
      if (once > 0 && -x >= once) x += once
      node.style.transform = `translateX(${Math.round(x)}px)`
    })
  }, [text, scene])

  if (text === '') return null
  // Decorative: the same record is a page of the paper, read there rather than announced here.
  return (
    <div className="stage-ticker" aria-hidden="true">
      <span className="ticker-line" ref={lineRef}>
        {`${text}${TICKER_SEP}${text}${TICKER_SEP}`}
      </span>
    </div>
  )
}
