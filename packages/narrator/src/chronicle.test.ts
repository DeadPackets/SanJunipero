import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import { renderChapter, sceneDigests, verifyCitations } from './chronicle.js'
import type { NarratorLlm, SceneSegment } from './types.js'

const memStore = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

const scenes: SceneSegment[] = [
  { day: 1, startTick: 1440, endTick: 1450, eventIds: [1, 2, 3], cast: ['omar', 'yusuf'], location: '3,4' },
  { day: 1, startTick: 1500, endTick: 1510, eventIds: [4, 5], cast: ['nadia'], location: null },
]

const llmWith = (citations: number[]): NarratorLlm =>
  ({
    summarizeChapter: vi.fn(async () => ({ title: 'The Quarrel', text: 'Blows by the storehouse.', citations })),
    summarizeEra: vi.fn(),
    newspaperCopy: vi.fn(),
    biography: vi.fn(),
  }) as unknown as NarratorLlm

describe('verifyCitations', () => {
  it('splits citations into valid and dangling', () => {
    expect(verifyCitations([1, 3, 99], new Set([1, 2, 3, 4, 5]))).toEqual({ ok: false, dangling: [99] })
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
      { eventIds: [1, 2, 3], cast: ['omar', 'yusuf'], location: '3,4', typeCounts: { agent_spoke: 3 } },
      { eventIds: [4, 5], cast: ['nadia'], location: null, typeCounts: { agent_spoke: 2 } },
    ])
  })
})
