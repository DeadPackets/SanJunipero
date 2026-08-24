// @slow — ★ THE PROOF THAT SOMETHING IN THE RUNNING APP CAN BUILD.
//
// Merge train 3's second finding: "a ring-3 town is reachable, but nothing will ever be built
// in it." The engine could grow a town, plat rings and cross a river; the dev world's agent
// policy had four verbs in it — walk, sleep, enter, exit — and no mason. Everything the
// claim-seam, town-growth and far-bank lanes built was proved on engine fixtures and had no
// reachable surface at all.
//
// ★ AND THE SEAM DID NOT FIT, WHICH IS THE FINDING UNDER THE FINDING. The engine locates the
// town by reading the AUTHORED `TOWN_SQUARE` (65, 78) less `state.origin`. The showcase town is
// the same `makeCityTemplate` town at its own anchor — square (68, 68) at ring 3 — and the dev
// world carried no origin, so `townSquareOf` looked at (65, 78), found a paved tile of the
// plaza's own street ring, and answered. Every plot it offered sat off the lattice that is
// drawn, and `layBlock` would have paved a second grid across the first. `devWorldOrigin` says
// where the array stands; the agreement test below is what makes that a derivation.
//
// Scripted masons, declared as such in `founders.ts`. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import {
  CITY_GROUND, TOWN_SQUARE, T_ROAD, freePlots, grammarOf, plotExtent, stateHash, townOrigin,
} from '@sj/shared'
import {
  EventStore, RngStreams, TickLoop, claimInWorld, openDb, standingRects, townGroundOf, townSquareOf,
  type WorldState,
} from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState, devTerrain } from './devWorld.js'
import { devTownSquare, devWorldOrigin } from './devTown.js'
import { FOUNDERS, foundersFor, makeFoundersOnTick, townStructuresFor } from './founders.js'

const TICKS = 4320
const RINGS = 3
const GENESIS_STRUCTURES = 11

type Seen = { type: string; tick: number; payload: Record<string, unknown> }
type Run = { state: WorldState; events: Seen[] }

function runDevWorld(builders: boolean, rings = RINGS, ticks = TICKS): Run {
  const config = SHOWCASE_CONFIG
  const terrain = devTerrain('showcase', rings)
  const structures = townStructuresFor('showcase', rings)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('g6')
  const events: Seen[] = []
  const inner = makeFoundersOnTick(config, rng, () => loop.state, {
    interiors: true, builders, structures, founders: foundersFor(structures), holdings: true,
  })
  const loop: TickLoop = new TickLoop({
    store, state: devGenesisState(config, terrain, 'showcase', rings), rng, config,
    snapshotEveryTicks: 720,
    onTick: (ctx) => inner({
      tick: ctx.tick,
      emit: (type, payload) => {
        events.push({ type, tick: ctx.tick, payload: (payload ?? {}) as Record<string, unknown> })
        ctx.emit(type, payload)
      },
    }),
  })
  for (let t = 0; t < ticks; t++) loop.step()
  return { state: loop.state, events }
}

// ── the frame, which everything below stands on ──────────────────────────────────────────────

describe('★ the dev world says where its array stands, so the engine can find its town', () => {
  it('★ THE AGREEMENT: under this origin the showcase channel IS the grammar’s channel', () => {
    // The grammar knows one river, at `CITY_GROUND` dx −17…−15 off the square. If the derived
    // origin is right, the water the showcase actually LAYS reads as those same three columns
    // in the authored frame — at every ring count, which is what makes it a derivation and not
    // a number that happens to work at three rings.
    for (const rings of [1, 2, 3, 4]) {
      const terrain = devTerrain('showcase', rings)
      const origin = devWorldOrigin(rings)
      const square = devTownSquare(rings)
      const wet: number[] = []
      for (let x = 0; x < terrain[0]!.length; x++) {
        if (terrain.some((row) => row[x] === 2)) wet.push(x + origin.x)
      }
      expect(wet, `rings=${rings}: the showcase river in the authored frame`).toEqual([48, 49, 50])
      // and the grammar agrees about the same three columns, off its own square
      for (const authored of wet) expect(CITY_GROUND(authored - TOWN_SQUARE.x, 0), `${authored}`).toBe('water')
      expect(square).toEqual({ x: 8 + townOrigin(rings), y: 8 + townOrigin(rings) })
    }
  })

  it('★ and the engine now finds the square the town is actually drawn around', () => {
    const rings = RINGS
    const terrain = devTerrain('showcase', rings)
    const state = devGenesisState(SHOWCASE_CONFIG, terrain, 'showcase', rings)
    expect(townSquareOf(state)).toEqual(devTownSquare(rings))
    // ★ THE BEFORE-STATE, AND THE ENGINE HAZARD BEHIND IT, NOW CLOSED. With no origin the
    // engine did not fail, it ANSWERED — `(65, 78)`, a different tile ten rows north of the
    // square that is drawn, which happens to be paved. That was the vacuous-guard family's
    // fourteenth member: a passing condition (one tile is road) satisfiable without the
    // property (this world's town is centred here). `townSquareOf` asks about the whole
    // plaza now, so the blind lookup REFUSES instead of lying, and the origin below is what
    // makes it answer.
    expect(townSquareOf({ ...state, origin: undefined }),
      'the engine still answers about a town that is not there').toBeNull()
    expect(devTownSquare(rings)).not.toEqual({ x: TOWN_SQUARE.x, y: TOWN_SQUARE.y })
  })

  it('leaves the frozen fixture with no origin and no town, which is the truth about it', () => {
    const state = devGenesisState(SHOWCASE_CONFIG, devTerrain('scripted'), 'scripted')
    expect(state.origin).toBeUndefined()
    expect(townSquareOf(state)).toBeNull()
  })
})

// ── the mason ────────────────────────────────────────────────────────────────────────────────

describe('★ THE DEV WORLD BUILDS — houses appear on plots the town claims', () => {
  const run = runDevWorld(true)
  const raised = run.events.filter((e) => e.type === 'structure_planned' && e.tick > 1)
  const finished = run.events.filter((e) => e.type === 'structure_completed' && e.tick > 1)

  it('★ agents raise houses, through the real build verb, in a world a viewer can open', () => {
    expect(raised.length, 'nothing was built').toBeGreaterThan(20)
    expect(finished.length, 'nothing was finished').toBeGreaterThan(20)
    expect(standingRects(run.state).length).toBe(GENESIS_STRUCTURES + raised.length)
    // ★ AND EVERY ONE OF THEM WAS UNDER SCAFFOLDING FOR A WHILE, which is the thing a viewer
    // is meant to catch: a roof that appears between one frame and the next was never built.
    const planned = new Map(raised.map((e) => [String(e.payload['id']), e.tick]))
    for (const e of finished) {
      const at = planned.get(String(e.payload['id']))
      expect(at, `${String(e.payload['id'])} completed without being planned`).toBeDefined()
      // At least the recipe's own ticks, and sometimes half again: `workPenalty` charges the
      // dark for work, so a roof begun at dusk takes 360 where one begun at noon takes 240.
      expect(e.tick - at!, 'a house went up in one tick')
        .toBeGreaterThanOrEqual(SHOWCASE_CONFIG.construction.houseTicks)
    }
  })

  it('★ AND NOT ONE OF THEM WAS TOLD WHERE — every build names {kind} and nothing else', () => {
    const builds = run.events.filter((e) => e.type === 'action_started' && e.payload['verb'] === 'build')
    expect(builds.length).toBeGreaterThan(20)
    for (const b of builds) {
      expect(Object.keys(b.payload['params'] as object).sort(), 'a coordinate reached the verb')
        .toEqual(['kind'])
    }
    // and it is a founder's hand on every one of them, not the tick-1 script's
    for (const e of raised) expect(FOUNDERS.map((f) => f.id)).toContain(String(e.payload['builderId']))
  })

  // ★ THE GUARD THAT CATCHES A LATTICE OFF ITS OWN FRAME, and it took a mutation to find the
  // one that does. "Not on water, not on a street tile" PASSES with the square ten rows out,
  // because a plot shifted by a third of a block still mostly lands on grass — mutation M8 is
  // saved beside this report showing it. What does not pass is PLOT CONTAINMENT: a house on a
  // shifted grid does not fit inside any plot of the lattice that is drawn. Same question
  // `townGrowth.test.ts` asks of its town, asked here of the dev world's own square.
  it('★ and every roof the town raised sits INSIDE a plot of the lattice that is drawn', () => {
    const square = devTownSquare(RINGS)
    const plots = freePlots(RINGS + 2, townGroundOf(run.state, square)).map((p) => plotExtent(p))
    const tiles = new Set<string>()
    for (const e of raised) {
      const x = Number(e.payload['x']), y = Number(e.payload['y'])
      const w = Number(e.payload['w']), h = Number(e.payload['h'])
      const g = grammarOf(square, { x, y })
      const inside = plots.some((p) =>
        p.dx <= g.dx && g.dx + w <= p.dx + p.w && p.dy <= g.dy && g.dy + h <= p.dy + p.h)
      expect(inside, `the house at ${x},${y} stands on no plot of this town`).toBe(true)
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
        const tile = run.state.terrain[y + dy]?.[x + dx]
        expect(tile, `${x + dx},${y + dy} is water`).not.toBe(2)
        expect(tile, `${x + dx},${y + dy} is off the map`).toBeDefined()
        expect(tile, `a roof stands in the street at ${x + dx},${y + dy}`).not.toBe(T_ROAD)
        expect(tiles.has(`${x + dx},${y + dy}`), 'two roofs on one tile').toBe(false)
        tiles.add(`${x + dx},${y + dy}`)
      }
    }
  })

  it('★ and the town claims a DIFFERENT plot each time — the register is not frozen at genesis', () => {
    const seats = new Set(raised.map((e) => `${String(e.payload['x'])},${String(e.payload['y'])}`))
    expect(seats.size).toBe(raised.length)
    // the claim still has somewhere to offer at the end, so the run did not stop for want of one
    expect(claimInWorld(run.state, { along: 2, deep: 2 })).not.toBeNull()
  })

  it('★ and the town survives building — nobody worked themselves onto the ground', () => {
    expect(run.events.filter((e) => e.type === 'agent_collapsed')).toEqual([])
    for (const f of FOUNDERS) expect(run.state.agents[f.id]!.alive, f.id).toBe(true)
  })

  it('★ and it is deterministic — a second run reaches the same town, roof for roof', () => {
    const twin = runDevWorld(true)
    expect(standingRects(twin.state)).toEqual(standingRects(run.state))
    expect(stateHash(twin.state)).toBe(stateHash(run.state))
  }, 180_000)

  it('builders OFF is the landed world exactly — eleven buildings and no more', () => {
    const off = runDevWorld(false, RINGS, 1440)
    expect(off.events.filter((e) => e.type === 'structure_planned' && e.tick > 1)).toEqual([])
    expect(standingRects(off.state).length).toBe(GENESIS_STRUCTURES)
  })
})
