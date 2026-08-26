import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { MomentsResponseSchema, tickToMoment, type Moment } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from '../render/scene.js'
import type { ObservatoryHandle } from '../net/socket.js'
import type { PeopleIndex } from './bondsModel.js'
import { DirectorMode } from './DirectorMode.js'
import { stripLayout } from './frame.js'
import { thumbLabel, thumbMotif, thumbTitle } from './momentThumb.js'
import {
  idlePlayer,
  nextPlaySpeed,
  pausePlayer,
  playPlayer,
  seekPlayer,
  tickPlayer,
  type PlayerState,
} from './momentsPlayer.js'
import { EMPTY_COPY } from './townStats.js'

const MOTIF_PX = 8

const clock = (tick: number): string => {
  const m = tickToMoment(tick)
  return `Day ${m.day} ${m.time}`
}

// Drawn, not typed: ▶ and ❙❙ are pictographic characters whose shape belongs to the reader's
// font. The town draws its own controls, in its own pixels.
const CREAM = '#FFF6E9'
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
const PAUSE_PIXELS: readonly (readonly [number, number])[] = [
  [1, 0],
  [2, 0],
  [5, 0],
  [6, 0],
  [1, 1],
  [2, 1],
  [5, 1],
  [6, 1],
  [1, 2],
  [2, 2],
  [5, 2],
  [6, 2],
  [1, 3],
  [2, 3],
  [5, 3],
  [6, 3],
  [1, 4],
  [2, 4],
  [5, 4],
  [6, 4],
  [1, 5],
  [2, 5],
  [5, 5],
  [6, 5],
  [1, 6],
  [2, 6],
  [5, 6],
  [6, 6],
  [1, 7],
  [2, 7],
  [5, 7],
  [6, 7],
]

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
  const motif = thumbMotif(moment)
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
      {motif.pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

export function MomentCardView({
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
          {/* one line inside a filmstrip card: the whole postcard is still in the aria-label */}
          <span className="thumb-meta">
            <span className="thumb-cast">{label.cast}</span>
            {label.location !== null && <span className="thumb-where">{label.location}</span>}
          </span>
        </span>
      </button>
    </li>
  )
}

/** The bottom band of the three-box stage frame (`frame.ts`). Pure by construction: the scroll
 *  offset comes from `stripLayout`, so where the strip has got to is a number a test can read. */
export function MomentsFrameView({
  moments,
  people,
  momentId,
  letterboxed,
  leaving,
  bandW,
  onOpen,
  children,
}: {
  moments: Moment[] | null
  people: PeopleIndex
  momentId: number | null
  letterboxed: boolean
  leaving: boolean
  bandW: number
  onOpen: (id: number) => void
  children?: ReactNode
}) {
  const days = moments ?? []
  const { scrollX } = stripLayout(
    days.length,
    days.findIndex((m) => m.id === momentId),
    bandW,
  )

  // The strip scrolls NATIVELY — which is how focus gets carried into view for free — and
  // `stripLayout` drives that scroll rather than replacing it, so opening a day still centres it.
  const stripRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (stripRef.current !== null) stripRef.current.scrollLeft = scrollX
  }, [scrollX])

  return (
    <div className="moments-lens" data-letterboxed={letterboxed ? 'true' : 'false'}>
      {letterboxed && <div className={leaving ? 'letterbox top leaving' : 'letterbox top'} />}
      <div className="film-strip" role="group" aria-label="The days the town kept">
        {moments !== null && days.length === 0 ? (
          <p className="feed-empty">{EMPTY_COPY.moments}</p>
        ) : (
          <ol ref={stripRef} className="strip-list" data-scroll-x={scrollX}>
            {days.map((m) => (
              <MomentCardView
                key={m.id}
                moment={m}
                people={people}
                open={m.id === momentId}
                onOpen={onOpen}
              />
            ))}
          </ol>
        )}
      </div>
      {children}
    </div>
  )
}

export function PlayerStripView({
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
        aria-valuetext={clock(player.tick)}
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
      <span className="player-clock">{clock(player.tick)}</span>
      <button
        className="player-btn speed"
        aria-label={`Speed ${player.speed} times. Change speed.`}
        onClick={onSpeed}
      >
        {player.speed}×
      </button>
      <button className="player-btn live" onClick={onLive}>
        LIVE
      </button>
    </div>
  )
}

export function MomentsLens({
  store,
  handle,
  scene,
  momentId,
  televised,
  leaving,
  onOpen,
}: {
  store: WorldStore
  handle: ObservatoryHandle | null
  scene: Scene | null
  momentId: number | null
  /** the live town, auto-cut by heat — as opposed to a recorded day playing back */
  televised: boolean
  /** held mounted for one beat while the bands slide out */
  leaving: boolean
  onOpen: (id: number | null) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [moments, setMoments] = useState<Moment[] | null>(null)
  // The player belongs to the day it plays: opening another one is a new player, never this
  // one carried across, so nothing has to be reset after the fact.
  const [playerOf, setPlayerOf] = useState<{ id: number | null; state: PlayerState }>(() => ({
    id: null,
    state: idlePlayer(0),
  }))
  const rootRef = useRef<HTMLDivElement>(null)
  const [bandW, setBandW] = useState(0)

  useEffect(() => {
    let alive = true
    void fetch('/api/moments')
      .then(async (r) => (r.ok ? MomentsResponseSchema.safeParse(await r.json()) : null))
      .then((parsed) => {
        if (alive && parsed?.success === true) setMoments(parsed.data.moments)
      })
      .catch(() => {
        /* the town is still watchable without its record */
      })
    return () => {
      alive = false
    }
  }, [])

  // ResizeObserver rather than a window listener: the stage narrows when a side panel opens
  // without the window changing at all.
  useEffect(() => {
    const el = rootRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      setBandW(entry?.contentRect.width ?? 0)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [])

  const people: PeopleIndex = useMemo(() => {
    const out: Record<string, { name: string; alive: boolean }> = {}
    for (const a of Object.values(state?.agents ?? {})) out[a.id] = { name: a.name, alive: a.alive }
    return out
  }, [state])

  const open = moments?.find((m) => m.id === momentId) ?? null
  const openId = open?.id ?? null
  const playerFor = (p: { id: number | null; state: PlayerState }): PlayerState =>
    p.id === openId ? p.state : idlePlayer(open?.startTick ?? 0)
  const player = playerFor(playerOf)
  const setPlayer = (step: (prev: PlayerState) => PlayerState): void => {
    setPlayerOf((prev) => ({ id: openId, state: step(playerFor(prev)) }))
  }

  // Opening a day parks the view at its first minute; a cold /moment/<id> load lands here too,
  // as soon as the list arrives.
  useEffect(() => {
    if (open === null) return
    handle?.scrub(open.startTick)
  }, [open, handle])

  // Scrubs go out only when the tick actually changes, so 60 frames a second do not become 60
  // socket messages.
  const scrubbedRef = useRef<number | null>(null)
  useEffect(() => {
    if (open === null || player.status !== 'playing') return
    let raf = 0
    let last = performance.now()
    const frame = (now: number): void => {
      const dt = now - last
      last = now
      setPlayer((prev) => {
        const next = tickPlayer(prev, dt, open.startTick, open.endTick)
        if (next.tick !== scrubbedRef.current) {
          scrubbedRef.current = next.tick
          handle?.scrub(next.tick)
        }
        return next
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [open, player.status, handle])

  const seek = (frac: number): void => {
    if (open === null) return
    setPlayer((prev) => {
      const next = seekPlayer(prev, frac, open.startTick, open.endTick)
      scrubbedRef.current = next.tick
      handle?.scrub(next.tick)
      return next
    })
  }

  const goLive = (): void => {
    scrubbedRef.current = null
    setPlayerOf({ id: null, state: idlePlayer(0) })
    handle?.goLive()
    onOpen(null)
  }

  // The auto-cut runs only while the town is being televised, so it cannot fight a recorded
  // day's playback.
  const letterboxed = momentId !== null || televised

  return (
    <div ref={rootRef} className="moments-frame">
      <MomentsFrameView
        moments={moments}
        people={people}
        momentId={momentId}
        letterboxed={letterboxed}
        leaving={leaving}
        bandW={bandW}
        onOpen={onOpen}
      >
        <DirectorMode store={store} scene={scene} autoCut={televised} leaving={leaving} />
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
      </MomentsFrameView>
    </div>
  )
}
