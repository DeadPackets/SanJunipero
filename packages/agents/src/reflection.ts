import { z } from 'zod'
import { NoObjectGeneratedError } from 'ai'
import { BudgetExceededError, type LlmClient, type LlmMessage } from '@sj/llm'
import type { MemoryRow, MemoryStore } from './memory/store.js'
import { splitSentences } from './prompt/assemble.js'
import { PersonalityEditSchema, type PersonalityDoc, type PersonalityStore } from './personality.js'

export type ReflectionLlm = {
  extractFacts(
    dayMemories: MemoryRow[],
  ): Promise<{ subject: string; predicate: string; object: string; srcMemoryId: number }[]>
  summarizeScenes(
    dayMemories: MemoryRow[],
  ): Promise<{ title: string; text: string; memoryIds: number[] }[]>
  summarizeDay(scenes: { title: string; text: string }[]): Promise<{ title: string; text: string }>
  updateLedger(personName: string, existing: string | null, relevant: MemoryRow[]): Promise<string>
  autobiographyParagraph(daySummary: string, doc: PersonalityDoc): Promise<string>
  proposeEdit(daySummary: string, doc: PersonalityDoc, dayMemories: MemoryRow[]): Promise<unknown>
}

export type ReflectionResult = {
  factCount: number
  sceneCount: number
  ledgersUpdated: string[]
  editApplied: boolean
  editRejectedReason?: string
  /** The mind declined to change tonight — whether it answered `no_proposal` or proposed a no-op. */
  editSkipped?: true
  fallback: boolean
}

export const FALLBACK_DAY_TITLE = 'A long day'
export const FALLBACK_AUTOBIOGRAPHY = 'A long day; too weary to make sense of it.'
export const FALLBACK_DIGEST_CHARS = 2000
const FALLBACK_EMPTY_DIGEST = 'Nothing of the day comes back.'

// A night with no headroom left must still leave the day written down, or the
// mind wakes with a hole where yesterday was and never gets it back.
function dayDigest(dayMemories: MemoryRow[]): string {
  const full = dayMemories.map((m) => m.text).join('\n')
  if (full.length === 0) return FALLBACK_EMPTY_DIGEST
  return full.length <= FALLBACK_DIGEST_CHARS ? full : `${full.slice(0, FALLBACK_DIGEST_CHARS)}…`
}

// Anything not listed here is a real fault and belongs to the caller's alert path.
// Matched by name, not by class: an abort wrapped on its way up is the same stall.
function isDegradable(err: unknown): boolean {
  return (
    err instanceof BudgetExceededError ||
    NoObjectGeneratedError.isInstance(err) ||
    (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))
  )
}

export async function runSleepReflection(deps: {
  mem: MemoryStore
  personality: PersonalityStore
  llm: ReflectionLlm
  day: number
  alert?: (kind: string, detail: string) => void
}): Promise<ReflectionResult> {
  const { mem, personality, llm, day, alert } = deps

  // 1. Load the day's memories.
  const dayMemories = mem.memoriesOfDay(day)

  // The first refused step ends the thinking; every later step reads this latch
  // rather than spending another call the guard will refuse anyway.
  const degraded: { reason: string | null } = { reason: null }
  async function step<T>(run: () => Promise<T>): Promise<T | null> {
    if (degraded.reason !== null) return null
    try {
      return await run()
    } catch (err) {
      if (!isDegradable(err)) throw err
      degraded.reason = err instanceof Error ? err.message : String(err)
      return null
    }
  }

  // Facts first, before any summarizing: a hallucinated `src_memory_id` trips the FK and
  // aborts the pipeline mid-write, so keep only facts that cite today's memories.
  const facts = (await step(() => llm.extractFacts(dayMemories))) ?? []
  const todayIds = new Set(dayMemories.map((m) => m.id))
  const insertedFacts = facts.filter((f) => todayIds.has(f.srcMemoryId))
  for (const f of insertedFacts) {
    mem.insertFact({
      day,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      srcMemoryId: f.srcMemoryId,
    })
  }
  const factCount = insertedFacts.length

  // 3. Scene summaries.
  const scenes = (await step(() => llm.summarizeScenes(dayMemories))) ?? []
  const sceneIds: number[] = []
  for (const s of scenes) {
    sceneIds.push(
      mem.insertSummaryNode({
        level: 'scene',
        day,
        title: s.title,
        text: s.text,
        childIds: [],
        memoryIds: s.memoryIds,
      }),
    )
  }

  // 4. Day node with child scene ids — mechanical when the night went dark.
  const daySummary = await step(() =>
    llm.summarizeDay(scenes.map((s) => ({ title: s.title, text: s.text }))),
  )
  mem.insertSummaryNode({
    level: 'day',
    day,
    title: daySummary?.title ?? FALLBACK_DAY_TITLE,
    text: daySummary?.text ?? dayDigest(dayMemories),
    childIds: daySummary === null ? [] : sceneIds,
    memoryIds: [],
  })
  const daySummaryText = daySummary?.text ?? ''

  // 5. Ledgers — once per distinct person tag in the day's memories.
  const ledgersUpdated: string[] = []
  const people = new Set<string>()
  for (const m of dayMemories) for (const p of m.tags.people) people.add(p)
  for (const person of people) {
    const existing = mem.getLedger(person)?.doc ?? null
    const relevant = dayMemories.filter((m) => m.tags.people.includes(person))
    const doc = await step(() => llm.updateLedger(person, existing, relevant))
    if (doc === null) break
    mem.upsertLedger(person, doc, day)
    ledgersUpdated.push(person)
  }

  // 6. Autobiography paragraph.
  const personalityDoc = personality.current().doc
  const paragraph = await step(() => llm.autobiographyParagraph(daySummaryText, personalityDoc))
  mem.appendAutobiography(day, paragraph ?? FALLBACK_AUTOBIOGRAPHY)

  // 7. Personality edit — ≤1 by construction, drift-limiter validates.
  const proposal = await step(() => llm.proposeEdit(daySummaryText, personalityDoc, dayMemories))
  if (degraded.reason !== null) {
    alert?.('reflection_fallback', degraded.reason)
    return {
      factCount,
      sceneCount: scenes.length,
      ledgersUpdated,
      editApplied: false,
      fallback: true,
    }
  }
  if (proposal == null) {
    return {
      factCount,
      sceneCount: scenes.length,
      ledgersUpdated,
      editApplied: false,
      editSkipped: true,
      fallback: false,
    }
  }
  const result = personality.applyNightlyEdit(day, proposal, mem)
  if (!result.ok) {
    if (!result.skipped) alert?.('personality_edit_rejected', result.reason)
    return {
      factCount,
      sceneCount: scenes.length,
      ledgersUpdated,
      editApplied: false,
      ...(result.skipped ? { editSkipped: true } : { editRejectedReason: result.reason }),
      fallback: false,
    }
  }
  return {
    factCount,
    sceneCount: scenes.length,
    ledgersUpdated,
    editApplied: true,
    fallback: false,
  }
}

// --- Real implementation: one structured-output call per method, z.strict() schemas. ---

type LlmPrompt = { system: string; messages: LlmMessage[] }

type CompactMemory = { id: number; text: string; importance: number; tags: MemoryRow['tags'] }

function compactMemories(memories: MemoryRow[]): CompactMemory[] {
  return memories.map((m) => ({ id: m.id, text: m.text, importance: m.importance, tags: m.tags }))
}

// The same previous-moment filter the day log runs, per kind: a perception restates nearly all
// of the perception before it, and the day's rows interleave kinds where the day log holds one.
function freshMemories(memories: MemoryRow[]): CompactMemory[] {
  const saidLast = new Map<MemoryRow['kind'], Set<string>>()
  const kept: MemoryRow[] = []
  for (const m of memories) {
    const sentences = splitSentences(m.text)
    const before = saidLast.get(m.kind) ?? new Set<string>()
    const fresh = sentences.filter((s) => !before.has(s))
    saidLast.set(m.kind, new Set(sentences))
    if (fresh.length > 0) kept.push({ ...m, text: fresh.join(' ') })
  }
  return compactMemories(kept)
}

// Both night dumps open with these same bytes and carry their own instruction after the day,
// so the day is one prefix they share instead of one each provider must read twice.
const NIGHT_SYSTEM = 'Before sleep, the day comes back to you.'

function nightPrompt(dayMemories: MemoryRow[], instruction: string[]): LlmPrompt {
  return {
    system: NIGHT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Today, you lived these moments:\n${JSON.stringify(freshMemories(dayMemories))}`,
      },
      { role: 'user', content: instruction.join('\n') },
    ],
  }
}

export function extractFactsPrompt(dayMemories: MemoryRow[]): LlmPrompt {
  return nightPrompt(dayMemories, [
    'Before sleep, you sort the day into what is solidly true.',
    // "From each moment" is a pass per memory against an unbounded array; asking for the few
    // surest ones asks for the same work once.
    'Keep only the few facts you are surest of, at most eight: who did what, who owes whom, what is where.',
    'For each fact, name the subject, the relation, and the object, and note the memory it came from.',
    'Write down only what the memories actually show, never what you merely suspect.',
  ])
}

export function summarizeScenesPrompt(dayMemories: MemoryRow[]): LlmPrompt {
  return nightPrompt(dayMemories, [
    'Before sleep, you gather the day into scenes.',
    'Group the moments into a few natural scenes, each with a short title and a short telling of what happened.',
    'For each scene, list the memories it draws from.',
  ])
}

export function summarizeDayPrompt(scenes: { title: string; text: string }[]): LlmPrompt {
  return {
    system: [
      'Before sleep, you look back over the whole day.',
      'Give the day a single title and a short telling that holds its scenes together.',
    ].join('\n'),
    messages: [{ role: 'user', content: `The day held these scenes:\n${JSON.stringify(scenes)}` }],
  }
}

export function updateLedgerPrompt(
  personName: string,
  existing: string | null,
  relevant: MemoryRow[],
): LlmPrompt {
  return {
    system: [
      'Before sleep, you revisit your private note about one person.',
      'Rewrite that note from the day, keeping what still holds and adding what changed.',
      'The note is yours alone: your opinion, your trust, what they owe you and what you owe them.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Person: ${personName}`,
          existing === null ? 'No earlier note.' : `Your earlier note:\n${existing}`,
          `What you saw of them today:\n${JSON.stringify(compactMemories(relevant))}`,
        ].join('\n\n'),
      },
    ],
  }
}

export function autobiographyPrompt(daySummary: string, doc: PersonalityDoc): LlmPrompt {
  return {
    system: [
      'Before sleep, you add one short paragraph to the story of your life.',
      'Tell what this day meant to you, in your own voice.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Your day:\n${daySummary}`,
          `You hold dear: ${doc.values.join(', ')}.`,
          `Your mood: ${doc.current.mood}.`,
        ].join('\n'),
      },
    ],
  }
}

export function proposeEditPrompt(
  daySummary: string,
  doc: PersonalityDoc,
  dayMemories: MemoryRow[],
): LlmPrompt {
  const memoryLines = dayMemories.map((m) => `[${m.id}] ${m.text}`).join('\n')
  return {
    // `ProposeEditSchema` is sent on every call, so only what it cannot say stays: `evidence`
    // is today's memory numbers, and temperament is not on the table.
    system: [
      'Before sleep, you may change one thing about what you value or what you believe.',
      'Read the telling of your day below. If it holds something that changed how you see the world (a collapse, hunger, a conflict, a first), name the single change it made in you.',
      'Most days hold nothing like that. When yours does not, propose nothing and be done: an edit whose text says there is no change is not an answer.',
      'When you do propose, `evidence` is the memory numbers from today that show why.',
      'Never change your temperament: it is yours from birth.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Your day:\n${daySummary}`,
          `What you value now: ${doc.values.join(', ')}.`,
          `What you believe now: ${doc.beliefs.join(', ') || 'nothing in particular yet.'}`,
          `Today's memories:\n${memoryLines}`,
        ].join('\n'),
      },
    ],
  }
}

const FACT_SCHEMA = z
  .object({
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
    srcMemoryId: z.number().int(),
  })
  .strict()
// Ten, against a prose bound of eight: the prose is the real ask and the schema is only the
// runaway stop, set loose enough that an honest answer is never rejected.
const FACTS_SCHEMA = z.object({ facts: z.array(FACT_SCHEMA).max(10) }).strict()
const SCENE_SCHEMA = z
  .object({
    title: z.string().min(1),
    text: z.string().min(1),
    memoryIds: z.array(z.number().int()),
  })
  .strict()
const SCENES_SCHEMA = z.object({ scenes: z.array(SCENE_SCHEMA) }).strict()
const DAY_SUMMARY_SCHEMA = z.object({ title: z.string().min(1), text: z.string().min(1) }).strict()
const LEDGER_SCHEMA = z.object({ doc: z.string() }).strict()
const PARAGRAPH_SCHEMA = z.object({ paragraph: z.string().min(1) }).strict()
export const ProposeEditSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('no_proposal') }).strict(),
  z.object({ verdict: z.literal('propose'), edit: PersonalityEditSchema }).strict(),
])

export function makeReflectionLlm(client: LlmClient): ReflectionLlm {
  // With the night's thinking off, facts and scenes came back identical and only the personality
  // edit thinned out, so this one call has its own name, its own ceiling and its own ledger line.
  const editClient = client.forCaller('reflection.edit')
  return {
    async extractFacts(dayMemories) {
      const p = extractFactsPrompt(dayMemories)
      const { value } = await client.object({
        system: p.system,
        messages: p.messages,
        schema: FACTS_SCHEMA,
      })
      return value.facts
    },
    async summarizeScenes(dayMemories) {
      const p = summarizeScenesPrompt(dayMemories)
      const { value } = await client.object({
        system: p.system,
        messages: p.messages,
        schema: SCENES_SCHEMA,
      })
      return value.scenes
    },
    async summarizeDay(scenes) {
      const p = summarizeDayPrompt(scenes)
      const { value } = await client.object({
        system: p.system,
        messages: p.messages,
        schema: DAY_SUMMARY_SCHEMA,
      })
      return value
    },
    async updateLedger(personName, existing, relevant) {
      const p = updateLedgerPrompt(personName, existing, relevant)
      const { value } = await client.object({
        system: p.system,
        messages: p.messages,
        schema: LEDGER_SCHEMA,
      })
      return value.doc
    },
    async autobiographyParagraph(daySummary, doc) {
      const p = autobiographyPrompt(daySummary, doc)
      const { value } = await client.object({
        system: p.system,
        messages: p.messages,
        schema: PARAGRAPH_SCHEMA,
      })
      return value.paragraph
    },
    async proposeEdit(daySummary, doc, dayMemories) {
      const p = proposeEditPrompt(daySummary, doc, dayMemories)
      const { value } = await editClient.object({
        system: p.system,
        messages: p.messages,
        schema: ProposeEditSchema,
      })
      return value.verdict === 'propose' ? value.edit : null
    },
  }
}
