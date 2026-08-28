import type { SimEvent } from '@sj/shared'
import type { NarratorStore } from './store.js'
import type { ChapterRow, EraRow, NarratorLlm, SceneDigest, SceneSegment } from './types.js'

// Every line here is a rule against inventing: hurt is never a number, sickness never a
// severity, care is credited only where somebody sat down, and a killing names only the hand.
export const NARRATOR_VOCABULARY_NOTES = [
  'Write "hurt" or "wounded"; never how much.',
  'Write "sickness" or "a bad turn"; never how bad.',
  'You may credit care — "after days at her side" — only where the digest records somebody tending them. Detect, never invent.',
  'Write "sat with" or "nursed". Never call anybody a healer unless the town calls them one first.',
  'A death by another hand may name the hand that was seen. It may never say whether it was deserved.',
  'The world growing wider is never explained.',
].join(' ')

// Who actually sat with whom, off the ledger. The chapter may credit care only from this.
export function creditedCare(events: SimEvent[]): { patient: string; tender: string }[] {
  const out: { patient: string; tender: string }[] = []
  for (const ev of events) {
    if (ev.type !== 'agent_tended') continue
    const p = (ev.payload ?? {}) as { agentId?: unknown; tenderId?: unknown }
    if (typeof p.agentId !== 'string' || typeof p.tenderId !== 'string') continue
    out.push({ patient: p.agentId, tender: p.tenderId })
  }
  return out
}

// The hand a death was witnessed by — the payload's own `byId`, and nothing inferred.
export function witnessedAttackers(events: SimEvent[]): { victim: string; byId: string }[] {
  const out: { victim: string; byId: string }[] = []
  for (const ev of events) {
    if (ev.type !== 'agent_died') continue
    const p = (ev.payload ?? {}) as { agentId?: unknown; byId?: unknown }
    if (typeof p.agentId !== 'string' || typeof p.byId !== 'string') continue
    out.push({ victim: p.agentId, byId: p.byId })
  }
  return out
}

/** The one line a paragraph may end on, and the only place a number is allowed to stand. */
export const FOOTNOTE_PREFIX = 'Seen:'

// The label is what marks a footnote, not where it sits: asked for a trailing line, the narrator
// writes it onto the tail of a sentence about as often, and sometimes after every sentence. The
// run may contain a range ("1-6009"); a range is not a citation and parses away to nothing.
const FOOTNOTE_LINE = /[ \t]*\bSeen:[ \t]*(\d+(?:[ \t]*[,–—-][ \t]*\d+)*)[ \t]*\.?/gu

// A number inside a sentence, in every shape the chronicle has produced one: a bracket, a
// counted tick or event, a parenthesised run, or a bare list the footnote parser did not claim
// — which is how a misspelled label smuggles unchecked seqs into the prose.
const PROSE_ID_LEAK =
  /\[\s*\d|\b(?:tick|ticks|event|events|seq|seqs|number|numbers)\s+#?\d|\(\s*\d[\d\s,–—-]*\)|\b\d+\s*,\s*\d+/giu

const numbersIn = (list: string): number[] =>
  list
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0)

/** Every seq the footnote lines claim, in the order they are claimed, each one once. */
export function footnoteSeqs(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(FOOTNOTE_LINE)) for (const n of numbersIn(m[1] ?? '')) out.add(n)
  return [...out]
}

/** The prose alone, for a scan that must not trip over the footnotes' own digits. */
export function stripFootnotes(text: string): string {
  return text.replace(FOOTNOTE_LINE, '').trim()
}

/** The same text with every unresolvable seq dropped from its footnote line. */
export function pruneFootnotes(text: string, valid: Set<number>): string {
  return text.replace(FOOTNOTE_LINE, (line, list: string) => {
    const kept = numbersIn(list).filter((n) => valid.has(n))
    return kept.length === 0 ? '' : line.replace(list, kept.join(', '))
  })
}

/** Whatever the prose is still carrying that belongs under it. Empty is the only good answer. */
export function proseIdLeaks(text: string): string[] {
  return [...stripFootnotes(text).matchAll(PROSE_ID_LEAK)].map((m) => m[0])
}

export const FOOTNOTE_RULE =
  'Never put a number inside a sentence: no brackets, no tick counts, no event numbers, no parenthesised runs. ' +
  `End every paragraph with a trailing line of its own, spelled exactly "${FOOTNOTE_PREFIX}" and then that ` +
  "paragraph's numbers separated by commas — only numbers given to you below, never invented. " +
  'These words are banned from your prose: record, ledger, entered, numbered.'

export function verifyCitations(
  citations: number[],
  valid: Set<number>,
): { ok: boolean; dangling: number[] } {
  const dangling = citations.filter((c) => !valid.has(c))
  return { ok: dangling.length === 0, dangling }
}

// The citation check, reading the footnote line the voices write under each paragraph. What the
// footnotes claim and what the schema field claims are one set; a seq no scene owns is dropped
// from both, so nothing unresolvable is ever stored or rendered.
export function applyFootnotes(
  text: string,
  citations: number[],
  valid: Set<number>,
): { text: string; citations: number[]; dangling: number[] } {
  const claimed = [...new Set([...footnoteSeqs(text), ...citations])]
  const { ok, dangling } = verifyCitations(claimed, valid)
  return {
    text: ok ? text : pruneFootnotes(text, valid),
    citations: claimed.filter((c) => valid.has(c)),
    dangling,
  }
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
  typeCounts?: ((ids: number[]) => Record<string, number>) | undefined
  alert?: ((d: string) => void) | undefined
}): Promise<ChapterRow> {
  const { store, llm, day, scenes } = deps
  const sceneIds = store.insertScenes(scenes)
  const summary = await llm.summarizeChapter(sceneDigests(scenes, deps.typeCounts ?? (() => ({}))))
  const valid = new Set(scenes.flatMap((s) => s.eventIds))
  const seen = applyFootnotes(summary.text, summary.citations, valid)
  if (seen.dangling.length > 0)
    deps.alert?.(
      `dangling_citation: chapter for day ${day} cited unknown ledger numbers ${seen.dangling.join(', ')}`,
    )
  let citations = seen.citations
  if (citations.length === 0)
    citations = scenes.map((s) => s.eventIds[0]).filter((id): id is number => id !== undefined)
  const text = seen.text
  const id = store.insertChapter({ day, title: summary.title, text, citations, sceneIds })
  return { id, day, title: summary.title, text, citations, sceneIds }
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
  alert?: ((d: string) => void) | undefined
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
  const seen = applyFootnotes(summary.text, summary.citations, valid)
  if (seen.dangling.length > 0)
    deps.alert?.(
      `dangling_citation: era days ${startDay}-${endDay} cited unknown ledger numbers ${seen.dangling.join(', ')}`,
    )
  let citations = seen.citations
  if (citations.length === 0) citations = chapters[0]!.citations.slice(0, 1)
  const text = seen.text
  const id = store.insertEra({
    startDay,
    endDay,
    title: summary.title,
    text,
    citations,
    chapterIds,
  })
  return { id, startDay, endDay, title: summary.title, text, citations, chapterIds }
}
