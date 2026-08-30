import type { AgentBody } from '@sj/engine/state'
import { TICK_REAL_MS, type SimEvent } from '@sj/shared'
import { FACINGS, facingFrom, type Facing } from './iso.js'

// Character standard v2 sheet layout (forge style bible) — the atlas is the runtime truth.
// The column order IS the facing roster; `iso.FACINGS` is the one copy of it (see iso.ts).
export const SHEET_COLS: readonly Facing[] = FACINGS
export const SHEET_ROWS = [
  'idle',
  'contact-a',
  'passing-a',
  'contact-b',
  'passing-b',
  'sleep',
] as const
export const CELL = 96
export const FEET_Y = 88
const WALK_FPS = 8
export const WALK_LOOP = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const // v2, 8fps
export const BOB_PX = 1 // passing frames render 1px lower — render-time only, never baked
export const CHAR_TARGET_PX = 52 // ≈1.6 tiles of 32px; art height 64 in cell → scale 52/64
export const WALK_FRAME_MS_V4 = 180 // v4 ruling: F1-F2-F1-F3 cadence at 180ms/frame

// Superseded by the measured capsule in hitShapes.ts; kept because the gate cites them as the
// before-state.
export const HIT_AREA_W = 52
export const HIT_AREA_H = 72
/** NOT the click target — hitShapes.bodyHitPolygon is. Kept as the before-state the landed
 *  tests measure against. */
export function hitRect(scale: number): { x: number; y: number; w: number; h: number } {
  return {
    x: -HIT_AREA_W / 2 / scale,
    y: -HIT_AREA_H / scale,
    w: HIT_AREA_W / scale,
    h: HIT_AREA_H / scale,
  }
}
export const NAME_TAG_ABOVE_HEAD_PX = 8
export const NAME_TAG_MAX_CHARS = 16
// Hover name tag: the agent's name, truncated to fit the pixel slab.
export function nameTagText(name: string): string {
  return name.length <= NAME_TAG_MAX_CHARS ? name : `${name.slice(0, NAME_TAG_MAX_CHARS - 1)}…`
}

// Gait variance is derived from a stable hash of the agent's id, never from `Math.random()`:
// two people watching the same replay must see the same town.

/** FNV-1a, 32-bit. Small, stable, and dependency-free: the same id gives the same number in
 *  every process, every session and every replay, which is the whole requirement. */
/** A phase in [0, 2π) off the hash, so no two things named differently swing together. */
export const phaseOf = (id: string): number => ((hash32(id) % 1000) / 1000) * Math.PI * 2

export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** How much two people's stride LENGTHS may differ at one walking speed. The variance goes on the stride, not the speed: the speed belongs to the record. */
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
  const stride = 1 + ((((h >>> 16) & 0xffff) / 0x10000) * 2 - 1) * GAIT_STRIDE_SPREAD
  return { phase, stride }
}

export type SheetRow = (typeof SHEET_ROWS)[number]
export type CharPose = { row: SheetRow; facing: Facing; bobY: number }

/** What a body draws when the cell it wants is missing, in the order it tries: never another facing's art, which would be a body walking one way drawn facing the other. */
export function cellRowLadder(row: SheetRow): readonly SheetRow[] {
  const i = (WALK_LOOP as readonly string[]).indexOf(row)
  // the walk loop backwards from the frame before this one — the last frame that was drawn
  const back: SheetRow[] =
    i < 0
      ? [...WALK_LOOP]
      : WALK_LOOP.map((_, k) => WALK_LOOP[(i - 1 - k + 2 * WALK_LOOP.length) % WALK_LOOP.length]!)
  // a lying body is the worst stand-in for a standing one, so `sleep` is always last
  const order: SheetRow[] =
    row === 'sleep' ? [row, 'idle', ...back] : [row, ...back, 'idle', 'sleep']
  return [...new Set(order)]
}

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

// ── THE STRIDE FOLLOWS THE GROUND ─────────────────────────────────────────────────────────
// A walk cycle at a fixed frame time has no relationship to the ground and reads as skating.

/** How far one four-frame cycle carries a body, in tiles: the v4 cadence's 720 ms cycle at the dev world's 400 ms a tile, so the shipped look is reproduced exactly. */
export const STRIDE_TILES = 1.8

/** Outside this band the legs slide on purpose: a body crossing a tile in 2.5 s would otherwise cycle its legs once every 4.5 s, which reads as a freeze rather than an amble.
 *  The band bounds the world's NOMINAL cadence, not a body's own — see `strideFrameMs`. */
export const WALK_FRAME_MIN_MS = 90
export const WALK_FRAME_MAX_MS = 360

/**
 * The frame time whose four-frame loop carries `STRIDE_TILES` tiles at this speed.
 *
 * Scales the CLAMPED cadence, not the ideal — inside the clamp all five founders came out at
 * exactly 360 ms at the product's real 2500 ms a tile (5 of 5 distinct only at the dev world's 400 ms).
 */
export function strideFrameMs(msPerTile: number, strideScale = 1): number {
  const ideal = (msPerTile * STRIDE_TILES) / WALK_LOOP.length
  return Math.min(WALK_FRAME_MAX_MS, Math.max(WALK_FRAME_MIN_MS, ideal)) * strideScale
}

// ── THE WORLD'S CLOCK, AS THE RENDERER SEES IT ────────────────────────────────────────────
// A leg's duration comes from the tick, not from wall-clock idle time.

/** Where the clock starts before it has seen two batches: the declared default, which is the
 *  only tick rate anything in this repo writes down. It is replaced by the first measurement. */
export const TICK_PERIOD_SEED_MS = TICK_REAL_MS
/** A period outside this is a pause, a resume, a scrub or a stall — not the world's cadence. */
const TICK_PERIOD_MIN_MS = 60
export const TICK_PERIOD_MAX_MS = 6000
/** Weight on a new sample. Low enough that one late batch does not become the walk's speed,
 *  high enough that a world that changes rate is followed within a second. */
const TICK_PERIOD_SMOOTHING = 0.25

export type TickClock = { periodMs: number; lastArrivalMs: number; samples: number }

export function initialTickClock(periodMs = TICK_PERIOD_SEED_MS): TickClock {
  return { periodMs, lastArrivalMs: -Infinity, samples: 0 }
}

/** One batch of deltas carrying `ticks` ticks. The first batch only records the time, and the first real sample REPLACES the seed rather than being averaged with it. */
export function observeTick(prev: TickClock, nowMs: number, ticks = 1): TickClock {
  if (!Number.isFinite(prev.lastArrivalMs)) {
    return { periodMs: prev.periodMs, lastArrivalMs: nowMs, samples: 0 }
  }
  const per = (nowMs - prev.lastArrivalMs) / Math.max(1, ticks)
  if (!(per > 0) || per < TICK_PERIOD_MIN_MS || per > TICK_PERIOD_MAX_MS) {
    return { ...prev, lastArrivalMs: nowMs }
  }
  const periodMs =
    prev.samples === 0 ? per : prev.periodMs + (per - prev.periodMs) * TICK_PERIOD_SMOOTHING
  return { periodMs, lastArrivalMs: nowMs, samples: prev.samples + 1 }
}

/** The renderer plays the record one tick behind itself: enough to absorb websocket jitter, and the smallest amount that is any use — more is visible lag for no gain. */
export const WALK_LEAD_TICKS = 1

/** Appends one tile of walk. The cap bounds the debt: the tail may sit at most one leg plus one tick of buffer ahead of now, so a body behind the record catches up rather than teleports. */
export function scheduleLeg(
  path: readonly Waypoint[],
  x: number,
  y: number,
  opts: { nowMs: number; legMs: number; leadMs: number },
): Waypoint[] {
  const { nowMs, legMs, leadMs } = opts
  const last = path[path.length - 1] ?? { x, y, atMs: nowMs }
  const wanted = Math.max(nowMs, last.atMs) + legMs
  const cap = nowMs + legMs + leadMs
  if (wanted <= cap) return [...path, { x, y, atMs: wanted }]

  // The future is COMPRESSED rather than clamped: clamping against `last.atMs` cannot drain the
  // debt, because `last.atMs` IS the debt. The anchor is where the body is at THIS INSTANT —
  // anchoring on the last passed waypoint would move it mid-segment, which is the jump being fixed.
  const here = interpolatePos(path, nowMs)
  const k = (cap - nowMs) / (wanted - nowMs)
  const out: Waypoint[] = [{ x: here.x, y: here.y, atMs: nowMs }]
  for (const w of path) if (w.atMs > nowMs) out.push({ ...w, atMs: nowMs + (w.atMs - nowMs) * k })
  out.push({ x, y, atMs: cap })
  return out
}

export type Waypoint = { x: number; y: number; atMs: number }

// The body steps through each waypoint tile — never a straight line to the final destination —
// so a corner leg cannot sweep across a building's drawn volume. path[0] is the anchor.
export function interpolatePos(path: readonly Waypoint[], nowMs: number): { x: number; y: number } {
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

// Keeps the last-passed waypoint as the anchor so the interpolation never re-winds. The no-op
// case returns the same array — this runs 60fps per character.
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
export function legFacing(path: readonly Waypoint[]): Facing | null {
  if (path.length < 2) return null
  return facingFrom(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y)
}

export const EMOTE_KINDS = [
  'exclaim',
  'question',
  'heart',
  'star',
  'sleep',
  'hunger',
  'cold',
  'rain',
  'hurt',
  'talk',
  'idea',
  'anger',
] as const // mirrors /assets/emotes.json order
export type EmoteKind = (typeof EMOTE_KINDS)[number]

const NEED_EMOTE_BELOW = 30

export function emoteFor(a: AgentBody, recent: SimEvent[]): EmoteKind | null {
  if (!a.alive) return null // the renderer's tone handling owns death
  const mine = (type: string): boolean =>
    recent.some((ev) => ev.type === type && (ev.payload as { agentId?: string }).agentId === a.id)
  if (mine('agent_injured')) return 'hurt'
  if (a.collapsedSinceTick !== null) return 'exclaim'
  if (a.asleep) return 'sleep'
  if (a.needs.hunger < NEED_EMOTE_BELOW) return 'hunger'
  if (a.needs.warmth < NEED_EMOTE_BELOW) return 'cold'
  if (mine('agent_spoke')) return 'talk'
  if (
    recent.some(
      (ev) =>
        ev.type === 'weather_changed' &&
        ['rain', 'storm'].includes((ev.payload as { kind: string }).kind),
    )
  )
    return 'rain'
  return null
}
