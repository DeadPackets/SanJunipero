import type { NarratorStore } from './store.js'
import type { ChapterRow, NarratorLlm, SceneDigest, SceneSegment } from './types.js'

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
