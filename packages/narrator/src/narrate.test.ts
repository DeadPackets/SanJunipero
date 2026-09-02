import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { SimConfigSchema, type SimEvent } from '@sj/shared'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import { ChapterRenderError, narrateDay, narrateWeek } from './narrate.js'
import type { ChapterRow, NarratorLlm } from './types.js'
import type { LlmClient, LlmUsage } from '@sj/llm'

const memStore = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

const ev = (seq: number, tick: number, type: string, payload: unknown = {}): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})

// Inline equivalent of Task 15's eventful-day fixture (gate task excluded from this
// session): idle scene, argument scene, first-trade scene — day 1.
const DAY1: SimEvent[] = [
  // scene 0: morning idle
  ev(1, 1440, 'agent_moved', { id: 'omar', x: 1, y: 1 }),
  ev(2, 1441, 'agent_moved', { id: 'yusuf', x: 2, y: 1 }),
  ev(3, 1442, 'crop_grew', { cropId: 'c1' }),
  // scene 1: midday argument (30-tick silence before)
  ev(4, 1480, 'agent_spoke', { agentId: 'omar', text: 'The wall is mine.', x: 3, y: 4 }),
  ev(5, 1481, 'agent_spoke', { agentId: 'yusuf', text: 'It stands on my plot.', x: 3, y: 4 }),
  ev(6, 1482, 'agent_spoke', { agentId: 'omar', text: 'Move your plot.', x: 3, y: 4 }),
  ev(7, 1483, 'agent_spoke', { agentId: 'yusuf', text: 'Never.', x: 3, y: 4 }),
  ev(8, 1484, 'action_interrupted', { agentId: 'omar', verb: 'build' }),
  ev(9, 1485, 'agent_injured', { agentId: 'yusuf', kind: 'bruise' }),
  // scene 2: evening first trade
  ev(10, 1520, 'action_completed', { agentId: 'omar', verb: 'give', targetId: 'yusuf' }),
  ev(11, 1521, 'agent_moved', { id: 'omar', x: 5, y: 6 }),
]

const scriptedLlm = (citations: number[] = [4, 9999]): NarratorLlm => ({
  summarizeChapter: vi.fn(async () => ({
    title: 'The Wall Quarrel',
    text: 'Omar and Yusuf quarrelled over a wall.',
    citations,
  })),
  summarizeEra: vi.fn(async () => ({
    title: 'The First Week',
    text: 'A week of walls and words.',
    citations: [],
  })),
  newspaperCopy: vi.fn(),
  biography: vi.fn(),
})

describe('narrateDay', () => {
  it('segments, scores, detects firsts, persists, and renders a resolving chapter', async () => {
    const store = memStore()
    const alert = vi.fn()
    const { chapter, heat, milestones } = await narrateDay({
      store,
      llm: scriptedLlm(),
      events: DAY1,
      rulebookCount: 0,
      privateCounts: { thoughts: 2, journals: 1 },
      alert,
    })
    const seqs = new Set(DAY1.map((e) => e.seq))
    expect(chapter.citations.length).toBeGreaterThan(0)
    expect(chapter.citations.every((c) => seqs.has(c))).toBe(true)
    expect(alert).toHaveBeenCalledTimes(1) // the scripted 9999
    expect(store.scenesForDay(1).length).toBe(3)
    expect(store.heatsForDay(1).length).toBe(3)
    expect(heat.length).toBe(3)
    const kinds = new Set(milestones.map((m) => m.kind))
    expect(kinds.has('first_speech')).toBe(true)
    expect(kinds.has('first_trade')).toBe(true)
    expect(store.milestoneKinds().has('first_speech')).toBe(true)
    // A never-seen type scores full novelty — the idle scene's two
    // fresh types give it novelty 2, not 0.
    expect(heat[0]!.novelty).toBeCloseTo(2, 5)
  })

  it('is idempotent: a second call for the same day adds no second chapter row', async () => {
    const store = memStore()
    await narrateDay({
      store,
      llm: scriptedLlm(),
      events: DAY1,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
    })
    const again = await narrateDay({
      store,
      llm: scriptedLlm(),
      events: DAY1,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
    })
    expect(store.chaptersForDay(1).length).toBe(1)
    expect(store.scenesForDay(1).length).toBe(3)
    expect(again.chapter.day).toBe(1)
  })

  it('maps institution founding scenes through store ids, skips unmappable (-1), on week boundaries', async () => {
    const store = memStore()
    // Offset seed: a pre-existing scene row so store ids != index + 1 (R2c).
    store.insertScenes([
      { day: 999, startTick: 0, endTick: 1, eventIds: [900], cast: [], location: null },
    ])
    const alert = vi.fn()
    // Day 7 (week boundary): omar's first tend sits alone -> dropped scene -> -1;
    // yusuf's fishing founds inside a surviving scene.
    const DAY7: SimEvent[] = [
      ev(1, 10080, 'action_completed', { agentId: 'omar', verb: 'tend' }),
      ev(2, 10120, 'action_completed', { agentId: 'omar', verb: 'tend' }),
      ev(3, 10121, 'action_completed', { agentId: 'omar', verb: 'tend' }),
      ev(4, 10122, 'action_completed', { agentId: 'omar', verb: 'tend' }),
      ev(5, 10160, 'action_completed', { agentId: 'yusuf', verb: 'fish' }),
      ev(6, 10161, 'action_completed', { agentId: 'yusuf', verb: 'fish' }),
      ev(7, 10162, 'action_completed', { agentId: 'yusuf', verb: 'fish' }),
    ]
    const { chapter } = await narrateDay({
      store,
      llm: scriptedLlm([2]),
      events: DAY7,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      alert,
    })
    expect(chapter.sceneIds).toEqual([2, 3]) // offset by the seeded row
    const institutions = store.institutions()
    expect(institutions.length).toBe(1) // caretaker skipped (-1 founding), fisher persisted
    expect(institutions[0]!.name).toBe('the fisher')
    expect(institutions[0]!.foundingSceneId).toBe(3) // store id, not index+1 (=2)
    expect(alert.mock.calls.some(([msg]) => String(msg).includes('founding'))).toBe(true)
  })

  it('skips institution detection off week boundaries', async () => {
    const store = memStore()
    await narrateDay({
      store,
      llm: scriptedLlm([4]),
      events: DAY1,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
    })
    expect(store.institutions().length).toBe(0) // day 1 is not a week boundary
  })
})

// One night's chronicle failing is one loss; it must not silently cost the semantic pass too.
describe('narrateDay: a chronicle that will not render does not take the semantic pass with it', () => {
  const throwingLlm = (): NarratorLlm => ({
    summarizeChapter: vi.fn(async () => {
      throw new Error('response did not match schema')
    }),
    summarizeEra: vi.fn(),
    newspaperCopy: vi.fn(),
    biography: vi.fn(),
  })

  const semanticRig = () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, agent_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL)`)
    migrateNarratorTables(db)
    const objectCalls = vi.fn(async () => ({
      value: { hits: [] },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 } satisfies LlmUsage,
    }))
    const llm = {
      object: objectCalls,
      text: vi.fn(),
      totalCostUsd: () => 0,
      alert: vi.fn(),
    } as unknown as LlmClient
    return { db, store: new NarratorStore(db), llm, objectCalls }
  }

  const records = [
    {
      sourceKind: 'speech' as const,
      agentId: 'omar',
      day: 1,
      tick: 1480,
      text: 'The wall is mine.',
      eventSeq: 4,
    },
  ]

  it('runs the pass and reports it, then rethrows the render failure as a ChapterRenderError', async () => {
    const { db, store, llm, objectCalls } = semanticRig()
    const caught = await narrateDay({
      store,
      llm: throwingLlm(),
      events: DAY1,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      semantic: { db, llm, records },
    }).then(
      () => null,
      (err: unknown) => err,
    )

    // Nine concepts, three to an ask.
    expect(objectCalls).toHaveBeenCalledTimes(3)
    expect(caught).toBeInstanceOf(ChapterRenderError)
    expect((caught as ChapterRenderError).night.semanticRan).toBe(true)
    expect((caught as ChapterRenderError).message).toContain('response did not match schema')
  })

  it('says the pass ran on a night that rendered, so a caller can count the nights it did not', async () => {
    const { db, store, llm } = semanticRig()
    const out = await narrateDay({
      store,
      llm: scriptedLlm([4]),
      events: DAY1,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      semantic: { db, llm, records },
    })
    expect(out.semanticRan).toBe(true)
  })

  it('says the pass did not run when no transcript was handed to it', async () => {
    const store = memStore()
    const out = await narrateDay({
      store,
      llm: scriptedLlm([4]),
      events: DAY1,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
    })
    expect(out.semanticRan).toBe(false)
  })
})

describe('narrateWeek', () => {
  it('wraps renderEra over seven chapters', async () => {
    const store = memStore()
    const chapters: ChapterRow[] = [0, 1, 2, 3, 4, 5, 6].map((day) => {
      const c = { day, title: `Day ${day}`, text: 'x', citations: [day + 1], sceneIds: [] }
      return { id: store.insertChapter(c), ...c }
    })
    const era = await narrateWeek({
      store,
      llm: scriptedLlm(),
      days: chapters,
      validEventIds: [1, 2, 3, 4, 5, 6, 7],
    })
    expect(era.chapterIds.length).toBe(7)
    expect(era.startDay).toBe(0)
    expect(era.endDay).toBe(6)
  })
})

// `first_house` and `first_bridge` read a structure's kind, and the day a roof goes on is not
// the day its plan named it.
describe('narrateDay: a roof finished on a day whose plan it never read', () => {
  const FINISH: SimEvent[] = [
    ev(1, 4320, 'structure_completed', { id: 'structure_9' }),
    ev(2, 4340, 'agent_spoke', { agentId: 'amara', text: 'It stands.', x: 3, y: 3 }),
  ]

  const worldWith = (kind: string) => ({
    config: SimConfigSchema.parse({}),
    state: {
      agents: {},
      structures: { structure_9: { id: 'structure_9', kind } },
      pairNights: {},
    } as never,
  })

  it('names the house from the world in reach, though the plan was three days ago', async () => {
    const { milestones } = await narrateDay({
      store: memStore(),
      llm: scriptedLlm([1]),
      events: FINISH,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      world: worldWith('house'),
    })
    expect(milestones.map((m) => m.kind)).toContain('first_house')
    expect(milestones.map((m) => m.kind)).not.toContain('first_bridge')
  })

  it('and the crossing likewise', async () => {
    const { milestones } = await narrateDay({
      store: memStore(),
      llm: scriptedLlm([1]),
      events: FINISH,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      world: worldWith('bridge'),
    })
    expect(milestones.map((m) => m.kind)).toContain('first_bridge')
  })

  it('with no world in reach the day still narrates, and claims no kind it cannot know', async () => {
    const { milestones } = await narrateDay({
      store: memStore(),
      llm: scriptedLlm([1]),
      events: FINISH,
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
    })
    expect(milestones.map((m) => m.kind)).toContain('first_structure')
    expect(milestones.map((m) => m.kind)).not.toContain('first_house')
  })
})

// `first_*_souls` compares a count of the living to 10/25/50, and a town does not reach ten
// in one night's births.
describe('narrateDay: the souls are counted from the world in reach', () => {
  // The scripted chapter names nobody: this town's roll is Soul 0..n, and a stranger in the
  // prose is a different test's subject.
  const quietLlm: NarratorLlm = {
    ...scriptedLlm([1]),
    summarizeChapter: vi.fn(async () => ({
      title: 'The Count',
      text: 'The town woke and counted itself.',
      citations: [1],
    })),
  }

  const townOf = (n: number) => ({
    config: SimConfigSchema.parse({}),
    state: {
      agents: Object.fromEntries(
        Array.from({ length: n }, (_a, i) => [
          `a${i}`,
          { id: `a${i}`, name: `Soul ${i}`, alive: true },
        ]),
      ),
      structures: {},
      pairNights: {},
    } as never,
  })

  it('★ marks the tenth soul on a day nobody was born', async () => {
    const { milestones } = await narrateDay({
      store: memStore(),
      llm: quietLlm,
      events: [ev(1, 4320, 'agent_spoke', { agentId: 'a0', text: 'We are many.', x: 3, y: 3 })],
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      world: townOf(12),
    })
    const kinds = milestones.map((m) => m.kind)
    expect(kinds).toContain('first_ten_souls')
    expect(kinds).not.toContain('first_twenty_five_souls')
  })

  it("★ and the day's own birth is counted where it lands, not before it", async () => {
    const { milestones } = await narrateDay({
      store: memStore(),
      llm: quietLlm,
      events: [
        ev(1, 4320, 'agent_spoke', { agentId: 'a0', text: 'Nine of us.', x: 3, y: 3 }),
        ev(2, 4330, 'agent_born', { agentId: 'a9' }),
      ],
      rulebookCount: 0,
      privateCounts: { thoughts: 0, journals: 0 },
      world: townOf(10), // ten alive as the day ends — nine as it began
    })
    expect(milestones.find((m) => m.kind === 'first_ten_souls')!.eventSeq).toBe(2)
  })
})
