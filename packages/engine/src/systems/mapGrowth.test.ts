import { describe, it, expect } from 'vitest'
import { CHUNK_TILES, MINUTES_PER_DAY, SimConfigSchema, chunkOf, chunksTouched, stateHash, type SimConfig, type SimEvent } from '@sj/shared'
import { fold } from '../fold.js'
import { findPath } from '../path.js'
import { RngStreams } from '../rng.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { createWorldTick } from '../worldTick.js'
import { growthsSoFar } from './mapGrowth.js'

// A 32x32 world on a config whose world.size says 128 — the ordinary shape of a fixture, and
// the case the plan's size-derived growth counter got wrong.
const SIZE = 32
const base = (over: Record<string, unknown> = {}): SimConfig => SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  // Nothing else may write terrain at midnight: from C11 Task 28 the wood seeds itself there.
  regrowth: { enabled: false },
  mapGrowth: { structuresPerStep: 2, step: 4, maxSize: 40 },
  ...over,
})
const CFG = base()

let seq = 90000
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({ seq: seq++, tick, type, payload })
const map = (): TileId[][] => Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, (): TileId => 0))

function town(config = CFG, structures = 2): WorldState {
  let s = genesisState(config, map())
  s = fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 6, ageDays: 7300 }), config)
  for (let i = 0; i < structures; i++) {
    s = fold(s, ev('structure_planned', {
      id: `structure_${i + 1}`, kind: 'house', x: 10 + i * 3, y: 20, w: 2, h: 2,
      maxHp: 50, flammable: true, builderId: 'a1',
    }), config)
    s = fold(s, ev('structure_completed', { id: `structure_${i + 1}` }), config)
  }
  s = fold(s, ev('item_spawned', { id: 'item_1', kind: 'axe', qty: 1, loc: { t: 'tile', x: 7, y: 9 } }), config)
  s = fold(s, ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 3, y: 3, plantedDay: 0 }), config)
  return s
}

// Midnight of day 1: hour 0, minute 0, and past tick 0 so the world has actually run.
const MIDNIGHT = MINUTES_PER_DAY

function tickAt(s: WorldState, tick: number, config = CFG, seed = 'grow') {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}

const grown = (r: { events: Array<{ type: string; payload: unknown }> }) =>
  r.events.filter((e) => e.type === 'world_grown')

describe('mapGrowthSystem', () => {
  it('grows once at midnight when the town has earned it, and not twice', () => {
    const r = tickAt(town(), MIDNIGHT)
    expect(grown(r)).toHaveLength(1)
    expect(r.state.terrain).toHaveLength(SIZE + 4)
    const again = tickAt(r.state, MIDNIGHT + MINUTES_PER_DAY)
    expect(grown(again)).toHaveLength(0) // 2 structures no longer clears 2 x (1 + 1)
  })

  it('does not grow before the town has earned it, or away from midnight', () => {
    expect(grown(tickAt(town(CFG, 1), MIDNIGHT))).toHaveLength(0)
    expect(grown(tickAt(town(), MIDNIGHT + 60))).toHaveLength(0)
  })

  it('a flag off never grows', () => {
    const off = base({ mapGrowth: { structuresPerStep: 2, step: 4, maxSize: 40, enabled: false } })
    expect(grown(tickAt(town(off), MIDNIGHT, off))).toHaveLength(0)
  })

  it('cycles n, e, s, w by growth index and stops at maxSize', () => {
    let s = town(CFG, 40)
    const edges: string[] = []
    for (let day = 1; day <= 6; day++) {
      const r = tickAt(s, day * MINUTES_PER_DAY)
      for (const e of grown(r)) edges.push((e.payload as { edge: string }).edge)
      s = r.state
    }
    expect(edges).toEqual(['n', 'e', 's', 'w'])
    expect(s.terrain).toHaveLength(40)
    expect(s.terrain[0]).toHaveLength(40)
  })

  it('carries the rolled strip in the payload, sized to the edge it grew', () => {
    const north = grown(tickAt(town(CFG, 40), MINUTES_PER_DAY))[0]!.payload as { depth: number; tiles: number[][] }
    expect(north.depth).toBe(4)
    expect(north.tiles).toHaveLength(4)
    for (const row of north.tiles) expect(row).toHaveLength(SIZE)
    const afterN = tickAt(town(CFG, 40), MINUTES_PER_DAY).state
    const east = grown(tickAt(afterN, 2 * MINUTES_PER_DAY))[0]!.payload as { tiles: number[][] }
    expect(east.tiles).toHaveLength(SIZE + 4)
    for (const row of east.tiles) expect(row).toHaveLength(4)
  })
})

describe('fold: world_grown', () => {
  const growTo = (edge: string, s = town()) => {
    const w = s.terrain[0]!.length, h = s.terrain.length
    const tiles = edge === 'n' || edge === 's'
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
    expect(after.structures['structure_1']).toMatchObject({ x: 10, y: 20 })
    expect(after.items['item_1']!.loc).toEqual({ t: 'tile', x: 7, y: 9 })
    expect(after.crops['crop_1']).toMatchObject({ x: 3, y: 3 })
    expect(before.agents.a1!.x).toBe(4) // the input is never mutated
  })

  it('growing west shifts every stored coordinate by the depth', () => {
    const after = growTo('w')
    expect(after.terrain[0]).toHaveLength(SIZE + 4)
    expect(after.agents.a1).toMatchObject({ x: 8, y: 6 })
    expect(after.structures['structure_1']).toMatchObject({ x: 14, y: 20 })
    expect(after.items['item_1']!.loc).toEqual({ t: 'tile', x: 11, y: 9 })
    expect(after.crops['crop_1']).toMatchObject({ x: 7, y: 3 })
  })

  it('growing north shifts the other axis and leaves x alone', () => {
    const after = growTo('n')
    expect(after.terrain).toHaveLength(SIZE + 4)
    expect(after.agents.a1).toMatchObject({ x: 4, y: 10 })
    expect(after.structures['structure_1']).toMatchObject({ x: 10, y: 24 })
    expect(after.crops['crop_1']).toMatchObject({ x: 3, y: 7 })
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

  it('carries an in-flight walk with the ground it was walking on', () => {
    let s = town()
    const path = findPath(s, s.agents.a1!, { x: 25, y: 28 }, CFG)!
    s = fold(s, ev('action_started', { agentId: 'a1', verb: 'walk', params: { x: 25, y: 28 }, duration: path.length }), CFG)
    const after = growTo('w', s)
    const act = after.agents.a1!.activity!
    expect(act.params).toEqual({ x: 29, y: 28 })
    expect(act.path).toEqual(path.map(([x, y]) => [x + 4, y]))
    // and an east growth leaves it exactly as it was
    const east = growTo('e', s)
    expect(east.agents.a1!.activity!.path).toEqual(path)
  })

  it('lays the rolled strip down where the payload says, and nowhere else', () => {
    const s = town()
    const strip = Array.from({ length: 2 }, (_, r) => Array.from({ length: SIZE }, (): number => (r === 0 ? 3 : 4)))
    const after = fold(s, ev('world_grown', { edge: 'n', depth: 2, tiles: strip }), CFG)
    expect(after.terrain[0]!.every((t) => t === 3)).toBe(true)
    expect(after.terrain[1]!.every((t) => t === 4)).toBe(true)
    expect(after.terrain[2]!.every((t) => t === 0)).toBe(true)
  })

  it('refuses a strip that is not the size the edge needs', () => {
    const s = town()
    const short = [Array.from({ length: 5 }, () => 0)]
    expect(() => fold(s, ev('world_grown', { edge: 'n', depth: 1, tiles: short }), CFG)).toThrow(/strip/i)
    expect(() => fold(s, ev('world_grown', { edge: 'n', depth: 2, tiles: [] }), CFG)).toThrow(/strip/i)
  })

  it('the new strip lands in exactly the chunks chunkOf names', () => {
    const after = growTo('e')
    const w = after.terrain[0]!.length
    const corners = [
      { x: SIZE, y: 0 }, { x: w - 1, y: 0 }, { x: SIZE, y: SIZE - 1 }, { x: w - 1, y: SIZE - 1 },
    ]
    const touched = chunksTouched(corners)
    expect(touched).toContain(`${chunkOf(SIZE, 0).cx},0`)
    expect(touched).toContain(`${chunkOf(w - 1, SIZE - 1).cx},${chunkOf(w - 1, SIZE - 1).cy}`)
    expect(CHUNK_TILES).toBe(32)
  })
})

describe('world_grown: replay', () => {
  it('folding the tick\'s own events over the input reproduces the state it returned', () => {
    const s = town(CFG, 40)
    const advanced = fold({ ...s, tick: MIDNIGHT - 1 }, ev('tick_advanced', {}, MIDNIGHT), CFG)
    const out = createWorldTick(CFG, new RngStreams('grow'))(advanced)
    expect(grown(out)).toHaveLength(1)
    let replayed = advanced
    for (const e of out.events) replayed = fold(replayed, ev(e.type, e.payload, MIDNIGHT), CFG)
    expect(stateHash(replayed)).toBe(stateHash(out.state))
  })

  it('replays identically from the payload alone, without re-rolling the stream', () => {
    const s = town(CFG, 40)
    const live = tickAt(s, MIDNIGHT).state
    const payload = grown(tickAt(s, MIDNIGHT))[0]!.payload
    // A different seed reaches the same map, because the roll travelled in the event.
    const advanced = fold({ ...s, tick: MIDNIGHT - 1 }, ev('tick_advanced', {}, MIDNIGHT), CFG)
    const fromLog = fold(advanced, ev('world_grown', payload, MIDNIGHT), CFG)
    expect(fromLog.terrain).toEqual(live.terrain)
    expect(stateHash(tickAt(s, MIDNIGHT, CFG, 'other').state)).not.toBe(stateHash(live))
  })
})

describe('growthsSoFar', () => {
  it('counts every growth on either axis, so the n-e-s-w cycle cannot lose its place', () => {
    const s = town()
    expect(growthsSoFar(s)).toBe(0)
    const n = fold(s, ev('world_grown', {
      edge: 'n', depth: 4, tiles: Array.from({ length: 4 }, () => Array.from({ length: SIZE }, () => 0)),
    }), CFG)
    expect(growthsSoFar(n)).toBe(1)
    const ne = fold(n, ev('world_grown', {
      edge: 'e', depth: 4, tiles: Array.from({ length: SIZE + 4 }, () => Array.from({ length: 4 }, () => 0)),
    }), CFG)
    expect(growthsSoFar(ne)).toBe(2)
  })

  it('a world that never grows carries no growths key and hashes as it always did', () => {
    const s = town()
    expect(s.growths).toBeUndefined()
    expect(stateHash(s)).toBe(stateHash({ ...s }))
    expect(Object.keys(s)).not.toContain('growths')
  })
})
