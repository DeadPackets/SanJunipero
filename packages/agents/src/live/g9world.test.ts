import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import { fold, genesisState, isPassable, submitIntent, type WorldState } from '@sj/engine'
import {
  CARRIED_MATERIALS, COPSE, CREEK, MAP_N, MATERIAL_PILES, PLOTS, WEIR, WORN_TOOL,
  mealsPerMind, makeTerrain, storehouseBread, townGenesisEvents,
} from './g9world.js'

const FOUR_DAYS = 4 * MINUTES_PER_DAY

// The five founders as the harness spawns them: only the body facts the world needs.
const MINDS = [
  { id: 'ada', name: 'Ada', sex: 'f' as const, ageDays: 30 * 364, x: 10, y: 12, hutIndex: 0 },
  { id: 'bex', name: 'Bex', sex: 'm' as const, ageDays: 32 * 364, x: 10, y: 13, hutIndex: 0 },
  { id: 'cass', name: 'Cass', sex: 'f' as const, ageDays: 41 * 364, x: 14, y: 12, hutIndex: 1 },
  { id: 'dov', name: 'Dov', sex: 'm' as const, ageDays: 36 * 364, x: 18, y: 12, hutIndex: 2 },
  { id: 'esen', name: 'Esen', sex: 'f' as const, ageDays: 27 * 364, x: 22, y: 12, hutIndex: 3 },
]

function town(totalTicks = FOUR_DAYS): WorldState {
  let state = genesisState(DEFAULT_CONFIG, makeTerrain())
  let seq = 0
  for (const e of townGenesisEvents({ config: DEFAULT_CONFIG, totalTicks, minds: MINDS, unbornMinds: 1 })) {
    seq += 1
    const ev: SimEvent = { seq, tick: 0, type: e.type, payload: e.payload }
    state = fold(state, ev, DEFAULT_CONFIG)
  }
  return state
}

// A body standing exactly where the test wants to act from, so a verb's own
// validate() is the thing under test and never the walk that came before it.
function probeAt(state: WorldState, x: number, y: number, id = 'probe'): WorldState {
  return fold(state, {
    seq: 9000, tick: 0, type: 'agent_spawned',
    payload: { id, name: 'Probe', x, y, ageDays: 7300, sex: 'f' },
  }, DEFAULT_CONFIG)
}

const tileAt = (s: WorldState, x: number, y: number): number => s.terrain[y]![x]!

const inSightOfAMind = (x: number, y: number): boolean =>
  MINDS.some((m) => Math.hypot(x - m.x, y - m.y) <= DEFAULT_CONFIG.movement.sightRadius)

describe('the G9b world — a town that can feed itself', () => {
  it('cuts a creek and a copse into the town without paving over it', () => {
    const map = makeTerrain()
    expect(map).toHaveLength(MAP_N)
    expect(map[0]).toHaveLength(MAP_N)
    for (const [x, y] of CREEK) expect(map[y]![x]).toBe(2)
    for (const [x, y] of COPSE) expect(map[y]![x]).toBe(3)
    // The huts, the hearth and the ground the founders stand on stay open.
    for (const m of MINDS) expect(map[m.y]![m.x]).toBe(0)
    expect(map[15]![17]).toBe(0)
    // The far river and the northern treeline the town has always had.
    expect(map[12]![31]).toBe(2)
    expect(map[1]![5]).toBe(3)
  })

  it('puts water in reach of the weir a mind is told to stand beside', () => {
    const state = probeAt(town(), WEIR.x, WEIR.y - 1)
    expect(tileAt(state, WEIR.x, WEIR.y)).toBe(2)
    expect(isPassable(state, WEIR.x, WEIR.y - 1)).toBe(true)
    expect(submitIntent(state, DEFAULT_CONFIG, 'probe', 'fish', { x: WEIR.x, y: WEIR.y }).ok).toBe(true)
  })

  it('puts a branch pile on open ground beside the trees, so forage needs only a walk', () => {
    const pile = MATERIAL_PILES.find((p) => p.kind === 'branch' && COPSE.some(
      ([x, y]) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1,
    ))
    expect(pile, 'a branch pile at the treeline').toBeDefined()
    const state = probeAt(town(), pile!.x, pile!.y)
    expect(isPassable(state, pile!.x, pile!.y)).toBe(true)
    expect(submitIntent(state, DEFAULT_CONFIG, 'probe', 'forage', {}).ok).toBe(true)
  })

  it('opens with ripe grain in the field and more coming in later', () => {
    const state = town()
    const ripe = Object.values(state.crops).filter((c) => !c.withered && c.stage === DEFAULT_CONFIG.crops['wheat']!.stages - 1)
    expect(ripe.length, 'plots ripe on the first morning').toBeGreaterThanOrEqual(2)
    const later = Object.values(state.crops).filter((c) => c.stage < DEFAULT_CONFIG.crops['wheat']!.stages - 1)
    expect(later.length, 'plots that ripen during the run').toBeGreaterThanOrEqual(1)

    const first = ripe[0]!
    const withProbe = probeAt(state, first.x, first.y - 1)
    expect(submitIntent(withProbe, DEFAULT_CONFIG, 'probe', 'harvest', { cropId: first.id }).ok).toBe(true)
  })

  it('leaves tilled ground and seed grain, so the loop can be run again', () => {
    const state = town()
    const spare = PLOTS.filter((p) => p.plantedDaysAgo === null)
    expect(spare.length).toBeGreaterThanOrEqual(1)
    for (const p of spare) {
      expect(tileAt(state, p.x, p.y), `farmland at (${p.x}, ${p.y})`).toBe(6)
      expect(Object.values(state.crops).some((c) => c.x === p.x && c.y === p.y && !c.withered)).toBe(false)
    }
    const seeds = Object.values(state.items).filter((i) => i.kind === 'wheat')
    expect(seeds.length, 'seed grain the town already holds').toBeGreaterThanOrEqual(1)

    const plot = spare[0]!
    const withProbe = probeAt(state, plot.x, plot.y - 1)
    expect(submitIntent(withProbe, DEFAULT_CONFIG, 'probe', 'plant', { x: plot.x, y: plot.y, kind: 'wheat' }).ok).toBe(true)
  })

  it('scales the pantry to the length of the run', () => {
    const twoDays = mealsPerMind(DEFAULT_CONFIG, 2 * MINUTES_PER_DAY)
    const fourDays = mealsPerMind(DEFAULT_CONFIG, FOUR_DAYS)
    expect(fourDays).toBeGreaterThan(twoDays)
    expect(storehouseBread(DEFAULT_CONFIG, FOUR_DAYS, MINDS.length + 1, MINDS.length))
      .toBeGreaterThan(storehouseBread(DEFAULT_CONFIG, 2 * MINUTES_PER_DAY, MINDS.length + 1, MINDS.length))

    // Every mouth, every day of the run, fed from what genesis puts in the world.
    const state = town()
    const edible = new Set(['bread', 'fish', 'wheat', 'berries', 'venison'])
    const stored = Object.values(state.items)
      .filter((i) => edible.has(i.kind))
      .reduce((sum, i) => sum + i.qty, 0)
    const standing = Object.values(state.crops)
      .filter((c) => !c.withered)
      .reduce((sum, c) => sum + DEFAULT_CONFIG.crops[c.kind]!.yield, 0)
    expect(stored + standing).toBeGreaterThanOrEqual((MINDS.length + 1) * fourDays)
  })

  it('lays the makings of a craft where the town can see them', () => {
    const state = town()
    for (const kind of ['clay', 'fiber', 'branch', 'stone']) {
      const piles = MATERIAL_PILES.filter((p) => p.kind === kind)
      expect(piles.length, `${kind} in the open`).toBeGreaterThanOrEqual(1)
      for (const p of piles) {
        expect(isPassable(state, p.x, p.y), `${kind} at (${p.x}, ${p.y}) reachable`).toBe(true)
        expect(inSightOfAMind(p.x, p.y), `${kind} at (${p.x}, ${p.y}) in sight`).toBe(true)
      }
    }
    // Raw stock in every hand, so the arbiter's "what the town has at hand" is never empty.
    for (const m of MINDS) {
      const held = Object.values(state.items).filter((i) => i.loc.t === 'agent' && i.loc.id === m.id)
      for (const c of CARRIED_MATERIALS) {
        expect(held.some((i) => i.kind === c.kind && i.qty >= c.qty), `${m.id} holds ${c.kind}`).toBe(true)
      }
    }
    // One tool, nearly spent: the next few uses are the last it has.
    const tools = Object.values(state.items).filter((i) => i.durability !== undefined)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.kind).toBe(WORN_TOOL.kind)
    expect(tools[0]!.durability).toBeLessThanOrEqual(2)
    expect(tools[0]!.loc).toEqual({ t: 'agent', id: WORN_TOOL.owner })
  })
})
