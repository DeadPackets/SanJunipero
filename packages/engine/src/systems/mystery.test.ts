import { describe, it, expect } from 'vitest'
import {
  MINUTES_PER_DAY,
  SimConfigSchema,
  stateHash,
  type SimConfig,
  type SimEvent,
} from '@sj/shared'
import { MYSTERIES, MYSTERY_BY_KIND } from '../data/mysteries.js'
import { composePerception } from '../perception.js'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { RngStreams } from '../rng.js'
import { createWorldTick } from '../worldTick.js'
import { MYSTERY_HOUR } from './mystery.js'

// The world keeps one hand hidden. These fire, they are felt or seen, and nothing
// in the state moves — least of all an explanation.

const CERTAIN: SimConfig = SimConfigSchema.parse({ mystery: { chancePerDay: 1 } })
const NEVER: SimConfig = SimConfigSchema.parse({ mystery: { chancePerDay: 0 } })

let seq = 1
const ev = (type: string, payload: unknown, tick = 0): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

function world(config: SimConfig): WorldState {
  const s = genesisState(
    config,
    Array.from({ length: 32 }, () => Array.from({ length: 32 }, (): TileId => 0)),
  )
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 4, y: 4, ageDays: 7300 }), config)
}

// Run the single tick at `hour` on day 1 and return only what the mystery system said.
function tickAt(config: SimConfig, hour: number, minute = 0, seed = 'mystery-test') {
  const tick = MINUTES_PER_DAY + hour * 60 + minute
  const advanced = fold({ ...world(config), tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  const result = createWorldTick(config, new RngStreams(seed))(advanced)
  return {
    events: result.events.filter((e) => e.type === 'mystery_event'),
    state: result.state,
    before: advanced,
  }
}

describe('mystery events', () => {
  it('the table is authored, ~10 deep, and every entry has one of the two scopes', () => {
    expect(MYSTERIES.length).toBeGreaterThanOrEqual(10)
    expect(MYSTERIES.some((m) => m.scope === 'global')).toBe(true)
    expect(MYSTERIES.some((m) => m.scope === 'located')).toBe(true)
    expect(new Set(MYSTERIES.map((m) => m.kind)).size).toBe(MYSTERIES.length)
    for (const m of MYSTERIES) expect(m.prose.length).toBeGreaterThan(10)
  })

  it('rolls once a day, at one fixed hour and nowhere else in the day', () => {
    expect(tickAt(CERTAIN, MYSTERY_HOUR).events).toHaveLength(1)
    expect(tickAt(CERTAIN, MYSTERY_HOUR, 1).events).toHaveLength(0)
    for (let hour = 0; hour < 24; hour++) {
      if (hour === MYSTERY_HOUR) continue
      expect(tickAt(CERTAIN, hour).events).toHaveLength(0)
    }
  })

  it('a miss says nothing at all', () => {
    expect(tickAt(NEVER, MYSTERY_HOUR).events).toHaveLength(0)
  })

  it('a hit picks exactly one table entry, the same one on every replay of that seed', () => {
    const a = tickAt(CERTAIN, MYSTERY_HOUR)
    const b = tickAt(CERTAIN, MYSTERY_HOUR)
    expect(a.events).toHaveLength(1)
    const kind = (a.events[0]!.payload as { kind: string }).kind
    expect(MYSTERY_BY_KIND[kind]).toBeDefined()
    expect(b.events[0]!.payload).toEqual(a.events[0]!.payload)
  })

  it('a located mystery carries a point on the map; a global one carries none', () => {
    // Sweep seeds until each scope has been drawn at least once — both branches are real.
    const seen = new Map<string, { kind: string; x?: number; y?: number }>()
    for (let i = 0; i < 40 && seen.size < 2; i++) {
      const [e] = tickAt(CERTAIN, MYSTERY_HOUR, 0, `sweep-${i}`).events
      if (!e) continue
      const p = e.payload as { kind: string; x?: number; y?: number }
      seen.set(MYSTERY_BY_KIND[p.kind]!.scope, p)
    }
    expect([...seen.keys()].sort()).toEqual(['global', 'located'])
    expect(seen.get('global')!.x).toBeUndefined()
    const located = seen.get('located')!
    expect(located.x).toBeGreaterThanOrEqual(0)
    expect(located.x).toBeLessThan(32)
    expect(located.y).toBeLessThan(32)
  })

  it('the fold is a no-op: the state hash before and after is the same string', () => {
    const s = world(CERTAIN)
    const after = fold(s, ev('mystery_event', { kind: 'far_bell' }), CERTAIN)
    expect(stateHash(after)).toBe(stateHash(s))
    const located = fold(s, ev('mystery_event', { kind: 'stone_hums', x: 3, y: 9 }), CERTAIN)
    expect(stateHash(located)).toBe(stateHash(s))
  })

  it('the fold refuses a kind that is not in the table', () => {
    expect(() =>
      fold(world(CERTAIN), ev('mystery_event', { kind: 'the_answer' }), CERTAIN),
    ).toThrow(/unknown mystery/)
  })
})

describe('perception: mysteries', () => {
  const GLOBAL = ev('mystery_event', { kind: 'far_bell' })
  const LOCATED = (x: number, y: number) => ev('mystery_event', { kind: 'stone_hums', x, y })

  function twoAgents(bAsleep: boolean): WorldState {
    let s = world(CERTAIN)
    s = fold(s, ev('agent_spawned', { id: 'a2', name: 'a2', x: 5, y: 4, ageDays: 7300 }), CERTAIN)
    if (bAsleep) s = fold(s, ev('agent_slept', { agentId: 'a2' }), CERTAIN)
    return s
  }

  it('a global mystery is felt by the awake and slept through by the sleeping', () => {
    const s = twoAgents(true)
    expect(composePerception(s, CERTAIN, 'a1', [GLOBAL]).feltEvents).toEqual(['far_bell'])
    expect(composePerception(s, CERTAIN, 'a2', [GLOBAL]).feltEvents).toEqual([])
  })

  it('a global mystery is never a seen entry', () => {
    expect(composePerception(twoAgents(false), CERTAIN, 'a1', [GLOBAL]).seen).toEqual([])
  })

  it('a located mystery is seen within sight and nowhere else', () => {
    const s = world(CERTAIN)
    expect(composePerception(s, CERTAIN, 'a1', [LOCATED(6, 6)]).seen).toEqual([
      { kind: 'mystery', mystery: 'stone_hums', prose: MYSTERY_BY_KIND.stone_hums!.prose },
    ])
    expect(composePerception(s, CERTAIN, 'a1', [LOCATED(30, 30)]).seen).toEqual([])
  })

  it('a located mystery is never a felt tag', () => {
    expect(composePerception(world(CERTAIN), CERTAIN, 'a1', [LOCATED(6, 6)]).feltEvents).toEqual([])
  })

  it('four walls hide a located mystery outside them', () => {
    let s = world(CERTAIN)
    s = fold(
      s,
      ev('structure_planned', {
        id: 'structure_1',
        kind: 'house',
        x: 4,
        y: 4,
        w: 2,
        h: 2,
        maxHp: 20,
        flammable: true,
        builderId: 'a1',
      }),
      CERTAIN,
    )
    s = fold(s, ev('structure_completed', { id: 'structure_1' }), CERTAIN)
    s = fold(s, ev('agent_entered', { agentId: 'a1', structureId: 'structure_1' }), CERTAIN)
    expect(composePerception(s, CERTAIN, 'a1', [LOCATED(6, 6)]).seen).toEqual([])
    // Sound and light with no source still reach indoors — a global one is still felt.
    expect(composePerception(s, CERTAIN, 'a1', [GLOBAL]).feltEvents).toEqual(['far_bell'])
  })
})
