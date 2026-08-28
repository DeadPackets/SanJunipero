import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChronicleEntry } from '@sj/shared'
import type { Scene } from '../render/scene.js'
import type { WorldStore } from '../state/worldStore.js'
import {
  CAPTION_HOLD_MS,
  TICKER_PX_PER_S,
  TICKER_SEP,
  lowerThirdLine,
  tickerText,
  type SpokenLine,
} from '../ui/broadcast.js'
import { bustStyle } from '../ui/bustStyle.js'
import { editions } from '../ui/dispatches.js'
import { chronicleFeed, dispatchesFeed } from '../ui/feeds.js'
import { useFeed } from '../ui/useEndpoint.js'
import { joinStageLoop } from './anchor.js'

/** The face beside the caption, in CSS pixels of the source frame. */
const BUST_PX = 96

const NO_ENTRIES: ChronicleEntry[] = []

/**
 * The lower third: who is talking, or — when nobody is — the newest thing the town's own paper
 * said. A plate of parchment with an ink rule under it, the way every other mark over the town
 * is a thing of the town.
 */
export function LowerThird({ store }: { store: WorldStore }) {
  const [spoken, setSpoken] = useState<SpokenLine | null>(null)
  const paper = useFeed(dispatchesFeed).data
  const latest = useMemo(() => (paper === null ? null : (editions(paper)[0] ?? null)), [paper])

  useEffect(() => {
    let timer = 0
    const off = store.onEvents((evts) => {
      for (const ev of evts) {
        if (ev.type !== 'agent_spoke') continue
        const p = ev.payload as { agentId: string; text: string }
        const name = store.getState()?.agents[p.agentId]?.name ?? p.agentId
        setSpoken({ agentId: p.agentId, name, words: p.text })
        clearTimeout(timer)
        timer = window.setTimeout(() => {
          setSpoken(null)
        }, CAPTION_HOLD_MS)
      }
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [store])

  const line = lowerThirdLine(
    spoken,
    latest === null ? null : { title: latest.title, body: latest.caption ?? latest.body },
  )
  if (line === null) return null
  const bust =
    line.kind === 'speech' ? bustStyle(store.assetRecords(), line.agentId, BUST_PX) : null

  return (
    <div className="lower-third" role="status" aria-live="polite">
      {line.kind === 'speech' && (
        <span
          className={bust === null ? 'lower-third-bust none' : 'lower-third-bust'}
          style={bust ?? undefined}
          aria-hidden="true"
        />
      )}
      <span className="lower-third-body">
        <span className="lower-third-name">{line.name}</span>
        <span className="lower-third-words">{line.words}</span>
      </span>
    </div>
  )
}

/**
 * The chronicle crawling along the bottom letterbox edge. The line is written twice so the wrap
 * is seamless, and it is moved on the stage's own frame rather than by a keyframe — the sheet's
 * motion table names response times, and a crawl is not a response to anything.
 */
export function Ticker({ scene }: { scene: Scene | null }) {
  const entries = useFeed(chronicleFeed).data ?? NO_ENTRIES
  const text = useMemo(() => tickerText(entries), [entries])
  const lineRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = lineRef.current
    if (node === null || text === '' || scene?.wantsMotion() !== true) return
    let x = 0
    let last = performance.now()
    return joinStageLoop(() => {
      const now = performance.now()
      x -= (TICKER_PX_PER_S * (now - last)) / 1000
      last = now
      const once = node.scrollWidth / 2
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
