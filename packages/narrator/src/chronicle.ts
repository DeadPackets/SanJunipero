import type { NarratorStore } from './store.js'
import type { ChapterRow, EraRow, NarratorLlm, SceneDigest, SceneSegment } from './types.js'

export function verifyCitations(citations: number[], valid: Set<number>): { ok: boolean; dangling: number[] } {
  const dangling = citations.filter((c) => !valid.has(c))
  return { ok: dangling.length === 0, dangling }
}

export function sceneDigests(
  scenes: SceneSegment[],
  typeCounts: (ids: number[]) => Record<string, number>,
): SceneDigest[] {
  return scenes.map((s) => ({
    eventIds: s.eventIds,
    cast: s.cast,
    location: s.location,
    typeCounts: typeCounts(s.eventIds),
  }))
}

// The hallucination guard: every persisted citation resolves by construction —
// dangling citations are stripped (with one alert), never stored, never rendered.
export async function renderChapter(deps: {
  store: NarratorStore
  llm: NarratorLlm
  day: number
  scenes: SceneSegment[]
  typeCounts?: (ids: number[]) => Record<string, number>
  alert?: (d: string) => void
}): Promise<ChapterRow> {
  const { store, llm, day, scenes } = deps
  const sceneIds = store.insertScenes(scenes)
  const summary = await llm.summarizeChapter(sceneDigests(scenes, deps.typeCounts ?? (() => ({}))))
  const valid = new Set(scenes.flatMap((s) => s.eventIds))
  const { ok, dangling } = verifyCitations(summary.citations, valid)
  if (!ok) deps.alert?.(`dangling_citation: chapter for day ${day} cited unknown ledger numbers ${dangling.join(', ')}`)
  let citations = summary.citations.filter((c) => valid.has(c))
  if (citations.length === 0) citations = scenes.map((s) => s.eventIds[0]).filter((id): id is number => id !== undefined)
  const id = store.insertChapter({ day, title: summary.title, text: summary.text, citations, sceneIds })
  return { id, day, title: summary.title, text: summary.text, citations, sceneIds }
}

// Incremental law (spec §9): an era is rendered once — a startDay already in the
// eras table is returned as-is, never reprocessed.
export async function renderEra(deps: {
  store: NarratorStore
  llm: NarratorLlm
  startDay: number
  endDay: number
  chapters: ChapterRow[]
  validEventIds: number[]
  alert?: (d: string) => void
}): Promise<EraRow> {
  const { store, startDay, endDay, chapters } = deps
  const existing = store.eras().find((e) => e.startDay === startDay)
  if (existing) return existing

  const chapterIds = chapters.map((c) => c.id)
  if (chapters.length === 0) {
    const title = `Days ${startDay} to ${endDay}`
    const text = 'Nothing of note was recorded this week.'
    const id = store.insertEra({ startDay, endDay, title, text, citations: [], chapterIds })
    return { id, startDay, endDay, title, text, citations: [], chapterIds }
  }

  const summary = await deps.llm.summarizeEra(
    chapters.map((c) => ({ day: c.day, title: c.title, text: c.text, citations: c.citations })),
  )
  const valid = new Set(deps.validEventIds)
  const { ok, dangling } = verifyCitations(summary.citations, valid)
  if (!ok) deps.alert?.(`dangling_citation: era days ${startDay}-${endDay} cited unknown ledger numbers ${dangling.join(', ')}`)
  let citations = summary.citations.filter((c) => valid.has(c))
  if (citations.length === 0) citations = chapters[0]!.citations.slice(0, 1)
  const id = store.insertEra({ startDay, endDay, title: summary.title, text: summary.text, citations, chapterIds })
  return { id, startDay, endDay, title: summary.title, text: summary.text, citations, chapterIds }
}
