import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { MomentSchema, type Moment } from '@sj/shared'
import type { PeopleIndex } from '../../ui/bondModel2.js'
import { thumbLabel, thumbMotif, thumbTitle } from '../../ui/momentThumb.js'
import {
  idlePlayer,
  nextPlaySpeed,
  pausePlayer,
  playPlayer,
  seekPlayer,
  tickPlayer,
  type PlayerState,
} from '../../ui/momentsPlayer.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { OutOfReach } from '../../ui/OutOfReach.js'
import { momentStamp } from '../stamp.js'
import type { PageProps } from './types.js'

/** Row by row on purpose: the schema wants a title of at least one character, and one untitled
 *  scene parsed as a whole array took the entire filmstrip with it. */
export const momentRows = (body: unknown): Moment[] | null => {
  const rows = (body as { moments?: unknown } | null)?.moments
  if (!Array.isArray(rows)) return null
  return rows.flatMap((row) => {
    const parsed = MomentSchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}

const MOTIF_PX = 8
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
      viewBox={`0 0 ${MOTIF_PX} ${MOTIF_PX}`}
      width={MOTIF_PX * 2}
      height={MOTIF_PX * 2}
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

function Motif({ moment }: { moment: Moment }) {
  return (
    <svg
      className="thumb-motif"
      viewBox={`0 0 ${MOTIF_PX} ${MOTIF_PX}`}
      width={MOTIF_PX * 3}
      height={MOTIF_PX * 3}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {thumbMotif(moment).pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

const MomentCardView = memo(function MomentCardView({
  moment,
  people,
  open,
  onOpen,
}: {
  moment: Moment
  people: PeopleIndex
  open: boolean
  onOpen: (id: number) => void
}) {
  const label = thumbLabel(moment, people)
  const where = label.location ?? 'somewhere in the town'
  return (
    <li>
      <button
        type="button"
        className={open ? 'moment-card open' : 'moment-card'}
        aria-current={open ? 'true' : undefined}
        aria-label={`${thumbTitle(moment)}. Day ${label.day}, ${label.cast}, ${where}. Play this day.`}
        onClick={() => {
          onOpen(moment.id)
        }}
      >
        <Motif moment={moment} />
        <span className="thumb-body">
          <span className="thumb-day">Day {label.day}</span>
          <span className="thumb-title">{thumbTitle(moment)}</span>
          <span className="thumb-meta">
            <span className="thumb-cast">{label.cast}</span>
            {label.location !== null && <span className="thumb-where">{label.location}</span>}
          </span>
        </span>
      </button>
    </li>
  )
})

function PlayerStripView({
  moment,
  player,
  onToggle,
  onSeek,
  onSpeed,
  onLive,
}: {
  moment: Moment
  player: PlayerState
  onToggle: () => void
  onSeek: (frac: number) => void
  onSpeed: () => void
  onLive: () => void
}) {
  const span = Math.max(1, moment.endTick - moment.startTick)
  const frac = Math.min(1, Math.max(0, (player.tick - moment.startTick) / span))
  const trackRef = useRef<HTMLDivElement>(null)
  const playing = player.status === 'playing'

  const pick = (clientX: number): void => {
    const el = trackRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    onSeek((clientX - r.left) / r.width)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    const step =
      e.key === 'ArrowLeft'
        ? -1 / span
        : e.key === 'ArrowRight'
          ? 1 / span
          : e.key === 'Home'
            ? -1
            : e.key === 'End'
              ? 1
              : null
    if (step === null) return
    e.preventDefault()
    onSeek(Math.abs(step) === 1 ? (step + 1) / 2 : frac + step)
  }

  return (
    <div className="moment-player" role="group" aria-label={`Playing ${thumbTitle(moment)}`}>
      <button
        type="button"
        className="player-btn"
        aria-pressed={playing}
        aria-label={playing ? 'Pause this day' : 'Play this day'}
        onClick={onToggle}
      >
        <TransportGlyph playing={playing} />
      </button>
      <div
        ref={trackRef}
        className="player-track"
        role="slider"
        tabIndex={0}
        aria-label="Moment in this day"
        aria-valuemin={moment.startTick}
        aria-valuemax={moment.endTick}
        aria-valuenow={player.tick}
        aria-valuetext={momentStamp(player.tick)}
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
      <span className="player-clock">{momentStamp(player.tick)}</span>
      <button
        type="button"
        className="player-btn speed"
        aria-label={`Speed ${player.speed} times. Change speed.`}
        onClick={onSpeed}
      >
        {player.speed}×
      </button>
      <button type="button" className="player-btn live" onClick={onLive}>
        LIVE
      </button>
    </div>
  )
}

export function Moments({ store, momentId, onJump, onLive, onMoment }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  // The town is still watchable without its record, so a refused read stays `null`.
  const record = useEndpointFor('/api/moments', momentRows)
  const read = useFeed(record)
  const moments = read.data
  // `/moment/:id` names a recorded day, so a link opens the filmstrip on it.
  const [openId, setOpenId] = useState<number | null>(momentId)
  const openMoment = (id: number | null): void => {
    setOpenId(id)
    onMoment(id)
  }
  // The player belongs to the day it plays: opening another one is a new player, never this
  // one carried across, so nothing has to be reset after the fact.
  const [playerOf, setPlayerOf] = useState<{ id: number | null; state: PlayerState }>(() => ({
    id: null,
    state: idlePlayer(0),
  }))

  const people: PeopleIndex = useMemo(() => {
    const out: Record<string, { name: string; alive: boolean }> = {}
    for (const a of Object.values(state?.agents ?? {})) out[a.id] = { name: a.name, alive: a.alive }
    return out
  }, [state])

  const open = moments?.find((m) => m.id === openId) ?? null
  const liveId = open?.id ?? null
  const playerFor = (p: { id: number | null; state: PlayerState }): PlayerState =>
    p.id === liveId ? p.state : idlePlayer(open?.startTick ?? 0)
  const player = playerFor(playerOf)
  const setPlayer = (step: (prev: PlayerState) => PlayerState): void => {
    setPlayerOf((prev) => ({ id: liveId, state: step(playerFor(prev)) }))
  }

  useEffect(() => {
    if (open === null) return
    onJump(open.startTick)
  }, [open, onJump])

  // Scrubs go out only when the tick actually changes, so 60 frames a second do not become 60
  // socket messages.
  const scrubbedRef = useRef<number | null>(null)
  const runningRef = useRef<PlayerState>(player)
  useEffect(() => {
    if (open === null || player.status !== 'playing') return
    // the run starts from what React last committed; the fraction of a tick lives here after
    runningRef.current = player
    let raf = 0
    let last = performance.now()
    const frame = (now: number): void => {
      const dt = now - last
      last = now
      const next = tickPlayer(runningRef.current, dt, open.startTick, open.endTick)
      const was = runningRef.current
      runningRef.current = next
      if (next.tick !== was.tick || next.status !== was.status) {
        if (next.tick !== scrubbedRef.current) {
          scrubbedRef.current = next.tick
          onJump(next.tick)
        }
        setPlayer(() => next)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [open, player.status, onJump])

  const seek = (frac: number): void => {
    if (open === null) return
    setPlayer((prev) => {
      const next = seekPlayer(prev, frac, open.startTick, open.endTick)
      scrubbedRef.current = next.tick
      runningRef.current = next
      onJump(next.tick)
      return next
    })
  }

  const goLive = (): void => {
    scrubbedRef.current = null
    setPlayerOf({ id: null, state: idlePlayer(0) })
    openMoment(null)
    onLive()
  }

  return (
    <>
      {read.failed && moments === null ? (
        <OutOfReach onRetry={record.retry} />
      ) : moments !== null && moments.length === 0 ? (
        <p className="feed-empty">{EMPTY_COPY.moments}</p>
      ) : (
        <ol className="strip-list" aria-label="The days the town kept">
          {(moments ?? []).map((m) => (
            <MomentCardView
              key={m.id}
              moment={m}
              people={people}
              open={m.id === openId}
              onOpen={openMoment}
            />
          ))}
        </ol>
      )}
      {open !== null && (
        <PlayerStripView
          moment={open}
          player={player}
          onToggle={() => {
            setPlayer((prev) =>
              prev.status === 'playing'
                ? pausePlayer(prev)
                : playPlayer(prev, open.startTick, open.endTick),
            )
          }}
          onSeek={seek}
          onSpeed={() => {
            setPlayer((prev) => ({ ...prev, speed: nextPlaySpeed(prev.speed) }))
          }}
          onLive={goLive}
        />
      )}
    </>
  )
}
