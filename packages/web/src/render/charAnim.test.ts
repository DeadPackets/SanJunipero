import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AgentBody } from '@sj/engine/state'
import { tilesPerTickFor } from '@sj/engine/verbs'
import { TICK_REAL_MS, type SimEvent } from '@sj/shared'
import {
  BOB_PX,
  EMOTE_KINDS,
  GAIT_STRIDE_SPREAD,
  HIT_AREA_H,
  HIT_AREA_W,
  NAME_TAG_MAX_CHARS,
  STRIDE_TILES,
  TICK_PERIOD_MAX_MS,
  TICK_PERIOD_SEED_MS,
  WALK_FRAME_MAX_MS,
  WALK_FRAME_MIN_MS,
  SHEET_ROWS,
  WALK_FRAME_MS_V4,
  WALK_LEAD_TICKS,
  WALK_LOOP,
  cellRowLadder,
  charPose,
  emoteFor,
  gaitOf,
  hash32,
  hitRect,
  initialTickClock,
  interpolatePos,
  legFacing,
  nameTagText,
  observeTick,
  prunePath,
  scheduleLeg,
  strideFrameMs,
  type Waypoint,
} from './charAnim.js'
import { MOVEMENT_FALLBACK } from './characters.js'

describe('charPose v4 cadence', () => {
  const v4base = { asleep: false, collapsed: false, walking: true, facing: 'se' as const, nowMs: 0 }
  it('walks the four-frame loop at 180ms per frame', () => {
    const rows = [0, 180, 360, 540].map(
      (nowMs) => charPose({ ...v4base, nowMs }, WALK_FRAME_MS_V4).row,
    )
    expect(rows).toEqual(['contact-a', 'passing-a', 'contact-b', 'passing-b'])
    expect(charPose({ ...v4base, nowMs: 179 }, WALK_FRAME_MS_V4).row).toBe('contact-a')
  })
})

const base = { asleep: false, collapsed: false, walking: false, facing: 'se' as const, nowMs: 0 }

const agent = (over: Partial<AgentBody> = {}): AgentBody => ({
  id: 'farmer',
  name: 'Farmer',
  x: 3,
  y: 4,
  alive: true,
  asleep: false,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 10,
  injuries: [],
  ill: false,
  ageDays: 7300,
  skills: {},
  activity: null,
  collapsedSinceTick: null,
  zeroHungerSinceTick: null,
  ...over,
})

const ev = (type: string, payload: unknown, tick = 10): SimEvent => ({
  seq: 1,
  tick,
  type,
  payload,
})

describe('charPose', () => {
  it('asleep beats walking and never bobs', () => {
    expect(charPose({ ...base, asleep: true, walking: true, nowMs: 125 })).toEqual({
      row: 'sleep',
      facing: 'se',
      bobY: 0,
    })
    expect(charPose({ ...base, collapsed: true, walking: true })).toEqual({
      row: 'sleep',
      facing: 'se',
      bobY: 0,
    })
  })

  it('walks the v2 loop at 8fps with a 1px bob exactly on passing frames', () => {
    const rows = [0, 125, 250, 375].map((nowMs) => charPose({ ...base, walking: true, nowMs }))
    expect(rows.map((r) => r.row)).toEqual([...WALK_LOOP])
    expect(rows.map((r) => r.bobY)).toEqual([0, BOB_PX, 0, BOB_PX])
  })

  it('idles at rest', () => {
    expect(charPose(base)).toEqual({ row: 'idle', facing: 'se', bobY: 0 })
  })
})

describe('interpolatePos (waypoints)', () => {
  it('is exact at the midpoint of a single leg', () => {
    const path = [
      { x: 2, y: 6, atMs: 1000 },
      { x: 4, y: 6, atMs: 2000 },
    ]
    expect(interpolatePos(path, 1500)).toEqual({ x: 3, y: 6 })
  })
  it('follows the path polyline, never the straight line to the destination', () => {
    // two legs: (2,6)→(4,6)→(4,4). The straight line from start to end would put
    // t=1500 at (3,5); the polyline keeps it on the first leg at (3,6).
    const path = [
      { x: 2, y: 6, atMs: 1000 },
      { x: 4, y: 6, atMs: 2000 },
      { x: 4, y: 4, atMs: 3000 },
    ]
    expect(interpolatePos(path, 1500)).toEqual({ x: 3, y: 6 })
    expect(interpolatePos(path, 2000)).toEqual({ x: 4, y: 6 }) // exactly at the corner waypoint
    expect(interpolatePos(path, 2500)).toEqual({ x: 4, y: 5 }) // on the second leg
  })
  it('clamps before the first and after the last waypoint', () => {
    const path = [
      { x: 2, y: 6, atMs: 1000 },
      { x: 4, y: 6, atMs: 2000 },
    ]
    expect(interpolatePos(path, 9999)).toEqual({ x: 4, y: 6 })
    expect(interpolatePos(path, 0)).toEqual({ x: 2, y: 6 })
  })
  it('handles a single waypoint', () => {
    expect(interpolatePos([{ x: 5, y: 5, atMs: 100 }], 999)).toEqual({ x: 5, y: 5 })
  })
})

describe('prunePath', () => {
  const path = [
    { x: 0, y: 0, atMs: 0 },
    { x: 1, y: 0, atMs: 100 },
    { x: 2, y: 0, atMs: 200 },
    { x: 2, y: 1, atMs: 300 },
  ]
  it('drops passed waypoints, keeping the last-passed one as the anchor', () => {
    expect(prunePath(path, 150)).toEqual([
      { x: 1, y: 0, atMs: 100 },
      { x: 2, y: 0, atMs: 200 },
      { x: 2, y: 1, atMs: 300 },
    ])
    expect(prunePath(path, 250)).toEqual([
      { x: 2, y: 0, atMs: 200 },
      { x: 2, y: 1, atMs: 300 },
    ])
  })
  it('returns the SAME array when nothing has passed — no per-frame allocation', () => {
    expect(prunePath(path, 50)).toBe(path)
  })
})

describe('legFacing', () => {
  const wp = (x: number, y: number, atMs = 0): { x: number; y: number; atMs: number } => ({
    x,
    y,
    atMs,
  })
  it('faces the direction of the path[0]→path[1] leg, all four ways', () => {
    expect(legFacing([wp(0, 0), wp(1, 0, 100)])).toBe('se')
    expect(legFacing([wp(0, 0), wp(-1, 0, 100)])).toBe('nw')
    expect(legFacing([wp(0, 0), wp(0, 1, 100)])).toBe('sw')
    expect(legFacing([wp(0, 0), wp(0, -1, 100)])).toBe('ne')
  })
  it('ignores later legs — faces the leg being walked, not the newest queued one', () => {
    expect(legFacing([wp(0, 0), wp(0, 1, 100), wp(5, 1, 600)])).toBe('sw')
  })
  it('is null for a single waypoint or an empty path', () => {
    expect(legFacing([wp(3, 3)])).toBeNull()
    expect(legFacing([])).toBeNull()
  })

  // `scheduleLeg`'s catch-up branch anchors on the body's position at this instant, which lands
  // exactly on the next waypoint at compression factor 1 — a real leg of zero delta.
  it('★ is null for a zero-length leg, instead of naming a direction', () => {
    expect(legFacing([wp(2, 2), wp(2, 2, 100)])).toBeNull()
  })
})

// ── EVERY DIRECTION OF TRAVEL, THROUGH THE PIPELINE THE PRODUCT ACTUALLY RUNS ─────────────
// `iso.test.ts` unit-tests `facingFrom` against the projection; this is the other half, the
// whole `scheduleLeg` → `prunePath` → `legFacing` → `charPose` queue.

describe('a body walked through the queue points where it is going', () => {
  const LEGS: [string, number, number][] = [
    ['+x', 1, 0],
    ['-x', -1, 0],
    ['+y', 0, 1],
    ['-y', 0, -1],
  ]
  const EXPECT: Record<string, string> = { '+x': 'se', '-x': 'nw', '+y': 'sw', '-y': 'ne' }
  const LEG_MS = 400,
    LEAD_MS = 400

  // one leg at a time, the way `agent_moved` arrives: append, prune, read the facing
  const walk = (steps: [number, number][]): string[] => {
    let path: Waypoint[] = [{ x: 0, y: 0, atMs: 0 }]
    let x = 0,
      y = 0,
      now = 0
    const seen: string[] = []
    for (const [dx, dy] of steps) {
      x += dx
      y += dy
      path = scheduleLeg(path, x, y, { nowMs: now, legMs: LEG_MS, leadMs: LEAD_MS })
      now += LEG_MS
      // mid-leg is where the renderer reads it: the body is part way along, still walking
      const mid = prunePath(path, now - LEG_MS / 2)
      seen.push(String(legFacing(mid)))
    }
    return seen
  }

  it.each(LEGS)('walks %s facing the right way', (name, dx, dy) => {
    expect(
      walk([
        [dx, dy],
        [dx, dy],
        [dx, dy],
      ]),
    ).toEqual([EXPECT[name], EXPECT[name], EXPECT[name]])
  })

  // The engine's paths are four-neighbour, so +dx +dy is walked as alternating cardinal legs —
  // which is where the two facings must not flap between a front and a back view.
  it('★ crosses a pure-depth diagonal toward the camera without turning its back', () => {
    expect(
      walk([
        [1, 0],
        [0, 1],
        [1, 0],
        [0, 1],
      ]),
    ).toEqual(['se', 'sw', 'se', 'sw'])
  })

  it('★ and away from the camera without turning to face it', () => {
    expect(
      walk([
        [-1, 0],
        [0, -1],
        [-1, 0],
        [0, -1],
      ]),
    ).toEqual(['nw', 'ne', 'nw', 'ne'])
  })

  it('turns the corner on the leg it is walking, not the one it has queued', () => {
    // both legs queued before either is walked — the body must still face the FIRST one first
    let path: Waypoint[] = [{ x: 0, y: 0, atMs: 0 }]
    path = scheduleLeg(path, 0, 1, { nowMs: 0, legMs: LEG_MS, leadMs: LEAD_MS })
    path = scheduleLeg(path, 1, 1, { nowMs: 0, legMs: LEG_MS, leadMs: LEAD_MS })
    expect(legFacing(prunePath(path, 200))).toBe('sw')
    expect(legFacing(prunePath(path, 600))).toBe('se')
  })

  it('holds its facing when it stops, rather than snapping to a default', () => {
    let path: Waypoint[] = [{ x: 0, y: 0, atMs: 0 }]
    path = scheduleLeg(path, 0, -1, { nowMs: 0, legMs: LEG_MS, leadMs: LEAD_MS })
    expect(legFacing(prunePath(path, 200))).toBe('ne')
    const arrived = prunePath(path, 5000)
    expect(arrived).toHaveLength(1)
    expect(legFacing(arrived)).toBeNull() // the caller keeps the last facing on null
  })

  // Not vacuous: the four legs must give FOUR answers, or a rule that answers 'se' always
  // satisfies half the assertions above by coincidence.
  it('uses a different facing for each of the four legs', () => {
    const all = LEGS.map(([, dx, dy]) => walk([[dx, dy]])[0])
    expect(new Set(all).size).toBe(4)
  })
})

describe('cellRowLadder — what a body draws when its cell is not in the sheet', () => {
  it('walks the loop BACKWARDS from the frame before this one — the one just drawn', () => {
    expect(cellRowLadder('contact-b')).toEqual([
      'contact-b',
      'passing-a',
      'contact-a',
      'passing-b',
      'idle',
      'sleep',
    ])
    expect(cellRowLadder('contact-a')).toEqual([
      'contact-a',
      'passing-b',
      'contact-b',
      'passing-a',
      'idle',
      'sleep',
    ])
  })

  it('sends a still body to the walk frames, and a lying one to standing first', () => {
    expect(cellRowLadder('idle')[1]).toBe('contact-a')
    expect(cellRowLadder('sleep')[1]).toBe('idle')
  })

  // ★ THE WHOLE POINT. The ladder is a list of ROWS; it can never name a facing, so a missing
  // cell cannot be answered with another direction's art. That is the property, not the list.
  it('★ is every row of THIS sheet, itself first, and never names a facing', () => {
    for (const row of SHEET_ROWS) {
      const ladder = cellRowLadder(row)
      expect(ladder[0], `${row} must try itself first`).toBe(row)
      expect([...ladder].sort(), `${row} does not cover the sheet exactly once`).toEqual(
        [...SHEET_ROWS].sort(),
      )
    }
  })

  it('★ never prefers a lying body over a standing one', () => {
    for (const row of SHEET_ROWS) {
      if (row === 'sleep') continue
      expect(cellRowLadder(row).at(-1), `${row} would rather lie down`).toBe('sleep')
    }
  })
})

describe('emoteFor', () => {
  it('mirrors the emote atlas order', () => {
    expect(EMOTE_KINDS).toEqual([
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
    ])
  })
  it('injury beats hunger', () => {
    const a = agent({ needs: { hunger: 10, energy: 80, warmth: 80, social: 80 } })
    expect(emoteFor(a, [ev('agent_injured', { agentId: 'farmer', kind: 'minor' })])).toBe('hurt')
  })
  it('talk fires on own agent_spoke in the window, not on others', () => {
    expect(emoteFor(agent(), [ev('agent_spoke', { agentId: 'farmer', text: 'hello' })])).toBe(
      'talk',
    )
    expect(emoteFor(agent(), [ev('agent_spoke', { agentId: 'fisher', text: 'hello' })])).toBeNull()
  })
  it('dead agents emote nothing at all', () => {
    expect(
      emoteFor(agent({ alive: false }), [
        ev('agent_injured', { agentId: 'farmer', kind: 'grave' }),
      ]),
    ).toBeNull()
  })
  it('is null when calm', () => {
    expect(emoteFor(agent(), [])).toBeNull()
  })
})

describe('character hit area + name tag', () => {
  it('pins the generous hit rect constants', () => {
    expect(HIT_AREA_W).toBe(52)
    expect(HIT_AREA_H).toBe(72)
    expect(HIT_AREA_H).toBeGreaterThan(64) // taller than the sprite's default art bounds
  })
  it('hitRect at scale 1 is the raw local rect', () => {
    expect(hitRect(1)).toEqual({ x: -HIT_AREA_W / 2, y: -HIT_AREA_H, w: HIT_AREA_W, h: HIT_AREA_H })
  })
  it('hitRect inflates local space so the screen rect stays 52×72 at v4 scales', () => {
    expect(hitRect(0.0625)).toEqual({ x: -416, y: -1152, w: 832, h: 1152 })
  })
  it('hitRect screen-size invariant: w·s === HIT_AREA_W for any scale', () => {
    for (const s of [1, 0.8125, 52 / 840, 0.0625]) {
      const r = hitRect(s)
      expect(r.w * s).toBeCloseTo(HIT_AREA_W, 9)
      expect(r.h * s).toBeCloseTo(HIT_AREA_H, 9)
      expect(r.x * s).toBeCloseTo(-HIT_AREA_W / 2, 9)
      expect(r.y * s).toBeCloseTo(-HIT_AREA_H, 9)
    }
  })
  it('name-tag text is the agent name, truncated to the slab', () => {
    expect(nameTagText('Omar')).toBe('Omar')
    const long = nameTagText('A very long founder name beyond the slab')
    expect(long).toHaveLength(NAME_TAG_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
  })
})

// ══════════════════════════════════════════════════════════════════════════════════════════
// THE WALK
// ══════════════════════════════════════════════════════════════════════════════════════════

const SHARED_CONFIG_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'shared', 'src', 'config.ts'),
  'utf8',
)

// ── the superseded scheduler, restated so the before-state is measured, not remembered ─────
const LANDED_GLIDE_MIN = 200,
  LANDED_GLIDE_MAX = 4000
type Body = { path: Waypoint[]; lastMoveArrival: number; legMs: number }

function landedPush(b: Body, x: number, y: number, nowMs: number): void {
  const last = b.path[b.path.length - 1]!
  const glide = Math.min(LANDED_GLIDE_MAX, Math.max(LANDED_GLIDE_MIN, nowMs - b.lastMoveArrival))
  b.path.push({ x, y, atMs: Math.max(nowMs, last.atMs) + glide })
  b.lastMoveArrival = nowMs
}

/** One walk played at 60 fps, reported as the two things a viewer feels: how far behind the record the body is drawn, and how much its own speed swings frame to frame. */
type Window = { maxLagTiles: number; p10: number; p90: number; spread: number }
function replay(opts: {
  tickMs: number
  tiles: number
  stillMsBefore: number
  jitterMs?: number
  landed: boolean
  perTile?: number
}): {
  maxLagTiles: number
  endLagTiles: number
  p10: number
  p90: number
  spread: number
  settled: Window
} {
  const { tickMs, tiles, stillMsBefore, landed } = opts
  const jitter = opts.jitterMs ?? 0
  const perTile = opts.perTile ?? 1
  const b: Body = { path: [{ x: 0, y: 0, atMs: 0 }], lastMoveArrival: 0, legMs: tickMs }
  let clock = initialTickClock()
  // one delta batch per tick; the body advances a tile every `perTile` of them
  const batches: { at: number; moved: number | null }[] = []
  for (let i = 0; i < tiles * perTile; i++) {
    const wobble = jitter === 0 ? 0 : ((i * 2654435761) % (2 * jitter + 1)) - jitter
    batches.push({
      at: stillMsBefore + i * tickMs + wobble,
      moved: (i + 1) % perTile === 0 ? Math.floor(i / perTile) + 1 : null,
    })
  }
  let bi = 0
  const samples: { t: number; x: number; sim: number }[] = []
  const end = batches[batches.length - 1]!.at + tickMs * perTile * 4
  for (let t = 0; t <= end; t += 1000 / 60) {
    while (bi < batches.length && batches[bi]!.at <= t) {
      const ba = batches[bi]!
      if (!landed) clock = observeTick(clock, ba.at, 1)
      if (ba.moved !== null) {
        if (landed) landedPush(b, ba.moved, 0, ba.at)
        else {
          b.legMs = clock.periodMs * perTile
          b.path = scheduleLeg(b.path, ba.moved, 0, {
            nowMs: ba.at,
            legMs: b.legMs,
            leadMs: clock.periodMs * WALK_LEAD_TICKS,
          })
        }
      }
      bi++
    }
    b.path = prunePath(b.path, t)
    const pos = interpolatePos(b.path, t)
    let sim = 0
    for (const ba of batches) if (ba.at <= t && ba.moved !== null) sim = ba.moved
    samples.push({ t, x: pos.x, sim })
  }
  // The renderer cannot know the world's tick rate until it has seen two batches, so the first
  // two are a stated transient rather than steady state. Everything is reported both ways.
  const settledFrom = stillMsBefore + 2 * tickMs
  const window = (
    from: number,
  ): { maxLagTiles: number; p10: number; p90: number; spread: number } => {
    const inWin = samples.filter((s) => s.t >= from)
    const lags = inWin.map((s) => s.sim - s.x)
    const speeds: number[] = []
    for (let i = 1; i < inWin.length; i++) {
      const d = inWin[i]!.x - inWin[i - 1]!.x
      if (d > 1e-9) speeds.push(d / (inWin[i]!.t - inWin[i - 1]!.t))
    }
    speeds.sort((p, q) => p - q)
    const p10 = speeds[Math.floor(speeds.length * 0.1)] ?? 0
    const p90 = speeds[Math.floor(speeds.length * 0.9)] ?? 0
    return { maxLagTiles: Math.max(...lags), p10, p90, spread: p10 > 0 ? p90 / p10 : Infinity }
  }
  const all = window(0)
  const settled = window(settledFrom)
  return {
    maxLagTiles: all.maxLagTiles,
    endLagTiles: samples[samples.length - 1]!.sim - samples[samples.length - 1]!.x,
    p10: all.p10,
    p90: all.p90,
    spread: all.spread,
    settled,
  }
}

describe('★ B1 — positions WERE interpolated; the jank was the schedule', () => {
  it('★ the landed scheduler falls TEN TILES behind and never catches up', () => {
    const before = replay({ tickMs: 400, tiles: 12, stillMsBefore: 20_000, landed: true })
    expect(before.maxLagTiles).toBeGreaterThan(9)
    // and it is still behind when the walk is over — the debt is appended, never absorbed
    expect(before.endLagTiles).toBeGreaterThan(5)
  })

  it('★ the record-driven schedule stays inside its own buffer, at every tick rate', () => {
    // The renderer cannot know the world's rate until two batches have arrived, so the first leg
    // goes against the declared default; both the transient and the settled window are asserted.
    const rows: string[] = []
    let worstAll = 0,
      worstSettled = 0
    for (const tickMs of [120, 400, 1000, 2500]) {
      for (const stillMsBefore of [0, 400, 5000, 60_000]) {
        const a = replay({ tickMs, tiles: 12, stillMsBefore, landed: false })
        rows.push(
          `${String(tickMs).padStart(4)}ms/tick after ${String(stillMsBefore).padStart(5)}ms still: ` +
            `worst ${a.maxLagTiles.toFixed(2)} tiles, settled ${a.settled.maxLagTiles.toFixed(2)}`,
        )
        worstAll = Math.max(worstAll, a.maxLagTiles)
        worstSettled = Math.max(worstSettled, a.settled.maxLagTiles)
      }
    }

    console.log('LAG BEHIND THE RECORD, tiles\n  ' + rows.join('\n  '))
    // The bound is on TIME and it is structural: `scheduleLeg` never lets the tail sit more than
    // `legMs + leadMs` ahead of now, so two ticks of time can briefly hold over two tiles.
    expect(worstSettled).toBeLessThanOrEqual(3)
    expect(worstAll).toBeLessThanOrEqual(3)
    // and the landed version, over the same walk, was ten and still growing
    expect(
      replay({ tickMs: 400, tiles: 12, stillMsBefore: 20_000, landed: true }).maxLagTiles,
    ).toBeGreaterThan(9)
  })

  it('★ the schedule can never hold more than two ticks of future — the structural bound', () => {
    // this is the thing the tile figure above is a consequence of, asserted directly, over a
    // world that stalls, resumes, and runs at three different rates
    let p: Waypoint[] = [{ x: 0, y: 0, atMs: 0 }]
    let now = 0
    for (let i = 1; i <= 200; i++) {
      const legMs = [120, 400, 400, 1000][i % 4]!
      now += i % 37 === 0 ? 9000 : legMs // every so often the world stalls
      p = scheduleLeg(p, i, 0, { nowMs: now, legMs, leadMs: legMs * WALK_LEAD_TICKS })
      expect(p[p.length - 1]!.atMs - now, `push ${i}`).toBeLessThanOrEqual(
        legMs * (1 + WALK_LEAD_TICKS) + 1e-9,
      )
    }
  })

  it('★ and the pace stops lurching — the swing measured in the page is gone', () => {
    const before = replay({
      tickMs: 400,
      tiles: 12,
      stillMsBefore: 20_000,
      jitterMs: 60,
      landed: true,
    })
    const after = replay({
      tickMs: 400,
      tiles: 12,
      stillMsBefore: 20_000,
      jitterMs: 60,
      landed: false,
    })

    console.log(
      `PACE SWING p90/p10 — landed ${before.settled.spread.toFixed(1)}x, ` +
        `now ${after.settled.spread.toFixed(2)}x`,
    )
    expect(before.settled.spread).toBeGreaterThan(3)
    expect(after.settled.spread).toBeLessThan(1.35)
  })

  it("a slow batch is absorbed by the buffer instead of becoming the walk's new speed", () => {
    const steady = replay({ tickMs: 400, tiles: 20, stillMsBefore: 0, landed: false })
    const jittery = replay({
      tickMs: 400,
      tiles: 20,
      stillMsBefore: 0,
      jitterMs: 120,
      landed: false,
    })
    expect(jittery.settled.spread).toBeLessThan(steady.settled.spread + 0.5)
    expect(jittery.settled.maxLagTiles).toBeLessThanOrEqual(3)
  })

  it('a body that moves every OTHER tick walks at half speed and still stays bounded', () => {
    const r = replay({ tickMs: 400, tiles: 10, stillMsBefore: 0, landed: false, perTile: 2 })
    expect(r.settled.maxLagTiles).toBeLessThanOrEqual(3)
    // half the tiles in the same wall time: the median frame covers about half the ground
    const fast = replay({ tickMs: 400, tiles: 10, stillMsBefore: 0, landed: false, perTile: 1 })
    expect(r.settled.p90).toBeLessThan(fast.settled.p90 * 0.75)
  })
})

describe('the tick clock — measured, not assumed', () => {
  it('starts at the declared default and is replaced by the FIRST real measurement', () => {
    expect(initialTickClock().periodMs).toBe(TICK_PERIOD_SEED_MS)
    let c = initialTickClock()
    c = observeTick(c, 1000) // first batch: only a timestamp, a gap needs two
    expect(c.periodMs).toBe(TICK_PERIOD_SEED_MS)
    c = observeTick(c, 1400)
    expect(c.periodMs).toBe(400) // replaced outright, not averaged with 2500
  })

  it('converges on a rate and then holds it against noise', () => {
    let c = initialTickClock()
    let t = 0
    for (let i = 0; i < 40; i++) {
      t += 400 + ((i * 7919) % 41) - 20
      c = observeTick(c, t)
    }
    expect(c.periodMs).toBeGreaterThan(380)
    expect(c.periodMs).toBeLessThan(420)
  })

  it("refuses a pause, a resume and a scrub — they are not the world's cadence", () => {
    let c = initialTickClock()
    c = observeTick(c, 0)
    c = observeTick(c, 400)
    const steady = c.periodMs
    c = observeTick(c, 400 + TICK_PERIOD_MAX_MS + 1) // the tab was in the background
    expect(c.periodMs).toBe(steady)
    c = observeTick(c, 400 + TICK_PERIOD_MAX_MS + 1 + 5) // a burst faster than any world
    expect(c.periodMs).toBe(steady)
  })

  it('divides a catch-up burst by the ticks it carried', () => {
    let c = initialTickClock()
    c = observeTick(c, 0, 1)
    c = observeTick(c, 2000, 5) // five ticks arrived at once
    expect(c.periodMs).toBe(400)
  })
})

describe('scheduleLeg — the queue can never run away from the world', () => {
  it('★ compressing the queue never MOVES the body — the position at this instant is kept', () => {
    // the guarantee is not that a timestamp survives; it is that nothing jumps
    const p: Waypoint[] = [
      { x: 0, y: 0, atMs: 0 },
      { x: 1, y: 0, atMs: 5000 },
    ]
    for (const nowMs of [0, 1, 100, 2500, 4999]) {
      const before = interpolatePos(p, nowMs)
      const out = scheduleLeg(p, 2, 0, { nowMs, legMs: 400, leadMs: 400 })
      const after = interpolatePos(out, nowMs)
      expect(after.x, `at ${nowMs}`).toBeCloseTo(before.x, 9)
      expect(after.y, `at ${nowMs}`).toBeCloseTo(before.y, 9)
    }
  })

  it('and it stays monotone — the body never walks a tile it has already left', () => {
    const p: Waypoint[] = [
      { x: 0, y: 0, atMs: 0 },
      { x: 1, y: 0, atMs: 5000 },
      { x: 2, y: 0, atMs: 9000 },
    ]
    const out = scheduleLeg(p, 3, 0, { nowMs: 100, legMs: 400, leadMs: 400 })
    for (let i = 1; i < out.length; i++)
      expect(out[i]!.atMs).toBeGreaterThanOrEqual(out[i - 1]!.atMs)
    expect(out.map((w) => w.x)).toEqual([0, 1, 2, 3].map((v) => (v === 0 ? out[0]!.x : v)))
  })

  it('caps the tail at one leg plus one tick of buffer', () => {
    let p: Waypoint[] = [{ x: 0, y: 0, atMs: 0 }]
    for (let i = 1; i <= 30; i++) {
      p = scheduleLeg(p, i, 0, { nowMs: i * 400, legMs: 400, leadMs: 400 })
      expect(p[p.length - 1]!.atMs - i * 400).toBeLessThanOrEqual(800.001)
    }
  })

  it('starts a standing body moving at once rather than after four seconds', () => {
    const p = scheduleLeg([{ x: 0, y: 0, atMs: 0 }], 1, 0, {
      nowMs: 60_000,
      legMs: 400,
      leadMs: 400,
    })
    expect(p[1]!.atMs - 60_000).toBe(400)
  })

  it('is pure — it returns a new array and leaves the old one alone', () => {
    const p: Waypoint[] = [{ x: 0, y: 0, atMs: 0 }]
    const out = scheduleLeg(p, 1, 0, { nowMs: 0, legMs: 400, leadMs: 400 })
    expect(p).toHaveLength(1)
    expect(out).not.toBe(p)
  })
})

describe('★ the legs follow the ground — the foot-slide half of "janky"', () => {
  it('★ reproduces the landed 180 ms cadence exactly at the rate the feedback was given', () => {
    // the derivation, stated as an identity rather than as a comment
    expect(strideFrameMs(400)).toBe(WALK_FRAME_MS_V4)
    expect((STRIDE_TILES * 400) / WALK_LOOP.length).toBe(WALK_FRAME_MS_V4)
  })

  it('a body crossing a tile in half the time cycles its legs twice as fast', () => {
    expect(strideFrameMs(200) * 2).toBeCloseTo(strideFrameMs(400), 6)
  })

  it('★ ONE GAIT CYCLE CARRIES THE SAME GROUND at every speed inside the band', () => {
    for (const msPerTile of [200, 300, 400, 600, 800]) {
      const tilesPerCycle = (strideFrameMs(msPerTile) * WALK_LOOP.length) / msPerTile
      expect(tilesPerCycle, `${msPerTile}ms/tile`).toBeCloseTo(STRIDE_TILES, 6)
    }
  })

  it('and the LANDED fixed cadence did not — that is the slide, in tiles per cycle', () => {
    const landed = (msPerTile: number): number => (WALK_FRAME_MS_V4 * WALK_LOOP.length) / msPerTile
    expect(landed(400)).toBeCloseTo(1.8, 6) // right, by luck, at one rate only
    expect(landed(200)).toBeCloseTo(3.6, 6) // twice the ground per cycle: skating
    expect(landed(2500)).toBeCloseTo(0.288, 3) // a third of a step per tile: mincing
  })

  it('clamps outside the band, and says where the band ends', () => {
    expect(strideFrameMs(1)).toBe(WALK_FRAME_MIN_MS)
    expect(strideFrameMs(1e6)).toBe(WALK_FRAME_MAX_MS)
    expect(WALK_FRAME_MIN_MS).toBeLessThan(WALK_FRAME_MAX_MS)
  })
})

describe('★ B2 — five people, five gaits, and none of them from a random number', () => {
  const FOUNDERS = ['omar', 'amara', 'yusuf', 'nadia', 'salma']
  const walking = { asleep: false, collapsed: false, walking: true, facing: 'se' as const }

  it('★ THE DEFECT: with one shared clock every walking body is on the SAME frame', () => {
    const rows = FOUNDERS.map(() => charPose({ ...walking, nowMs: 1234.5 }, WALK_FRAME_MS_V4).row)
    expect(new Set(rows).size).toBe(1)
  })

  it('★ THE FIX: at the same instant the five are spread across the loop', () => {
    const rows = FOUNDERS.map(
      (id) =>
        charPose({ ...walking, nowMs: 1234.5 }, WALK_FRAME_MS_V4, { phase: gaitOf(id).phase }).row,
    )
    expect(new Set(rows).size).toBeGreaterThanOrEqual(3)
  })

  it('and they are spread at every instant, not just a lucky one', () => {
    let worst = 4
    for (let t = 0; t < 3000; t += 37) {
      const rows = FOUNDERS.map(
        (id) =>
          charPose({ ...walking, nowMs: t }, WALK_FRAME_MS_V4, { phase: gaitOf(id).phase }).row,
      )
      worst = Math.min(worst, new Set(rows).size)
    }
    expect(worst).toBeGreaterThanOrEqual(2)
  })

  it('★ the variance is DETERMINISTIC — the same id gives the same gait, always', () => {
    for (const id of FOUNDERS) expect(gaitOf(id)).toEqual(gaitOf(id))
    expect(gaitOf('omar')).not.toEqual(gaitOf('omar '))
  })

  it('★ AND IT IS PINNED, so two viewers of one replay see the same town', () => {
    // The literals are the point: change the hash, the mix or the spread and every character in
    // every recording walks differently.
    expect(FOUNDERS.map((id) => hash32(id))).toEqual([
      3866124158, 3817335319, 909508363, 327684010, 1753767877,
    ])
    expect(FOUNDERS.map((id) => Number(gaitOf(id).phase.toFixed(6)))).toEqual([
      0.373016, 0.914413, 0.996262, 0.061188, 0.3741,
    ])
    expect(FOUNDERS.map((id) => Number(gaitOf(id).stride.toFixed(6)))).toEqual([
      1.096035, 1.093307, 0.930819, 0.898311, 0.977998,
    ])
  })

  it('★ NO RANDOM SOURCE EXISTS in the two files that decide how a body moves', () => {
    // comments are stripped first, deliberately: the prose in those files names `Math.random()`
    // while explaining why it is never called
    const code = (rel: string): string =>
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
    for (const rel of ['charAnim.ts', 'characters.ts']) {
      expect(code(rel), `${rel} reaches for randomness`).not.toMatch(
        /Math\.random|crypto\.getRandomValues/,
      )
      // nor for the wall clock as a source of variance — Date.now differs between two viewers
      expect(code(rel), `${rel} uses Date.now`).not.toMatch(/Date\.now/)
    }
    // and the stripper leaves code alone, so the scan is not passing on an empty string
    expect(code('charAnim.ts')).toContain('export function gaitOf')
    expect(code('charAnim.ts').length).toBeGreaterThan(1500)
  })

  it('the spread is bounded, so nobody moonwalks and nobody sprints', () => {
    for (let i = 0; i < 500; i++) {
      const g = gaitOf(`agent-${i}`)
      expect(g.phase).toBeGreaterThanOrEqual(0)
      expect(g.phase).toBeLessThan(1)
      expect(g.stride).toBeGreaterThanOrEqual(1 - GAIT_STRIDE_SPREAD)
      expect(g.stride).toBeLessThanOrEqual(1 + GAIT_STRIDE_SPREAD)
    }
  })

  it('the hash actually spreads — 500 ids fill the phase circle rather than clumping', () => {
    const buckets = new Array(8).fill(0)
    for (let i = 0; i < 500; i++) buckets[Math.floor(gaitOf(`agent-${i}`).phase * 8)]++
    for (const [i, n] of buckets.entries()) expect(n, `bucket ${i}`).toBeGreaterThan(20)
  })

  // Every rate, not just the dev world's: at the shipped 2000 ms a tile the clamp binds, so a
  // guard made only at 400 ms passes while all five founders share one cadence.
  it('★ five founders keep five cadences at EVERY rate, the shipped one included', () => {
    const rows: string[] = [],
      inStep: string[] = []
    for (const msPerTile of [120, 400, 1000, TICK_REAL_MS, 6000]) {
      const ms = FOUNDERS.map((id) => strideFrameMs(msPerTile, gaitOf(id).stride))
      const distinct = new Set(ms.map((v) => v.toFixed(4))).size
      rows.push(
        `${String(msPerTile).padStart(4)} ms/tile → ${ms.map((v) => v.toFixed(1)).join(' ')}`,
      )
      if (distinct < FOUNDERS.length) inStep.push(`${msPerTile} ms/tile: ${distinct} of 5 cadences`)
    }

    console.log('WALK CADENCE PER FOUNDER, ms/frame\n  ' + rows.join('\n  '))
    expect(inStep).toEqual([])
  })

  it("★ and the clamp still holds the world's own cadence — the stride only varies it", () => {
    // the band is on the NOMINAL cadence; a body may sit at most one gait spread outside it
    for (const msPerTile of [1, 120, 400, 2500, 100_000]) {
      for (const id of [...FOUNDERS, 'agent-0', 'agent-499']) {
        const v = strideFrameMs(msPerTile, gaitOf(id).stride)
        expect(v).toBeGreaterThanOrEqual(WALK_FRAME_MIN_MS * (1 - GAIT_STRIDE_SPREAD))
        expect(v).toBeLessThanOrEqual(WALK_FRAME_MAX_MS * (1 + GAIT_STRIDE_SPREAD))
      }
      expect(strideFrameMs(msPerTile)).toBeGreaterThanOrEqual(WALK_FRAME_MIN_MS)
      expect(strideFrameMs(msPerTile)).toBeLessThanOrEqual(WALK_FRAME_MAX_MS)
    }
    // the landed identity is untouched: the dev world's 400 ms a tile IS the v4 cadence
    expect(strideFrameMs(400)).toBe(WALK_FRAME_MS_V4)
  })

  it('★ a stride difference changes the LEG CADENCE and never the ground speed', () => {
    // the speed is the record's; the stride is the body's. A longer stride is a slower cycle
    // over the same ground, which is what a taller person does.
    const a = gaitOf('amara'),
      b = gaitOf('yusuf')
    expect(a.stride).not.toBe(b.stride)
    expect(strideFrameMs(400, a.stride)).not.toBe(strideFrameMs(400, b.stride))
    // and the leg duration — the thing that moves the body — has no gait term at all
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'characters.ts'), 'utf8')
    const leg = /e\.legMs = [^\n]*/.exec(src)?.[0] ?? ''
    expect(leg).toContain('clock.periodMs / perTick')
    expect(leg).not.toMatch(/gait|stride|phase/)
  })
})

describe('★ gait follows what a person is DOING, from state that already existed', () => {
  it('★ the engine already walks a debuffed body slower — this is that rule, restated', () => {
    const well = { hunger: 90, energy: 90, warmth: 90, social: 90 }
    const hungry = { hunger: 5, energy: 90, warmth: 90, social: 90 }
    const cfg = { debuffThreshold: 30, base: 3, debuff: 2 }
    expect(tilesPerTickFor(well, cfg)).toBe(3)
    expect(tilesPerTickFor(hungry, cfg)).toBe(2)
    // so a hurrying body's legs cycle faster than an ailing one's, on the same clock
    expect(strideFrameMs(TICK_REAL_MS / tilesPerTickFor(well, cfg))).toBeLessThan(
      strideFrameMs(TICK_REAL_MS / tilesPerTickFor(hungry, cfg)),
    )
  })

  it("the fallback numbers are the schema's own defaults, read off config.ts", () => {
    expect(SHARED_CONFIG_SRC).toContain(
      `debuffThreshold: z.number().default(${MOVEMENT_FALLBACK.debuffThreshold})`,
    )
    expect(SHARED_CONFIG_SRC).toContain(
      `baseTilesPerTick: z.number().default(${MOVEMENT_FALLBACK.base})`,
    )
    expect(SHARED_CONFIG_SRC).toContain(
      `debuffTilesPerTick: z.number().default(${MOVEMENT_FALLBACK.debuff})`,
    )
  })
})

describe('★ prefers-reduced-motion: the person still walks, the flourish goes', () => {
  const walking = {
    asleep: false,
    collapsed: false,
    walking: true,
    facing: 'se' as const,
    nowMs: 180,
  }

  it('keeps the walk cycle — a body with still legs sliding along the ground is worse', () => {
    const off = charPose(walking, WALK_FRAME_MS_V4, { bob: false })
    expect(off.row).toBe('passing-a')
    expect(WALK_LOOP as readonly string[]).toContain(off.row)
  })

  it('drops the 1 px passing hop, which is a 2.8 Hz square wave and nothing else', () => {
    expect(charPose(walking, WALK_FRAME_MS_V4, { bob: true }).bobY).toBe(BOB_PX)
    expect(charPose(walking, WALK_FRAME_MS_V4, { bob: false }).bobY).toBe(0)
    // over a whole loop, every frame
    for (let t = 0; t < WALK_FRAME_MS_V4 * WALK_LOOP.length; t += 10) {
      expect(charPose({ ...walking, nowMs: t }, WALK_FRAME_MS_V4, { bob: false }).bobY).toBe(0)
    }
  })

  it('★ interpolation is NOT a flourish and survives — the person is still going somewhere', () => {
    // Not a count of call sites: a count cannot tell a new legitimate flourish from a leak into
    // the walk schedule, so every occurrence must BE one of the flourishes named here.
    const FLOURISHES: readonly { what: string; line: RegExp }[] = [
      {
        what: 'the 1px passing hop',
        line: /^\{ phase: e\.gait\.phase, bob: scene\.wantsMotion\(\) \},$/,
      },
      { what: 'a crowd re-forming into its rank', line: /^const t = scene\.wantsMotion\(\)$/ },
    ]
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'characters.ts'), 'utf8')
    const sites = src
      .split('\n')
      .map((l, i) => ({ n: i + 1, t: l.trim() }))
      .filter((l) => l.t.includes('wantsMotion()'))

    const undeclared = sites.filter((s) => !FLOURISHES.some((f) => f.line.test(s.t)))
    expect(undeclared.map((s) => `characters.ts:${s.n} — ${s.t}`)).toEqual([])
    // and every declared flourish is really there, so the list cannot rot into a permit
    for (const f of FLOURISHES) {
      expect(
        sites.some((s) => f.line.test(s.t)),
        `no call site for ${f.what}`,
      ).toBe(true)
    }
    // the schedule is not one of them: nothing that decides WHERE a body is asks the flag
    for (const call of ['scheduleLeg(', 'interpolatePos(', 'prunePath(', 'tilesPerTickFor(']) {
      for (const l of src.split('\n')) {
        if (l.includes(call)) expect(l).not.toContain('wantsMotion')
      }
    }
  })

  it('the canvas asks ONE owner, so no surface can be forgotten', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const rig = readFileSync(join(here, 'cameraRig.ts'), 'utf8')
    expect(rig.split("matchMedia('(prefers-reduced-motion: reduce)')").length - 1).toBe(1)
    // exported on the Scene from the rig that owns it, never re-derived
    expect(readFileSync(join(here, 'scene.ts'), 'utf8')).toContain('wantsMotion: rig.wantsMotion')
  })
})

describe('charPose keeps its landed shape', () => {
  const base = { asleep: false, collapsed: false, walking: true, facing: 'se' as const, nowMs: 0 }
  it('an absent phase is the old shared clock, exactly', () => {
    for (let t = 0; t < 2000; t += 13) {
      expect(charPose({ ...base, nowMs: t }, WALK_FRAME_MS_V4).row).toBe(
        charPose({ ...base, nowMs: t }, WALK_FRAME_MS_V4, { phase: 0 }).row,
      )
    }
  })

  it('a phase of a whole cycle is no phase at all', () => {
    expect(charPose({ ...base, nowMs: 500 }, WALK_FRAME_MS_V4, { phase: 1 }).row).toBe(
      charPose({ ...base, nowMs: 500 }, WALK_FRAME_MS_V4).row,
    )
  })

  it('a clock that ran backwards still names a real frame', () => {
    for (const nowMs of [-1, -1000, -12345.6]) {
      expect(WALK_LOOP as readonly string[]).toContain(
        charPose({ ...base, nowMs }, WALK_FRAME_MS_V4, { phase: 0.7 }).row,
      )
    }
  })

  it('sleep and collapse outrank a gait — a still body has no phase', () => {
    expect(charPose({ ...base, asleep: true }, 180, { phase: 0.9 }).row).toBe('sleep')
    expect(charPose({ ...base, collapsed: true }, 180, { phase: 0.9 }).bobY).toBe(0)
    expect(charPose({ ...base, walking: false }, 180, { phase: 0.9 }).row).toBe('idle')
  })
})
