import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema, type SimConfig, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { composePerception } from './perception.js'
import { RngStreams, type RngStream } from './rng.js'
import { registerVerb, unregisterVerb, VERBS, type VerbDef } from './verbs.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2 }
const ev = (seq: number, type: string, payload: unknown): SimEvent => ({ seq, tick: 0, type, payload })

function makeWorld(rows: string[] = ['........', '........', '........', '........']): WorldState {
  const s = genesisState(DEFAULT_CONFIG, rows.map((row) => [...row].map((c) => CHAR_TILE[c]!)))
  return fold(s, ev(1, 'agent_spawned', { id: 'a1', name: 'a1', x: 0, y: 0, ageDays: 7300 }))
}

const testVerb: VerbDef = {
  kind: 'recipe:test',
  validate() { return null },
  duration() { return 1 },
  onComplete() { return [] },
  interruptible: true,
}

const TIER1 = [
  'walk', 'sleep', 'wake', 'enter', 'exit', 'eat', 'tend', 'till', 'plant', 'harvest', 'fish', 'forage',
  'build', 'craft', 'extinguish',
  'speak', 'give', 'take', 'stow', 'write', 'read', 'inscribe', 'teach', 'attack', 'experiment',
]

afterEach(() => { unregisterVerb('recipe:test') })

describe('verb registry seam', () => {
  it('registerVerb registers a codified recipe verb end-to-end', () => {
    const s = makeWorld()
    registerVerb(testVerb)
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'recipe:test', {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.events).toContainEqual({
      type: 'action_started',
      payload: { agentId: 'a1', verb: 'recipe:test', params: {}, duration: 1 },
    })
  })

  it('registerVerb throws on a duplicate kind', () => {
    expect(() => registerVerb({ ...testVerb, kind: 'walk' })).toThrow(/already registered/)
  })

  it('unregisterVerb removes a verb; unknown and absent kinds are no-ops', () => {
    registerVerb(testVerb)
    unregisterVerb('recipe:test')
    expect(submitIntent(makeWorld(), DEFAULT_CONFIG, 'a1', 'recipe:test', {})).toEqual({
      ok: false, reason: 'unknown verb: recipe:test',
    })
    expect(() => unregisterVerb('never_existed')).not.toThrow()
  })

  it('all Tier-1 verbs still resolve, and TIER1 is the whole built-in registry', () => {
    for (const v of TIER1) expect(VERBS[v]).toBeDefined()
    expect(Object.keys(VERBS).sort()).toEqual([...TIER1].sort())
    const r = submitIntent(makeWorld(), DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'ghost' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).not.toBe('unknown verb: eat')
  })

  it('VerbDef.kind is a string that accepts a literal Tier-1 verb unchanged', () => {
    const def: VerbDef = {
      kind: 'walk',
      validate: () => null,
      duration: () => 1,
      onComplete: () => [],
      interruptible: true,
    }
    expect(def.kind).toBe('walk')
  })
})

describe('eat: a last-day meal and the pale mushroom', () => {
  const cfg = (mortality: Record<string, unknown>): SimConfig => SimConfigSchema.parse({ mortality })
  const POISONS = cfg({ poisonChanceSpoiled: 1 })
  const SPARES = cfg({ poisonChanceSpoiled: 0 })
  const OFF = cfg({ enabled: false, poisonChanceSpoiled: 1 })
  const DAY = 1440

  function holding(kind: string, spoilage?: { spawnDay: number; days: number }, day = 0): WorldState {
    const s = fold(makeWorld(), ev(2, 'item_spawned', {
      id: 'item_1', kind, qty: 1, loc: { t: 'agent', id: 'a1' }, ...(spoilage ? { spoilage } : {}),
    }))
    return { ...s, tick: day * DAY }
  }
  const eaten = (s: WorldState, config: SimConfig, rng: RngStream) =>
    VERBS.eat!.onComplete(s, config, 'a1', { itemId: 'item_1' }, rng)
  const illness = (seed = 'poison') => new RngStreams(seed).get('illness')

  it('draws its roll from the illness stream, and a pale mushroom is food you may eat', () => {
    expect(VERBS.eat!.rngStream).toBe('illness')
    const r = submitIntent(holding('pale_mushroom'), DEFAULT_CONFIG, 'a1', 'eat', { itemId: 'item_1' })
    expect(r.ok).toBe(true)
  })

  it('poisons on a pale mushroom when the roll goes against the eater, and still feeds them', () => {
    const out = eaten(holding('pale_mushroom'), POISONS, illness())
    expect(out[0]).toEqual({
      type: 'agent_afflicted', payload: { agentId: 'a1', kind: 'poison', severity: 1, itemId: 'item_1' },
    })
    expect(out).toContainEqual({
      type: 'need_changed', payload: { id: 'a1', need: 'hunger', delta: POISONS.needs.eatRestoreHunger },
    })
  })

  it('spares the eater when the roll goes their way, and the meal still counts', () => {
    const out = eaten(holding('pale_mushroom'), SPARES, illness())
    expect(out.map((e) => e.type)).toEqual(['item_qty_changed', 'need_changed'])
  })

  it('rolls on a loaf on its last day, and not one day earlier', () => {
    const spoiling = holding('bread', { spawnDay: 0, days: 6 }, 5)
    expect(eaten(spoiling, POISONS, illness()).map((e) => e.type)).toContain('agent_afflicted')

    const fresh = holding('bread', { spawnDay: 0, days: 6 }, 4)
    const rng = illness()
    const before = rng.state()
    expect(eaten(fresh, POISONS, rng).map((e) => e.type)).not.toContain('agent_afflicted')
    expect(rng.state()).toEqual(before)
  })

  it('never draws at all when the world has mortality switched off', () => {
    const rng = illness()
    const before = rng.state()
    expect(eaten(holding('pale_mushroom'), OFF, rng).map((e) => e.type)).not.toContain('agent_afflicted')
    expect(rng.state()).toEqual(before)
  })

  it('tells the eye a pale mushroom and nothing more: which ones kill is the town\'s to learn', () => {
    const s = fold(makeWorld(), ev(3, 'item_spawned', {
      id: 'item_1', kind: 'pale_mushroom', qty: 1, loc: { t: 'tile', x: 1, y: 1 },
    }))
    const seen = composePerception(s, DEFAULT_CONFIG, 'a1', []).visible.items
    expect(seen.find((i) => i.kind === 'pale_mushroom')).toBeDefined()
    expect(JSON.stringify(seen)).not.toMatch(/warn|danger|poison|deadly/i)
  })
})
