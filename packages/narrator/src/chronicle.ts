import { SOMEONE, type SimEvent } from '@sj/shared'
import type { NarratorStore } from './store.js'
import type {
  CastMember,
  ChapterRow,
  EraRow,
  NarratorLlm,
  SceneDigest,
  SceneSegment,
} from './types.js'

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

// R4: the chronicle invented ten villagers for a day whose only events were weather and deer,
// and wrote "no bad turn came to any household" over five graves. A chapter may name nobody the
// world has not got, and a day nobody lived through is a still day, not an empty stage to fill.
const ROLL_LAW =
  'This roll is everyone who has ever lived here. Name no one else — no neighbour, no elder, no' +
  ' visitor, no household you were not given. A name not on this roll is a lie in the record.'

const STILLNESS =
  'No person acted today: the digests hold only weather and animals. Write that stillness' +
  ' plainly — the empty lanes, the standing graves, the river and the sky — and do not fill the' +
  ' day with people or households to make it a story.'

export function castLaw(cast: readonly CastMember[], anyoneActed: boolean): string {
  const living = cast.filter((c) => c.alive).map((c) => c.name)
  const dead = cast.filter((c) => !c.alive).map((c) => c.name)
  const out: string[] = []
  if (cast.length > 0) {
    out.push(
      living.length === 0
        ? 'No one is left alive in this town.'
        : `Living, and the only people who can act: ${living.join(', ')}.`,
    )
    if (dead.length > 0) out.push(`Dead, and their graves stand: ${dead.join(', ')}.`)
    out.push(ROLL_LAW)
  }
  if (!anyoneActed) out.push(STILLNESS)
  return out.join(' ')
}

/** Capitalised words the roll cannot account for. Built from the roll, never a fixed list: a
 *  capital INSIDE a sentence is somebody being named, where one opening a sentence is grammar.
 *  Sentence-initial strangers are therefore out of reach, and that is the honest limit. */
export function namesOutsideRoll(text: string, cast: readonly CastMember[]): string[] {
  const known = new Set(cast.map((c) => c.name))
  const found = new Set<string>()
  for (const sentence of text.split(/(?<=[.!?])\s+/u)) {
    for (const raw of sentence.trim().split(/\s+/u).slice(1)) {
      const word = raw.replace(/[^\p{L}]/gu, '')
      if (/^\p{Lu}\p{Ll}+$/u.test(word) && !known.has(word) && !PLACE_WORDS.has(word))
        found.add(word)
    }
  }
  return [...found].sort()
}

// The town's own proper nouns, which are places and not people.
const PLACE_WORDS = new Set(['San', 'Junipero', 'Day'])

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

export const FOOTNOTE_PREFIX = 'Seen:'

// The label marks a footnote, not its position: asked for a trailing line, the narrator as often
// hangs it off a sentence. A range ("1-6009") is not a citation and parses away to nothing.
const FOOTNOTE_LINE = /[ \t]*\bSeen:[ \t]*(\d+(?:[ \t]*[,–—-][ \t]*\d+)*)[ \t]*\.?/gu

// Every shape the chronicle has produced a number in. The bare list is how a misspelled label
// smuggles unchecked seqs into the prose.
const PROSE_ID_LEAK =
  /\[\s*\d|\b(?:tick|ticks|event|events|seq|seqs|number|numbers)\s+#?\d|\(\s*\d[\d\s,–—-]*\)|\b\d+\s*,\s*\d+/giu

const numbersIn = (list: string): number[] =>
  list
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0)

export function footnoteSeqs(text: string): number[] {
  const out = new Set<number>()
  for (const m of text.matchAll(FOOTNOTE_LINE)) for (const n of numbersIn(m[1] ?? '')) out.add(n)
  return [...out]
}

export function stripFootnotes(text: string): string {
  return text.replace(FOOTNOTE_LINE, '').trim()
}

export function pruneFootnotes(text: string, valid: Set<number>): string {
  return text.replace(FOOTNOTE_LINE, (line, list: string) => {
    const kept = numbersIn(list).filter((n) => valid.has(n))
    return kept.length === 0 ? '' : line.replace(list, kept.join(', '))
  })
}

export function proseIdLeaks(text: string): string[] {
  return [...stripFootnotes(text).matchAll(PROSE_ID_LEAK)].map((m) => m[0])
}

// Never across a line break: a list of milestone labels carries no full stop, and one bad line
// there must not take the whole block with it. Newlines match nothing, so they stay put.
const SENTENCE = /[^.!?\n]+[.!?]*/gu

export function withoutProseIds(text: string): { text: string; dropped: string[] } {
  const dropped: string[] = []
  const kept = text.replace(SENTENCE, (s) => {
    if (proseIdLeaks(s).length === 0) return s
    dropped.push(s.trim())
    return ''
  })
  if (dropped.length === 0) return { text, dropped }
  return { text: kept.replace(/\n{3,}/gu, '\n\n').trim(), dropped }
}

/** FOOTNOTE_RULE is a prompt line, and a prompt line is not enforcement. A leaking sentence is
 *  dropped rather than re-rendered: a second call for it buys a coin-flip for real money. */
export function publishClean(
  deps: { store: NarratorStore; alert?: ((d: string) => void) | undefined },
  where: string,
  text: string,
): string {
  const { text: clean, dropped } = withoutProseIds(text)
  if (dropped.length === 0) return text
  const detail = `${where}: ${dropped.length} sentence(s) dropped for a number in the prose — ${dropped
    .slice(0, 3)
    .join(' | ')}`
  deps.store.insertAlert('prose_id_leak', detail)
  deps.alert?.(`prose_id_leak: ${detail}`)
  return clean
}

/** `castLaw` is a prompt line, and a prompt line is not enforcement. A sentence that names a
 *  stranger is dropped the way a sentence with a number in it is, and the alert is how anyone
 *  finds out the model is inventing villagers without reading every chapter. */
export function withoutStrangers(
  deps: { store: NarratorStore; alert?: ((d: string) => void) | undefined },
  where: string,
  text: string,
  cast: readonly CastMember[],
): string {
  if (cast.length === 0) return text
  const strangers = new Set<string>()
  let dropped = 0
  const kept = text.replace(SENTENCE, (s) => {
    const found = namesOutsideRoll(s, cast)
    if (found.length === 0) return s
    for (const name of found) strangers.add(name)
    dropped += 1
    return ''
  })
  if (dropped === 0) return text
  const detail =
    `${where}: ${dropped} sentence(s) dropped for naming somebody the town does not have` +
    ` — ${[...strangers].slice(0, 6).join(', ')}`
  deps.store.insertAlert('cast_leak', detail)
  deps.alert?.(`cast_leak: ${detail}`)
  return kept.replace(/\n{3,}/gu, '\n\n').trim()
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

// What the footnotes claim and what the schema field claims are one set; a seq no scene owns is
// dropped from both, so nothing unresolvable is ever stored or rendered.
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

/** What the digest needs from the world so the prompt never carries an id or a tile: the model
 *  cannot leak what it never sees. Absent, nobody is named and no place is claimed. */
export type DigestLookup = {
  nameOf?: (id: string) => string
  placeOf?: (location: string) => string | null
}

export function sceneDigests(
  scenes: SceneSegment[],
  typeCounts: (ids: number[]) => Record<string, number>,
  look: DigestLookup = {},
): SceneDigest[] {
  return scenes.map((s) => ({
    eventIds: s.eventIds,
    cast: s.cast.map(look.nameOf ?? (() => SOMEONE)),
    location: s.location === null ? null : (look.placeOf?.(s.location) ?? null),
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
  look?: DigestLookup | undefined
  cast?: readonly CastMember[] | undefined
  alert?: ((d: string) => void) | undefined
}): Promise<ChapterRow> {
  const { store, llm, day, scenes } = deps
  const sceneIds = store.insertScenes(scenes)
  const summary = await llm.summarizeChapter(
    sceneDigests(scenes, deps.typeCounts ?? (() => ({})), deps.look ?? {}),
    deps.cast ?? [],
  )
  const valid = new Set(scenes.flatMap((s) => s.eventIds))
  const seen = applyFootnotes(summary.text, summary.citations, valid)
  if (seen.dangling.length > 0)
    deps.alert?.(
      `dangling_citation: chapter for day ${day} cited unknown ledger numbers ${seen.dangling.join(', ')}`,
    )
  let citations = seen.citations
  if (citations.length === 0)
    citations = scenes.map((s) => s.eventIds[0]).filter((id): id is number => id !== undefined)
  const grounded = withoutStrangers(deps, `chapter for day ${day}`, seen.text, deps.cast ?? [])
  const text = publishClean(deps, `chapter for day ${day}`, grounded)
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
  const text = publishClean(deps, `era days ${startDay}-${endDay}`, seen.text)
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
