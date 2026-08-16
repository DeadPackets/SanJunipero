import { z } from 'zod'
import type { LlmClient, LlmMessage } from './llm/client.js'
import type { MemoryRow, MemoryStore } from './memory/store.js'
import { PersonalityEditSchema, type PersonalityDoc, type PersonalityStore } from './personality.js'

export type ReflectionLlm = {
  extractFacts(
    dayMemories: MemoryRow[],
  ): Promise<Array<{ subject: string; predicate: string; object: string; srcMemoryId: number }>>
  summarizeScenes(
    dayMemories: MemoryRow[],
  ): Promise<Array<{ title: string; text: string; memoryIds: number[] }>>
  summarizeDay(scenes: Array<{ title: string; text: string }>): Promise<{ title: string; text: string }>
  updateLedger(personName: string, existing: string | null, relevant: MemoryRow[]): Promise<string>
  autobiographyParagraph(daySummary: string, doc: PersonalityDoc): Promise<string>
  proposeEdit(daySummary: string, doc: PersonalityDoc, dayMemories: MemoryRow[]): Promise<unknown | null>
}

export type ReflectionResult = {
  factCount: number
  sceneCount: number
  ledgersUpdated: string[]
  editApplied: boolean
  editRejectedReason?: string
}

export async function runSleepReflection(deps: {
  mem: MemoryStore
  personality: PersonalityStore
  llm: ReflectionLlm
  day: number
}): Promise<ReflectionResult> {
  const { mem, personality, llm, day } = deps

  // 1. Load the day's memories.
  const dayMemories = mem.memoriesOfDay(day)

  // 2. Facts FIRST (spec §6 step 2 — before any summarizing). A hallucinated
  // src_memory_id would trip the memories(id) FK (foreign_keys=ON) and abort the
  // whole pipeline mid-write, so keep only facts that cite today's memories.
  const facts = await llm.extractFacts(dayMemories)
  const todayIds = new Set(dayMemories.map((m) => m.id))
  const insertedFacts = facts.filter((f) => todayIds.has(f.srcMemoryId))
  for (const f of insertedFacts) {
    mem.insertFact({ day, subject: f.subject, predicate: f.predicate, object: f.object, srcMemoryId: f.srcMemoryId })
  }
  const factCount = insertedFacts.length

  // 3. Scene summaries.
  const scenes = await llm.summarizeScenes(dayMemories)
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

  // 4. Day node with child scene ids.
  const daySummary = await llm.summarizeDay(scenes.map((s) => ({ title: s.title, text: s.text })))
  mem.insertSummaryNode({
    level: 'day',
    day,
    title: daySummary.title,
    text: daySummary.text,
    childIds: sceneIds,
    memoryIds: [],
  })

  // 5. Ledgers — once per distinct person tag in the day's memories.
  const ledgersUpdated: string[] = []
  const people = new Set<string>()
  for (const m of dayMemories) for (const p of m.tags.people) people.add(p)
  for (const person of people) {
    const existing = mem.getLedger(person)?.doc ?? null
    const relevant = dayMemories.filter((m) => m.tags.people.includes(person))
    const doc = await llm.updateLedger(person, existing, relevant)
    mem.upsertLedger(person, doc, day)
    ledgersUpdated.push(person)
  }

  // 6. Autobiography paragraph.
  const personalityDoc = personality.current().doc
  const paragraph = await llm.autobiographyParagraph(daySummary.text, personalityDoc)
  mem.appendAutobiography(day, paragraph)

  // 7. Personality edit — ≤1 by construction, drift-limiter validates.
  const proposal = await llm.proposeEdit(daySummary.text, personalityDoc, dayMemories)
  if (proposal == null) {
    return { factCount, sceneCount: scenes.length, ledgersUpdated, editApplied: false }
  }
  const result = personality.applyNightlyEdit(day, proposal, mem)
  if (!result.ok) {
    return {
      factCount,
      sceneCount: scenes.length,
      ledgersUpdated,
      editApplied: false,
      editRejectedReason: result.reason,
    }
  }
  return { factCount, sceneCount: scenes.length, ledgersUpdated, editApplied: true }
}

// --- Real implementation: one structured-output call per method, z.strict() schemas. ---

type LlmPrompt = { system: string; messages: LlmMessage[] }

function compactMemories(memories: MemoryRow[]): Array<{ id: number; text: string; importance: number; tags: MemoryRow['tags'] }> {
  return memories.map((m) => ({ id: m.id, text: m.text, importance: m.importance, tags: m.tags }))
}

export function extractFactsPrompt(dayMemories: MemoryRow[]): LlmPrompt {
  return {
    system: [
      'Before sleep, you sort the day into what is solidly true.',
      'From each moment, keep only the facts you are sure of: who did what, who owes whom, what is where.',
      'For each fact, name the subject, the relation, and the object, and note the memory it came from.',
      'Write down only what the memories actually show, never what you merely suspect.',
    ].join('\n'),
    messages: [{ role: 'user', content: `Today, you lived these moments:\n${JSON.stringify(compactMemories(dayMemories))}` }],
  }
}

export function summarizeScenesPrompt(dayMemories: MemoryRow[]): LlmPrompt {
  return {
    system: [
      'Before sleep, you gather the day into scenes.',
      'Group the moments into a few natural scenes, each with a short title and a short telling of what happened.',
      'For each scene, list the memories it draws from.',
    ].join('\n'),
    messages: [{ role: 'user', content: `Today, you lived these moments:\n${JSON.stringify(compactMemories(dayMemories))}` }],
  }
}

export function summarizeDayPrompt(scenes: Array<{ title: string; text: string }>): LlmPrompt {
  return {
    system: [
      'Before sleep, you look back over the whole day.',
      'Give the day a single title and a short telling that holds its scenes together.',
    ].join('\n'),
    messages: [{ role: 'user', content: `The day held these scenes:\n${JSON.stringify(scenes)}` }],
  }
}

export function updateLedgerPrompt(personName: string, existing: string | null, relevant: MemoryRow[]): LlmPrompt {
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
        content: [`Your day:\n${daySummary}`, `You hold dear: ${doc.values.join(', ')}.`, `Your mood: ${doc.current.mood}.`].join(
          '\n',
        ),
      },
    ],
  }
}

export function proposeEditPrompt(daySummary: string, doc: PersonalityDoc, dayMemories: MemoryRow[]): LlmPrompt {
  const memoryLines = dayMemories.map((m) => `[${m.id}] ${m.text}`).join('\n')
  return {
    system: [
      'Before sleep, you may change one thing about what you value or what you believe.',
      'You may change at most one, and only if this day gives you a clear reason.',
      'If today held an event that changed how you see the world — a collapse, hunger, a conflict, a first — propose exactly one change to what you value or believe, and point to the memory that shows why.',
      'If the day was truly uneventful, say so and propose nothing.',
      'Answer with one field named `verdict`, either `no_proposal` or `propose`.',
      'For `no_proposal`, `verdict` is `no_proposal`.',
      'For `propose`, `verdict` is `propose` and `edit` holds the change: `op` one of add, remove, revise; `field` one of values, beliefs; for add or revise, `text` is the new wording; for remove or revise, `index` is its place counting from 0; and `evidence` is the list of today\'s memory numbers that show why.',
      'Never change your temperament — it is yours from birth.',
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
  .object({ subject: z.string().min(1), predicate: z.string().min(1), object: z.string().min(1), srcMemoryId: z.number().int() })
  .strict()
const FACTS_SCHEMA = z.object({ facts: z.array(FACT_SCHEMA) }).strict()
const SCENE_SCHEMA = z.object({ title: z.string().min(1), text: z.string().min(1), memoryIds: z.array(z.number().int()) }).strict()
const SCENES_SCHEMA = z.object({ scenes: z.array(SCENE_SCHEMA) }).strict()
const DAY_SUMMARY_SCHEMA = z.object({ title: z.string().min(1), text: z.string().min(1) }).strict()
const LEDGER_SCHEMA = z.object({ doc: z.string() }).strict()
const PARAGRAPH_SCHEMA = z.object({ paragraph: z.string().min(1) }).strict()
export const ProposeEditSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('no_proposal') }).strict(),
  z.object({ verdict: z.literal('propose'), edit: PersonalityEditSchema }).strict(),
])

export function makeReflectionLlm(client: LlmClient): ReflectionLlm {
  return {
    async extractFacts(dayMemories) {
      const p = extractFactsPrompt(dayMemories)
      const { value } = await client.object({ system: p.system, messages: p.messages, schema: FACTS_SCHEMA })
      return value.facts
    },
    async summarizeScenes(dayMemories) {
      const p = summarizeScenesPrompt(dayMemories)
      const { value } = await client.object({ system: p.system, messages: p.messages, schema: SCENES_SCHEMA })
      return value.scenes
    },
    async summarizeDay(scenes) {
      const p = summarizeDayPrompt(scenes)
      const { value } = await client.object({ system: p.system, messages: p.messages, schema: DAY_SUMMARY_SCHEMA })
      return value
    },
    async updateLedger(personName, existing, relevant) {
      const p = updateLedgerPrompt(personName, existing, relevant)
      const { value } = await client.object({ system: p.system, messages: p.messages, schema: LEDGER_SCHEMA })
      return value.doc
    },
    async autobiographyParagraph(daySummary, doc) {
      const p = autobiographyPrompt(daySummary, doc)
      const { value } = await client.object({ system: p.system, messages: p.messages, schema: PARAGRAPH_SCHEMA })
      return value.paragraph
    },
    async proposeEdit(daySummary, doc, dayMemories) {
      const p = proposeEditPrompt(daySummary, doc, dayMemories)
      const { value } = await client.object({ system: p.system, messages: p.messages, schema: ProposeEditSchema })
      return value.verdict === 'propose' ? value.edit : null
    },
  }
}
