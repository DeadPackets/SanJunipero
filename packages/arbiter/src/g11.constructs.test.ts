// @slow — the recognition plane: the word a town buys once, the thing it keeps coming back to,
// and the glass nothing said here may cross. Every model in this file is a script.
import { describe, expect, it } from 'vitest'
import type { LlmClient } from '@sj/llm'
import { FakeEmbedder } from '@sj/llm/testutil'
import {
  fold,
  genesisState,
  submitIntent,
  unregisterVerb,
  VERBS,
  type WorldState,
} from '@sj/engine'
import {
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  SimConfigSchema,
  type SimEvent,
  scanPromptForGlassLeak,
  UNNAMED_CONSTRUCT_COPY,
} from '@sj/shared'
import { CANON } from './canon.js'
import { CodexStore } from './codex.js'
import {
  CONSTRUCT_TYPES,
  CONSTRUCT_TYPE_INSTRUCTION,
  ConstructSchema,
  detectCandidates,
  runConstructPass,
} from './constructs.js'
import { ConstructStore } from './constructStore.js'
import { makeArbiter, type AgentCtx, type Arbiter } from './adjudicate.js'
import { EXPRESSIVE_INSTRUCTION, type ExpressiveRuling } from './expressive.js'
import { ADJUDICATION_INSTRUCTION } from './prompt.js'
import { openArbiterDb } from './schema.js'
import { ScriptedLlm } from './testutil/scriptedLlm.js'
import type { Verdict } from './verdict.js'

let seq = 1
const ev = (tick: number, type: string, payload: unknown): SimEvent => ({
  seq: seq++,
  tick,
  type,
  payload,
})

// Every prompt any model in this file was shown, so the one-way-glass scan is run over the
// whole suite's traffic and not over a sample of it.
const ALL_PROMPTS: string[] = []

// ------------------------------------------------------------------ the expressive verb

const DANCE: ExpressiveRuling = {
  word: 'dance',
  sense: 'sight',
  durationTicks: 10,
  energyCost: 2,
  targeted: false,
  emote: 'turns in slow circles, arms wide',
}
const IMPOSSIBLE: Verdict = {
  kind: 'impossible',
  reason: 'no clear way to do this',
  class: 'physically_impossible',
}

const ADA: AgentCtx = {
  agentId: 'ada',
  name: 'Ada',
  skills: {},
  inventory: [],
  position: { x: 20, y: 20 },
}
const BEX: AgentCtx = { ...ADA, agentId: 'bex', name: 'Bex' }

async function rig(llm: ScriptedLlm): Promise<Arbiter> {
  const db = openArbiterDb(':memory:')
  new CodexStore(db).insert({ id: 'fire', era: 'handwork', name: 'Fire', prerequisiteId: null })
  return makeArbiter({
    db,
    llm: llm as unknown as LlmClient,
    embedder: await FakeEmbedder.create(),
    tick: () => 100,
  })
}

const scripted = new ScriptedLlm(({ system }) =>
  system.includes(EXPRESSIVE_INSTRUCTION) ? DANCE : IMPOSSIBLE,
)

function twoBodies(): WorldState {
  let s = genesisState(
    DEFAULT_CONFIG,
    Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => 0 as const)),
  )
  for (const [id, name] of [
    ['ada', 'Ada'],
    ['bex', 'Bex'],
  ]) {
    s = fold(s, ev(0, 'agent_spawned', { id, name, x: 20, y: 20, ageDays: 7300 }), DEFAULT_CONFIG)
  }
  return { ...s, tick: 720 }
}

describe('G11a-X1: a word the town buys once and then owns', () => {
  it('one adjudication, then a second body does the same act at zero cost', async () => {
    const llm = scripted
    const arbiter = await rig(llm)
    try {
      const first = await arbiter.adjudicate('I dance by the fire', ADA)
      expect(first).toEqual({ kind: 'map', verb: 'express:dance', params: {} })
      expect(llm.objectCalls).toBe(1)
      expect(llm.systems[0]).toContain(EXPRESSIVE_INSTRUCTION)
      expect(llm.systems[0]).not.toContain(ADJUDICATION_INSTRUCTION)

      const before = llm.objectCalls
      const second = await arbiter.adjudicate('dance', BEX)
      expect(second).toEqual({ kind: 'map', verb: 'express:dance', params: {} })
      expect(llm.objectCalls - before).toBe(0)

      // And the second body can really do it: the verb is in the registry the engine reads.
      const s = twoBodies()
      const started = submitIntent(s, DEFAULT_CONFIG, 'bex', 'express:dance', {})
      expect(started.ok).toBe(true)
      const events = VERBS['express:dance']!.onComplete(s, DEFAULT_CONFIG, 'bex', {}, {
        next: () => 0,
        int: () => 0,
      } as never)
      expect(events[0]).toMatchObject({
        type: 'agent_expressed',
        payload: { agentId: 'bex', verb: 'dance' },
      })
      ALL_PROMPTS.push(...llm.systems, ...llm.users)
    } finally {
      unregisterVerb('express:dance')
    }
  })
})

// ------------------------------------------------------------------ the recognizer

const THREE = ['ada', 'bex', 'cass']

// One coming-together at (30, 30) on a given evening: three bodies walk in, one dances.
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

const NAMED = (day: number): SimEvent =>
  ev(day * MINUTES_PER_DAY + 19 * 60 + 2, 'agent_spoke', {
    agentId: 'bex',
    text: 'Every seventh night now. We call it the Long Turning.',
    x: 30,
    y: 30,
  })

const NIGHTS = (): SimEvent[] => [...gathering(1), ...gathering(3), ...gathering(5)]

const classifier = (type: string) =>
  new ScriptedLlm(({ user }) => ({
    rulings: [...user.matchAll(/^- (\S+)/gmu)].map((m) => ({ key: m[1]!, type })),
  }))

async function runPass(
  events: SimEvent[],
  llm: ScriptedLlm,
  overrides: Record<string, unknown> = {},
) {
  const db = openArbiterDb(':memory:')
  const store = new ConstructStore(db)
  const rows = await runConstructPass({
    events,
    baseConfig: DEFAULT_CONFIG,
    store,
    llm: llm as unknown as LlmClient,
    ...overrides,
  })
  ALL_PROMPTS.push(...llm.systems, ...llm.users)
  return { rows, store }
}

describe('G11a-X2: the recognizer over the authored fixture', () => {
  it('yields exactly one row, correctly typed, named verbatim, with its provenance', async () => {
    const llm = classifier('festival')
    const { rows, store } = await runPass([...NIGHTS(), NAMED(5)], llm)
    expect(rows).toHaveLength(1)
    const row = ConstructSchema.parse(rows[0])
    expect(row.type).toBe('festival')
    expect(CONSTRUCT_TYPES).toContain(row.type)
    expect(row.name).toBe('Long Turning')
    expect(row.nameProvenance).not.toBeNull()
    // Verbatim or nothing: the name is a substring of the sentence it came out of.
    expect(row.nameProvenance!.quote).toContain(row.name!)
    expect(row.nameProvenance!.byId).toBe('bex')
    expect(row.participants).toEqual([...THREE].sort())
    expect(row.recurrences).toHaveLength(2)

    // One call for the whole pass, and the registry says the same thing the return did.
    expect(llm.objectCalls).toBe(1)
    expect(store.all()).toHaveLength(1)
    expect(store.events().filter((e) => e.type === 'construct_recognized')).toHaveLength(1)
    expect(store.events().filter((e) => e.type === 'construct_named')).toHaveLength(1)
  })

  it('a fixture where nobody says a name keeps `null`, and the viewer is told so', async () => {
    const { rows } = await runPass(NIGHTS(), classifier('faith'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBeNull()
    expect(rows[0]!.nameProvenance).toBeNull()
    expect(UNNAMED_CONSTRUCT_COPY).toBe('a gathering not yet named')
  })

  it('the pass is idempotent: a second run over the same days recognizes nothing twice', async () => {
    const db = openArbiterDb(':memory:')
    const store = new ConstructStore(db)
    const llm = classifier('council')
    const deps = {
      events: [...NIGHTS(), NAMED(5)],
      baseConfig: DEFAULT_CONFIG,
      store,
      llm: llm as unknown as LlmClient,
    }
    await runConstructPass(deps)
    await runConstructPass(deps)
    expect(store.all()).toHaveLength(1)
    expect(store.events().filter((e) => e.type === 'construct_recognized')).toHaveLength(1)
  })

  it('with the law off there are no rows and no call at all', async () => {
    const OFF = SimConfigSchema.parse({ constructs: { enabled: false } })
    const llm = classifier('festival')
    const db = openArbiterDb(':memory:')
    const store = new ConstructStore(db)
    const rows = await runConstructPass({
      events: [...NIGHTS(), NAMED(5)],
      baseConfig: OFF,
      store,
      llm: llm as unknown as LlmClient,
    })
    expect(rows).toEqual([])
    expect(llm.objectCalls).toBe(0)
    expect(store.all()).toEqual([])

    // And the same, switched off by a world law mid-run rather than by the base config.
    const byLaw = await runConstructPass({
      events: [...NIGHTS(), NAMED(5)],
      baseConfig: DEFAULT_CONFIG,
      store,
      llm: llm as unknown as LlmClient,
      laws: { 'constructs.enabled': false },
    })
    expect(byLaw).toEqual([])
    expect(llm.objectCalls).toBe(0)
  })

  it('a name the record does not carry is refused, so the row keeps null', async () => {
    // The classifier is not asked for names; the naming law reads mouths. A gathering whose
    // only speech names nothing leaves the field null rather than inventing one.
    const quiet = ev(5 * MINUTES_PER_DAY + 19 * 60 + 2, 'agent_spoke', {
      agentId: 'bex',
      text: 'cold tonight',
      x: 30,
      y: 30,
    })
    const { rows } = await runPass([...NIGHTS(), quiet], classifier('festival'))
    expect(rows[0]!.name).toBeNull()
  })

  it('two bodies are not a gathering, and two nights are not a habit', () => {
    const two = [
      ...gathering(1, ['ada', 'bex']),
      ...gathering(3, ['ada', 'bex']),
      ...gathering(5, ['ada', 'bex']),
    ]
    expect(detectCandidates(two, DEFAULT_CONFIG)).toEqual([])
    expect(detectCandidates([...gathering(1), ...gathering(3)], DEFAULT_CONFIG)).toEqual([])
  })
})

// ------------------------------------------------------------------ the one-way glass

describe('G11a-X3: the one-way glass, scanned over every prompt this suite assembled', () => {
  it('the canon and the two agent-facing instructions carry no ops word', () => {
    expect(scanPromptForGlassLeak(CANON)).toEqual([])
    expect(scanPromptForGlassLeak(ADJUDICATION_INSTRUCTION)).toEqual([])
    expect(scanPromptForGlassLeak(EXPRESSIVE_INSTRUCTION)).toEqual([])
  })

  it('the classifier prompt is ops-side and is ALLOWED its own vocabulary — and is never shown to a mind', () => {
    // The one prompt in the codebase that must name the taxonomy. It is the recognizer's,
    // it never reaches an agent, and the scan is what proves the difference is deliberate.
    expect(scanPromptForGlassLeak(CONSTRUCT_TYPE_INSTRUCTION).length).toBeGreaterThan(0)
    for (const type of CONSTRUCT_TYPES) expect(CONSTRUCT_TYPE_INSTRUCTION).toContain(type)
  })

  it('every prompt an AGENT-facing path assembled in this file is clean', () => {
    const agentFacing = ALL_PROMPTS.filter((p) => !p.includes(CONSTRUCT_TYPE_INSTRUCTION))
    expect(agentFacing.length).toBeGreaterThan(0)
    for (const prompt of agentFacing) expect(scanPromptForGlassLeak(prompt)).toEqual([])
  })
})
