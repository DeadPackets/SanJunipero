import { describe, it, expect } from 'vitest'
import {
  CHUNK_TILES,
  MINUTES_PER_DAY,
  SimConfigSchema,
  TOWN_RINGS_GENESIS,
  WORLD_MARGIN,
  chunkOf,
  chunksTouched,
  edgesOwed,
  stateHash,
  worldSizeForRings,
  type SimConfig,
} from '@sj/shared'
import { fold } from '../fold.js'
import { genesisTerrainAt } from '../geography.js'
import { findPath } from '../path.js'
import { RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { createWorldTick } from '../worldTick.js'
import { GROWABLE_FLOOR, authoredOrigin, builtBox, grownStrip, growthsSoFar } from './mapGrowth.js'
import { ev, grid, roundTrips } from '../testutil/world.js'

// A 32x32 world on a config whose world.size says 128 — the ordinary shape of a fixture, and
// the case the plan's size-derived growth counter got wrong.
const SIZE = 32
const base = (over: Record<string, unknown> = {}): SimConfig =>
  SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
    // Nothing else may write terrain at midnight: the wood seeds itself there.
    regrowth: { enabled: false },
    ...over,
  })
const CFG = base()

// The world the SYSTEM is measured in. A fixture below `GROWABLE_FLOOR` is a fixture and the
// rule says nothing about it by design; the fold tests below keep the small map on purpose.
const TOWN_SIZE = 128

const map = (n = SIZE): TileId[][] => grid(n)

function town(config = CFG, structures = 2, size = SIZE, at = { x: 10, y: 20 }): WorldState {
  let s = genesisState(config, map(size))
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 6, ageDays: 7300 }), config)
  for (let i = 0; i < structures; i++) {
    s = fold(
      s,
      ev('structure_planned', {
        id: `structure_${i + 1}`,
        kind: 'house',
        x: at.x + i * 3,
        y: at.y,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
      }),
      config,
    )
    s = fold(s, ev('structure_completed', { id: `structure_${i + 1}` }), config)
  }
  s = fold(
    s,
    ev('item_spawned', { id: 'item_1', kind: 'axe', qty: 1, loc: { t: 'tile', x: 7, y: 9 } }),
    config,
  )
  s = fold(
    s,
    ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 3, y: 3, plantedDay: 0 }),
    config,
  )
  return s
}

/** A pair of roofs in the north-west of a world big enough for the rule to have an opinion: nine
 *  rows short of its northern margin and ten columns short of its western one. */
const bigTown = (config = CFG): WorldState => town(config, 2, TOWN_SIZE, { x: 10, y: 9 })

// Midnight of day 1: hour 0, minute 0, and past tick 0 so the world has actually run.
const MIDNIGHT = MINUTES_PER_DAY

function tickAt(s: WorldState, tick: number, config = CFG, seed = 'grow') {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}

const grown = (r: { events: { type: string; payload: unknown }[] }) =>
  r.events.filter((e) => e.type === 'world_grown')

// The rule is a clearance: the world owes every side of the built set WORLD_MARGIN of ground and
// widens whichever side it is short on. No counter, no ceiling.
describe('mapGrowthSystem', () => {
  // Two roofs at 10..14 x 9..10 in a 128-tile world: ten short to the north, nine to the west,
  // and a hundred clear on the other two.
  const OWED = [
    { edge: 'n', owed: 10 },
    { edge: 'w', owed: 9 },
  ]

  it('reads what it owes off the built set, and off nothing else', () => {
    const s = bigTown()
    expect(builtBox(s)).toEqual({ dx0: 10, dy0: 9, dx1: 14, dy1: 10 })
    expect(edgesOwed(builtBox(s)!, { w: TOWN_SIZE, h: TOWN_SIZE }, WORLD_MARGIN)).toEqual(OWED)
    // An empty world owes nobody ground, however large it is.
    const empty = genesisState(CFG, map(TOWN_SIZE))
    expect(builtBox(empty)).toBeNull()
    expect(grown(tickAt(empty, MIDNIGHT))).toHaveLength(0)
  })

  // The floor is the smallest world a one-ring town needs — derived, not chosen — and below it
  // the rule stays silent rather than widening every test map in the repository forever.
  it('says nothing at all about a world that could not hold a town of one ring', () => {
    expect(GROWABLE_FLOOR).toBe(worldSizeForRings(TOWN_RINGS_GENESIS))
    expect(SIZE).toBeLessThan(GROWABLE_FLOOR)
    // The small fixture is owed ground on three sides and is not given a tile of it.
    expect(edgesOwed(builtBox(town())!, { w: SIZE, h: SIZE }, WORLD_MARGIN).length).toBe(3)
    expect(grown(tickAt(town(), MIDNIGHT))).toHaveLength(0)
    // One tile under the floor is silent; the floor itself is not.
    const under = town(CFG, 2, GROWABLE_FLOOR - 1, { x: 10, y: 9 })
    expect(grown(tickAt(under, MIDNIGHT))).toHaveLength(0)
    const at = town(CFG, 2, GROWABLE_FLOOR, { x: 10, y: 9 })
    expect(grown(tickAt(at, MIDNIGHT))).toHaveLength(1)
  })

  it('widens the first edge it owes, by exactly the ground it owes', () => {
    const r = tickAt(bigTown(), MIDNIGHT)
    expect(grown(r)).toHaveLength(1)
    expect(grown(r)[0]!.payload).toMatchObject({ edge: 'n', depth: 10 })
    expect(r.state.terrain).toHaveLength(TOWN_SIZE + 10)
    expect(r.state.terrain[0]).toHaveLength(TOWN_SIZE)
  })

  // One edge a night until it owes nothing, then quiet — and it never widens an edge twice
  // over, because the debt it just paid is gone from the next night's reading.
  it('works through every edge it owes, one a night, and then stops for good', () => {
    let s = bigTown()
    const steps: { edge: string; depth: number }[] = []
    for (let day = 1; day <= 6; day++) {
      const r = tickAt(s, day * MINUTES_PER_DAY)
      for (const e of grown(r)) {
        const p = e.payload as { edge: string; depth: number }
        steps.push({ edge: p.edge, depth: p.depth })
      }
      s = r.state
    }
    expect(steps).toEqual([
      { edge: 'n', depth: 10 },
      { edge: 'w', depth: 9 },
    ])
    expect(s.terrain).toHaveLength(TOWN_SIZE + 10)
    expect(s.terrain[0]).toHaveLength(TOWN_SIZE + 9)
    expect(
      edgesOwed(builtBox(s)!, { w: s.terrain[0]!.length, h: s.terrain.length }, WORLD_MARGIN),
    ).toEqual([])
  })

  // ★ NO CEILING. The old rule stopped at 192 tiles; this one is asked for a world an order of
  // magnitude past that and answers with the ground, because a clearance has no maximum.
  it('has no size it refuses to grow past', () => {
    const wide = 2048
    let s = genesisState(
      CFG,
      Array.from({ length: wide }, () => Array.from({ length: wide }, (): TileId => 0)),
    )
    s = fold(
      s,
      ev('structure_planned', {
        id: 'far',
        kind: 'house',
        x: wide - 4,
        y: wide - 4,
        w: 2,
        h: 2,
        maxHp: 50,
        flammable: true,
        builderId: 'a1',
      }),
      CFG,
    )
    s = fold(s, ev('structure_completed', { id: 'far' }), CFG)
    const r = tickAt(s, MIDNIGHT)
    expect(grown(r)[0]!.payload).toMatchObject({ edge: 'e', depth: 17 })
    expect(r.state.terrain[0]).toHaveLength(wide + 17)
  })

  it('does not grow away from midnight, and a flag off never grows at all', () => {
    expect(grown(tickAt(bigTown(), MIDNIGHT + 60))).toHaveLength(0)
    const off = base({ mapGrowth: { enabled: false } })
    expect(grown(tickAt(bigTown(off), MIDNIGHT, off))).toHaveLength(0)
  })

  it('carries the strip in the payload, sized to the edge it grew', () => {
    const north = grown(tickAt(bigTown(), MIDNIGHT))[0]!.payload as {
      depth: number
      tiles: number[][]
    }
    expect(north.depth).toBe(10)
    expect(north.tiles).toHaveLength(10)
    for (const row of north.tiles) expect(row).toHaveLength(TOWN_SIZE)
    const afterN = tickAt(bigTown(), MIDNIGHT).state
    const west = grown(tickAt(afterN, 2 * MINUTES_PER_DAY))[0]!.payload as { tiles: number[][] }
    expect(west.tiles).toHaveLength(TOWN_SIZE + 10)
    for (const row of west.tiles) expect(row).toHaveLength(9)
  })

  // genesisTerrainAt has no bounds in it: the world was always infinite and the array is only how
  // much of it is written down, so the ground that arrives was always going to be there.
  it('fills the strip from the authored world, in the frame the world will be in', () => {
    // Wide enough to see the difference: the channel at columns 48-50 runs at every row, so a
    // strip in the WRONG frame still finds a river. The frame only shows in the forest edge.
    const W = 100
    const wide = genesisState(
      CFG,
      Array.from({ length: SIZE }, () => Array.from({ length: W }, (): TileId => 0)),
    )
    const edgeOf = (row: number[]): number => row.findIndex((t) => t === 3)
    const north = grownStrip(wide, 'n', 3)
    expect(north).toHaveLength(3)
    for (let y = 0; y < 3; y++) {
      const row = north[y]!
      // The river is there, in the three columns it has always run in.
      expect(
        [...row.keys()].filter((x) => row[x] === 2),
        `row ${y - 3}`,
      ).toEqual([48, 49, 50])
      // Growing north moves the array's origin, so index 0 is authored row -3, not row 0.
      for (let x = 0; x < W; x++) expect(row[x], `${x},${y - 3}`).toBe(genesisTerrainAt(x, y - 3))
    }
    // And the wood really does come in at a different column in a row behind the origin than
    // in the row that shares its index — which is the whole of what the frame decides.
    expect(north.map(edgeOf)).toEqual([88, 90, 87])
    expect(
      [0, 1, 2].map((y) => edgeOf(Array.from({ length: W }, (_, x) => genesisTerrainAt(x, y)))),
    ).toEqual([90, 92, 94])

    const east = grownStrip(wide, 'e', 3)
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < 3; x++)
        expect(east[y]![x], `${W + x},${y}`).toBe(genesisTerrainAt(W + x, y))
  })

  it('tracks the authored frame across a shift, so a second strip continues the first', () => {
    const s = town()
    const first = fold(
      s,
      ev('world_grown', { edge: 'n', depth: 3, tiles: grownStrip(s, 'n', 3) }),
      CFG,
    )
    expect(authoredOrigin(s)).toEqual({ x: 0, y: 0 })
    expect(authoredOrigin(first)).toEqual({ x: 0, y: -3 })
    // Every row of the grown world is the authored row it should be, old and new alike.
    for (let y = 0; y < first.terrain.length; y++)
      for (let x = 0; x < SIZE; x++)
        expect(first.terrain[y]![x], `${x},${y - 3}`).toBe(genesisTerrainAt(x, y - 3))
    const second = fold(
      first,
      ev('world_grown', {
        edge: 'n',
        depth: 2,
        tiles: grownStrip(first, 'n', 2),
      }),
      CFG,
    )
    expect(authoredOrigin(second)).toEqual({ x: 0, y: -5 })
    for (let y = 0; y < second.terrain.length; y++)
      for (let x = 0; x < SIZE; x++)
        expect(second.terrain[y]![x], `${x},${y - 5}`).toBe(genesisTerrainAt(x, y - 5))
  })
})

describe('fold: world_grown', () => {
  const growTo = (edge: string, s = town()) => {
    const w = s.terrain[0]!.length,
      h = s.terrain.length
    const tiles =
      edge === 'n' || edge === 's'
        ? Array.from({ length: 4 }, () => Array.from({ length: w }, () => 0))
        : Array.from({ length: h }, () => Array.from({ length: 4 }, () => 0))
    return fold(s, ev('world_grown', { edge, depth: 4, tiles }), CFG)
  }

  it('growing east leaves every stored coordinate alone', () => {
    const before = town()
    const after = growTo('e')
    expect(after.terrain).toHaveLength(SIZE)
    expect(after.terrain[0]).toHaveLength(SIZE + 4)
    expect(after.agents.a1).toMatchObject({ x: 4, y: 6 })
    expect(after.structures.structure_1).toMatchObject({ x: 10, y: 20 })
    expect(after.items.item_1!.loc).toEqual({ t: 'tile', x: 7, y: 9 })
    expect(after.crops.crop_1).toMatchObject({ x: 3, y: 3 })
    expect(before.agents.a1!.x).toBe(4) // the input is never mutated
  })

  it('growing west shifts every stored coordinate by the depth', () => {
    const after = growTo('w')
    expect(after.terrain[0]).toHaveLength(SIZE + 4)
    expect(after.agents.a1).toMatchObject({ x: 8, y: 6 })
    expect(after.structures.structure_1).toMatchObject({ x: 14, y: 20 })
    expect(after.items.item_1!.loc).toEqual({ t: 'tile', x: 11, y: 9 })
    expect(after.crops.crop_1).toMatchObject({ x: 7, y: 3 })
  })

  it('growing north shifts the other axis and leaves x alone', () => {
    const after = growTo('n')
    expect(after.terrain).toHaveLength(SIZE + 4)
    expect(after.agents.a1).toMatchObject({ x: 4, y: 10 })
    expect(after.structures.structure_1).toMatchObject({ x: 10, y: 24 })
    expect(after.crops.crop_1).toMatchObject({ x: 3, y: 7 })
  })

  it('the same route still resolves between the same two landmarks after a shift', () => {
    const before = town()
    const a = before.agents.a1!
    const target = { x: 25, y: 28 }
    const routeBefore = findPath(before, a, target, CFG)!
    const after = growTo('w')
    const routeAfter = findPath(after, after.agents.a1!, { x: target.x + 4, y: target.y }, CFG)!
    expect(routeAfter.map(([x, y]) => [x - 4, y])).toEqual(routeBefore)
  })

  it('carries an in-flight walk, and the act hung on its end, with the ground', () => {
    let s = town()
    const path = findPath(s, s.agents.a1!, { x: 25, y: 28 }, CFG)!
    s = fold(
      s,
      ev('action_started', {
        agentId: 'a1',
        verb: 'walk',
        params: { x: 25, y: 28 },
        duration: path.length,
        then: { verb: 'till', params: { x: 25, y: 28 } },
      }),
      CFG,
    )
    const after = growTo('w', s)
    const act = after.agents.a1!.activity!
    expect(act.params).toEqual({ x: 29, y: 28 })
    expect(act.path).toEqual(path.map(([x, y]) => [x + 4, y]))
    expect(act.then).toEqual({ verb: 'till', params: { x: 29, y: 28 } })
    // and an east growth leaves it exactly as it was
    const east = growTo('e', s).agents.a1!.activity!
    expect(east.path).toEqual(path)
    expect(east.then).toEqual({ verb: 'till', params: { x: 25, y: 28 } })
  })

  it('lays the rolled strip down where the payload says, and nowhere else', () => {
    const s = town()
    const strip = Array.from({ length: 2 }, (_, r) =>
      Array.from({ length: SIZE }, (): number => (r === 0 ? 3 : 4)),
    )
    const after = fold(s, ev('world_grown', { edge: 'n', depth: 2, tiles: strip }), CFG)
    expect(after.terrain[0]!.every((t) => t === 3)).toBe(true)
    expect(after.terrain[1]!.every((t) => t === 4)).toBe(true)
    expect(after.terrain[2]!.every((t) => t === 0)).toBe(true)
  })

  it('refuses a strip that is not the size the edge needs', () => {
    const s = town()
    const short = [Array.from({ length: 5 }, () => 0)]
    expect(() => fold(s, ev('world_grown', { edge: 'n', depth: 1, tiles: short }), CFG)).toThrow(
      /strip/i,
    )
    expect(() => fold(s, ev('world_grown', { edge: 'n', depth: 2, tiles: [] }), CFG)).toThrow(
      /strip/i,
    )
  })

  it('the new strip lands in exactly the chunks chunkOf names', () => {
    const after = growTo('e')
    const w = after.terrain[0]!.length
    const corners = [
      { x: SIZE, y: 0 },
      { x: w - 1, y: 0 },
      { x: SIZE, y: SIZE - 1 },
      { x: w - 1, y: SIZE - 1 },
    ]
    const touched = chunksTouched(corners)
    expect(touched).toContain(`${chunkOf(SIZE, 0).cx},0`)
    expect(touched).toContain(`${chunkOf(w - 1, SIZE - 1).cx},${chunkOf(w - 1, SIZE - 1).cy}`)
    expect(CHUNK_TILES).toBe(32)
  })
})

describe('world_grown: replay', () => {
  it("folding the tick's own events over the input reproduces the state it returned", () => {
    const { replayed, out } = roundTrips({ ...bigTown(), tick: MIDNIGHT - 1 }, CFG, 'grow')
    expect(grown(out)).toHaveLength(1)
    expect(stateHash(replayed)).toBe(stateHash(out.state))
  })

  // Growth is no longer a roll at all: it is the authored world continued. The tiles still ride
  // in the payload, because a log must replay without re-deriving anything.
  it('replays identically from the payload alone, and does not consult a stream', () => {
    const s = bigTown()
    const live = tickAt(s, MIDNIGHT).state
    const payload = grown(tickAt(s, MIDNIGHT))[0]!.payload
    const advanced = fold({ ...s, tick: MIDNIGHT - 1 }, ev('tick_advanced', {}, MIDNIGHT), CFG)
    const fromLog = fold(advanced, ev('world_grown', payload, MIDNIGHT), CFG)
    expect(fromLog.terrain).toEqual(live.terrain)
    expect(stateHash(tickAt(s, MIDNIGHT, CFG, 'other').state)).toBe(stateHash(live))
    // And the payload is not merely reproducible, it is the world: the same tiles the authored
    // function gives for the ground the strip covers.
    expect((payload as { tiles: number[][] }).tiles).toEqual(grownStrip(s, 'n', 10))
  })
})

describe('growthsSoFar', () => {
  it('counts every growth on either axis, so the n-e-s-w cycle cannot lose its place', () => {
    const s = town()
    expect(growthsSoFar(s)).toBe(0)
    const n = fold(
      s,
      ev('world_grown', {
        edge: 'n',
        depth: 4,
        tiles: Array.from({ length: 4 }, () => Array.from({ length: SIZE }, () => 0)),
      }),
      CFG,
    )
    expect(growthsSoFar(n)).toBe(1)
    const ne = fold(
      n,
      ev('world_grown', {
        edge: 'e',
        depth: 4,
        tiles: Array.from({ length: SIZE + 4 }, () => Array.from({ length: 4 }, () => 0)),
      }),
      CFG,
    )
    expect(growthsSoFar(ne)).toBe(2)
  })

  it('a world that never grows carries no growths key and hashes as it always did', () => {
    const s = town()
    expect(s.growths).toBeUndefined()
    expect(stateHash(s)).toBe(stateHash({ ...s }))
    expect(Object.keys(s)).not.toContain('growths')
  })
})
