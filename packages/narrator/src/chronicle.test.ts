import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateNarratorTables, openNarratorDb } from './schema.js'
import { NarratorStore } from './store.js'
import {
  NARRATOR_VOCABULARY_NOTES,
  creditedCare,
  renderChapter,
  sceneDigests,
  verifyCitations,
  withoutProseIds,
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

const llmWith = (citations: number[]): NarratorLlm => ({
  summarizeChapter: vi.fn(async () => ({
    title: 'The Quarrel',
    text: 'Blows by the storehouse.',
    citations,
  })),
  summarizeEra: vi.fn(),
  newspaperCopy: vi.fn(),
  biography: vi.fn(),
})

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

// The guard behind commit 0cadae64, at the point of publication rather than in a hand-run script.
// `openNarratorDb` is what production opens, and it is what carries the alerts table.
const watched = (): { store: NarratorStore; alerts: () => { kind: string; detail: string }[] } => {
  const db = openNarratorDb(':memory:')
  return {
    store: new NarratorStore(db),
    alerts: () =>
      db.prepare('SELECT kind, detail FROM alerts ORDER BY id').all() as {
        kind: string
        detail: string
      }[],
  }
}

const leaking = (text: string): NarratorLlm => ({
  summarizeChapter: vi.fn(async () => ({ title: 'The Quarrel', text, citations: [1] })),
  summarizeEra: vi.fn(),
  newspaperCopy: vi.fn(),
  biography: vi.fn(),
})

describe('withoutProseIds', () => {
  it('leaves prose that keeps its numbers under the line alone', () => {
    const clean = 'Blows by the storehouse.\nSeen: 1, 3'
    expect(withoutProseIds(clean)).toEqual({ text: clean, dropped: [] })
  })

  it('drops the offending sentence whole and keeps its neighbours', () => {
    const out = withoutProseIds('The mill turned. They met at the well (3, 4). Rain came.')
    expect(out.text).toBe('The mill turned. Rain came.')
    expect(out.dropped).toEqual(['They met at the well (3, 4).'])
  })

  it('a leaking line in a list of marks takes only its own line', () => {
    const out = withoutProseIds(
      'Marks of the day:\n- the first trade\n- the 3, 4 thing\n- the first joke',
    )
    expect(out.dropped).toEqual(['- the 3, 4 thing'])
    expect(out.text).toBe('Marks of the day:\n- the first trade\n\n- the first joke')
  })

  it('catches a bracket, a counted event and a bare run', () => {
    const out = withoutProseIds('A [30034] came. It was event 12. Then 90, 91 followed.')
    expect(out.dropped).toHaveLength(3)
    expect(out.text).toBe('')
  })
})

describe('the prose-id guard at publish time', () => {
  it('a leaking chapter is persisted clean, with an alert row and an operator line', async () => {
    const { store, alerts } = watched()
    const alert = vi.fn()
    const chapter = await renderChapter({
      store,
      llm: leaking('The mill turned. They met at the well (3, 4).\nSeen: 1'),
      day: 1,
      scenes,
      alert,
    })
    expect(chapter.text).toBe('The mill turned.\nSeen: 1')
    expect(store.chaptersForDay(1)[0]!.text).toBe('The mill turned.\nSeen: 1')
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0]!.kind).toBe('prose_id_leak')
    expect(alerts()[0]!.detail).toContain('chapter for day 1')
    expect(alert.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining('prose_id_leak'),
    )
  })

  it('a clean chapter writes no alert at all', async () => {
    const { store, alerts } = watched()
    await renderChapter({
      store,
      llm: leaking('Blows by the storehouse.\nSeen: 1'),
      day: 1,
      scenes,
    })
    expect(alerts()).toEqual([])
  })
})
