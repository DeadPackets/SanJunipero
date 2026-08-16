import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { MINUTES_PER_DAY, tickToMoment } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { ObservatoryHandle } from '../net/socket.js'

export const KEY_STEP_TICKS = 10
export const KEY_PAGE_TICKS = MINUTES_PER_DAY

type Chapter = { tick: number; title: string }

export function Timeline({ store, handle, onView }: {
  store: WorldStore
  handle: ObservatoryHandle | null
  onView: (tick: number | null) => void // null = went live; updates the address bar
}) {
  const liveEdgeRef = useRef(0)
  const liveTick = useSyncExternalStore(store.subscribe, () => {
    const s = store.getState()
    return store.getMode().live ? s?.tick ?? 0 : Math.max(s?.tick ?? 0, liveEdgeRef.current)
  })
  const mode = useSyncExternalStore(store.subscribe, store.getMode)
  const events = useSyncExternalStore(store.subscribe, store.recentEvents)
  if (mode.live) liveEdgeRef.current = Math.max(liveEdgeRef.current, liveTick)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetch('/api/chapters').then(async (r) => {
      if (r.ok) setChapters(((await r.json()) as Chapter[]) ?? [])
    }).catch(() => {})
  }, [])

  const edge = Math.max(liveEdgeRef.current, 1)
  const viewTick = mode.live ? edge : mode.tick
  const frac = Math.min(1, viewTick / edge)

  const scrubTo = (tick: number): void => {
    const t = Math.max(0, Math.min(edge, Math.round(tick)))
    handle?.scrub(t)
    onView(t)
  }
  const goLive = (): void => {
    handle?.goLive()
    onView(null)
  }

  const pick = (clientX: number): void => {
    const el = trackRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    scrubTo(((clientX - r.left) / r.width) * edge)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    const step =
      e.key === 'ArrowLeft' ? -KEY_STEP_TICKS
      : e.key === 'ArrowRight' ? KEY_STEP_TICKS
      : e.key === 'PageDown' ? -KEY_PAGE_TICKS
      : e.key === 'PageUp' ? KEY_PAGE_TICKS
      : null
    if (step !== null) {
      e.preventDefault()
      scrubTo(viewTick + step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      scrubTo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      goLive()
    }
  }

  const days = Math.floor(edge / MINUTES_PER_DAY)
  const gridDays = Array.from({ length: days + 1 }, (_, d) => d)
  const deaths = events.filter((ev) => ev.type === 'agent_died')
  const completions = events.filter((ev) => ev.type === 'structure_completed')
  const m = tickToMoment(viewTick)

  return (
    <div className="timeline" role="group" aria-label="Town timeline">
      <div
        ref={trackRef}
        className="timeline-track"
        role="slider"
        tabIndex={0}
        aria-label="Moment in the town's history"
        aria-valuemin={0}
        aria-valuemax={edge}
        aria-valuenow={viewTick}
        aria-valuetext={`Day ${m.day} ${m.time}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          pick(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pick(e.clientX)
        }}
      >
        {gridDays.map((d) => (
          <span key={d} className="timeline-day" style={{ left: `${(d * MINUTES_PER_DAY * 100) / edge}%` }}>
            <em>Day {d}</em>
          </span>
        ))}
        {deaths.map((ev, i) => (
          <span key={`d${i}`} className="mark death" style={{ left: `${(ev.tick * 100) / edge}%` }} title="A death" />
        ))}
        {completions.map((ev, i) => (
          <span key={`c${i}`} className="mark done" style={{ left: `${(ev.tick * 100) / edge}%` }} title="A building finished" />
        ))}
        {chapters.map((c, i) => (
          <span key={`ch${i}`} className="mark chapter" style={{ left: `${(c.tick * 100) / edge}%` }} title={c.title} />
        ))}
        <span className="playhead" style={{ left: `${frac * 100}%` }} />
      </div>
      <button className={mode.live ? 'live-pill live' : 'live-pill'} onClick={goLive} aria-pressed={mode.live}>
        {mode.live ? 'LIVE' : 'Return to now'}
      </button>
    </div>
  )
}
