import { useRef, useSyncExternalStore } from 'react'
import type { ObservatoryHandle } from '../net/socket.js'
import type { WorldStore } from '../state/worldStore.js'
import { momentStamp } from '../paper/stamp.js'
import type { MomentPlay } from '../ui/replayRun.js'

const GLYPH_PX = 8
const CREAM = '#FFF6E9'

// Drawn, not typed: ▶ and ❙❙ are pictographic characters whose shape belongs to the reader's
// font. The town draws its own controls, in its own pixels.
const PLAY_PIXELS: readonly (readonly [number, number])[] = [
  [2, 0],
  [2, 1],
  [3, 1],
  [2, 2],
  [3, 2],
  [4, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
  [2, 4],
  [3, 4],
  [4, 4],
  [5, 4],
  [2, 5],
  [3, 5],
  [4, 5],
  [2, 6],
  [3, 6],
  [2, 7],
]
const PAUSE_PIXELS: readonly (readonly [number, number])[] = [1, 2, 5, 6].flatMap((x) =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((y) => [x, y] as const),
)

function TransportGlyph({ playing }: { playing: boolean }) {
  return (
    <svg
      className="player-glyph"
      viewBox={`0 0 ${GLYPH_PX} ${GLYPH_PX}`}
      width={GLYPH_PX * 2}
      height={GLYPH_PX * 2}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {(playing ? PAUSE_PIXELS : PLAY_PIXELS).map(([x, y]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={CREAM} />
      ))}
    </svg>
  )
}

/** Where the playhead sits inside the moment, 0 to 1. */
export function playhead(tick: number, play: MomentPlay): number {
  const span = Math.max(1, play.until - play.from)
  return Math.min(1, Math.max(0, (tick - play.from) / span))
}

/** The tick a fraction of the way along the moment's own span, never past either end. */
export function seekTick(frac: number, play: MomentPlay): number {
  const span = play.until - play.from
  return Math.round(play.from + Math.min(1, Math.max(0, frac)) * span)
}

/** One minute of the moment, for the arrow keys. */
const KEY_STEP = 1

/** The town's own transport, in the town: no bar, no dock, no rail across the frame. Pause is
 *  `scrub(tick)` and resume is `replay(tick)` — the socket already speaks both, so a strip that
 *  runs a moment costs the protocol nothing.
 *
 *  There is no speed control. `bubbleLife` is 3500 ms + 55/char and the leg timing is tuned to
 *  the live cadence: above 2x a replayed conversation is unreadable, and 2x alone is not worth
 *  a control. */
export function Transport({
  store,
  play,
  handle,
  onLive,
  onAt,
}: {
  store: WorldStore
  play: MomentPlay | null
  handle: ObservatoryHandle | null
  onLive: () => void
  onAt: (tick: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  if (play === null || mode.live) return null

  const tick = mode.tick
  const playing = mode.replaying
  const frac = playhead(tick, play)

  const goTo = (next: number): void => {
    handle?.scrub(next)
    onAt(next)
  }
  const pick = (clientX: number): void => {
    const el = trackRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    goTo(seekTick((clientX - r.left) / r.width, play))
  }
  const onKey = (e: React.KeyboardEvent): void => {
    const next =
      e.key === 'ArrowLeft'
        ? tick - KEY_STEP
        : e.key === 'ArrowRight'
          ? tick + KEY_STEP
          : e.key === 'Home'
            ? play.from
            : e.key === 'End'
              ? play.until
              : null
    if (next === null) return
    e.preventDefault()
    goTo(Math.min(play.until, Math.max(play.from, next)))
  }

  return (
    <div className="transport" role="group" aria-label="Playing a moment from the town’s past">
      <button
        type="button"
        className="player-btn"
        aria-pressed={playing}
        aria-label={playing ? 'Pause this moment' : 'Play this moment'}
        onClick={() => {
          // A moment paused at its own end has nowhere to run: play it again from the top.
          if (playing) handle?.scrub(tick)
          else handle?.replay(tick >= play.until ? play.from : tick)
        }}
      >
        <TransportGlyph playing={playing} />
      </button>
      <div
        ref={trackRef}
        className="player-track"
        role="slider"
        tabIndex={0}
        aria-label="Minute of this moment"
        aria-valuemin={play.from}
        aria-valuemax={play.until}
        aria-valuenow={tick}
        aria-valuetext={momentStamp(tick)}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          pick(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) pick(e.clientX)
        }}
      >
        <span className="player-head" style={{ left: `${frac * 100}%` }} />
      </div>
      <span className="player-clock">{momentStamp(tick)}</span>
      <button type="button" className="player-btn live" onClick={onLive}>
        Return to now
      </button>
    </div>
  )
}
