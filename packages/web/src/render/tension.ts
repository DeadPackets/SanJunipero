import { GIVE_WAY_AFTER, type SimEvent } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { MOTION, easeFn } from '../ui/motion.js'

// Who is pushing and who is folding, read off the `move` the world already records on every
// line. A bar moves on a recorded move or it does not move.

/** One bar per person in the scene, over the ring. */
export const TENSION_BAR_W = 64
export const TENSION_BAR_H = 4

/** Where a bar stands before anybody has pushed: half, so it has room both ways. */
export const TENSION_LEVEL_START = 0.5
/** One press, as a fraction of the bar. Eight of them cover it. */
export const TENSION_UNIT = 0.125
/** Press, agree, and the sideways shift of a deflect coming back. */
export const TENSION_MOVE_MS = MOTION.move.ms
export const TENSION_GIVE_WAY_MS = 260
export const TENSION_DEFLECT_PX = 6
export const TENSION_TEASE_MS = MOTION.tap.ms
export const TENSION_TEASE_SCALE = 1.06
/** How far an agree closes each bar toward the others. */
export const TENSION_AGREE = 0.2
export const TENSION_CARET_PX = 1
/** The two channels a turn takes outside the bars. */
export const TENSION_DESATURATE_MS = 120
export const TENSION_RIM_MS = 200

/** --ember, and what a bar that has given way falls to. */
export const TENSION_INK = 0xe8785a
export const TENSION_SPENT = 0x5f5568
/** --honey: a joke's tick and the ring rim's flash on a turn. */
export const TENSION_WARM = 0xf2c879
/** What a body's own colour falls toward while the turn drains it. */
const TENSION_DRAIN = 0x9a9490

export type TensionBar = {
  agentId: string
  /** 0..1 of TENSION_BAR_W */
  level: number
  colour: number
  /** the sideways pixels a deflect is holding */
  dx: number
  /** the tease nudge */
  scale: number
  /** a joke's warm tick, standing until the next line */
  tickAbove: boolean
  /** the caret an ask opened, standing until the next line */
  caret: boolean
}

/** A give_way after three presses: `stakes.ts`'s own shape of a scene turning. */
export type TensionTurn = { sceneId: string; yielder: string; tick: number }

export type Tension = {
  /** The bars the world holds for this scene, in the cast's own order. Empty for a scene the
   *  world never opened, or has closed. */
  bars: (sceneId: string, nowMs: number) => readonly TensionBar[]
  /** 0..1 of the warm flash a turn puts on the ring rim. */
  rimFlash: (sceneId: string, nowMs: number) => number
  /** 0..1 of the desaturate the yielder and the one who pressed take on a turn. */
  desaturate: (agentId: string, nowMs: number) => number
  onTurn: (fn: (turn: TensionTurn) => void) => () => void
  /** Drop every talk. A scrub leaves the store's scenes behind, and a bar for a conversation
   *  that is not in the minute on screen is the same lie the floor used to tell. */
  forget: () => void
  destroy: () => void
}

type Bar = {
  from: number
  to: number
  atMs: number
  ms: number
  gaveWayMs: number | null
  deflectMs: number | null
  teaseMs: number | null
  tickAbove: boolean
  caret: boolean
}

type Talk = {
  cast: string[]
  bars: Map<string, Bar>
  presses: number
  lastPresser: string | null
  rimMs: number | null
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

const ramp = (startMs: number, nowMs: number, ms: number): number => clamp01((nowMs - startMs) / ms)

const ease = easeFn('move')

const mixInk = (a: number, b: number, t: number): number => {
  const ch = (shift: number): number => {
    const from = (a >> shift) & 0xff
    return Math.round(from + (((b >> shift) & 0xff) - from) * t) << shift
  }
  return ch(16) | ch(8) | ch(0)
}

const levelAt = (bar: Bar, nowMs: number): number =>
  bar.from + (bar.to - bar.from) * ease(ramp(bar.atMs, nowMs, bar.ms))

const newBar = (nowMs: number): Bar => ({
  from: TENSION_LEVEL_START,
  to: TENSION_LEVEL_START,
  atMs: nowMs,
  ms: TENSION_MOVE_MS,
  gaveWayMs: null,
  deflectMs: null,
  teaseMs: null,
  tickAbove: false,
  caret: false,
})

const setLevel = (bar: Bar, next: number, nowMs: number, ms: number): void => {
  bar.from = levelAt(bar, nowMs)
  bar.to = clamp01(next)
  bar.atMs = nowMs
  bar.ms = ms
  if (bar.to > 0) bar.gaveWayMs = null
}

/** A sprite's tint over a turn: white at rest, so a body wears its own art. */
export const drainTint = (drain: number): number => mixInk(0xffffff, TENSION_DRAIN, drain)

export function createTension(store: Pick<WorldStore, 'onEvents'>): Tension {
  const talks = new Map<string, Talk>()
  const desat = new Map<string, number>()
  const turnSubs = new Set<(turn: TensionTurn) => void>()

  const castOf = (p: Record<string, unknown>): string[] =>
    Array.isArray(p.participants)
      ? (p.participants as string[]).filter((s) => typeof s === 'string')
      : []

  const opened = (id: string, cast: string[], nowMs: number): void => {
    const talk = talks.get(id) ?? {
      cast: [],
      bars: new Map<string, Bar>(),
      presses: 0,
      lastPresser: null,
      rimMs: null,
    }
    talk.cast = cast
    for (const agentId of cast) if (!talk.bars.has(agentId)) talk.bars.set(agentId, newBar(nowMs))
    for (const agentId of [...talk.bars.keys()])
      if (!cast.includes(agentId)) talk.bars.delete(agentId)
    talks.set(id, talk)
  }

  const said = (ev: SimEvent, p: Record<string, unknown>, nowMs: number): void => {
    const talk = talks.get(typeof p.id === 'string' ? p.id : '')
    if (talk === undefined) return
    const speaker = typeof p.agentId === 'string' ? p.agentId : ''
    for (const bar of talk.bars.values()) {
      bar.tickAbove = false
      bar.caret = false
    }
    const self = talk.bars.get(speaker)
    const others = [...talk.bars.entries()].filter(([id]) => id !== speaker)
    switch (typeof p.move === 'string' ? p.move : '') {
      case 'press': {
        talk.presses += 1
        talk.lastPresser = speaker
        if (self !== undefined)
          setLevel(self, levelAt(self, nowMs) + TENSION_UNIT, nowMs, TENSION_MOVE_MS)
        for (const [, bar] of others)
          setLevel(bar, levelAt(bar, nowMs) - TENSION_UNIT / 2, nowMs, TENSION_MOVE_MS)
        return
      }
      case 'give_way': {
        if (self !== undefined) {
          setLevel(self, 0, nowMs, TENSION_GIVE_WAY_MS)
          self.gaveWayMs = nowMs
        }
        if (talk.presses < GIVE_WAY_AFTER) return
        talk.presses = 0
        talk.rimMs = nowMs
        desat.set(speaker, nowMs)
        if (talk.lastPresser !== null) desat.set(talk.lastPresser, nowMs)
        const turn: TensionTurn = {
          sceneId: typeof p.id === 'string' ? p.id : '',
          yielder: speaker,
          tick: ev.tick,
        }
        for (const fn of turnSubs) fn(turn)
        return
      }
      case 'deflect':
        if (self !== undefined) self.deflectMs = nowMs
        return
      case 'tease':
        if (self !== undefined) self.teaseMs = nowMs
        return
      case 'joke':
        if (self !== undefined) self.tickAbove = true
        return
      case 'ask':
        for (const [, bar] of others) bar.caret = true
        return
      case 'agree': {
        const now = [...talk.bars.values()].map((bar) => levelAt(bar, nowMs))
        if (now.length < 2) return
        const sum = now.reduce((a, b) => a + b, 0)
        let i = 0
        for (const bar of talk.bars.values()) {
          const mean = (sum - now[i]!) / (now.length - 1)
          setLevel(bar, now[i]! + (mean - now[i]!) * TENSION_AGREE, nowMs, TENSION_MOVE_MS)
          i += 1
        }
        return
      }
      default:
        return
    }
  }

  const offEvents = store.onEvents((evts) => {
    const nowMs = performance.now()
    for (const ev of evts) {
      const p = ev.payload as Record<string, unknown>
      const id = typeof p.id === 'string' ? p.id : ''
      if (ev.type === 'scene_opened' || ev.type === 'scene_turned') opened(id, castOf(p), nowMs)
      else if (ev.type === 'scene_line') said(ev, p, nowMs)
      else if (ev.type === 'scene_closed') talks.delete(id)
    }
  })

  return {
    bars: (sceneId, nowMs) => {
      const talk = talks.get(sceneId)
      if (talk === undefined) return []
      const out: TensionBar[] = []
      for (const agentId of talk.cast) {
        const bar = talk.bars.get(agentId)
        if (bar === undefined) continue
        const gave =
          bar.gaveWayMs === null ? 0 : ease(ramp(bar.gaveWayMs, nowMs, TENSION_GIVE_WAY_MS))
        const away = bar.deflectMs === null ? 1 : ramp(bar.deflectMs, nowMs, TENSION_MOVE_MS)
        const nudge = bar.teaseMs === null ? 1 : ramp(bar.teaseMs, nowMs, TENSION_TEASE_MS)
        out.push({
          agentId,
          level: levelAt(bar, nowMs),
          colour: mixInk(TENSION_INK, TENSION_SPENT, gave),
          dx: TENSION_DEFLECT_PX * (1 - away),
          scale: 1 + (TENSION_TEASE_SCALE - 1) * (1 - nudge),
          tickAbove: bar.tickAbove,
          caret: bar.caret,
        })
      }
      return out
    },

    rimFlash: (sceneId, nowMs) => {
      const at = talks.get(sceneId)?.rimMs
      return at === undefined || at === null ? 0 : 1 - ramp(at, nowMs, TENSION_RIM_MS)
    },

    desaturate: (agentId, nowMs) => {
      const at = desat.get(agentId)
      return at === undefined ? 0 : 1 - ramp(at, nowMs, TENSION_DESATURATE_MS)
    },

    onTurn: (fn) => {
      turnSubs.add(fn)
      return () => turnSubs.delete(fn)
    },

    forget: () => {
      talks.clear()
      desat.clear()
    },

    destroy: () => {
      offEvents()
      talks.clear()
      desat.clear()
      turnSubs.clear()
    },
  }
}
