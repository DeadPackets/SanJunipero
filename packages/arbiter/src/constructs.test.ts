import { describe, expect, it } from 'vitest'
import type { LlmClient } from '@sj/llm'
import { fold, genesisState, type TileId, type WorldState } from '@sj/engine'
import {
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  stateHash,
  type SimEvent,
  CONSTRUCT_VOCABULARY,
  CONSTRUCT_TYPES,
  scanPromptForGlassLeak,
} from '@sj/shared'
import {
  ConstructSchema,
  CONSTRUCT_TYPE_INSTRUCTION,
  detectCandidates,
  namedCustoms,
  NAMED_CUSTOMS_SHOWN,
  runConstructPass,
  type Construct,
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
function gathering(day: number, who: readonly string[] = THREE, x0 = 30): SimEvent[] {
  const at = day * MINUTES_PER_DAY + 19 * 60
  return [
    ...who.map((id, i) => ev(at, 'agent_moved', { id, x: x0 + i, y: 30 })),
    ev(at + 1, 'agent_expressed', {
      agentId: who[0]!,
      verb: 'dance',
      x: x0,
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
      name: 'Long Turning',
      sourceKind: 'speech',
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

  it('never takes the name of one of its own bodies for the gathering', async () => {
    const introduction = ev(5 * MINUTES_PER_DAY + 19 * 60 + 2, 'agent_spoke', {
      agentId: 'ada',
      text: 'Bex, this is Cass, my son.',
      x: 30,
      y: 30,
    })
    const { rows } = await pass([...threeNights(), introduction], new ScriptedLlm(ruleEvery()))
    expect(rows[0]!.name).toBeNull()
  })

  it('never takes a name that leads with one of its own bodies', async () => {
    const remark = ev(5 * MINUTES_PER_DAY + 19 * 60 + 2, 'agent_spoke', {
      agentId: 'ada',
      text: 'We call it Cass Night, after the boy.',
      x: 30,
      y: 30,
    })
    const { rows } = await pass([...threeNights(), remark], new ScriptedLlm(ruleEvery()))
    expect(rows[0]!.name).toBeNull()
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

  it('goes on recording recurrences long after the first week is over', async () => {
    const db = openArbiterDb(':memory:')
    const store = new ConstructStore(db)
    const llm = new ScriptedLlm(ruleEvery())
    const run = (events: SimEvent[]) =>
      runConstructPass({
        events,
        baseConfig: DEFAULT_CONFIG,
        store,
        llm: llm as unknown as LlmClient,
      })
    await run(threeNights())
    const [row] = await run([...threeNights(), ...gathering(20)])

    const at = (day: number): number => day * MINUTES_PER_DAY + 19 * 60
    expect(row!.recurrences.map((r) => r.tick)).toEqual([at(3), at(5), at(20)])
    expect(store.events().filter((e) => e.type === 'construct_recurred')).toHaveLength(3)
  })

  it('keeps a site its id when the window drops the gatherings that founded it', async () => {
    const db = openArbiterDb(':memory:')
    const store = new ConstructStore(db)
    const llm = new ScriptedLlm(ruleEvery())
    const run = (events: SimEvent[]) =>
      runConstructPass({
        events,
        baseConfig: DEFAULT_CONFIG,
        store,
        llm: llm as unknown as LlmClient,
      })
    const drifted = [
      ...gathering(20, THREE, 33),
      ...gathering(22, THREE, 33),
      ...gathering(24, THREE, 33),
    ]
    const [founded] = await run([...threeNights(), ...drifted])
    const [again] = await run(drifted)

    expect(again!.id).toBe(founded!.id)
    expect(store.all()).toHaveLength(1)
    expect(store.events().filter((e) => e.type === 'construct_recognized')).toHaveLength(1)
  })

  it('asks the classifier only about the sites it has never typed', async () => {
    const db = openArbiterDb(':memory:')
    const store = new ConstructStore(db)
    const llm = new ScriptedLlm(ruleEvery())
    const deps = {
      events: threeNights(),
      baseConfig: DEFAULT_CONFIG,
      store,
      llm: llm as unknown as LlmClient,
    }
    await runConstructPass(deps)
    const rows = await runConstructPass(deps)

    expect(llm.objectCalls).toBe(1)
    expect(rows[0]!.type).toBe('festival')
  })

  it('shows the model every type id it is allowed to answer with, and refuses the rest', async () => {
    const llm = new ScriptedLlm(ruleEvery('cult'))
    for (const t of CONSTRUCT_TYPES) expect(CONSTRUCT_TYPE_INSTRUCTION).toContain(t)
    const { rows } = await pass(threeNights(), llm)
    expect(rows[0]!.type).toBe('custom')
  })
})

// The one thing that crosses the glass, and the whole of it: a name the town said out loud.
describe('namedCustoms', () => {
  const construct = (over: Partial<Construct> = {}): Construct => ({
    id: 'construct_30_30',
    type: 'festival',
    name: 'Long Turning',
    nameProvenance: {
      name: 'Long Turning',
      sourceKind: 'speech',
      eventSeq: 9,
      quote: 'We call it the Long Turning.',
      byId: 'bex',
    },
    anchor: { x: 30, y: 30 },
    participants: THREE,
    firstTick: MINUTES_PER_DAY,
    recurrences: [],
    ...over,
  })

  it('renders a construct a mouth named, and never one that only recurred', () => {
    expect(namedCustoms([construct()])).toEqual(['Long Turning'])
    expect(namedCustoms([construct({ name: null, nameProvenance: null })])).toEqual([])
  })

  it('takes a name only from speech, never from a wall', () => {
    const written = construct({
      nameProvenance: { ...construct().nameProvenance!, sourceKind: 'inscription' },
    })
    expect(namedCustoms([written])).toEqual([])
  })

  it('keeps a name that collides with our taxonomy, because a town will say council', () => {
    const said = construct({
      id: 'construct_9_9',
      name: 'Council',
      nameProvenance: { ...construct().nameProvenance!, name: 'Council' },
    })
    expect(namedCustoms([said])).toEqual(['Council'])
  })

  it('holds the oldest names, so a name already on the page never moves', () => {
    const many = Array.from({ length: NAMED_CUSTOMS_SHOWN + 2 }, (_, i) =>
      construct({
        id: `construct_${i}_0`,
        name: `Naming ${i}`,
        firstTick: (NAMED_CUSTOMS_SHOWN + 2 - i) * MINUTES_PER_DAY,
        nameProvenance: { ...construct().nameProvenance!, name: `Naming ${i}` },
      }),
    )
    const held = namedCustoms(many)
    expect(held).toHaveLength(NAMED_CUSTOMS_SHOWN)
    expect(held[0]).toBe(`Naming ${NAMED_CUSTOMS_SHOWN + 1}`)
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
