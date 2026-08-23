// @slow — ★ THE END-TO-END PROOF OF THE CLAIM SEAM.
//
// Not "the claim returns a plot": a RUNNING WORLD, stepped tick by tick through the real
// `TickLoop` and the real `worldTick`, in which scripted bodies raise houses through the real
// `build` verb until the town crosses into ring 2 — and then every building standing in it is
// dry, in the world, road-fronted, one to a plot, and no closer to its neighbour than the
// floor the grammar proved exhaustively.
//
// The world-growth lane proved 3 488 buildings at ring 5 with 0 violations FROM THE GRAMMAR
// SIDE, by enumerating plots. This is the same claim from the AGENT side, where the only way a
// building can exist at all is that a body stood on the ground and worked for it.
//
// Scripted policies only. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import {
  MINUTES_PER_DAY, SimConfigSchema, TOWN_SQUARE, T_ROAD, centreOf, doorFrontOf, freePlots,
  grammarOf, place, plotExtent, ringsStanding, stateHash, type SimConfig,
} from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { replayFromGenesis } from './replay.js'
import { RngStreams } from './rng.js'
import { TickLoop } from './tickLoop.js'
import { createWorldTick } from './worldTick.js'
import { genesisState, type Structure, type TileId, type WorldState } from './state.js'
import { makeGenesisWorld } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { isAdjacentToRect } from './verbs.js'
import { claimInWorld, standingRects, townGroundOf } from './town.js'

// ★ ONE FIXTURE DIAL, AND IT IS DECLARED: a house takes four hours here instead of two days,
// so a town that reaches ring 2 fits inside a test suite. It changes how LONG a build takes
// and nothing whatever about WHERE it goes — `buildTicks` is read after the site is settled.
const HOUSE_TICKS = 240
const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  aging: { deathOfOldAgeEnabled: false },
  construction: { houseTicks: HOUSE_TICKS },
  structures: { recipes: { ...SimConfigSchema.parse({}).structures.recipes,
    house: { ...SimConfigSchema.parse({}).structures.recipes['house']!, durationTicks: HOUSE_TICKS } } },
})

const MASONS = 6
const DAYS = 3
const UPKEEP_EVERY = 240
const WET: ReadonlySet<number> = new Set([2, 10])

type Run = { loop: TickLoop; store: EventStore; genesisTerrain: TileId[][]; growths: number; refusals: number }

/**
 * Six masons who want roofs and nothing else. Each one asks the world where the ground is,
 * walks there, and builds. It never names a coordinate to build at, because after this lane
 * there is no such parameter — the two-step below is exactly what a mind reads out of the
 * perception line and, failing that, out of the refusal.
 */
function runTown(seed = 'claim-seam'): Run {
  const { terrain, events: genesis } = makeGenesisWorld(CFG)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams(seed)
  const worldTick = createWorldTick(CFG, rng)
  const ids = Array.from({ length: MASONS }, (_, i) => `mason_${i}`)
  let refusals = 0
  const loop: TickLoop = new TickLoop({
    store, state: genesisState(CFG, terrain), rng, config: CFG, snapshotEveryTicks: 720,
    onTick: ({ tick, emit }) => {
      if (tick === 1) {
        for (const e of genesis) emit(e.type, e.payload)
        ids.forEach((id, i) => emit('agent_spawned', {
          id, name: id, x: TOWN_SQUARE.x + i + 1, y: TOWN_SQUARE.y + 1, ageDays: 7300,
        }))
      }
      // FIXTURE UPKEEP, said out loud: this proof is about the lattice, not about the economy,
      // so the masons are fed and re-supplied on a fixed clock — the same device the scripted
      // G2 fixture uses to keep two bodies at a post for three days. Nothing here touches
      // where a building goes; every one of them still goes through `build`.
      if (tick % UPKEEP_EVERY === 0) {
        for (const id of ids) {
          if (loop.state.agents[id] === undefined) continue
          for (const need of ['hunger', 'energy', 'warmth', 'social'] as const) {
            emit('need_changed', { id, need, delta: 100 })
          }
          emit('thirst_changed', { id, delta: 100 })
        }
      }
      for (const e of worldTick(loop.state).events) emit(e.type, e.payload)

      let claim = claimInWorld(loop.state, { along: 2, deep: 2 })
      for (const id of ids) {
        const a = loop.state.agents[id]
        if (a === undefined || !a.alive || a.activity !== null) continue
        const wood = Object.values(loop.state.items)
          .filter((i) => i.kind === 'wood' && i.loc.t === 'agent' && i.loc.id === id)
          .reduce((s, i) => s + i.qty, 0)
        if (wood < 10) emit('item_spawned', { id: `wood_${id}_${tick}`, kind: 'wood', qty: 10, loc: { t: 'agent', id } })
        if (claim === null) continue
        if (isAdjacentToRect(a.x, a.y, claim.site)) {
          const b = submitIntent(loop.state, CFG, id, 'build', { kind: 'house' })
          if (!b.ok) { refusals++; continue }
          for (const e of b.events) emit(e.type, e.payload)
          claim = claimInWorld(loop.state, { along: 2, deep: 2 })
          continue
        }
        if (a.x === claim.door.x && a.y === claim.door.y) continue
        const w = submitIntent(loop.state, CFG, id, 'walk', { x: claim.door.x, y: claim.door.y })
        if (w.ok) for (const e of w.events) emit(e.type, e.payload)
      }
    },
  })
  for (let i = 0; i < DAYS * MINUTES_PER_DAY; i++) loop.step()
  return {
    loop, store, genesisTerrain: terrain, refusals,
    growths: store.readFrom(0).filter((e) => e.type === 'world_grown').length,
  }
}

/** The plot a standing building sits on, or null for the two monuments in the square. */
function plotOf(state: WorldState, s: Structure) {
  const g = grammarOf(TOWN_SQUARE, s)
  for (const plot of freePlots(6, townGroundOf(state, TOWN_SQUARE))) {
    const e = plotExtent(plot)
    if (e.dx <= g.dx && g.dx + s.w <= e.dx + e.w && e.dy <= g.dy && g.dy + s.h <= e.dy + e.h) return plot
  }
  return null
}

const ringOf = (s: { x: number; y: number }): number => {
  const g = grammarOf(TOWN_SQUARE, s)
  return Math.max(Math.abs(Math.floor(g.dx / 19)), Math.abs(Math.floor(g.dy / 19)))
}

const closestPairOf = (all: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): number => {
  let closest = Infinity
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const p = centreOf({ dx: all[i]!.x, dy: all[i]!.y, w: all[i]!.w, h: all[i]!.h })
      const q = centreOf({ dx: all[j]!.x, dy: all[j]!.y, w: all[j]!.w, h: all[j]!.h })
      closest = Math.min(closest, Math.hypot(p.sx - q.sx, p.sy - q.sy))
    }
  return closest
}

describe('★ agents build until the town reaches ring 2, and everything in it is still right', () => {
  const run = runTown()
  const state = run.loop.state
  const all = Object.values(state.structures)
  const built = all.filter((s) => s.builtBy?.startsWith('mason_') === true)
  const size = { w: state.terrain[0]!.length, h: state.terrain.length }

  it('the town crossed into ring 2, and it was agents that took it there', () => {
    // eslint-disable-next-line no-console
    console.log(`[claim-seam] ${DAYS * MINUTES_PER_DAY} ticks, ${MASONS} masons: ${built.length} agent builds`
      + ` (ring 1: ${built.filter((s) => ringOf(s) === 1).length}, ring 2: ${built.filter((s) => ringOf(s) === 2).length}),`
      + ` ${all.length} standing, world ${size.w}x${size.h}, ${run.growths} growths,`
      + ` closest pair ${closestPairOf(all.filter((s) => s.w > 1 || s.h > 1)).toFixed(4)} px`)
    expect(built.length).toBeGreaterThanOrEqual(20)
    expect(built.filter((s) => ringOf(s) === 2).length).toBeGreaterThanOrEqual(5)
    expect(ringsStanding(TOWN_SQUARE, standingRects(state), townGroundOf(state, TOWN_SQUARE))).toBe(2)
    for (const s of built) expect(s.kind).toBe('house')
  })

  it('★ and the world widened to hold it', () => {
    expect(run.growths).toBeGreaterThanOrEqual(2)
    expect(size.h).toBeGreaterThan(CFG.world.size.h)
    expect(size.w).toBeGreaterThan(CFG.world.size.w)
  })

  it('★ every building standing in the town is dry, in the world, and road-fronted', () => {
    let offPlot = 0
    let tiles = 0
    for (const s of all) {
      for (let y = s.y; y < s.y + s.h; y++)
        for (let x = s.x; x < s.x + s.w; x++) {
          // IN-WORLD: the array really addresses it.
          expect(state.terrain[y]?.[x], `${s.kind} off the world at ${x},${y}`).toBeDefined()
          // DRY: not one tile of it stands in water.
          expect(WET.has(state.terrain[y]![x]!), `${s.kind} in water at ${x},${y}`).toBe(false)
          tiles++
        }
      const plot = plotOf(state, s)
      if (plot === null) { offPlot++; continue }
      // ROAD-FRONTED: the door opens onto paving that is actually laid in the world's terrain,
      // not onto a road the template drew on paper.
      const along = plot.face === 'sw' ? s.w : s.h
      const deep = plot.face === 'sw' ? s.h : s.w
      const front = doorFrontOf(place(plot, s.kind, along, deep, null))
      const at = { x: TOWN_SQUARE.x + front.dx, y: TOWN_SQUARE.y + front.dy }
      expect(state.terrain[at.y]?.[at.x], `${s.kind} at ${s.x},${s.y} fronts ${at.x},${at.y}`).toBe(T_ROAD)
    }
    expect(all.length).toBe(built.length + 11)
    expect(tiles).toBeGreaterThan(4 * built.length)
    // The two off-plot ones are the well and the fire pit. They stand in the square, and block
    // (0,0) is never platted — so they have no plot and no frontage, by construction.
    expect(offPlot).toBe(2)
    expect(all.filter((s) => plotOf(state, s) === null).map((s) => s.kind).sort()).toEqual(['fire_pit', 'well'])
  })

  it('★ and no two of them are closer than the floor the grammar proved', () => {
    // 86.1626 px is the exhaustive floor over 2 496 pairings of BUILDINGS ON PLOTS. The two
    // monuments are 1x1 things standing in the paved square, which the lattice never platted
    // and the survey never measured; they are 73.7564 px apart and have been since genesis.
    expect(closestPairOf(all.filter((s) => s.w > 1 || s.h > 1))).toBeGreaterThanOrEqual(86.1626)
    expect(closestPairOf(all.filter((s) => s.w === 1 && s.h === 1))).toBeCloseTo(73.7564, 3)
  })

  it('★ and not one tile in the town holds two buildings, nor one plot two roofs', () => {
    const seen = new Set<string>()
    for (const s of all)
      for (let y = s.y; y < s.y + s.h; y++)
        for (let x = s.x; x < s.x + s.w; x++) {
          expect(seen.has(`${x},${y}`), `two buildings on ${x},${y}`).toBe(false)
          seen.add(`${x},${y}`)
        }
    const perPlot = new Map<string, number>()
    for (const s of all) {
      const plot = plotOf(state, s)
      if (plot === null) continue
      const k = `${plot.block.i},${plot.block.j}/${plot.slot}`
      perPlot.set(k, (perPlot.get(k) ?? 0) + 1)
    }
    expect(perPlot.size).toBe(all.length - 2)
    for (const [k, n] of perPlot) expect(n, k).toBe(1)
  })

  it('★ and the whole run replays from genesis, event for event, to the same hash', () => {
    // The genesis terrain is the loop's starting condition, not an event, so replay is handed
    // the same one. Everything after it — every street the town paved, every tree it felled,
    // every row the world grew — is in the log and nowhere else.
    expect(stateHash(replayFromGenesis(run.store, CFG, run.genesisTerrain))).toBe(stateHash(state))
  })

  it('★ and a second run of the same world reaches the same town, tile for tile', () => {
    const twin = runTown()
    expect(standingRects(twin.loop.state)).toEqual(standingRects(state))
    expect(stateHash(twin.loop.state)).toBe(stateHash(state))
  }, 60_000)
})
