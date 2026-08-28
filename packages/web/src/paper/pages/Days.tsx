import { useMemo, useRef, useSyncExternalStore } from 'react'
import { MINUTES_PER_DAY, tickToMoment } from '@sj/shared'
import {
  MARK_GLYPH,
  MARK_GLYPH_PX,
  MARK_GLYPH_SCALE,
  coalesceMarks,
  markLeft,
  marksFrom,
  tipSide,
  type Mark,
  type MarkSources,
} from '../../ui/timelineMarks.js'
import { usePolled } from '../../ui/useEndpoint.js'
import type { PageProps } from './index.js'

const KEY_STEP_TICKS = 10
const KEY_PAGE_TICKS = MINUTES_PER_DAY

/** The marks come from the record, in one request. Refreshed slowly, because a mark is a
 *  thing that already happened and re-folding it per frame would buy nothing. */
const MARKS_REFETCH_MS = 30_000

/** The firsts are `/api/milestones`' to serve; `/api/timeline/marks` carries the other five. */
type WireSources = Omit<MarkSources, 'milestones'>

const EMPTY_SOURCES: WireSources = {
  chapters: [],
  moments: [],
  changes: [],
  events: [],
  discoveries: [],
}

/** Every list is optional on the wire; a source the gateway has nothing for is an empty one. */
const markSources = (body: unknown): WireSources => {
  const b = body as Partial<WireSources>
  return {
    chapters: b.chapters ?? [],
    moments: b.moments ?? [],
    changes: b.changes ?? [],
    events: b.events ?? [],
    discoveries: b.discoveries ?? [],
  }
}

const NO_FIRSTS: MarkSources['milestones'] = []
const firstRows = (body: unknown): MarkSources['milestones'] | null =>
  Array.isArray(body) ? (body as MarkSources['milestones']) : null

function MarkGlyph({ mark }: { mark: Mark }) {
  return (
    <svg
      className="mark-glyph"
      viewBox={`0 0 ${MARK_GLYPH_PX} ${MARK_GLYPH_PX}`}
      width={MARK_GLYPH_PX * MARK_GLYPH_SCALE}
      height={MARK_GLYPH_PX * MARK_GLYPH_SCALE}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {MARK_GLYPH[mark.kind].map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

export function DayStripView({
  edge,
  viewTick,
  live,
  marks,
  onScrub,
  onLive,
}: {
  edge: number
  viewTick: number
  live: boolean
  marks: readonly Mark[]
  onScrub: (tick: number) => void
  onLive: () => void
}) {
  const span = Math.max(1, edge)
  const trackRef = useRef<HTMLDivElement>(null)
  const frac = Math.min(1, viewTick / span)
  const m = tickToMoment(viewTick)

  const pick = (clientX: number): void => {
    const el = trackRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    onScrub(((clientX - r.left) / r.width) * span)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    const step =
      e.key === 'ArrowLeft'
        ? -KEY_STEP_TICKS
        : e.key === 'ArrowRight'
          ? KEY_STEP_TICKS
          : e.key === 'PageDown'
            ? -KEY_PAGE_TICKS
            : e.key === 'PageUp'
              ? KEY_PAGE_TICKS
              : null
    if (step !== null) {
      e.preventDefault()
      onScrub(viewTick + step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      onScrub(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      onLive()
    }
  }

  const gridDays = Array.from({ length: Math.floor(span / MINUTES_PER_DAY) + 1 }, (_, d) => d)

  return (
    <div className="day-strip" role="group" aria-label="The days the town has lived">
      <p className="sheet-note">
        Drag the strip to replay a day. The stamp reads REPLAY until you come back to now.
      </p>
      <div className="day-marks">
        {marks.map((mk) => {
          const at = tickToMoment(mk.tick)
          return (
            <button
              key={`${mk.kind}-${mk.tick}`}
              type="button"
              className={`mark ${mk.kind}`}
              style={{ left: markLeft(mk.tick, span) }}
              aria-label={`Day ${at.day} ${at.time} — ${mk.words}. Go to this moment.`}
              onClick={() => {
                onScrub(mk.tick)
              }}
            >
              <MarkGlyph mark={mk} />
              <span className="mark-tip" data-side={tipSide(mk.tick, span)}>
                {mk.words}
              </span>
            </button>
          )
        })}
      </div>
      <div
        ref={trackRef}
        className="day-track"
        role="slider"
        tabIndex={0}
        aria-label="Moment in the town's history"
        aria-valuemin={0}
        aria-valuemax={edge}
        aria-valuenow={viewTick}
        aria-valuetext={`Day ${m.day} ${m.time}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          pick(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pick(e.clientX)
        }}
      >
        {gridDays.map((d) => (
          <span
            key={d}
            className="day-tick"
            style={{ left: `${(d * MINUTES_PER_DAY * 100) / span}%` }}
          >
            <em>Day {d}</em>
          </span>
        ))}
        <span className="playhead" style={{ left: `${frac * 100}%` }} />
      </div>
      <button className={live ? 'live-pill live' : 'live-pill'} onClick={onLive} aria-pressed={live}>
        {live ? 'LIVE' : 'Return to now'}
      </button>
    </div>
  )
}

export function Days({ store, handle, onView }: PageProps) {
  const liveEdge = useSyncExternalStore(store.subscribe, store.liveEdge)
  const mode = useSyncExternalStore(store.subscribe, store.getMode)
  // The strip still scrubs without its marks, so a missing answer is EMPTY_SOURCES.
  const sources =
    usePolled('/api/timeline/marks', markSources, MARKS_REFETCH_MS).data ?? EMPTY_SOURCES
  const firsts = usePolled('/api/milestones', firstRows, MARKS_REFETCH_MS).data ?? NO_FIRSTS

  const edge = Math.max(liveEdge, 1)
  const viewTick = mode.live ? edge : mode.tick
  const marks = useMemo(
    () => coalesceMarks(marksFrom({ ...sources, milestones: firsts }), edge),
    [sources, firsts, edge],
  )

  return (
    <DayStripView
      edge={edge}
      viewTick={viewTick}
      live={mode.live}
      marks={marks}
      onScrub={(tick) => {
        const t = Math.max(0, Math.min(edge, Math.round(tick)))
        handle?.scrub(t)
        onView(t)
      }}
      onLive={() => {
        handle?.goLive()
        onView(null)
      }}
    />
  )
}
