import { describe, expect, it } from 'vitest'
import type { LlmClient } from '@sj/llm'
import { fold, genesisState, type TileId, type WorldState } from '@sj/engine'
import {
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  stateHash,
  type SimEvent,
  CONSTRUCT_VOCABULARY,
  scanPromptForGlassLeak,
} from '@sj/shared'
import {
  CONSTRUCT_TYPES,
  ConstructSchema,
  CONSTRUCT_TYPE_INSTRUCTION,
  detectCandidates,
  runConstructPass,
} from './constructs.js'
import { ConstructStore } from './constructStore.js'
import { CANON } from './canon.js'
import { openArbiterDb } from './schema.js'
import { ScriptedLlm, type ScriptedCall } from './testutil/scriptedLlm.js'

let seq = 1
const ev = (tick: number, type: string, payload: unknown): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

const THREE = ['ada', 'bex', 'cass']

// One coming-together at (30, 30) on a given day: three bodies walk in, one dances.
function gathering(day: number, who: readonly string[] = THREE): SimEvent[] {
  const at = day * MINUTES_PER_DAY + 19 * 60
  return [
    ...who.map((id, i) => ev(at, 'agent_moved', { id, x: 30 + i, y: 30 })),
    ev(at + 1, 'agent_expressed', {
      agentId: who[0]!,
      verb: 'dance',
      x: 30,
      y: 30,
      sense: 'sight',
    }),
  ]
}

const NAMING = (day: number): SimEvent =>
  ev(day * MINUTES_PER_DAY + 19 * 60 + 2, 'agent_spoke', {
    agentId: 'bex',
    text: 'Every seventh night now. We call it the Long Turning.',
    x: 30,
    y: 30,
  })

const threeNights = (): SimEvent[] => [...gathering(1), ...gathering(3), ...gathering(5)]

// Answers every candidate key the prompt listed with the same construct type.
const ruleEvery =
  (type = 'festival') =>
  ({ user }: ScriptedCall): unknown => ({
    rulings: [...user.matchAll(/^- (\S+)/gmu)].map((m) => ({ key: m[1]!, type })),
  })

const pass = async (
  events: SimEvent[],
  llm: ScriptedLlm,
  overrides: Record<string, unknown> = {},
) => {
  const db = openArbiterDb(':memory:')
  const store = new ConstructStore(db)
  const rows = await runConstructPass({
    events,
    baseConfig: DEFAULT_CONFIG,
    store,
    llm: llm as unknown as LlmClient,
    ...overrides,
  })
  return { rows, store, db }
}

describe('detectCandidates', () => {
  it('needs the gatherings to recur — two nights is a habit nobody has yet', () => {
    expect(detectCandidates([...gathering(1), ...gathering(3)], DEFAULT_CONFIG)).toEqual([])
    expect(detectCandidates(threeNights(), DEFAULT_CONFIG)).toHaveLength(1)
  })

  it('needs enough bodies to be a gathering at all', () => {
    const two = [
      ...gathering(1, ['ada', 'bex']),
      ...gathering(3, ['ada', 'bex']),
      ...gathering(5, ['ada', 'bex']),
    ]
    expect(detectCandidates(two, DEFAULT_CONFIG)).toEqual([])
  })

  it('carries the anchor, the bodies, the first tick and every recurrence', () => {
    const [c] = detectCandidates(threeNights(), DEFAULT_CONFIG)
    expect(c!.anchor).toEqual({ x: 31, y: 30 })
    expect(c!.participants).toEqual(THREE)
    expect(c!.firstTick).toBe(MINUTES_PER_DAY + 19 * 60)
    expect(c!.gatherings).toHaveLength(3)
    expect(c!.signals.expressive).toBe(3)
  })

  it('lets a week pass between them, but not a fortnight', () => {
    const spread = [...gathering(1), ...gathering(3), ...gathering(20)]
    const [c] = detectCandidates(spread, DEFAULT_CONFIG)
    expect(c).toBeUndefined()
  })
})

describe('the daily pass', () => {
  it('writes exactly one row, typed, named in their own words, with provenance', async () => {
    const llm = new ScriptedLlm(ruleEvery('festival'))
    const { rows, store } = await pass([...threeNights(), NAMING(5)], llm)
    expect(rows).toHaveLength(1)
    expect(llm.objectCalls).toBe(1)
    const row = ConstructSchema.parse(rows[0])
    expect(row.type).toBe('festival')
    expect(row.name).toBe('Long Turning')
    expect(row.nameProvenance).toEqual({
      eventSeq: expect.any(Number) as number,
      quote: 'Every seventh night now. We call it the Long Turning.',
      byId: 'bex',
    })
    expect(row.nameProvenance!.quote).toContain(row.name!)
    expect(store.all()).toHaveLength(1)
    expect(store.events().map((e) => e.type)).toEqual([
      'construct_recognized',
      'construct_recurred',
      'construct_recurred',
      'construct_named',
    ])
  })

  it('leaves the name null when nobody has said one', async () => {
    const { rows } = await pass(threeNights(), new ScriptedLlm(ruleEvery()))
    expect(rows[0]!.name).toBeNull()
    expect(rows[0]!.nameProvenance).toBeNull()
  })

  it('writes nothing, and asks nothing, when the law is switched off', async () => {
    const llm = new ScriptedLlm(ruleEvery())
    const off = [
      ...threeNights(),
      ev(6 * MINUTES_PER_DAY, 'config_changed', { path: 'constructs.enabled', value: false }),
    ]
    const { rows, store } = await pass(off, llm)
    expect(rows).toEqual([])
    expect(store.all()).toEqual([])
    expect(llm.objectCalls).toBe(0)
  })

  it('reads the world law off the log itself — the recognizer derives its own config (G5)', async () => {
    const llm = new ScriptedLlm(ruleEvery())
    const raised = [
      ev(0, 'config_changed', { path: 'constructs.minParticipants', value: 4 }),
      ...threeNights(),
    ]
    expect((await pass(raised, llm)).rows).toEqual([])
    const four = ['ada', 'bex', 'cass', 'dov']
    const wider = [
      ev(0, 'config_changed', { path: 'constructs.minParticipants', value: 4 }),
      ...gathering(1, four),
      ...gathering(3, four),
      ...gathering(5, four),
    ]
    expect((await pass(wider, new ScriptedLlm(ruleEvery()))).rows).toHaveLength(1)
  })

  it('runs a second pass over the same days without minting a second row', async () => {
    const db = openArbiterDb(':memory:')
    const store = new ConstructStore(db)
    const events = [...threeNights(), NAMING(5)]
    const deps = {
      events,
      baseConfig: DEFAULT_CONFIG,
      store,
      llm: new ScriptedLlm(ruleEvery()) as unknown as LlmClient,
    }
    await runConstructPass(deps)
    await runConstructPass(deps)
    expect(store.all()).toHaveLength(1)
    expect(store.events().filter((e) => e.type === 'construct_recognized')).toHaveLength(1)
  })

  it('shows the model every type id it is allowed to answer with, and refuses the rest', async () => {
    const llm = new ScriptedLlm(ruleEvery('cult'))
    for (const t of CONSTRUCT_TYPES) expect(CONSTRUCT_TYPE_INSTRUCTION).toContain(t)
    const { rows } = await pass(threeNights(), llm)
    expect(rows[0]!.type).toBe('custom')
  })
})

describe('one-way glass', () => {
  it("the registry is the arbiter's alone — no world row, no hash movement", async () => {
    const flat = Array.from({ length: 64 }, () => Array.from({ length: 64 }, (): TileId => 0))
    let state: WorldState = genesisState(DEFAULT_CONFIG, flat)
    const events = [...threeNights(), NAMING(5)]
    const before = stateHash(state)
    const { rows, db } = await pass(events, new ScriptedLlm(ruleEvery()))
    for (const e of events) {
      if (e.type === 'agent_moved' || e.type === 'agent_expressed' || e.type === 'agent_spoke')
        continue
      state = fold(state, e, DEFAULT_CONFIG)
    }
    expect(stateHash(state)).toBe(before)
    expect(JSON.stringify(state)).not.toContain('construct')
    expect(JSON.stringify(state)).not.toContain(rows[0]!.id)
    expect(new ConstructStore(db).all()).toHaveLength(1)
    // The world log is where physics lives, and the pass wrote nothing into it.
    expect((db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n).toBe(0)
    expect((db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n).toBe(0)
  })

  it('never lets a type word out into a prompt an agent can see', () => {
    for (const t of CONSTRUCT_TYPES) {
      expect(ConstructSchema.shape.type.options).toContain(t)
      // The mirror guard: the taxonomy the arbiter writes is the taxonomy the scan catches.
      expect(CONSTRUCT_VOCABULARY, t).toContain(t)
    }
  })

  it("the arbiter's own agent-facing text is clean", () => {
    const agentFacing = [
      'no clear way to do this presents itself',
      'nothing in the town lends itself to this',
      'this would need a craft the town has not yet reached',
      CANON,
    ]
    for (const text of agentFacing) expect(scanPromptForGlassLeak(text), text).toEqual([])
  })

  it("the recognizer's own prompt is ops-side, and says so by carrying the taxonomy", () => {
    expect(scanPromptForGlassLeak(CONSTRUCT_TYPE_INSTRUCTION).sort()).toEqual(
      [...CONSTRUCT_TYPES].sort(),
    )
  })
})
