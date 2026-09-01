import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine/store'
import {
  createWorldTick,
  fold,
  genesisState,
  GENESIS_RIVER_X,
  isPassable,
  makeGenesisWorld,
  RngStreams,
  TickLoop,
  walkDestination,
  type TickHandler,
  type TileId,
  type WorldState,
} from '@sj/engine'
import { isWet, SimConfigSchema, type SimConfig } from '@sj/shared'
import { perceptionToProse, placesKnownLine } from '../prompt/prose.js'
import { EngineBridge } from './bridge.js'

// Walked end to end: a founder who has never been shown anything reads "the river" out of the
// places it knows, and the same mark walks its legs to the bank.
const AGENT = 'tamar'

// Well east of the channel and well west of the lake, so every bearing below is unambiguous.
const EAST_BANK = { x: GENESIS_RIVER_X + 30, y: 70 }

function valley(
  at: { x: number; y: number },
  flat = false,
): { bridge: EngineBridge; loop: TickLoop; config: SimConfig } {
  const config = SimConfigSchema.parse({
    weather: { hourlyChangeChance: 0 },
    mystery: { chancePerDay: 0 },
  })
  const { w, h } = config.world.size
  const terrain: TileId[][] = flat
    ? Array.from({ length: h }, () => Array.from({ length: w }, (): TileId => 0))
    : makeGenesisWorld(config).terrain
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('river-seam')
  let state = genesisState(config, terrain)
  state = fold(
    state,
    store.append(state.tick, 'agent_spawned', {
      id: AGENT,
      name: 'Tamar',
      x: at.x,
      y: at.y,
      ageDays: 7300,
    }),
    config,
  )
  // Noon: the sight horizon shrinks with the light, and the vista is about what the eyes reach.
  state = { ...state, tick: 720 }

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({
    store,
    state,
    rng,
    config,
    onTick: (ctx) => {
      handler(ctx)
    },
  })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit }) => {
    for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
  })
  return { bridge, loop, config }
}

const touchesWater = (state: WorldState, p: { x: number; y: number }): boolean => {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tile = state.terrain[p.y + dy]?.[p.x + dx]
      if (tile !== undefined && isWet(tile)) return true
    }
  }
  return false
}

describe('★ the valley a mind is born knowing', () => {
  it('names the river, the lake and the ford to a founder who has been shown nothing', () => {
    const { bridge } = valley(EAST_BANK)
    const packet = bridge.perception(AGENT)
    expect(packet.visible.structures).toEqual([])

    const lines = placesKnownLine(bridge.knownPlaces(AGENT), packet).split('\n')
    expect(lines[0]).toBe('Places you know:')
    expect(lines).toContain('the river (river), far to the west')
    expect(lines.join('\n')).toMatch(/the lake \(lake\), far to the north/)
    expect(lines.join('\n')).toMatch(/the ford \(ford\)/)
  })

  it('a valley with no water in it has no landmarks to name', () => {
    const { bridge } = valley(EAST_BANK, true)
    expect(bridge.knownPlaces(AGENT)).toEqual([])
  })

  it('★ walks the legs to the bank, on the mark the block printed', () => {
    const { loop, config } = valley(EAST_BANK)
    const to = walkDestination(loop.state, config, AGENT, { structureId: 'river' })
    expect(to).not.toHaveProperty('refusal')
    const bank = to as { x: number; y: number }
    // Ground a foot can go on, at the water's edge, and on this body's own side of it.
    expect(isPassable(loop.state, bank.x, bank.y)).toBe(true)
    expect(touchesWater(loop.state, bank)).toBe(true)
    expect(bank.x).toBeGreaterThan(GENESIS_RIVER_X)
  })

  it('a mark this valley has no ground for names no place at all', () => {
    const { loop, config } = valley(EAST_BANK, true)
    expect(walkDestination(loop.state, config, AGENT, { structureId: 'river' })).toEqual({
      refusal: 'you know no such place',
    })
  })
})

describe('★ water at the far edge of the valley', () => {
  it('glints in the direction it actually lies', () => {
    const { bridge, loop, config } = valley(EAST_BANK)
    const prose = perceptionToProse(bridge.perception(AGENT), undefined, {
      distantWater: (x, y) => bridge.distantWater(x, y),
    })
    expect(prose).toContain('Water glints to the west.')
    // The same water the legs would be sent to, so the glint and the walk cannot disagree.
    const to = walkDestination(loop.state, config, AGENT, { structureId: 'river' })
    expect((to as { x: number }).x).toBeLessThan(EAST_BANK.x)
  })

  it('says nothing at the bank itself, where the near scan already has it', () => {
    const { bridge } = valley({ x: GENESIS_RIVER_X + 3, y: 70 })
    expect(bridge.distantWater(GENESIS_RIVER_X + 3, 70)).toBe(null)
    const prose = perceptionToProse(bridge.perception(AGENT), undefined, {
      distantWater: (x, y) => bridge.distantWater(x, y),
    })
    expect(prose).not.toContain('glints')
  })

  it('says nothing about water too far off to pick out', () => {
    const { bridge } = valley({ x: GENESIS_RIVER_X + 60, y: 70 })
    expect(bridge.distantWater(GENESIS_RIVER_X + 60, 70)).toBe(null)
  })
})
