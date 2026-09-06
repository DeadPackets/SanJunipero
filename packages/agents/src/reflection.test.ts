import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import { NoObjectGeneratedError } from 'ai'
import { openAgentDb } from './memory/schema.js'
import { MemoryStore, type MemoryKind, type MemoryRow, type MemoryTags } from './memory/store.js'
import { GIST_MIN_CHARS } from './memory/gist.js'
import { TieStore } from './memory/ties.js'
import Sqlite from 'better-sqlite3'
import { BudgetExceededError, LlmClient, migrateLlmTables, type LlmMessage } from '@sj/llm'
import { FakeEmbedder, mockModel } from '@sj/llm/testutil'
import { PersonalityStore, type PersonalityDoc } from './personality.js'
import {
  runSleepReflection,
  gistPrompt,
  makeReflectionLlm,
  extractFactsPrompt,
  summarizeScenesPrompt,
  summarizeDayPrompt,
  updateLedgerPrompt,
  listTiesPrompt,
  autobiographyPrompt,
  proposeEditPrompt,
  ProposeEditSchema,
  editFromAnswer,
  FALLBACK_AUTOBIOGRAPHY,
  FALLBACK_DAY_TITLE,
  FALLBACK_DIGEST_CHARS,
  type ReflectionLlm,
} from './reflection.js'
import {
  FORBIDDEN_FRAMING,
  PLAIN_SPEECH,
  scanForLayoutLeak,
  scanPromptForGlassLeak,
} from '@sj/shared'

const AGENT = 'tamar'
const DAY = 3
const TICKS_PER_DAY = 1440
const CAST = [
  { id: AGENT, name: 'Tamar' },
  { id: 'nadia', name: 'Nadia' },
  { id: 'omar', name: 'Omar' },
]

const TAGS: MemoryTags = { people: [], place: 'storehouse', objects: [], topics: [] }

function baseDoc(): PersonalityDoc {
  return {
    temperament: 'calm',
    values: ['loyalty'],
    beliefs: [],
    current: { mood: 'ok', worries: [], goals: [] },
  }
}

async function makeStores(): Promise<{
  db: Database.Database
  mem: MemoryStore
  personality: PersonalityStore
}> {
  const db = openAgentDb(':memory:')
  const mem = new MemoryStore(db, AGENT, await FakeEmbedder.create())
  const personality = new PersonalityStore(db, AGENT)
  personality.init(baseDoc(), 0)
  return { db, mem, personality }
}

const SINGLE_PERSON_DAY = [
  { text: 'Nadia and I bartered grain for firewood.', people: ['Nadia'], importance: 7 },
  { text: 'Nadia promised to help mend the storehouse.', people: ['Nadia'], importance: 6 },
  { text: 'I mended the storehouse door alone.', people: [], importance: 4 },
]

const TWO_PERSON_DAY = [
  { text: 'Nadia and I bartered grain for firewood.', people: ['Nadia'], importance: 7 },
  { text: 'Omar promised to repay three firewood by tomorrow.', people: ['Omar'], importance: 8 },
  { text: 'I mended the storehouse door alone.', people: [], importance: 4 },
]

async function seedDay(
  mem: MemoryStore,
  day: number,
  specs: { text: string; people: string[]; importance: number; kind?: MemoryKind }[],
): Promise<MemoryRow[]> {
  let i = 0
  for (const s of specs) {
    await mem.insertMemory({
      tick: day * TICKS_PER_DAY + i,
      kind: s.kind ?? 'perception',
      text: s.text,
      importance: s.importance,
      tags: { ...TAGS, people: s.people },
    })
    i += 1
  }
  return mem.memoriesOfDay(day)
}

/** What opens the nightly edit: one act at the mark `actImportance` gives a making. Appended to
 *  a day, so the fixtures' row order and ids are the ones every other test already reads. */
const A_MAKING = {
  text: 'You have raised a wall.',
  people: [],
  importance: 7,
  kind: 'action' as const,
}
const A_DAY_THAT_CHANGED_SOMETHING = [...TWO_PERSON_DAY, A_MAKING]

/** One the day opened and one it paid off, plus a neighbour who was never in the valley. */
const LISTED_TIES: Awaited<ReturnType<ReflectionLlm['listTies']>> = [
  {
    about: 'Nadia',
    kind: 'promise',
    text: 'She mends the storehouse door with me.',
    settled: false,
  },
  { about: 'Omar', kind: 'debt', text: 'Three firewood, and he brought them.', settled: true },
  {
    about: 'Kestrel',
    kind: 'grudge',
    text: 'Nobody of that name has ever lived here.',
    settled: false,
  },
]

class ScriptedReflectionLlm implements ReflectionLlm {
  calls: string[] = []
  constructor(private readonly edit: unknown) {}

  async gist(text: string) {
    this.calls.push('gist')
    return `gist: ${text.slice(0, 20)}`
  }

  async extractFacts(dayMemories: MemoryRow[]) {
    this.calls.push('extractFacts')
    return [
      {
        subject: 'Nadia',
        predicate: 'traded',
        object: 'grain for firewood',
        srcMemoryId: dayMemories[0]!.id,
      },
      {
        subject: 'Nadia',
        predicate: 'promised',
        object: 'to help mend the storehouse',
        srcMemoryId: dayMemories[1]!.id,
      },
    ]
  }

  async summarizeScenes(dayMemories: MemoryRow[]) {
    this.calls.push('summarizeScenes')
    return [
      {
        title: 'Barter at the storehouse',
        text: 'I traded grain with Nadia.',
        memoryIds: [dayMemories[0]!.id],
      },
      {
        title: 'A promise from Nadia',
        text: 'Nadia offered to help mend the door.',
        memoryIds: [dayMemories[1]!.id, dayMemories[2]!.id],
      },
    ]
  }

  async summarizeDay() {
    this.calls.push('summarizeDay')
    return {
      title: 'Trade and promises',
      text: 'The day was full of deals.',
      standing: ['Omar owes me three firewood by tomorrow.'],
    }
  }

  async updateLedger(personName: string, _existing: string | null, relevant: MemoryRow[]) {
    this.calls.push('updateLedger')
    return `Ledger for ${personName} (${relevant.length} memories).`
  }

  async listTies() {
    this.calls.push('listTies')
    return LISTED_TIES
  }

  async autobiographyParagraph(_daySummary: string, doc: PersonalityDoc) {
    this.calls.push('autobiographyParagraph')
    return `Today, still ${doc.current.mood}, I kept my word.`
  }

  async proposeEdit() {
    this.calls.push('proposeEdit')
    return this.edit
  }
}

describe('runSleepReflection pipeline', () => {
  it('the night gists the day’s long rows and pins what the mind is about', async () => {
    const { mem, personality } = await makeStores()
    const long = `Omar promised three planks. ${'The meadow is wide and quiet. '.repeat(30)}`
    await seedDay(mem, DAY, [{ text: long, people: ['Omar'], importance: 6 }, ...SINGLE_PERSON_DAY])
    const llm = new ScriptedReflectionLlm(null)
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect([res.gistsWritten, llm.calls.filter((c) => c === 'gist').length]).toEqual([1, 1])
    const rows = mem.memoriesOfDay(DAY)
    expect(rows[0]!.gist).toBe(`gist: ${long.slice(0, 20).trim()}`)
    expect(rows[0]!.text).toBe(long)
    expect(rows[1]!.gist).toBeNull()
    expect(personality.current().doc.current.goals).toEqual([
      'Omar owes me three firewood by tomorrow.',
    ])
  })

  it('runs steps in spec order: facts strictly before any summarize', async () => {
    const { mem, personality } = await makeStores()
    const memories = await seedDay(mem, DAY, [...SINGLE_PERSON_DAY, A_MAKING])
    const llm = new ScriptedReflectionLlm(null)
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(llm.calls).toEqual([
      'extractFacts',
      'summarizeScenes',
      'summarizeDay',
      'updateLedger',
      'autobiographyParagraph',
      'proposeEdit',
    ])
    expect(llm.calls.indexOf('extractFacts')).toBeLessThan(llm.calls.indexOf('summarizeScenes'))
    expect(res.factCount).toBe(2)
    expect(res.sceneCount).toBe(2)

    // facts rows inserted with srcMemoryId provenance
    const nadiaFacts = mem.factsAbout('Nadia')
    expect(nadiaFacts).toHaveLength(2)
    expect(nadiaFacts.map((f) => f.srcMemoryId)).toEqual([memories[0]!.id, memories[1]!.id])
    expect(nadiaFacts[0]).toMatchObject({
      subject: 'Nadia',
      predicate: 'traded',
      object: 'grain for firewood',
    })

    // day node's childIds equal the scene node ids
    const scenes = mem.summaryNodes('scene', DAY)
    expect(scenes).toHaveLength(2)
    expect(scenes.map((s) => s.memoryIds)).toEqual([
      [memories[0]!.id],
      [memories[1]!.id, memories[2]!.id],
    ])
    const days = mem.summaryNodes('day', DAY)
    expect(days).toHaveLength(1)
    expect(days[0]!.childIds).toEqual(scenes.map((s) => s.id))

    // ledger replaced for the one person seen that day, and only them
    expect(res.ledgersUpdated).toEqual(['Nadia'])
    expect(mem.getLedger('Nadia')!.doc).toBe('Ledger for Nadia (2 memories).')
    expect(mem.getLedger('SomeoneElse')).toBeNull()

    // autobiography appended once; no edit proposed -> no version bump
    expect(mem.autobiography()).toHaveLength(1)
    expect(res.editApplied).toBe(false)
    expect(res.editRejectedReason).toBeUndefined()
    expect(personality.current().version).toBe(1)
  })

  // ★ A prefix only stays warm for the call right behind it: r13 put the day summary and every
  // ledger between the second dump and the third, and 70% of night calls read no cache at all.
  it('★ the three night dumps go out back to back, before anything else is asked', async () => {
    const { db, mem, personality } = await makeStores()
    await seedDay(mem, DAY, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    await runSleepReflection({
      mem,
      personality,
      llm,
      day: DAY,
      ties: { store: new TieStore(db, AGENT), cast: CAST, tick: DAY * TICKS_PER_DAY },
    })

    expect(llm.calls.slice(0, 3)).toEqual(['extractFacts', 'summarizeScenes', 'listTies'])
  })

  it('updates the ledger once per distinct person seen that day, and only those', async () => {
    const { mem, personality } = await makeStores()
    await seedDay(mem, DAY, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(res.ledgersUpdated).toEqual(['Nadia', 'Omar'])
    expect(llm.calls.filter((c) => c === 'updateLedger')).toHaveLength(2)
    expect(mem.getLedger('Nadia')!.doc).toBe('Ledger for Nadia (1 memories).')
    expect(mem.getLedger('Omar')!.doc).toBe('Ledger for Omar (1 memories).')
    expect(mem.getLedger('SomeoneElse')).toBeNull()
  })

  it('writes the day’s ties, settled and open, and invents no neighbour', async () => {
    const { db, mem, personality } = await makeStores()
    await seedDay(mem, DAY, TWO_PERSON_DAY)
    const store = new TieStore(db, AGENT)
    store.apply(
      [{ agentId: AGENT, personId: 'omar', kind: 'debt', text: 'Three firewood by tomorrow.' }],
      0,
    )
    const llm = new ScriptedReflectionLlm(null)
    const res = await runSleepReflection({
      mem,
      personality,
      llm,
      day: DAY,
      ties: { store, cast: CAST, tick: DAY * TICKS_PER_DAY },
    })

    expect(res.tiesWritten, 'Kestrel is nobody, so two of the three land').toBe(2)
    expect(store.open().map((t) => [t.personId, t.kind, t.source])).toEqual([
      ['nadia', 'promise', 'reflection'],
    ])
    const debt = store.all().find((t) => t.kind === 'debt')!
    expect(debt.settledTick, 'the day squared what was already owed').toBe(DAY * TICKS_PER_DAY)
  })

  it('reflects without a tie book the way it did before there were ties', async () => {
    const { mem, personality } = await makeStores()
    await seedDay(mem, DAY, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })
    expect(llm.calls).not.toContain('listTies')
    expect(res.tiesWritten).toBe(0)
  })

  it('applies a valid proposed edit -> editApplied true and personality v2', async () => {
    const { mem, personality } = await makeStores()
    const memories = await seedDay(mem, DAY, A_DAY_THAT_CHANGED_SOMETHING)
    const llm = new ScriptedReflectionLlm({
      op: 'add',
      field: 'values',
      text: 'fairness',
      evidence: [memories[0]!.id],
    })
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(res.editApplied).toBe(true)
    expect(res.editRejectedReason).toBeUndefined()
    expect(personality.current().version).toBe(2)
    expect(personality.current().doc.values).toEqual(['loyalty', 'fairness'])
  })

  it('rejects a temperament-shaped proposal -> editApplied false, invalid_edit_shape', async () => {
    const { mem, personality } = await makeStores()
    const memories = await seedDay(mem, DAY, A_DAY_THAT_CHANGED_SOMETHING)
    const llm = new ScriptedReflectionLlm({
      op: 'add',
      field: 'temperament',
      text: 'fierce',
      evidence: [memories[0]!.id],
    })
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(res.editApplied).toBe(false)
    expect(res.editRejectedReason).toBe('invalid_edit_shape')
    expect(personality.current().version).toBe(1)
  })

  // ★ The edit resends the whole day at 6,598 tokens a call and its own prompt says "most days
  // hold nothing like that" — over r13 it answered on every one of 35 nights all the same.
  it('★ a day that changed nothing is not asked what it changed', async () => {
    const { mem, personality } = await makeStores()
    await seedDay(mem, DAY, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm({
      op: 'add',
      field: 'values',
      text: 'fairness',
      evidence: [],
    })
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(llm.calls).not.toContain('proposeEdit')
    expect(res.editSkipped).toBe(true)
    expect(res.fallback, 'a night nobody asked is not a night that failed').toBe(false)
    expect(personality.current().version).toBe(1)
  })

  // A quarrel is the one signal the ties carry that the act table cannot: nothing was made,
  // and the mind still has something new to be about.
  it('★ a quarrel the day opened is enough to ask', async () => {
    const { db, mem, personality } = await makeStores()
    await seedDay(mem, DAY, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    llm.listTies = async () => {
      llm.calls.push('listTies')
      return [
        { about: 'Omar', kind: 'grudge' as const, text: 'He let the door rot.', settled: false },
      ]
    }
    await runSleepReflection({
      mem,
      personality,
      llm,
      day: DAY,
      ties: { store: new TieStore(db, AGENT), cast: CAST, tick: DAY * TICKS_PER_DAY },
    })

    expect(llm.calls).toContain('proposeEdit')
  })

  it('a "No change" proposal is skipped quietly: no version bump, no alert', async () => {
    const { mem, personality } = await makeStores()
    const memories = await seedDay(mem, DAY, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm({
      op: 'add',
      field: 'values',
      text: 'No change',
      evidence: [memories[0]!.id],
    })
    const alerts: string[] = []
    const res = await runSleepReflection({
      mem,
      personality,
      llm,
      day: DAY,
      alert: (kind) => alerts.push(kind),
    })

    expect(res.editApplied).toBe(false)
    expect(res.editSkipped).toBe(true)
    expect(res.editRejectedReason).toBeUndefined()
    expect(alerts).toEqual([])
    expect(personality.current().version).toBe(1)
    expect(personality.current().doc.values).not.toContain('No change')
  })

  it('asks for no edit in the first days of a life, whatever the day held', async () => {
    const { db, mem, personality } = await makeStores()
    await seedDay(mem, 2, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    llm.listTies = async () => {
      llm.calls.push('listTies')
      return [
        { about: 'Omar', kind: 'grudge' as const, text: 'He let the door rot.', settled: false },
      ]
    }
    await runSleepReflection({
      mem,
      personality,
      llm,
      day: 2,
      ties: { store: new TieStore(db, AGENT), cast: CAST, tick: 2 * TICKS_PER_DAY },
    })
    expect(llm.calls).not.toContain('proposeEdit')
  })

  it('sets aside a belief proposed while beliefs are shut, without an alert', async () => {
    const { db, mem, personality } = await makeStores()
    const earlier = await seedDay(mem, DAY, TWO_PERSON_DAY)
    expect(
      personality.applyNightlyEdit(
        DAY,
        { op: 'add', field: 'beliefs', text: 'rain comes early', evidence: [earlier[0]!.id] },
        mem,
      ).ok,
    ).toBe(true)
    const later = DAY + 2
    const memories = await seedDay(mem, later, TWO_PERSON_DAY)
    const llm = new ScriptedReflectionLlm({
      op: 'add',
      field: 'beliefs',
      text: 'rain comes late',
      evidence: [memories[0]!.id],
    })
    llm.listTies = async () => {
      llm.calls.push('listTies')
      return [
        { about: 'Omar', kind: 'grudge' as const, text: 'He let the door rot.', settled: false },
      ]
    }
    const alerts: string[] = []
    const res = await runSleepReflection({
      mem,
      personality,
      llm,
      day: later,
      ties: { store: new TieStore(db, AGENT), cast: CAST, tick: later * TICKS_PER_DAY },
      alert: (kind) => alerts.push(kind),
    })
    expect(llm.calls).toContain('proposeEdit')
    expect(res.editApplied).toBe(false)
    expect(res.editSkipped).toBe(true)
    expect(alerts).not.toContain('personality_edit_rejected')
    expect(personality.current().version).toBe(2)
  })

  it('proposeEdit -> null -> no version bump', async () => {
    const { mem, personality } = await makeStores()
    await seedDay(mem, DAY, SINGLE_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(res.editApplied).toBe(false)
    expect(personality.current().version).toBe(1)
  })
  it("skips facts whose srcMemoryId is not one of today's memories", async () => {
    const { mem, personality } = await makeStores()
    const memories = await seedDay(mem, DAY, SINGLE_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    llm.extractFacts = async () => {
      llm.calls.push('extractFacts')
      return [
        {
          subject: 'Nadia',
          predicate: 'traded',
          object: 'grain for firewood',
          srcMemoryId: memories[0]!.id,
        },
        { subject: 'Ghost', predicate: 'did', object: 'nothing', srcMemoryId: 999_999 },
      ]
    }
    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(res.factCount).toBe(1)
    expect(mem.factsAbout('Ghost')).toHaveLength(0)
    expect(mem.factsAbout('Nadia')).toHaveLength(1)
    // pipeline completed through autobiography — the bad src id did not abort mid-write
    expect(mem.autobiography()).toHaveLength(1)
  })
})

describe('runSleepReflection survives an exhausted budget (T22)', () => {
  function noObject(): NoObjectGeneratedError {
    return new NoObjectGeneratedError({
      text: 'not json',
      response: { id: 'r1', timestamp: new Date(0), modelId: 'm' },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
      },
      finishReason: 'stop',
    })
  }

  function alertSink(): {
    alerts: { kind: string; detail: string }[]
    alert: (k: string, d: string) => void
  } {
    const alerts: { kind: string; detail: string }[] = []
    return { alerts, alert: (kind, detail) => alerts.push({ kind, detail }) }
  }

  it('a budget refusal at the first step still writes a verbatim day node and an alert', async () => {
    const { mem, personality } = await makeStores()
    const memories = await seedDay(mem, DAY, SINGLE_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    llm.extractFacts = async () => {
      llm.calls.push('extractFacts')
      throw new BudgetExceededError('no headroom')
    }
    const sink = alertSink()

    const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: sink.alert })

    expect(res.fallback).toBe(true)
    expect(res.factCount).toBe(0)
    expect(res.sceneCount).toBe(0)
    expect(res.ledgersUpdated).toEqual([])
    expect(res.editApplied).toBe(false)

    // Not one LLM step past the refusal was attempted.
    expect(llm.calls).toEqual(['extractFacts'])

    const days = mem.summaryNodes('day', DAY)
    expect(days).toHaveLength(1)
    expect(days[0]!.title).toBe(FALLBACK_DAY_TITLE)
    for (const m of memories) expect(days[0]!.text).toContain(m.text)
    expect(days[0]!.childIds).toEqual([])
    expect(mem.summaryNodes('scene', DAY)).toEqual([])

    expect(mem.factsAbout('Nadia')).toHaveLength(0)
    expect(mem.getLedger('Nadia')).toBeNull()
    expect(mem.autobiography()).toEqual([FALLBACK_AUTOBIOGRAPHY])
    expect(personality.current().version).toBe(1)

    expect(sink.alerts).toHaveLength(1)
    expect(sink.alerts[0]!.kind).toBe('reflection_fallback')
    expect(sink.alerts[0]!.detail).toContain('no headroom')
  })

  it('a refusal midway keeps what already landed and degrades the rest', async () => {
    const { mem, personality } = await makeStores()
    await seedDay(mem, DAY, SINGLE_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    llm.summarizeScenes = async () => {
      llm.calls.push('summarizeScenes')
      throw new BudgetExceededError('no headroom')
    }
    const sink = alertSink()

    const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: sink.alert })

    expect(res.fallback).toBe(true)
    expect(res.factCount).toBe(2)
    expect(mem.factsAbout('Nadia')).toHaveLength(2)
    expect(llm.calls).toEqual(['extractFacts', 'summarizeScenes'])
    expect(mem.summaryNodes('day', DAY)[0]!.title).toBe(FALLBACK_DAY_TITLE)
    expect(mem.autobiography()).toEqual([FALLBACK_AUTOBIOGRAPHY])
    expect(sink.alerts.map((a) => a.kind)).toEqual(['reflection_fallback'])
  })

  it('a NoObjectGeneratedError degrades exactly like a budget refusal', async () => {
    const { mem, personality } = await makeStores()
    await seedDay(mem, DAY, SINGLE_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    llm.summarizeDay = async () => {
      llm.calls.push('summarizeDay')
      throw noObject()
    }
    const sink = alertSink()

    const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: sink.alert })

    expect(res.fallback).toBe(true)
    expect(res.sceneCount).toBe(2)
    expect(mem.summaryNodes('scene', DAY)).toHaveLength(2)
    // The scenes landed, but the day node is mechanical and adopts none of them:
    // a child list without a parent telling is a half-written night.
    expect(mem.summaryNodes('day', DAY)[0]!.title).toBe(FALLBACK_DAY_TITLE)
    expect(mem.autobiography()).toEqual([FALLBACK_AUTOBIOGRAPHY])
    expect(sink.alerts).toHaveLength(1)
  })

  // ★ A raw `TimeoutError` rethrown by `invokeReserved` lost a whole night to one alert row.
  it('★ a provider stall degrades the night instead of losing it', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const { mem, personality } = await makeStores()
      const memories = await seedDay(mem, DAY, SINGLE_PERSON_DAY)
      const llm = new ScriptedReflectionLlm(null)
      llm.extractFacts = async () => {
        llm.calls.push('extractFacts')
        const err = new Error('The operation was aborted due to timeout')
        err.name = name
        throw err
      }
      const sink = alertSink()

      const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: sink.alert })

      expect(res.fallback, name).toBe(true)
      expect(llm.calls, name).toEqual(['extractFacts'])
      const days = mem.summaryNodes('day', DAY)
      expect(days, name).toHaveLength(1)
      for (const m of memories) expect(days[0]!.text, name).toContain(m.text)
      expect(mem.autobiography(), name).toEqual([FALLBACK_AUTOBIOGRAPHY])
      expect(
        sink.alerts.map((a) => a.kind),
        name,
      ).toEqual(['reflection_fallback'])
    }
  })

  // ★ A 5xx is neither budget, malformed output nor a stall, so it threw past the fallback —
  // and the caller had already marked the night done, so that day was gone for good.
  it('★ a provider error nobody listed still leaves the day written down', async () => {
    const { mem, personality } = await makeStores()
    const memories = await seedDay(mem, DAY, SINGLE_PERSON_DAY)
    const llm = new ScriptedReflectionLlm(null)
    llm.extractFacts = async () => {
      llm.calls.push('extractFacts')
      const err = new Error('the provider is on fire')
      err.name = 'AI_APICallError'
      throw err
    }
    const sink = alertSink()

    const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: sink.alert })

    expect(res.fallback).toBe(true)
    expect(llm.calls).toEqual(['extractFacts'])
    const days = mem.summaryNodes('day', DAY)
    expect(days).toHaveLength(1)
    for (const m of memories) expect(days[0]!.text).toContain(m.text)
    expect(mem.autobiography()).toEqual([FALLBACK_AUTOBIOGRAPHY])
    // The kind, so an operator can tell a 5xx from a night that simply had no headroom.
    expect(sink.alerts.map((a) => a.kind)).toEqual(['reflection_fallback'])
    expect(sink.alerts[0]!.detail).toContain('AI_APICallError')
  })

  it('the mechanical digest is truncated, and the day node survives an empty day', async () => {
    const { mem, personality } = await makeStores()
    const long = Array.from({ length: 80 }, (_, i) => ({
      text: `A very long moment number ${i}, ${'x'.repeat(60)}`,
      people: [],
      importance: 3,
    }))
    await seedDay(mem, DAY, long)
    const llm = new ScriptedReflectionLlm(null)
    llm.extractFacts = async () => {
      throw new BudgetExceededError('no headroom')
    }
    const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: () => {} })

    expect(res.fallback).toBe(true)
    const text = mem.summaryNodes('day', DAY)[0]!.text
    expect(text.length).toBeLessThanOrEqual(FALLBACK_DIGEST_CHARS + 1)
    expect(text.endsWith('…')).toBe(true)
    expect(text).toContain('A very long moment number 0')

    // An agent who lived no recorded moment still gets a night, not a crash.
    const empty = await makeStores()
    const quiet = new ScriptedReflectionLlm(null)
    quiet.extractFacts = async () => {
      throw new BudgetExceededError('no headroom')
    }
    const res2 = await runSleepReflection({
      mem: empty.mem,
      personality: empty.personality,
      llm: quiet,
      day: DAY,
    })
    expect(res2.fallback).toBe(true)
    expect(empty.mem.summaryNodes('day', DAY)).toHaveLength(1)
  })

  it('a clean night reports fallback false', async () => {
    const { mem, personality } = await makeStores()
    await seedDay(mem, DAY, SINGLE_PERSON_DAY)
    const res = await runSleepReflection({
      mem,
      personality,
      llm: new ScriptedReflectionLlm(null),
      day: DAY,
    })
    expect(res.fallback).toBe(false)
  })

  const LONG_ROW = `Omar promised three planks. ${'The meadow is wide and quiet. '.repeat(30)}`
  const longDay = (mem: MemoryStore): Promise<MemoryRow[]> =>
    seedDay(mem, DAY, [{ text: LONG_ROW, people: ['Omar'], importance: 6 }, ...SINGLE_PERSON_DAY])

  // ★ Gisting is the last step, and the latch closed on the first refused call, so any one
  // rate-limited night wrote no gist at all — and one mind of twelve never gisted once.
  it('★ a night that degraded early still gists the day’s long rows', async () => {
    const { mem, personality } = await makeStores()
    await longDay(mem)
    const llm = new ScriptedReflectionLlm(null)
    llm.summarizeScenes = async () => {
      llm.calls.push('summarizeScenes')
      throw noObject()
    }
    const sink = alertSink()

    const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: sink.alert })

    expect(res.fallback).toBe(true)
    expect(llm.calls).toEqual(['extractFacts', 'summarizeScenes', 'gist'])
    expect(res.gistsWritten).toBe(1)
    expect(mem.memoriesOfDay(DAY)[0]!.gist).toBe(`gist: ${LONG_ROW.slice(0, 20).trim()}`)
    expect(sink.alerts.map((a) => a.kind)).toEqual(['reflection_fallback'])
  })

  // ★ The same night with a dead endpoint: the loss is now named instead of read as "nothing
  // wanted a gist", which is what an unrun batch and an empty day looked like from outside.
  it('★ a degraded night whose gists all fail raises the refusal', async () => {
    const { mem, personality } = await makeStores()
    await longDay(mem)
    const llm = new ScriptedReflectionLlm(null)
    llm.summarizeScenes = async () => {
      llm.calls.push('summarizeScenes')
      throw noObject()
    }
    llm.gist = async () => {
      llm.calls.push('gist')
      throw new Error('rate-limited upstream')
    }
    const sink = alertSink()

    const res = await runSleepReflection({ mem, personality, llm, day: DAY, alert: sink.alert })

    expect(res.gistsWritten).toBe(0)
    expect(res.gistsEligible).toBe(1)
    expect(sink.alerts.map((a) => a.kind)).toEqual(['gist_batch_refused', 'reflection_fallback'])
  })

  it('a night with no headroom left does not spend the last of it on gists', async () => {
    const { mem, personality } = await makeStores()
    const rows = await longDay(mem)
    const llm = new ScriptedReflectionLlm(null)
    llm.extractFacts = async () => {
      llm.calls.push('extractFacts')
      throw new BudgetExceededError('no headroom')
    }

    const res = await runSleepReflection({ mem, personality, llm, day: DAY })

    expect(llm.calls).toEqual(['extractFacts'])
    expect(res.gistsWritten).toBe(0)
    // Still ungisted, so tomorrow's batch takes it off the backlog.
    expect(mem.ungistedMemories(GIST_MIN_CHARS, 10).map((m) => m.id)).toEqual([rows[0]!.id])
  })
})

describe('makeReflectionLlm prompts', () => {
  const memories: MemoryRow[] = [
    {
      id: 1,
      agentId: AGENT,
      tick: DAY * TICKS_PER_DAY,
      day: DAY,
      kind: 'perception',
      text: 'Nadia and I bartered grain for firewood.',
      gist: null,
      importance: 7,
      tags: { ...TAGS, people: ['Nadia'] },
    },
    {
      id: 2,
      agentId: AGENT,
      tick: DAY * TICKS_PER_DAY + 1,
      day: DAY,
      kind: 'perception',
      gist: null,
      text: 'Nadia promised to help mend the storehouse.',
      importance: 8,
      tags: { ...TAGS, people: ['Nadia'] },
    },
  ]
  const doc = baseDoc()

  // The two night dumps moved their instruction behind the day so the dump can cache; every
  // scan that used to read the system block has to follow it there.
  const authoredText = (p: { system: string; messages: LlmMessage[] }): string =>
    [p.system, p.messages.at(-1)?.content ?? ''].join('\n')

  function recordingClient(): {
    client: LlmClient
    calls: { system: string; messages: LlmMessage[] }[]
  } {
    const calls: { system: string; messages: LlmMessage[] }[] = []
    const client = {
      async object(opts: { system: string; messages: LlmMessage[]; schema: unknown }) {
        calls.push({ system: opts.system, messages: opts.messages })
        return {
          value: { edit: null },
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
        }
      },
      async text(opts: { system: string; messages: LlmMessage[] }) {
        calls.push({ system: opts.system, messages: opts.messages })
        return {
          text: 'A short form.',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 },
        }
      },
      forCaller() {
        return this
      },
    } as unknown as LlmClient
    return { client, calls }
  }

  it('every prompt is diegetic second-person and passes FORBIDDEN_FRAMING', async () => {
    const { client, calls } = recordingClient()
    const llm = makeReflectionLlm(client)
    await llm.extractFacts(memories)
    await llm.summarizeScenes(memories)
    await llm.summarizeDay([{ title: 'Trade', text: 'The day was full of deals.' }])
    await llm.updateLedger('Nadia', null, memories)
    await llm.listTies(memories, ['Nadia'])
    await llm.autobiographyParagraph('The day was full of deals.', doc)
    await llm.proposeEdit('The day was full of deals.', doc, memories, ['values', 'beliefs'])
    await llm.gist('A very long moment that the night sets down in short.')

    expect(calls).toHaveLength(8)
    for (const c of calls) {
      expect(c.system).toMatch(/\byou\b/i)
      expect(c.system).not.toMatch(FORBIDDEN_FRAMING)
      expect(c.messages.map((m) => m.content).join('\n')).not.toMatch(FORBIDDEN_FRAMING)
      // `rulesOfBeing.test.ts` holds this over SPEECH_RULES and `assemble.test.ts` over the
      // perception; neither reaches these six.
      expect(c.system, 'a reflection prompt spends an em dash a mind will imitate').not.toContain(
        '—',
      )
    }
  })
  // Eight authored surfaces every mind reads every night, which neither the card scan nor
  // `assemblePrompt` reaches. A shorter prompt must not turn a question into an instruction.
  it('no reflection prompt leaks the ops taxonomy, the town grammar, or a hint', () => {
    const authored = [
      authoredText(extractFactsPrompt(memories)),
      authoredText(summarizeScenesPrompt(memories)),
      summarizeDayPrompt([{ title: 'Trade', text: 'The day was full of deals.' }]).system,
      updateLedgerPrompt('Nadia', null, memories).system,
      authoredText(listTiesPrompt(memories, ['Nadia'])),
      autobiographyPrompt('The day was full of deals.', doc).system,
      proposeEditPrompt('The day was full of deals.', doc, memories).system,
      gistPrompt('A very long moment that the night sets down in short.').system,
    ]
    for (const text of authored) {
      expect(scanPromptForGlassLeak(text), text.slice(0, 48)).toEqual([])
      expect(scanForLayoutLeak(text), text.slice(0, 48)).toEqual([])
      // The turn is where a mind decides what to do. A night prompt that reaches across and
      // tells it what to do next has stopped being reflection.
      for (const hint of ['you should', 'you must build', 'go inside', 'raise a', 'be sure to']) {
        expect(text.toLowerCase(), `${text.slice(0, 48)} hints "${hint}"`).not.toContain(hint)
      }
    }
  })

  const row = (id: number, kind: MemoryRow['kind'], text: string): MemoryRow => ({
    id,
    agentId: AGENT,
    tick: DAY * TICKS_PER_DAY + id,
    day: DAY,
    kind,
    text,
    gist: null,
    importance: 3,
    tags: TAGS,
  })

  // A thought between two perceptions is the real shape of a day, and the reason the filter
  // remembers the last moment of each kind rather than the last row.
  const repeatedDay = [
    row(1, 'perception', 'The storehouse door is open. Nadia is here. Rain falls.'),
    row(2, 'thought', 'I should trade while she is here.'),
    row(3, 'perception', 'The storehouse door is open. Nadia is here. Rain falls.'),
    row(4, 'thought', 'I should trade while she is here.'),
    row(5, 'perception', 'The storehouse door is open. Nadia is here. You are hungry.'),
    row(6, 'perception', 'The storehouse door is shut.'),
  ]

  const dumpOf = (p: { messages: LlmMessage[] }): { id: number; text: string }[] => {
    const content = p.messages[0]!.content
    return JSON.parse(content.slice(content.indexOf('\n') + 1)) as { id: number; text: string }[]
  }

  // ★ The turn path drops what the moment before already said; until the night did the same,
  // one mind's day dump was 126k tokens of mostly the same perception, sent twice.
  it('★ the night dump keeps only what the moment before it did not already say', () => {
    const expected = [
      { id: 1, text: 'The storehouse door is open. Nadia is here. Rain falls.' },
      { id: 2, text: 'I should trade while she is here.' },
      { id: 5, text: 'You are hungry.' },
      { id: 6, text: 'The storehouse door is shut.' },
    ]
    for (const prompt of [extractFactsPrompt(repeatedDay), summarizeScenesPrompt(repeatedDay)]) {
      expect(dumpOf(prompt).map((m) => ({ id: m.id, text: m.text }))).toEqual(expected)
    }
  })

  // ★ System comes first, so a per-call instruction above the dump makes the 126k tokens under
  // it uncacheable for the call that follows.
  it('★ all three night prompts open with the same bytes, and differ only after the day', () => {
    const a = extractFactsPrompt(memories)
    const b = summarizeScenesPrompt(memories)
    const c = listTiesPrompt(memories, ['Nadia'])
    const prefix = (p: { system: string; messages: LlmMessage[] }): string =>
      `${p.system}\n${p.messages[0]!.content}`
    expect(prefix(a)).toBe(prefix(b))
    expect(prefix(a)).toBe(prefix(c))
    expect(prefix(a).length).toBeGreaterThan(memories[0]!.text.length)
    expect(a.messages[1]!.content).not.toBe(b.messages[1]!.content)
    expect(a.messages[1]!.content).toContain('at most eight')
    expect(b.messages[1]!.content).toContain('list the memories it draws from')
    expect(c.messages[1]!.content).toContain('Name only these people')
  })

  // ★ The per-person slice and the edit's `[id] text` lines are the night's two largest dumps
  // — 162k and 114k tokens on run D — and both sent every repeat the two above now drop.
  it('★ the ledger and the personality edit send the same deduped day', () => {
    const ledger = updateLedgerPrompt('Nadia', null, repeatedDay).messages[0]!.content
    for (const kept of ['"id":1', '"id":2', '"id":5', '"id":6']) expect(ledger).toContain(kept)
    for (const dropped of ['"id":3', '"id":4']) expect(ledger).not.toContain(dropped)
    expect(ledger).toContain('"text":"You are hungry."')

    const edit = proposeEditPrompt('A still day.', doc, repeatedDay).messages[0]!.content
    expect(edit).toContain("Today's memories:\n[1] The storehouse door is open.")
    expect(edit).toContain('[5] You are hungry.')
    expect(edit).not.toContain('[3]')
    expect(edit).not.toContain('[4]')
  })

  it("proposeEdit prompt carries today's memory ids and what the schema cannot say", () => {
    const p = proposeEditPrompt('The day was full of deals.', doc, memories)
    const text = p.system + '\n' + p.messages.map((m) => m.content).join('\n')
    expect(text).toContain(`[${memories[0]!.id}]`)
    expect(text).toContain(`[${memories[1]!.id}]`)
    // What `ProposeEditSchema` cannot carry: what `evidence` refers to, that only one change is
    // on the table, that temperament is not, and the kinds of day that earn a change at all.
    for (const kw of ['`evidence`', 'one thing', 'temperament', 'collapse', 'hunger', 'conflict']) {
      expect(text).toContain(kw)
    }
    expect(text).not.toMatch(FORBIDDEN_FRAMING)
  })

  // Every field name and enum below reaches the provider as JSON schema on the same call, so
  // spelling them again in English buys nothing.
  it('proposeEdit no longer restates its own schema in prose', () => {
    const system = proposeEditPrompt('The day was full of deals.', doc, memories).system
    for (const spelledTwice of [
      '`verdict`',
      '`no_proposal`',
      '`op`',
      '`field`',
      '`index`',
      'counting from 0',
    ]) {
      expect(
        system,
        `proposeEdit spells ${spelledTwice} that ProposeEditSchema already enforces`,
      ).not.toContain(spelledTwice)
    }
    // Every one of them still reaches the model, because the schema is what carries them.
    const shape = JSON.stringify(z.toJSONSchema(ProposeEditSchema))
    for (const fromSchema of [
      'verdict',
      'no_proposal',
      'propose',
      'op',
      'field',
      'index',
      'evidence',
    ]) {
      expect(shape, `${fromSchema} is not in the schema either`).toContain(fromSchema)
    }
    // The longest of the six is no longer this one.
    const others = [
      authoredText(extractFactsPrompt(memories)),
      authoredText(summarizeScenesPrompt(memories)),
      summarizeDayPrompt([{ title: 'Trade', text: 'x' }]).system,
      updateLedgerPrompt('Nadia', null, memories).system,
      autobiographyPrompt('x', doc).system,
    ]
    const words = (s: string): number => s.split(/\s+/).length
    expect(words(system), 'proposeEdit is still 2.5x the next longest').toBeLessThan(
      2 * Math.max(...others.map(words)),
    )
  })

  it('propose verdict schema accepts no_proposal and shaped edits, rejects temperament', () => {
    const none = {
      verdict: 'no_proposal',
      op: null,
      field: null,
      index: null,
      text: null,
      evidence: [],
    }
    expect(ProposeEditSchema.safeParse(none).success).toBe(true)
    expect(editFromAnswer(ProposeEditSchema.parse(none))).toBeNull()
    const add = {
      verdict: 'propose',
      op: 'add',
      field: 'values',
      index: null,
      text: 'fairness',
      evidence: [memories[0]!.id],
    }
    expect(ProposeEditSchema.safeParse(add).success).toBe(true)
    expect(editFromAnswer(ProposeEditSchema.parse(add))).toEqual({
      op: 'add',
      field: 'values',
      text: 'fairness',
      evidence: [memories[0]!.id],
    })
    expect(ProposeEditSchema.safeParse({ ...add, field: 'temperament' }).success).toBe(false)
    expect(
      editFromAnswer(ProposeEditSchema.parse({ ...add, text: null })),
      'an add with no text is no edit',
    ).toBeNull()
  })
})

// ★ `proposeEdit` shared reflection's ceiling and its ledger line, so the night's one
// reasoning-on call could not be priced. The caller name is what both are keyed off.
describe('★ the night bills its personality edit under its own name', () => {
  it('writes reflection.edit rows the by-caller ledger can price on their own', async () => {
    const db = new Sqlite(':memory:')
    migrateLlmTables(db)
    const model = mockModel([
      { json: { facts: [] } },
      {
        json: {
          verdict: 'no_proposal',
          op: null,
          field: null,
          index: null,
          text: null,
          evidence: [],
        },
      },
    ])
    const llm = makeReflectionLlm(
      new LlmClient({ model, db, caller: 'reflection', agentId: AGENT }),
    )
    await llm.extractFacts([])
    await llm.proposeEdit('The day was full of deals.', baseDoc(), [], ['values', 'beliefs'])

    expect(
      db
        .prepare('SELECT caller, COUNT(*) AS calls FROM llm_calls GROUP BY caller ORDER BY caller')
        .all(),
    ).toEqual([
      { caller: 'reflection', calls: 1 },
      { caller: 'reflection.edit', calls: 1 },
    ])
    db.close()
  })
})

// ★ Owner, 2026-09-06: "any human facing text ... sounds human and casual". The journal and the
// life story reach the person page, so the kitchen-table rule rides both.
describe('★ what reaches the page is said plainly', () => {
  it('rides the day summary and the life story', () => {
    expect(summarizeDayPrompt([]).system).toContain(PLAIN_SPEECH)
    expect(autobiographyPrompt('a day', baseDoc()).system).toContain(PLAIN_SPEECH)
  })
})
