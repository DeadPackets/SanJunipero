import { useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { MINUTES_PER_DAY, dayPhaseFromTick } from '@sj/shared'
import type { ObservatoryHandle } from '../net/socket.js'
import type { WorldStore } from '../state/worldStore.js'
import { stamp } from '../paper/stamp.js'
import { tickBadgeState, type BadgeState, type LinkState } from '../ui/broadcastReady.js'
import { townAsleep } from '../ui/directorCut.js'
import { WEATHER_GLYPH } from '../ui/townStats.js'
import { skyKind, skyWord } from '../ui/skyModel.js'
import { useFrameCoalesced } from '../ui/onFrame.js'
import { endpoint, useFeed, usePolled } from '../ui/useEndpoint.js'
import { milestonesFeed } from '../ui/feeds.js'
import {
  EMPTY_SOURCES,
  MARKS_POLL_MS,
  MARKS_URL,
  markSources,
  marksFrom,
  type Mark,
  type MarkSources,
} from '../ui/timelineMarks.js'
import { GameIcon } from '../paper/game/shared.js'
import { localStore, pref } from '../ui/storage.js'
import { AlmanacMoments } from './AlmanacMoments.js'
import { CameraChip } from './CameraChip.js'
import { PixelGlyph } from './PixelGlyph.js'

export type StampWord = 'LIVE' | 'REPLAY' | 'OFFLINE' | 'PAUSED'

/** A clock nobody can know is stale reads OFFLINE rather than a time. */
const STAMP_OF: Readonly<Record<BadgeState, StampWord>> = {
  live: 'LIVE',
  past: 'REPLAY',
  stale: 'OFFLINE',
  waking: 'OFFLINE',
}

export function stampWord(
  live: boolean,
  awake: boolean,
  link: LinkState,
  paused = false,
): StampWord {
  const word = STAMP_OF[tickBadgeState(link, live, awake)]
  // Only over LIVE: a stopped clock behind a scrub or a dropped socket is the lesser fact.
  return paused && word === 'LIVE' ? 'PAUSED' : word
}

/** The day's shape so far, as the gateway marks it: I from the first scene, II once the day has
 *  had its hottest one, III from dusk. Null before the day has anything to be an act of. */
export type ActMark = 'I' | 'II' | 'III'

/** What the town is doing when nobody in it is doing anything. Nothing wakes a body at an hour,
 *  so there is no hour to name here. Null while anybody is up, which is a town worth watching. */
export function sleepField(
  agents: Readonly<Record<string, { alive: boolean; asleep: boolean }>> | undefined,
): string | null {
  return townAsleep(agents) ? 'ASLEEP' : null
}

/** ★ Pause is a scrub and resume is a replay: the socket already speaks both, so the one
 *  control that runs a day costs the protocol nothing. */
export function playPause(
  handle: ObservatoryHandle | null,
  replaying: boolean,
  tick: number,
): void {
  if (replaying) handle?.scrub(tick)
  else handle?.replay(tick)
}

/** The first minute of the day a tick falls in. */
export function dayStart(tick: number): number {
  return Math.floor(Math.max(0, tick) / MINUTES_PER_DAY) * MINUTES_PER_DAY
}

/** Where in its own day a minute sits, 0 at midnight and 1 at the next one. */
export function dayFrac(tick: number): number {
  return (Math.max(0, tick) - dayStart(tick)) / MINUTES_PER_DAY
}

/** The minute a hand at `frac` along the day is asking for. Never past the live edge: the town
 *  has not reached the rest of the day, so the track may not offer it. */
export function trackTick(frac: number, tick: number, edge: number): number {
  const at = dayStart(tick) + Math.round(Math.min(1, Math.max(0, frac)) * (MINUTES_PER_DAY - 1))
  return Math.max(0, Math.min(at, edge))
}

/** The minute a hand at `frac` is asking for, or null when it is the minute already on screen:
 *  a scrub to where a live viewer already stands takes them out of live and gives back nothing. */
export function pickTick(frac: number, tick: number, edge: number): number | null {
  const next = trackTick(frac, tick, edge)
  return next === tick ? null : next
}

/** Where the part of the day the world has not reached begins, or null once it has lived the
 *  whole of it. The track draws 24 hours and the town has only been through some of them. */
export function deadFrom(from: number, edge: number): number | null {
  const lived = (edge - from) / MINUTES_PER_DAY
  return lived >= 1 ? null : Math.max(0, lived)
}

/** The marks of one day, where they fall along it. A mark its source dated only to a DAY has no
 *  minute to stand at here, so this track drops it rather than draw it at midnight. */
export function marksOfDay(marks: readonly Mark[], tick: number): Mark[] {
  const from = dayStart(tick)
  return marks.filter(
    (m) => m.dayOnly !== true && m.tick >= from && m.tick < from + MINUTES_PER_DAY,
  )
}

/** Along the day, as a percentage the sheet clamps: a mark at either end stays whole. */
const at = (frac: number): CSSProperties =>
  ({ '--at': `${(Math.min(1, Math.max(0, frac)) * 100).toFixed(3)}%` }) as CSSProperties

const almanacTheme = pref('sj.almanacTheme', ['light', 'dark'] as const, 'light')

const NO_FIRSTS: MarkSources['milestones'] = []
/** A stream frame has no track to draw a mark on, so it reads neither list. A reader with no
 *  url fetches nothing and times nothing, which is what a frame that runs for days is owed. */
const NO_MILESTONES: typeof milestonesFeed = endpoint(null)
/** One minute of the day, for the arrow keys. */
const KEY_STEP = 1

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

/** ★ THE ONE BAR THAT SAYS WHEN. One band owns the town's clock and its track IS the scrub, so
 *  there is one of each where five boxes and four formatters used to print the same minute. */
export function DayBar({
  store,
  link,
  handle,
  onAt,
  onWatch,
  onLive,
  autoCut,
  handbackAt,
  broadcast = false,
}: {
  store: WorldStore
  link: LinkState
  handle: ObservatoryHandle | null
  onAt: (tick: number) => void
  onWatch: (tick: number) => void
  onLive: () => void
  autoCut: boolean
  handbackAt: () => number | null
  broadcast?: boolean
}) {
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const edge = useSyncExternalStore(store.subscribe, store.liveEdge, store.liveEdge)
  const paused = useSyncExternalStore(store.subscribe, store.getPaused, store.getPaused)
  // Primitives, never the folded state object: `state.weather` is a fresh object every tick and
  // would re-render this mark sixty times for a sky that has not changed.
  const readKind = (): string => skyKind(store.getState())
  const readWeather = (): string => skyWord(store.getState())
  const readAsleep = (): string | null => sleepField(store.getState()?.agents)
  const isAwake = (): boolean => store.getState() !== null
  const kind = useSyncExternalStore(store.subscribe, readKind, readKind)
  const weather = useSyncExternalStore(store.subscribe, readWeather, readWeather)
  const asleep = useSyncExternalStore(store.subscribe, readAsleep, readAsleep)
  const awake = useSyncExternalStore(store.subscribe, isAwake, isAwake)

  // The strip still scrubs without its marks, so a missing answer is EMPTY_SOURCES.
  const sources =
    usePolled(broadcast ? null : MARKS_URL, markSources, MARKS_POLL_MS).data ?? EMPTY_SOURCES
  const firsts = useFeed(broadcast ? NO_MILESTONES : milestonesFeed).data ?? NO_FIRSTS
  const from = dayStart(tick)
  const marks = useMemo(
    () =>
      marksOfDay(marksFrom({ ...sources, milestones: firsts }), from).filter((m) => m.tick <= edge),
    [sources, firsts, from, edge],
  )
  const [theme, setTheme] = useState(() => almanacTheme.read(localStore()))
  const running = mode.live || mode.replaying
  const phase = dayPhaseFromTick(tick)

  const word = stampWord(mode.live, awake, link, paused)
  const dead = deadFrom(from, edge)
  const when = stamp(tick)
  const frac = dayFrac(tick)
  const track = useRef<HTMLDivElement>(null)

  const goTo = (next: number): void => {
    onAt(next)
  }
  const pick = (clientX: number): void => {
    const el = track.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    const next = pickTick((clientX - r.left) / r.width, tick, edge)
    if (next !== null) goTo(next)
  }
  // A drag commits once a frame: every sample went through to the scrub, and that redraws the
  // stage and every figure on it.
  const drag = useFrameCoalesced(pick)
  const onKey = (e: React.KeyboardEvent): void => {
    const next =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? tick - KEY_STEP
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? tick + KEY_STEP
          : e.key === 'Home'
            ? from
            : e.key === 'End'
              ? Math.min(from + MINUTES_PER_DAY - 1, edge)
              : null
    if (next === null) return
    e.preventDefault()
    goTo(Math.max(from, Math.min(next, Math.min(from + MINUTES_PER_DAY - 1, edge))))
  }

  return (
    <div className="day-bar almanac" data-theme={theme}>
      <div className="almanac-date">
        <div className="almanac-day">
          <span>DAY</span>
          <b>{when.day}</b>
        </div>
        <div>
          <p className="almanac-season">
            <GameIcon kind="leaf" />
            {when.season.toLowerCase()}
          </p>
          <small>{when.weekday.toLowerCase()}</small>
        </div>
      </div>
      <div className="almanac-center">
        {phase === 'night' ? (
          <GameIcon kind="moon" />
        ) : (
          <i className="almanac-sun" aria-hidden="true" />
        )}
        <div className="almanac-clock">
          <strong>{awake ? when.time : '—'}</strong>
          <span>
            {asleep
              ? 'Town asleep'
              : phase === 'day'
                ? dayFrac(tick) < 0.5
                  ? 'Morning'
                  : 'Afternoon'
                : phase}
          </span>
        </div>
      </div>
      <div className="almanac-weather">
        <PixelGlyph
          className="almanac-sky"
          pixels={(WEATHER_GLYPH[kind] ?? WEATHER_GLYPH['—']!).pixels}
        />
        <div>
          <p>{weather.toLowerCase()}</p>
          <CameraChip autoCut={autoCut} handbackAt={handbackAt} />
        </div>
        <span className="almanac-status" data-live={word === 'LIVE'}>
          {!mode.live && !mode.replaying && word === 'REPLAY' ? 'Paused' : word.toLowerCase()}
        </span>
      </div>
      {!broadcast && (
        <div className="almanac-timeline">
          <button
            type="button"
            className="almanac-control"
            disabled={!handle || !awake}
            aria-label={running ? 'Stop here' : 'Run this day forward'}
            onClick={() => (running ? goTo(tick) : onWatch(tick))}
          >
            <PixelGlyph
              className="almanac-play-glyph"
              pixels={running ? PAUSE_PIXELS : PLAY_PIXELS}
            />
          </button>
          <div className="almanac-rail">
            <AlmanacMoments key={from} marks={marks} onWatch={onWatch} />
            <div
              ref={track}
              className="almanac-track"
              role="slider"
              tabIndex={0}
              aria-label="Minute of this day"
              aria-valuemin={from}
              aria-valuemax={Math.max(from, Math.min(from + MINUTES_PER_DAY - 1, edge))}
              aria-valuenow={tick}
              aria-valuetext={when.time}
              onKeyDown={onKey}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                pick(e.clientX)
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) drag(e.clientX)
              }}
            >
              <span className="almanac-line">
                {dead !== null && <span className="almanac-future" style={at(dead)} />}
              </span>
              <span className="almanac-cursor" style={at(frac)} />
            </div>
            <div className="almanac-times" aria-hidden="true">
              <span>00:00</span>
              <span>06:00</span>
              <span>Noon</span>
              <span>18:00</span>
              <span>24:00</span>
            </div>
          </div>
          <button
            type="button"
            className="almanac-live"
            disabled={mode.live || !handle}
            onClick={onLive}
          >
            Go live
          </button>
          <button
            type="button"
            className="almanac-theme almanac-control"
            aria-label={theme === 'light' ? 'Use dark almanac' : 'Use light almanac'}
            title={theme === 'light' ? 'Use dark almanac' : 'Use light almanac'}
            onClick={() => {
              const next = theme === 'light' ? 'dark' : 'light'
              setTheme(next)
              almanacTheme.write(localStore(), next)
            }}
          >
            {theme === 'light' ? (
              <GameIcon kind="moon" />
            ) : (
              <i className="almanac-sun" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}
