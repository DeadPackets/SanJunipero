import { useSyncExternalStore, type CSSProperties } from 'react'
import { simTimeFromTick, tickToMoment } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { tickBadgeState, type BadgeState, type LinkState } from '../ui/broadcastReady.js'
import { townAsleep } from '../ui/directorCut.js'
import { WEATHER_GLYPH } from '../ui/townStats.js'
import { ARC_BOX, ARC_PATH, arcPercent, skyKind, skyToken, skyWord } from '../ui/skyModel.js'
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

/** ONE read of the clock for both halves of the bar. Two formatters printed the day twice, 42px
 *  apart, and could disagree about which minute it was. */
export function townStamp(
  tick: number,
  word: StampWord,
  act: ActMark | null = null,
): { date: string; clock: string } {
  const m = tickToMoment(tick)
  const season = simTimeFromTick(tick).season.toUpperCase()
  return {
    date: act === null ? `DAY ${m.day} · ${season}` : `DAY ${m.day} · ${season} · ACT ${act}`,
    clock: `${m.time} · ${word}`,
  }
}

/** What the town is doing when nobody in it is doing anything. Nothing wakes a body at an hour,
 *  so there is no hour to name here. Null while anybody is up, which is a town worth watching. */
export function sleepField(
  agents: Readonly<Record<string, { alive: boolean; asleep: boolean }>> | undefined,
): string | null {
  return townAsleep(agents) ? 'ASLEEP' : null
}

/** The token is drawn on the same eight-pixel grid the weather glyphs are. */
/** No fill: the sun and the moon take `currentColor` off `.sky-token`. */
const SUN: readonly (readonly [number, number])[] = [
  [3, 1],
  [4, 1],
  [2, 2],
  [3, 2],
  [4, 2],
  [5, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [5, 3],
  [3, 4],
  [4, 4],
  [0, 2],
  [7, 2],
  [0, 3],
  [7, 3],
]
const MOON: readonly (readonly [number, number])[] = [
  [3, 0],
  [4, 0],
  [2, 1],
  [5, 1],
  [1, 2],
  [5, 2],
  [1, 3],
  [5, 3],
  [2, 4],
  [5, 4],
  [3, 5],
  [4, 5],
]

/** ★ THE SUN ARC, the one permanent mark over the town and the only one that says when. Where
 *  the token sits on the curve says the hour before any word beside it is read. The words are
 *  the weather, the clock, the day and whatever the town itself is doing. Not a live region:
 *  an hour announcing itself every minute of town time is one nobody can listen past. */
export function SkyArc({ store, link }: { store: WorldStore; link: LinkState }) {
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  // Primitives, never the folded state object: `state.weather` is a fresh object every tick and
  // would re-render this mark sixty times for a sky that has not changed.
  const readKind = (): string => skyKind(store.getState())
  const readSky = (): string => skyWord(store.getState())
  const readState = (): string | null => sleepField(store.getState()?.agents)
  const isLive = (): boolean => store.getMode().live
  const isAwake = (): boolean => store.getState() !== null
  const kind = useSyncExternalStore(store.subscribe, readKind, readKind)
  const sky = useSyncExternalStore(store.subscribe, readSky, readSky)
  const field = useSyncExternalStore(store.subscribe, readState, readState)
  const live = useSyncExternalStore(store.subscribe, isLive, isLive)
  const awake = useSyncExternalStore(store.subscribe, isAwake, isAwake)
  const paused = useSyncExternalStore(store.subscribe, store.getPaused, store.getPaused)
  const actNow = (): ActMark | null => store.getDirector()?.act ?? null
  const act = useSyncExternalStore(store.subscribe, actNow, actNow)

  const token = skyToken(tick)
  const at = arcPercent(token.along)
  const glyph = WEATHER_GLYPH[kind] ?? WEATHER_GLYPH['—']!
  const stamp = townStamp(tick, stampWord(live, awake, link, paused), act)

  return (
    <div className="sky-bar">
      <p className="sky-chip sky-weather">
        <PixelGlyph className="sky-glyph" pixels={glyph.pixels} />
        {sky}
      </p>
      <div className="sky-arc">
        <svg
          className="sky-arc-line"
          viewBox={`0 0 ${ARC_BOX.w} ${ARC_BOX.h}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {/* The road carries its own ground: a deep under-stroke, then the honey dashes on it,
              so neither is read against whatever tile happens to be behind the bar. */}
          <path className="sky-arc-ground" d={ARC_PATH} />
          <path className="sky-arc-track" d={ARC_PATH} />
        </svg>
        <span
          className="sky-token"
          data-kind={token.kind}
          style={{ '--sky-x': `${at.left}%`, '--sky-y': `${at.top}%` } as CSSProperties}
        >
          {/* `currentColor`, so the token's honey and cream stay in `:root` with every other
              colour the product uses rather than being retyped here. */}
          <PixelGlyph className="sky-glyph" pixels={token.kind === 'sun' ? SUN : MOON} />
        </span>
      </div>
      <p className="sky-chip sky-clock">{stamp.clock}</p>
      <p className="sky-line">
        {stamp.date}
        {field !== null && <span className="sky-state">{field}</span>}
      </p>
    </div>
  )
}
