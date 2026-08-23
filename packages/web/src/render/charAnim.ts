import type { AgentBody } from '@sj/engine/state'
import { TICK_REAL_MS, type SimEvent } from '@sj/shared'
import { facingFrom, type Facing } from './iso.js'

// Character standard v2 sheet layout (forge style bible) — the atlas is the runtime truth
export const SHEET_COLS: Facing[] = ['sw', 'se', 'ne', 'nw']
export const SHEET_ROWS = ['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b', 'sleep'] as const
export const CELL = 96
export const FEET_Y = 88
export const WALK_FPS = 8
export const WALK_LOOP = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const // v2, 8fps
export const BOB_PX = 1 // passing frames render 1px lower — render-time only, never baked
export const CHAR_TARGET_PX = 52 // ≈1.6 tiles of 32px; art height 64 in cell → scale 52/64
export const WALK_FRAME_MS_V4 = 180 // v4 ruling: F1-F2-F1-F3 cadence at 180ms/frame

// The click target BEFORE U9: a 52×72 rectangle around a figure drawn 26×52, i.e. 2.77× the
// silhouette's area. hitShapes.ts replaced it with a measured capsule; these two constants
// stay because they are the before-state the gate cites.
export const HIT_AREA_W = 52
export const HIT_AREA_H = 72
/** @deprecated superseded by hitShapes.bodyHitPolygon (U9). Kept for the landed C10 tests. */
export function hitRect(scale: number): { x: number; y: number; w: number; h: number } {
  return { x: -HIT_AREA_W / 2 / scale, y: -HIT_AREA_H / scale, w: HIT_AREA_W / scale, h: HIT_AREA_H / scale }
}
export const NAME_TAG_ABOVE_HEAD_PX = 8
export const NAME_TAG_MAX_CHARS = 16
// Hover name tag: the agent's name, truncated to fit the pixel slab.
export function nameTagText(name: string): string {
  return name.length <= NAME_TAG_MAX_CHARS ? name : `${name.slice(0, NAME_TAG_MAX_CHARS - 1)}…`
}

// ── ★ FIVE PEOPLE, ONE GAIT — AND WHY THAT WAS TRUE BY CONSTRUCTION ───────────────────────
//
// THE COMPLAINT, verbatim: "all the characters walk at the EXACT same jumpy pace."
//
// `charPose` read ONE clock — `nowMs` — so every walking body in the town was on the same
// frame of the same loop at the same instant. Not similar: IDENTICAL, provably, because the
// agent's identity was not an input to the function. Real crowds never do that.
//
// ★ THE CONSTRAINT THAT DECIDES HOW THE VARIANCE IS MADE: the engine is the record and the
// renderer is a view. So the variance is DERIVED FROM IDENTITY — a stable hash of the agent's
// id — and never from `Math.random()`, which would make two people watching the same replay
// see two different towns. `charAnim.test.ts` proves the derivation is stable across a fresh
// module instance and scans this file and `characters.ts` for any random source at all.

/** FNV-1a, 32-bit. Small, stable, and dependency-free: the same id gives the same number in
 *  every process, every session and every replay, which is the whole requirement. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * How much two people's stride LENGTHS may differ at the same walking speed. A taller person
 * covers more ground per step and so cycles their legs more slowly — this is that, and it is
 * why the variance goes on the stride rather than on the speed. The speed belongs to the
 * record; the stride is a property of the body, and the renderer is allowed to know bodies
 * apart. At 12 % the slowest gait cycles 1.27x slower than the fastest.
 */
export const GAIT_STRIDE_SPREAD = 0.12

export type Gait = {
  /** where in the four-frame loop this person is, as a fraction of one cycle */
  phase: number
  /** their stride length as a multiple of the average */
  stride: number
}

/** The one place an agent's identity becomes a gait. Deterministic, total, and reachable by
 *  nothing that writes to the record. */
export function gaitOf(agentId: string): Gait {
  const h = hash32(agentId)
  const phase = (h & 0xffff) / 0x10000
  const stride = 1 + (((h >>> 16) & 0xffff) / 0x10000 * 2 - 1) * GAIT_STRIDE_SPREAD
  return { phase, stride }
}

export type CharPose = { row: (typeof SHEET_ROWS)[number]; facing: Facing; bobY: number }

export type PoseOpts = {
  /** this body's own offset into the walk loop, from `gaitOf` — 0 is the shared clock */
  phase?: number
  /** the 1 px passing-frame hop. Off under `prefers-reduced-motion` — see charAnim.test.ts */
  bob?: boolean
}

export function charPose(
  a: { asleep: boolean; collapsed: boolean; walking: boolean; facing: Facing; nowMs: number },
  frameMs = 1000 / WALK_FPS,
  opts: PoseOpts = {},
): CharPose {
  if (a.asleep || a.collapsed) return { row: 'sleep', facing: a.facing, bobY: 0 }
  if (a.walking) {
    const n = WALK_LOOP.length
    const cycles = a.nowMs / (frameMs * n) + (opts.phase ?? 0)
    const i = Math.floor(cycles * n)
    const row = WALK_LOOP[((i % n) + n) % n]!
    const bobbing = opts.bob !== false && (row === 'passing-a' || row === 'passing-b')
    return { row, facing: a.facing, bobY: bobbing ? BOB_PX : 0 }
  }
  return { row: 'idle', facing: a.facing, bobY: 0 }
}

// ── ★ THE STRIDE FOLLOWS THE GROUND, WHICH IS MOST OF "JANKY" ─────────────────────────────
//
// THE COMPLAINT, verbatim: "Walking animations are janky, don't feel smooth."
//
// Positions WERE already interpolated — `interpolatePos` below has been there since C10, and
// the brief's guess that they were not is wrong. The jank is two other things.
//
// The first is FOOT SLIDE. The loop ran at a fixed 180 ms a frame however fast the body was
// actually travelling, so the legs had no relationship to the ground: at the dev world's
// 400 ms a tile a body crossed two tiles per gait cycle, and at the shipped 2500 ms a tile it
// crossed a third of one. Nothing about the limbs said which. A walk cycle that does not match
// the ground reads as skating, and no easing inside the sprite hides it.

/**
 * How far one four-frame cycle carries a body, in tiles. Derived twice, and the two agree
 * inside 20 %:
 *
 *  A. From the landed cadence. `WALK_FRAME_MS_V4` is 180 ms, so a cycle is 720 ms, and at the
 *     dev world's 400 ms a tile that is 1.8 tiles. Shipped behaviour at the rate the feedback
 *     was given against is reproduced exactly — `charAnim.test.ts` asserts that identity.
 *  B. From the body. A walking human's stride is about 0.75 of their height; a figure is
 *     `CHAR_TARGET_PX` = 52 px tall and one tile of ground travel is drawn about 36 px long,
 *     so a step is ~1.09 tiles and a cycle — which is two steps — is ~2.18.
 *
 * A is the one taken, because it keeps a shipped look at the cadence a viewer is watching.
 */
export const STRIDE_TILES = 1.8

/** Outside this band the legs stop matching the ground, and that is deliberate: a body
 *  crossing a tile in 2.5 s would otherwise cycle its legs once every 4.5 s, which reads as a
 *  freeze rather than an amble. Inside it the feet are planted; outside it they slide, slowly
 *  at the top and quickly at the bottom, which is the least bad thing available. */
export const WALK_FRAME_MIN_MS = 90
export const WALK_FRAME_MAX_MS = 360

/** The frame time whose four-frame loop carries `STRIDE_TILES` tiles at this speed. */
export function strideFrameMs(msPerTile: number, strideScale = 1): number {
  const ideal = (msPerTile * STRIDE_TILES * strideScale) / WALK_LOOP.length
  return Math.min(WALK_FRAME_MAX_MS, Math.max(WALK_FRAME_MIN_MS, ideal))
}

// ── ★ THE WORLD'S CLOCK, AS THE RENDERER SEES IT ──────────────────────────────────────────
//
// The second half of "janky", and the worse one. The landed scheduler took a leg's duration
// from WALL-CLOCK IDLE TIME — `clamp(now - lastMoveArrival, 200, 4000)` — and appended it to
// the tail of the queue with `max(now, last.atMs) + glide`. Two consequences, both measured:
//
//  · A body that had stood still for four seconds spent FOUR SECONDS crossing its first tile,
//    and because the excess was appended rather than absorbed it never drained. Measured over
//    a twelve-tile walk at 400 ms a tick: 9.96 TILES BEHIND THE RECORD, still growing.
//  · A leg's speed was the PREVIOUS leg's arrival jitter, so a slow tick made one leg lurch
//    and every later one inherit the debt. Measured in the running page over three seconds:
//    each body's own speed swung 6x between its 10th and 90th percentile frame, while all five
//    bodies shared a median inside 6 % of each other. That is the user's sentence exactly —
//    the same pace, and jumpy.
//
// The fix is to stop guessing. The world ticks; the renderer can see the ticks arrive, and the
// record says how many ticks a tile costs this person. A leg is then `ticks x period`, which
// is a duration derived rather than sampled, and the queue is capped so no debt accumulates.

/** Where the clock starts before it has seen two batches: the declared default, which is the
 *  only tick rate anything in this repo writes down. It is replaced by the first measurement. */
export const TICK_PERIOD_SEED_MS = TICK_REAL_MS
/** A period outside this is a pause, a resume, a scrub or a stall — not the world's cadence. */
export const TICK_PERIOD_MIN_MS = 60
export const TICK_PERIOD_MAX_MS = 6000
/** Weight on a new sample. Low enough that one late batch does not become the walk's speed,
 *  high enough that a world that changes rate is followed within a second. */
export const TICK_PERIOD_SMOOTHING = 0.25

export type TickClock = { periodMs: number; lastArrivalMs: number; samples: number }

export function initialTickClock(periodMs = TICK_PERIOD_SEED_MS): TickClock {
  return { periodMs, lastArrivalMs: -Infinity, samples: 0 }
}

/**
 * One batch of deltas arrived, carrying `ticks` ticks of the world. The first batch only
 * records the time — a gap needs two — and the first real sample REPLACES the seed rather
 * than being averaged with it, so a dev world at 400 ms is not walked at 2500 for ten seconds.
 */
export function observeTick(prev: TickClock, nowMs: number, ticks = 1): TickClock {
  if (!Number.isFinite(prev.lastArrivalMs)) {
    return { periodMs: prev.periodMs, lastArrivalMs: nowMs, samples: 0 }
  }
  const per = (nowMs - prev.lastArrivalMs) / Math.max(1, ticks)
  if (!(per > 0) || per < TICK_PERIOD_MIN_MS || per > TICK_PERIOD_MAX_MS) {
    return { ...prev, lastArrivalMs: nowMs }
  }
  const periodMs = prev.samples === 0
    ? per
    : prev.periodMs + (per - prev.periodMs) * TICK_PERIOD_SMOOTHING
  return { periodMs, lastArrivalMs: nowMs, samples: prev.samples + 1 }
}

/**
 * ★ HOW FAST THIS PERSON WALKS, ACCORDING TO THE RECORD.
 *
 * The engine already knows, and it already varies: `verbs.ticksPerTile` gives a body whose
 * needs have fallen under the debuff threshold `movement.debuffTicksPerTile` and everyone else
 * `movement.baseTicksPerTile` — 2 and 1 by default, so a hungry, cold, exhausted or lonely
 * person walks at HALF SPEED and always has. The renderer simply ignored it.
 *
 * So "gait should follow what a person is doing" needed no new engine field: it needed the
 * renderer to read the one that is already there. This restates the engine's expression rather
 * than importing it — `@sj/engine` publishes no `./verbs` subpath and its barrel drags
 * `better-sqlite3` into the browser bundle — and `charAnim.test.ts` reads `engine/src/verbs.ts`
 * off disk and asserts the two are the same expression, so they cannot drift apart in silence.
 */
export function ticksPerTileOf(
  needs: Readonly<Record<string, number>>,
  cfg: { debuffThreshold: number; base: number; debuff: number },
): number {
  const debuffed = Object.values(needs).some((v) => v < cfg.debuffThreshold)
  return debuffed ? cfg.debuff : cfg.base
}

/**
 * ★ THE INTERPOLATION BUFFER, IN TICKS.
 *
 * The renderer plays the record slightly behind itself so a late batch is absorbed instead of
 * stalling a body mid-stride. One tick of slack is enough for the jitter a websocket produces
 * and is the smallest amount that is any use; more would be visible lag for no gain.
 */
export const WALK_LEAD_TICKS = 1

/**
 * Append one tile of walk to a body's queue, and never let the queue run away from the world.
 *
 * `legMs` is what the record says the leg costs. The cap is what makes the debt bounded: the
 * tail may sit at most one leg plus one tick of buffer ahead of now, so a body that has fallen
 * behind catches up by walking its next legs at their proper speed against a nearer deadline
 * rather than by teleporting — and a body that has stood still for a minute starts walking at
 * once instead of spending four seconds on its first tile.
 */
export function scheduleLeg(
  path: readonly Waypoint[], x: number, y: number,
  opts: { nowMs: number; legMs: number; leadMs: number },
): Waypoint[] {
  const { nowMs, legMs, leadMs } = opts
  const last = path[path.length - 1] ?? { x, y, atMs: nowMs }
  const wanted = Math.max(nowMs, last.atMs) + legMs
  const cap = nowMs + legMs + leadMs
  if (wanted <= cap) return [...path, { x, y, atMs: wanted }]

  // ★ THE QUEUE HAS FALLEN BEHIND, AND SIMPLY REFUSING TO REWIND IS NOT ENOUGH.
  //
  // The first version of this clamped the new waypoint to `max(last.atMs, min(wanted, cap))`,
  // which cannot drain a debt at all: `last.atMs` IS the debt, so the cap never binds. Caught
  // by the replay at 120 ms a tick, where the clock's 2500 ms seed put the first leg 2.4 s in
  // the future and the body stayed 11 tiles behind for the rest of the walk.
  //
  // So the future is COMPRESSED instead: every leg still ahead is squeezed toward now by the
  // same factor, and the body catches up by walking quicker for a moment rather than by
  // teleporting. The order it visits tiles is untouched.
  //
  // The anchor is the body's position AT THIS INSTANT, not the last waypoint it passed. Left
  // as the passed waypoint, squeezing the segment the body is part way along would change
  // where it is drawn THIS FRAME — a jump, which is the exact thing being fixed.
  const here = interpolatePos(path, nowMs)
  const k = (cap - nowMs) / (wanted - nowMs)
  const out: Waypoint[] = [{ x: here.x, y: here.y, atMs: nowMs }]
  for (const w of path) if (w.atMs > nowMs) out.push({ ...w, atMs: nowMs + (w.atMs - nowMs) * k })
  out.push({ x, y, atMs: cap })
  return out
}

export type Waypoint = { x: number; y: number; atMs: number }

// Interpolate along a scheduled path polyline (path[0] is the anchor). The body
// steps through each waypoint tile — never a straight line from start to final
// destination — so a corner leg can't sweep across a building's drawn volume.
export function interpolatePos(path: ReadonlyArray<Waypoint>, nowMs: number): { x: number; y: number } {
  if (path.length === 0) return { x: 0, y: 0 }
  const first = path[0]!
  if (nowMs <= first.atMs) return { x: first.x, y: first.y }
  const last = path[path.length - 1]!
  if (nowMs >= last.atMs) return { x: last.x, y: last.y }
  for (let i = 1; i < path.length; i++) {
    const next = path[i]!
    if (nowMs <= next.atMs) {
      const prev = path[i - 1]!
      const span = next.atMs - prev.atMs
      const t = span <= 0 ? 1 : (nowMs - prev.atMs) / span
      return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t }
    }
  }
  return { x: last.x, y: last.y }
}

// Drop waypoints we've passed, keeping the last-passed one as the anchor so the
// path queue stays short while the interpolation never re-winds. The no-op case
// returns the same array — this runs 60fps per character.
export function prunePath(path: Waypoint[], nowMs: number): Waypoint[] {
  let cut = 0
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i + 1]!.atMs <= nowMs) cut = i + 1
    else break
  }
  return cut > 0 ? path.slice(cut) : path
}

// Facing for the leg being walked NOW — path[0] (anchor) → path[1] — so a queued
// multi-waypoint path never turns the body toward its final leg early.
export function legFacing(path: ReadonlyArray<Waypoint>): Facing | null {
  if (path.length < 2) return null
  return facingFrom(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y)
}

export const EMOTE_KINDS = ['exclaim', 'question', 'heart', 'star', 'sleep', 'hunger',
  'cold', 'rain', 'hurt', 'talk', 'idea', 'anger'] as const // mirrors /assets/emotes.json order
export type EmoteKind = (typeof EMOTE_KINDS)[number]

export const NEED_EMOTE_BELOW = 30

export function emoteFor(a: AgentBody, recent: SimEvent[]): EmoteKind | null {
  if (!a.alive) return null // the renderer's tone handling owns death (Task 15)
  const mine = (type: string): boolean =>
    recent.some((ev) => ev.type === type && (ev.payload as { agentId?: string }).agentId === a.id)
  if (mine('agent_injured')) return 'hurt'
  if (a.collapsedSinceTick !== null) return 'exclaim'
  if (a.asleep) return 'sleep'
  if (a.needs.hunger < NEED_EMOTE_BELOW) return 'hunger'
  if (a.needs.warmth < NEED_EMOTE_BELOW) return 'cold'
  if (mine('agent_spoke')) return 'talk'
  if (recent.some((ev) => ev.type === 'weather_changed' && ['rain', 'storm'].includes((ev.payload as { kind: string }).kind))) return 'rain'
  return null
}
