import { describe, expect, it } from 'vitest'
import {
  createWorldTick,
  EventStore,
  fold,
  genesisState,
  openDb,
  RngStreams,
  TickLoop,
  type TickHandler,
  type TileId,
} from '@sj/engine'
import { SimConfigSchema } from '@sj/shared'
import { EngineBridge } from './bridge.js'
import { buildAgentCtx, humanizeIntent, wireArbiter, type SeamArbiter } from './arbiterSeam.js'

const AGENT = 'tamar'

function world(opts: { well?: boolean; terrain?: TileId[][] } = {}) {
  const config = SimConfigSchema.parse({})
  const terrain: TileId[][] = opts.terrain
    ?? Array.from({ length: 24 }, () => Array.from({ length: 24 }, (): TileId => 0))
  const db = openDb(':memory:')
  const store = new EventStore(db)
  const rng = new RngStreams('arbiter-seam-test')
  let state = genesisState(config, terrain)
  const emit = (type: string, payload: unknown) => {
    const ev = store.append(state.tick, type, payload)
    state = fold(state, ev, config)
  }
  emit('agent_spawned', { id: AGENT, name: 'Tamar', x: 7, y: 4, ageDays: 30 })
  emit('item_spawned', { id: 'item_1', kind: 'wood', qty: 3, loc: { t: 'agent', id: AGENT } })
  emit('skill_gained', { agentId: AGENT, track: 'carpentry', xp: 5 })
  if (opts.well === true) {
    emit('structure_planned', {
      id: 'structure_1', kind: 'well', x: 9, y: 4, w: 1, h: 1, maxHp: 40, flammable: false, builderId: AGENT,
    })
    emit('structure_completed', { id: 'structure_1' })
  }
  // Noon: the sight horizon narrows in the dark, and this seam is about what stands in view.
  state = { ...state, tick: 720 }

  const worldTick = createWorldTick(config, rng)
  let handler: TickHandler = () => {}
  const loop = new TickLoop({ store, state, rng, config, onTick: (ctx) => handler(ctx) })
  const bridge = new EngineBridge({ loop, store, simConfig: config })
  handler = bridge.wrapTickHandler(({ emit: e }) => {
    for (const ev of worldTick(loop.state).events) e(ev.type, ev.payload)
  })
  return { bridge, loop }
}

describe('buildAgentCtx', () => {
  it('carries who is asking, what they carry, where they stand, and what they can already do', () => {
    const { bridge } = world()
    expect(buildAgentCtx(bridge, AGENT)).toEqual({
      agentId: AGENT,
      name: 'Tamar',
      skills: { carpentry: 5 },
      inventory: [{ kind: 'wood', qty: 3 }],
      position: { x: 7, y: 4 },
      visible: { structures: [], ground: ['grass'] },
    })
  })

  // The live run's worst ruling: the arbiter said three times that the town has no well while
  // five minds drank from one, and overturned its own precedent to do it. It could not see.
  it('shows the arbiter what stands in front of the asker', () => {
    const { bridge } = world({ well: true })
    expect(buildAgentCtx(bridge, AGENT).visible.structures).toEqual([{ kind: 'well', x: 9, y: 4 }])
  })

  it('names the ground within sight, in the words a recipe may ask for', () => {
    const rows: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, (): TileId => 0))
    rows[4]![9] = 2   // water, two steps east
    rows[4]![10] = 7  // a road: the town has no recipe word for it, so it is not offered
    rows[20]![20] = 5 // sand, far out of sight
    const { bridge } = world({ terrain: rows })
    expect(buildAgentCtx(bridge, AGENT).visible.ground).toEqual(['grass', 'water'])
  })

  it('throws for a body the world does not have — an unknown asker is a bug, not a verdict', () => {
    const { bridge } = world()
    expect(() => buildAgentCtx(bridge, 'nobody')).toThrow(/nobody/)
  })
})

describe('humanizeIntent', () => {
  it('turns a rejected named verb back into the words a mind would use', () => {
    expect(humanizeIntent('patch', { structureId: 'structure_1' })).toBe('patch structure_1')
    expect(humanizeIntent('inspect', {})).toBe('inspect')
  })

  it('is deterministic: params read in key order, whatever order they arrived in', () => {
    expect(humanizeIntent('walk', { y: 6, x: 5 })).toBe('walk 5 6')
    expect(humanizeIntent('walk', { x: 5, y: 6 })).toBe('walk 5 6')
  })

  it('flattens a nested param without losing it', () => {
    expect(humanizeIntent('offer', { gift: { kind: 'bread' } })).toBe('offer {"kind":"bread"}')
  })
})

describe('wireArbiter', () => {
  it('hands the runtime both halves of the arbiter in one call', () => {
    const arbiter: SeamArbiter = {
      adjudicate: async () => ({ kind: 'impossible', reason: 'no', class: 'physically_impossible' }),
      codify: () => ({ ruleId: 1, verb: 'recipe:x' }),
    }
    const wired: SeamArbiter[] = []
    wireArbiter({ useArbiter: (a) => wired.push(a) }, arbiter)
    expect(wired).toEqual([arbiter])
  })
})
