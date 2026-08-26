import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import {
  NARRATOR_VOCABULARY_NOTES,
  creditedCare,
  renderChapter,
  sceneDigests,
  verifyCitations,
  witnessedAttackers,
} from './chronicle.js'
import type { SimEvent } from '@sj/shared'
import type { NarratorLlm, SceneSegment } from './types.js'

const memStore = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

const scenes: SceneSegment[] = [
  {
    day: 1,
    startTick: 1440,
    endTick: 1450,
    eventIds: [1, 2, 3],
    cast: ['omar', 'yusuf'],
    location: '3,4',
  },
  { day: 1, startTick: 1500, endTick: 1510, eventIds: [4, 5], cast: ['nadia'], location: null },
]

const llmWith = (citations: number[]): NarratorLlm =>
  ({
    summarizeChapter: vi.fn(async () => ({
      title: 'The Quarrel',
      text: 'Blows by the storehouse.',
      citations,
    })),
    summarizeEra: vi.fn(),
    newspaperCopy: vi.fn(),
    biography: vi.fn(),
  }) as unknown as NarratorLlm

describe('verifyCitations', () => {
  it('splits citations into valid and dangling', () => {
    expect(verifyCitations([1, 3, 99], new Set([1, 2, 3, 4, 5]))).toEqual({
      ok: false,
      dangling: [99],
    })
    expect(verifyCitations([1, 3], new Set([1, 2, 3, 4, 5]))).toEqual({ ok: true, dangling: [] })
    expect(verifyCitations([], new Set([1]))).toEqual({ ok: true, dangling: [] })
  })
})

describe('renderChapter', () => {
  it('strips dangling citations, alerts once, persists the resolved set', async () => {
    const store = memStore()
    const alert = vi.fn()
    const chapter = await renderChapter({ store, llm: llmWith([1, 3, 99]), day: 1, scenes, alert })
    expect(chapter.citations).toEqual([1, 3])
    expect(chapter.sceneIds).toEqual([1, 2])
    expect(chapter.day).toBe(1)
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]![0]).toContain('99')
    const persisted = store.chaptersForDay(1)
    expect(persisted.length).toBe(1)
    expect(persisted[0]!.citations).toEqual([1, 3])
    expect(persisted[0]!.sceneIds).toEqual([1, 2])
  })

  it('falls back to citing the first event of each scene on zero citations, no alert', async () => {
    const store = memStore()
    const alert = vi.fn()
    const chapter = await renderChapter({ store, llm: llmWith([]), day: 1, scenes, alert })
    expect(chapter.citations).toEqual([1, 4])
    expect(alert).not.toHaveBeenCalled()
    expect(store.chaptersForDay(1)[0]!.citations).toEqual([1, 4])
  })
})

describe('sceneDigests', () => {
  it('maps scenes to digests with injected typeCounts', () => {
    const counter = (ids: number[]) => ({ agent_spoke: ids.length })
    const digests = sceneDigests(scenes, counter)
    expect(digests).toEqual([
      {
        eventIds: [1, 2, 3],
        cast: ['omar', 'yusuf'],
        location: '3,4',
        typeCounts: { agent_spoke: 3 },
      },
      { eventIds: [4, 5], cast: ['nadia'], location: null, typeCounts: { agent_spoke: 2 } },
    ])
  })
})

describe('the narrator vocabulary (§12)', () => {
  const ev = (seq: number, type: string, payload: unknown): SimEvent => ({
    seq,
    tick: 100,
    type,
    payload,
  })

  it('credits care only where somebody actually sat down', () => {
    expect(creditedCare([ev(1, 'agent_tended', { agentId: 'ada', tenderId: 'bex' })])).toEqual([
      { patient: 'ada', tender: 'bex' },
    ])
    // A recovery on its own credits nobody: detect, never invent.
    expect(
      creditedCare([ev(2, 'affliction_recovered', { agentId: 'ada', kind: 'illness' })]),
    ).toEqual([])
    expect(creditedCare([ev(3, 'agent_tended', { agentId: 'ada' })])).toEqual([])
  })

  it('names the hand a death was witnessed by, and never more than that', () => {
    expect(
      witnessedAttackers([ev(4, 'agent_died', { agentId: 'ada', cause: 'slain', byId: 'cass' })]),
    ).toEqual([{ victim: 'ada', byId: 'cass' }])
    expect(witnessedAttackers([ev(5, 'agent_died', { agentId: 'ada', cause: 'hunger' })])).toEqual(
      [],
    )
  })

  it('binds the chapter writer: no numbers for hurt, no titles, no verdicts, no explanations', () => {
    expect(NARRATOR_VOCABULARY_NOTES).toMatch(/never how much/i)
    expect(NARRATOR_VOCABULARY_NOTES).toMatch(/never how bad/i)
    expect(NARRATOR_VOCABULARY_NOTES).toMatch(/detect, never invent/i)
    expect(NARRATOR_VOCABULARY_NOTES).toMatch(/healer/i)
    expect(NARRATOR_VOCABULARY_NOTES).toMatch(/never say whether it was deserved/i)
    expect(NARRATOR_VOCABULARY_NOTES).toMatch(/never explained/i)
  })
})
