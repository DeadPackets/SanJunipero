import { describe, it, expect, afterEach } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
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
