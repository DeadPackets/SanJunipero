import { useEffect, useRef, useState } from 'react'
import { agentName } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'

/** One line per this, or a screen reader is read a market square all at once. */
export const SPEECH_LIVE_MS = 800
/** A town can out-talk 800 ms forever. Falling minutes behind is worse than missing a line,
 *  so the oldest waiting line is dropped once the queue is this long. */
export const SPEECH_LIVE_CAP = 8

export type Utterance = { name: string; text: string }

export function speechLine(u: Utterance): string {
  return `${u.name}: ${u.text}`
}

export function nextLine(
  queue: readonly Utterance[],
  lastAtMs: number,
  nowMs: number,
  everyMs = SPEECH_LIVE_MS,
): { line: string; rest: Utterance[] } | null {
  if (queue.length === 0 || nowMs - lastAtMs < everyMs) return null
  return { line: speechLine(queue[0]!), rest: queue.slice(1) }
}

export function enqueue(
  queue: readonly Utterance[],
  u: Utterance,
  cap = SPEECH_LIVE_CAP,
): Utterance[] {
  const next = [...queue, u]
  return next.length > cap ? next.slice(next.length - cap) : next
}

/** Every utterance, spoken once, whether or not it drew a bubble: the nearest-three rule is
 *  about paper over the picture, not about who is allowed to be heard. */
export function SpeechLive({ store }: { store: WorldStore }) {
  const [line, setLine] = useState('')
  const queue = useRef<Utterance[]>([])
  const lastAt = useRef(0)

  useEffect(() => {
    const off = store.onEvents((evts) => {
      for (const ev of evts) {
        if (ev.type !== 'agent_spoke') continue
        const p = ev.payload as { agentId: string; text: string }
        const name = agentName(store.getState()?.agents, p.agentId)
        queue.current = enqueue(queue.current, { name, text: p.text })
      }
    })
    const timer = setInterval(() => {
      const due = nextLine(queue.current, lastAt.current, performance.now())
      if (due === null) return
      queue.current = due.rest
      lastAt.current = performance.now()
      // Two people saying the same thing is the same text node, which announces nothing.
      setLine((prev) => (prev === due.line ? `${due.line} ` : due.line))
    }, SPEECH_LIVE_MS)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [store])

  return (
    <p className="stage-sr" aria-live="polite">
      {line}
    </p>
  )
}
