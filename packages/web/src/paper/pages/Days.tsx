import { useMemo, useRef, useSyncExternalStore } from 'react'
import { MINUTES_PER_DAY, tickToMoment } from '@sj/shared'
import {
  MARK_GLYPH,
  MARK_GLYPH_PX,
  MARK_GLYPH_SCALE,
  EMPTY_SOURCES,
  MARKS_POLL_MS,
  MARKS_URL,
  coalesceMarks,
  gridDays,
  markLeft,
  markSources,
  markWindow,
  marksFrom,
  tipSide,
  type Mark,
  type MarkSources,
} from '../../ui/timelineMarks.js'
import { milestonesFeed } from '../../ui/feeds.js'
import { pointPlay } from '../../ui/replayRun.js'
import { useFeed, usePolled } from '../../ui/useEndpoint.js'
import { useFrameCoalesced } from '../../ui/onFrame.js'
import type { PageProps } from './types.js'

const KEY_STEP_TICKS = 10
const KEY_PAGE_TICKS = MINUTES_PER_DAY

const NO_FIRSTS: MarkSources['milestones'] = []

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

function DayStripView({
  edge,
  viewTick,
  marks,
  marksDown,
  onScrub,
  onMark,
  onLive,
}: {
  edge: number
  viewTick: number
  marks: readonly Mark[]
  marksDown: boolean
  onScrub: (tick: number) => void
  onMark: (mark: Mark) => void
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
  // A drag commits once a frame: every sample went to the route, and the route re-renders the
  // stage, the sky and forty figures with it.
  const drag = useFrameCoalesced(pick)

  const onKey = (e: React.KeyboardEvent): void => {
    const step =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? -KEY_STEP_TICKS
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
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

  return (
    <div className="day-strip" role="group" aria-label="The days the town has lived">
      <p className="sheet-note">
        Drag the strip to hold a minute still, or pick a mark to watch it. The stamp reads REPLAY
        until you come back to now.
      </p>
      {/* The strip scrubs without its marks, so this is a note beside a working control rather
          than a page-wide refusal — but a bare strip must not read as a town with no days. */}
      {marksDown && (
        <p className="sheet-note" role="status">
          The marks along the strip could not be read. Scrubbing still works.
        </p>
      )}
      <div className="day-marks">
        {marks.map((mk) => {
          const at = tickToMoment(mk.tick)
          return (
            <button
              key={`${mk.kind}-${mk.tick}`}
              type="button"
              className="mark"
              data-kind={mk.kind}
              style={{ left: markLeft(mk.tick, span) }}
              aria-label={`Day ${at.day} ${at.time}. ${mk.words}. Watch this moment.`}
              onClick={() => {
                onMark(mk)
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
          e.currentTarget.setPointerCapture(e.pointerId)
          pick(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) drag(e.clientX)
        }}
      >
        {gridDays(span).map((d) => (
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
    </div>
  )
}

export function Days({ store, onScrub, onPlay, onLive }: PageProps) {
  const liveEdge = useSyncExternalStore(store.subscribe, store.liveEdge, store.liveEdge)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  // The strip still scrubs without its marks, so a missing answer is EMPTY_SOURCES.
  const marksRead = usePolled(MARKS_URL, markSources, MARKS_POLL_MS)
  const sources = marksRead.data ?? EMPTY_SOURCES
  const firsts = useFeed(milestonesFeed).data ?? NO_FIRSTS

  const edge = Math.max(liveEdge, 1)
  const viewTick = mode.live ? edge : mode.tick
  // The live edge moves every tick and the fold only reads it through `markWindow`, so that is
  // the key: the marks are re-folded when the track's own spacing changes, not once a minute.
  const gap = markWindow(edge)
  const marks = useMemo(
    () => coalesceMarks(marksFrom({ ...sources, milestones: firsts }), gap),
    [sources, firsts, gap],
  )

  return (
    <DayStripView
      edge={edge}
      viewTick={viewTick}
      marks={marks}
      marksDown={marksRead.failed && marksRead.data === null}
      onScrub={(tick) => {
        onScrub(Math.max(0, Math.min(edge, Math.round(tick))))
      }}
      onMark={(mk) => {
        onPlay(pointPlay(mk.tick, edge, mk.words))
      }}
      onLive={onLive}
    />
  )
}
