import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from '../state.js'
import { fold } from '../fold.js'
import { submitIntent } from '../intent.js'
import { VERBS } from '../verbs/index.js'
import { RngStreams } from '../rng.js'
import { createWorldTick, type WorldTickResult } from '../worldTick.js'
import { ev } from '../testutil/world.js'

const FAST: SimConfig = SimConfigSchema.parse({
  crops: {
    wheat: { growthDays: 2, stages: 4, seasons: ['spring', 'summer'], yield: 3 },
    icegrass: { growthDays: 2, stages: 2, seasons: ['winter'], yield: 1 },
  },
})
const DAWN = 360 // hour 6, minute 0
const NOON = 720 // hour 12: daylight, so the night-work penalty is not what is being measured
const CHAR_TILE: Record<string, TileId> = { '.': 0, ',': 1, '~': 2, '#': 6, c: 10 }

function makeWorld(rows: string[] = ['.#', '..'], config = FAST): WorldState {
  const s = genesisState(
    config,
    rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }), config)
}
function atTick(s: WorldState, tick: number): WorldState {
  return { ...s, tick }
}
function applyAll(
  s: WorldState,
  events: { type: string; payload: unknown }[],
  config = FAST,
  tick = s.tick,
): WorldState {
  for (const e of events) s = fold(s, ev(e.type, e.payload, tick), config)
  return s
}
function tickOnce(s: WorldState, config = FAST, rng = new RngStreams('t')): WorldTickResult {
  const wt = createWorldTick(config, rng)
  return wt(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}
const cropEvents = (r: WorldTickResult) => r.events.filter((e) => e.type.startsWith('crop_'))

describe('fold: crop and terrain events', () => {
  it('crop_planted / crop_grew / crop_withered / crop_harvested drive the crop lifecycle', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 }),
      FAST,
    )
    expect(s.crops.crop_1).toEqual({
      id: 'crop_1',
      kind: 'wheat',
      x: 1,
      y: 0,
      plantedDay: 0,
      stage: 0,
      withered: false,
    })
    expect(s.counters.nextEntityId).toBe(2)
    s = fold(s, ev('crop_grew', { cropId: 'crop_1', stage: 2 }), FAST)
    expect(s.crops.crop_1!.stage).toBe(2)
    s = fold(s, ev('crop_withered', { cropId: 'crop_1' }), FAST)
    expect(s.crops.crop_1!.withered).toBe(true)
    s = fold(s, ev('crop_harvested', { cropId: 'crop_1' }), FAST)
    expect(s.crops.crop_1).toBeUndefined()
    expect(() => fold(s, ev('crop_grew', { cropId: 'ghost', stage: 1 }), FAST)).toThrow(
      /unknown crop/i,
    )
    expect(() => fold(s, ev('crop_withered', { cropId: 'ghost' }), FAST)).toThrow(/unknown crop/i)
    expect(() => fold(s, ev('crop_harvested', { cropId: 'ghost' }), FAST)).toThrow(/unknown crop/i)
  })

  it('crop_planted over a withered crop on the same tile replaces it', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 }),
      FAST,
    )
    s = fold(s, ev('crop_withered', { cropId: 'crop_1' }), FAST)
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_2', kind: 'wheat', x: 1, y: 0, plantedDay: 3 }),
      FAST,
    )
    expect(s.crops.crop_1).toBeUndefined()
    expect(Object.values(s.crops).filter((c) => c.x === 1 && c.y === 0)).toHaveLength(1)
    expect(s.crops.crop_2!.withered).toBe(false)
  })

  it('crop_planted leaves withered crops on other tiles alone', () => {
    let s = makeWorld(['.##', '...'])
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 2, y: 0, plantedDay: 0 }),
      FAST,
    )
    s = fold(s, ev('crop_withered', { cropId: 'crop_1' }), FAST)
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_2', kind: 'wheat', x: 1, y: 0, plantedDay: 3 }),
      FAST,
    )
    expect(s.crops.crop_1!.withered).toBe(true)
    expect(Object.keys(s.crops).sort()).toEqual(['crop_1', 'crop_2'])
  })

  it('tile_changed rewrites exactly one tile; out of bounds throws', () => {
    let s = makeWorld(['..', '..'])
    s = fold(s, ev('tile_changed', { x: 0, y: 1, from: 0, to: 6, reason: 'tilled' }), FAST)
    expect(s.terrain[1]![0]).toBe(6)
    expect(s.terrain[0]![0]).toBe(0)
    expect(() =>
      fold(s, ev('tile_changed', { x: 9, y: 0, from: 0, to: 6, reason: 'tilled' }), FAST),
    ).toThrow(/out of bounds/i)
  })
})

describe('verb: till', () => {
  it('is registered with the farming skill', () => {
    expect(VERBS.till!.kind).toBe('till')
    expect(VERBS.till!.skill).toEqual({ track: 'farming', xp: 1 })
  })

  it('validates params, tile kind, and adjacency', () => {
    const s = makeWorld(['.~.', '...'])
    expect(submitIntent(s, FAST, 'a1', 'till', {}).ok).toBe(false)
    expect(submitIntent(s, FAST, 'a1', 'till', { x: 1, y: 0 }).ok).toBe(false) // water
    expect(submitIntent(s, FAST, 'a1', 'till', { x: 2, y: 1 }).ok).toBe(false) // not adjacent
    expect(submitIntent(s, FAST, 'a1', 'till', { x: 0, y: 1 }).ok).toBe(true)
    expect(submitIntent(s, FAST, 'a1', 'till', { x: 0, y: 0 }).ok).toBe(true) // own tile
  })

  it('converts grass and dirt to farmland via tile_changed; plant then works there', () => {
    // By daylight: a tilled furrow cut at midnight takes half again as long.
    let s = atTick(makeWorld([',.', '..']), NOON)
    const r = submitIntent(s, FAST, 'a1', 'till', { x: 0, y: 0 })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const t = tickOnce(s)
    expect(t.events).toContainEqual({
      type: 'tile_changed',
      payload: { x: 0, y: 0, from: 1, to: 6, reason: 'tilled', byId: 'a1' },
    })
    expect(t.events).toContainEqual({
      type: 'skill_gained',
      payload: { agentId: 'a1', track: 'farming', xp: 1 },
    })
    expect(t.state.terrain[0]![0]).toBe(6)
    expect(submitIntent(t.state, FAST, 'a1', 'plant', { x: 0, y: 0, kind: 'wheat' }).ok).toBe(true)
  })
})

describe('verb: plant', () => {
  it('requires an adjacent farmland tile, a known kind, and an empty plot', () => {
    const s = makeWorld(['.#...#', '......'])
    expect(submitIntent(s, FAST, 'a1', 'plant', { x: 1, y: 0 }).ok).toBe(false) // no kind
    expect(submitIntent(s, FAST, 'a1', 'plant', { x: 0, y: 1, kind: 'wheat' }).ok).toBe(false) // grass
    expect(submitIntent(s, FAST, 'a1', 'plant', { x: 1, y: 0, kind: 'kelp' }).ok).toBe(false) // unknown kind
    expect(submitIntent(s, FAST, 'a1', 'plant', { x: 5, y: 0, kind: 'wheat' }).ok).toBe(false) // not adjacent
    expect(submitIntent(s, FAST, 'a1', 'plant', { x: 1, y: 0, kind: 'wheat' }).ok).toBe(true)
  })

  it('completion emits crop_planted with the current day; the plot is then occupied', () => {
    let s = makeWorld()
    const r = submitIntent(s, FAST, 'a1', 'plant', { x: 1, y: 0, kind: 'wheat' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    const t = tickOnce(s)
    expect(t.events).toContainEqual({
      type: 'crop_planted',
      payload: { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 },
    })
    expect(t.events).toContainEqual({
      type: 'skill_gained',
      payload: { agentId: 'a1', track: 'farming', xp: 1 },
    })
    expect(t.state.crops.crop_1!.stage).toBe(0)
    expect(submitIntent(t.state, FAST, 'a1', 'plant', { x: 1, y: 0, kind: 'wheat' }).ok).toBe(false)
  })
})

describe('worldTick: crop growth at dawn', () => {
  it('wheat matures in exactly growthDays in-season dawns; stage caps at stages-1', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 }),
      FAST,
    )
    const d1 = tickOnce(atTick(s, 1440 + DAWN - 1))
    // day 1 of 2: stage = floor(1×(4−1)/2) = 1, not yet mature
    expect(cropEvents(d1)).toEqual([{ type: 'crop_grew', payload: { cropId: 'crop_1', stage: 1 } }])
    const d2 = tickOnce(atTick(d1.state, 2 * 1440 + DAWN - 1))
    expect(cropEvents(d2)).toEqual([{ type: 'crop_grew', payload: { cropId: 'crop_1', stage: 3 } }])
    expect(d2.state.crops.crop_1!.stage).toBe(3) // stages−1: mature exactly at growthDays
    const d3 = tickOnce(atTick(d2.state, 3 * 1440 + DAWN - 1))
    expect(cropEvents(d3)).toEqual([])
  })

  it('does not grow outside the dawn tick', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 }),
      FAST,
    )
    const r = tickOnce(atTick(s, 1440 + 998))
    expect(cropEvents(r)).toEqual([])
  })

  it('withers at the first out-of-season dawn and stays inert after', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 181 }),
      FAST,
    )
    const autumn = tickOnce(atTick(s, 182 * 1440 + DAWN - 1)) // first autumn dawn
    expect(cropEvents(autumn)).toEqual([{ type: 'crop_withered', payload: { cropId: 'crop_1' } }])
    expect(autumn.state.crops.crop_1!.withered).toBe(true)
    const next = tickOnce(atTick(autumn.state, 183 * 1440 + DAWN - 1))
    expect(cropEvents(next)).toEqual([])
  })

  it('winter withers even an in-season kind', () => {
    let s = makeWorld()
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'icegrass', x: 1, y: 0, plantedDay: 273 }),
      FAST,
    )
    const r = tickOnce(atTick(s, 274 * 1440 + DAWN - 1))
    expect(cropEvents(r)).toEqual([{ type: 'crop_withered', payload: { cropId: 'crop_1' } }])
  })
})

describe('verb: harvest', () => {
  function mature(): WorldState {
    let s = makeWorld()
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 }),
      FAST,
    )
    return fold(s, ev('crop_grew', { cropId: 'crop_1', stage: 3 }), FAST)
  }

  it('is registered with the farming skill', () => {
    expect(VERBS.harvest!.kind).toBe('harvest')
    expect(VERBS.harvest!.skill).toEqual({ track: 'farming', xp: 1 })
  })

  it('rejects missing, immature, withered, and out-of-reach crops', () => {
    let s = makeWorld()
    expect(submitIntent(s, FAST, 'a1', 'harvest', { cropId: 'crop_9' }).ok).toBe(false)
    s = fold(
      s,
      ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 }),
      FAST,
    )
    expect(submitIntent(s, FAST, 'a1', 'harvest', { cropId: 'crop_1' }).ok).toBe(false) // stage 0
    const withered = fold(mature(), ev('crop_withered', { cropId: 'crop_1' }), FAST)
    expect(submitIntent(withered, FAST, 'a1', 'harvest', { cropId: 'crop_1' }).ok).toBe(false)
    const far = { ...mature(), agents: { a1: { ...mature().agents.a1!, x: 4, y: 1 } } }
    expect(submitIntent(far, FAST, 'a1', 'harvest', { cropId: 'crop_1' }).ok).toBe(false)
    expect(submitIntent(mature(), FAST, 'a1', 'harvest', { cropId: 'crop_1' }).ok).toBe(true)
  })

  it('yields exactly `yield` items of the crop kind to the harvester, grants farming xp, removes the crop', () => {
    let s = mature()
    const r = submitIntent(s, FAST, 'a1', 'harvest', { cropId: 'crop_1' })
    if (!r.ok) throw new Error(r.reason)
    s = applyAll(s, r.events)
    s = fold(s, ev('tick_advanced', {}, s.tick + 1), FAST)
    const out = createWorldTick(FAST, new RngStreams('t'))(s)
    expect(out.events).toContainEqual({ type: 'crop_harvested', payload: { cropId: 'crop_1' } })
    expect(out.events).toContainEqual({
      type: 'item_spawned',
      payload: {
        id: 'item_2',
        kind: 'wheat',
        qty: 3,
        loc: { t: 'agent', id: 'a1' },
        owner: 'a1',
        spoilage: { spawnDay: 0, days: 60 },
      },
    })
    expect(out.events).toContainEqual({
      type: 'skill_gained',
      payload: { agentId: 'a1', track: 'farming', xp: 1 },
    })
    expect(out.state.crops.crop_1).toBeUndefined()
    expect(out.state.items.item_2!.qty).toBe(3)
    expect(applyAll(s, out.events, FAST, s.tick)).toEqual(out.state)
  })

  it('a plot beside water yields more, and the same crop out in the dry yields the plain number', () => {
    function harvestQty(rows: string[]): number {
      let s = makeWorld(rows)
      s = fold(
        s,
        ev('crop_planted', { id: 'crop_1', kind: 'wheat', x: 1, y: 0, plantedDay: 0 }),
        FAST,
      )
      s = fold(s, ev('crop_grew', { cropId: 'crop_1', stage: 3 }), FAST)
      const r = submitIntent(s, FAST, 'a1', 'harvest', { cropId: 'crop_1' })
      if (!r.ok) throw new Error(r.reason)
      s = applyAll(s, r.events)
      s = fold(s, ev('tick_advanced', {}, s.tick + 1), FAST)
      const out = createWorldTick(FAST, new RngStreams('t'))(s)
      const spawned = out.events.find((e) => e.type === 'item_spawned')!
      return (spawned.payload as { qty: number }).qty
    }
    // fertility 1.375 one tile from the bank: floor(3 x 1.375) = 4.
    expect(harvestQty(['.#~', '...'])).toBe(4)
    expect(harvestQty(['.#.', '...'])).toBe(3)
  })
})

describe('verb: dig_channel', () => {
  it('cuts a channel beside water in four ticks', () => {
    let s = atTick(makeWorld(['.~.', '...']), NOON)
    const r = submitIntent(s, FAST, 'a1', 'dig_channel', { x: 1, y: 1 })
    if (!r.ok) throw new Error(r.reason)
    expect(r.events[0]).toEqual({
      type: 'action_started',
      payload: { agentId: 'a1', verb: 'dig_channel', params: { x: 1, y: 1 }, duration: 4 },
    })
    s = applyAll(s, r.events)
    let out = createWorldTick(
      FAST,
      new RngStreams('t'),
    )(fold(s, ev('tick_advanced', {}, s.tick + 1), FAST))
    for (let i = 0; i < 3; i++) {
      out = createWorldTick(
        FAST,
        new RngStreams('t'),
      )(fold(out.state, ev('tick_advanced', {}, out.state.tick + 1), FAST))
    }
    expect(out.events).toContainEqual({
      type: 'tile_changed',
      payload: { x: 1, y: 1, from: 0, to: 10, reason: 'channel', byId: 'a1' },
    })
    expect(out.state.terrain[1]![1]).toBe(10)
  })

  it('extends from a channel as readily as from the river itself', () => {
    const s = makeWorld(['.c.', '...'])
    expect(submitIntent(s, FAST, 'a1', 'dig_channel', { x: 1, y: 1 }).ok).toBe(true)
  })

  it('refuses a meadow, a diagonal neighbour, a tile out of reach, and anything but grass or dirt', () => {
    const dry = makeWorld(['...', '...'])
    const r = submitIntent(dry, FAST, 'a1', 'dig_channel', { x: 1, y: 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no water reaches here')
    // (0,1) touches the water at (1,0) only corner to corner.
    expect(
      submitIntent(makeWorld(['.~.', '...']), FAST, 'a1', 'dig_channel', { x: 0, y: 1 }).ok,
    ).toBe(false)
    expect(
      submitIntent(makeWorld(['.~..', '....']), FAST, 'a1', 'dig_channel', { x: 3, y: 1 }).ok,
    ).toBe(false)
    expect(
      submitIntent(makeWorld(['.~#', '...']), FAST, 'a1', 'dig_channel', { x: 2, y: 0 }).ok,
    ).toBe(false)
  })
})
