import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'
import { renderEra } from './chronicle.js'
import { FORBIDDEN_FRAMING } from '@sj/shared'
import type { ChapterRow, NarratorLlm } from './types.js'

const memStore = (): NarratorStore => {
  const db = new Database(':memory:')
  migrateNarratorTables(db)
  return new NarratorStore(db)
}

const seedChapters = (store: NarratorStore, days: number[]): ChapterRow[] =>
  days.map((day) => {
    const c = { day, title: `Day ${day}`, text: `The tale of day ${day}.`, citations: [day + 1], sceneIds: [] }
    const id = store.insertChapter(c)
    return { id, ...c }
  })

const llmWith = (citations: number[]) =>
  ({
    summarizeChapter: vi.fn(),
    summarizeEra: vi.fn(async () => ({ title: 'The First Week', text: 'Seven days by the river.', citations })),
    newspaperCopy: vi.fn(),
    biography: vi.fn(),
  }) as unknown as NarratorLlm

describe('renderEra', () => {
  it('persists a week arc, strips dangling citations, alerts once', async () => {
    const store = memStore()
    const chapters = seedChapters(store, [0, 1, 2, 3, 4, 5, 6])
    const alert = vi.fn()
    const era = await renderEra({
      store, llm: llmWith([2, 3, 777]), startDay: 0, endDay: 6, chapters, validEventIds: [1, 2, 3, 4, 5], alert,
    })
    expect(era.startDay).toBe(0)
    expect(era.endDay).toBe(6)
    expect(era.chapterIds).toEqual(chapters.map((c) => c.id))
    expect(era.citations).toEqual([2, 3])
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]![0]).toContain('777')
    const persisted = store.eras()
    expect(persisted.length).toBe(1)
    expect(persisted[0]!.citations).toEqual([2, 3])
  })

  it('handles an empty week: no chapters, no citations, no alert, no LLM call', async () => {
    const store = memStore()
    const llm = llmWith([2, 3, 777])
    const alert = vi.fn()
    const era = await renderEra({ store, llm, startDay: 0, endDay: 6, chapters: [], validEventIds: [], alert })
    expect(era.citations).toEqual([])
    expect(era.chapterIds).toEqual([])
    expect(alert).not.toHaveBeenCalled()
    expect((llm.summarizeEra as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
    expect(FORBIDDEN_FRAMING.test(era.title)).toBe(false)
    expect(FORBIDDEN_FRAMING.test(era.text)).toBe(false)
  })

  it('never reprocesses an era: a second call with the same startDay returns the existing row', async () => {
    const store = memStore()
    const chapters = seedChapters(store, [0, 1, 2, 3, 4, 5, 6])
    const first = await renderEra({ store, llm: llmWith([2]), startDay: 0, endDay: 6, chapters, validEventIds: [1, 2, 3] })
    const second = await renderEra({ store, llm: llmWith([3]), startDay: 0, endDay: 6, chapters, validEventIds: [1, 2, 3] })
    expect(store.eras().length).toBe(1)
    expect(second).toEqual(first)
  })

  it('zero-citation summary falls back to the first chapter citation', async () => {
    const store = memStore()
    const chapters = seedChapters(store, [0, 1, 2])
    const alert = vi.fn()
    const era = await renderEra({ store, llm: llmWith([]), startDay: 0, endDay: 2, chapters, validEventIds: [1, 2, 3], alert })
    expect(era.citations).toEqual([1])
    expect(alert).not.toHaveBeenCalled()
  })
})
