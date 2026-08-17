import type { SimEvent } from '@sj/shared'
import type { NarratorStore } from './store.js'
import type { ChapterRow, EraRow, NarratorLlm, SceneDigest, SceneSegment } from './types.js'

// The narrator's binding vocabulary (addendum §12). Every line of it is a rule about what
// may be SAID, and every one of them is a rule against inventing: hurt is never a number,
// sickness is never a severity, care is credited only where somebody actually sat down, and
// a killing names the hand that was witnessed and never a verdict on it.
export const NARRATOR_VOCABULARY_NOTES = [
  'Write "hurt" or "wounded"; never how much.',
  'Write "sickness" or "a bad turn"; never how bad.',
  'You may credit care — "after days at her side" — only where the digest records somebody tending them. Detect, never invent.',
  'Write "sat with" or "nursed". Never call anybody a healer unless the town calls them one first.',
  'A death by another hand may name the hand that was seen. It may never say whether it was deserved.',
  'The world growing wider is never explained.',
].join(' ')

// Who actually sat with whom, off the ledger. The chapter may credit care only from this.
export function creditedCare(events: SimEvent[]): Array<{ patient: string; tender: string }> {
  const out: Array<{ patient: string; tender: string }> = []
  for (const ev of events) {
    if (ev.type !== 'agent_tended') continue
    const p = (ev.payload ?? {}) as { agentId?: unknown; tenderId?: unknown }
    if (typeof p.agentId !== 'string' || typeof p.tenderId !== 'string') continue
    out.push({ patient: p.agentId, tender: p.tenderId })
  }
  return out
}

// The hand a death was witnessed by — the payload's own `byId`, and nothing inferred.
export function witnessedAttackers(events: SimEvent[]): Array<{ victim: string; byId: string }> {
  const out: Array<{ victim: string; byId: string }> = []
  for (const ev of events) {
    if (ev.type !== 'agent_died') continue
    const p = (ev.payload ?? {}) as { agentId?: unknown; byId?: unknown }
    if (typeof p.agentId !== 'string' || typeof p.byId !== 'string') continue
    out.push({ victim: p.agentId, byId: p.byId })
  }
  return out
}

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
