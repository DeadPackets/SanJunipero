// Last stage of bridge -> prose -> agentRuntime -> assemble, and the only one that renders bytes.
import { sanitizeSpokenText, type RosterEntry } from '@sj/shared'
import type { PersonalityDoc } from '../personality.js'
import type { ScoredMemory } from '../memory/retrieve.js'
import { promptText } from '../memory/gist.js'
import { CAPABILITIES, renderRoster, SPEECH_RULES } from './rulesOfBeing.js'

export type IdentityCore = {
  name: string
  age: number
  backstory: string
  temperament: string
  voiceCard: {
    register: string
    rhythm: string
    tics: string[]
    neverSays: string[]
    exampleLines: string[]
    // Absent renders nothing, keeping every pre-C9 persona byte-stable.
    wordBudget?: { typical: number; burst: number }
  }
}

type JournalEntry = { day: number; text: string }

export type Recalled = { query: string; memories: string[] }

/** What the mind already committed to and is partway through: the head of a running plan, or
 *  the act its body is still carrying out. `of` at one is a single act, and prints no step. */
export type Underway = { what: string; step: number; of: number }

export type PromptBlocks = {
  rulesOfBeing: string // block 1 — never changes, identical for all agents
  // What the town has minted, identical for all agents; changes only when a verb is minted or
  // retired, so it sits after the static rules and before anything that is one mind's own.
  roster?: readonly RosterEntry[]
  identity: IdentityCore // block 2 — never changes
  personality: { doc: PersonalityDoc; autobiography: string[] } // block 3 — changes at sleep only
  journal: JournalEntry[] // the mind's own book — changes only when it writes in it
  scene: { ledgers: { name: string; doc: string }[]; memories: ScoredMemory[] } // block 4 — per scene
  dayLog: string[] // block 5 — append-only all day
  recalled: Recalled | null // only on the turn after a mind cast its mind back
  // Only on the turn after an act the engine turned away. Absent everywhere else, so a packet
  // built before it existed reads exactly as it always did.
  lastOutcome?: string | null
  // block 6 — every turn. `heard` is another mouth's bytes and rides its own message, so no
  // utterance can ever read as a sentence the narrator wrote. `said` is this mind's own last
  // words, oldest first: perception skips self, so nothing else in the prompt holds them.
  now: { prose: string; heard?: string; said?: string[] }
  // Last of all, and only while something is already running: a mind holding an intention is
  // asked whether to carry on or break off, never asked afresh whether to act at all.
  underway: Underway | null
}

export type AssembledPrompt = {
  system: string // blocks 1+2+3, fixed delimiters
  messages: { role: 'user'; content: string }[] // stable→volatile; an empty block sends no message
  estTokens: number // ceil(totalChars/4)
  needsCompaction: boolean // est(dayLog) > 6000 tokens
}

// Byte-stable, so blocks 1-3 form an unbroken cache prefix until sleep rewrites block 3.
const BLOCK_DELIM = '\n\n---\n\n'

const DAYLOG_COMPACTION_TOKENS = 6000

export const JOURNAL_LINES = 5
const JOURNAL_MAX_CHARS = 1200

/** Two, because one line back cannot show a rut and a page of them is the mind talking to
 *  itself instead of to the town. */
export const OWN_WORDS_SHOWN = 2

function renderIdentity(id: IdentityCore): string {
  const v = id.voiceCard
  const lines = [
    `Name: ${id.name}`,
    `Age: ${id.age}`,
    `Temperament: ${id.temperament}`,
    `Backstory: ${id.backstory}`,
    `Voice: ${v.register} — ${v.rhythm}`,
    `Tics: ${v.tics.join('; ')}`,
    `Never says: ${v.neverSays.join('; ')}`,
    `Example lines: ${v.exampleLines.join(' | ')}`,
  ]
  if (v.wordBudget) {
    lines.push(
      `You usually say about ${v.wordBudget.typical} words at a time; when truly moved, up to ${v.wordBudget.burst}.`,
    )
  }
  return lines.join('\n')
}

function renderPersonality(p: PromptBlocks['personality']): string {
  const doc = p.doc
  const lines = [
    `Mood: ${doc.current.mood}`,
    `Values: ${doc.values.join('; ')}`,
    `Beliefs: ${doc.beliefs.join('; ')}`,
    `Worries: ${doc.current.worries.join('; ')}`,
    `Goals: ${doc.current.goals.join('; ')}`,
  ]
  if (p.autobiography.length > 0) {
    lines.push(`Your life so far:\n${p.autobiography.join('\n\n')}`)
  }
  return lines.join('\n')
}

// Oldest pages drop first, so one long hand cannot flood the page.
function renderJournal(entries: JournalEntry[]): string {
  const lines = entries.slice(-JOURNAL_LINES).map((e) => `Day ${e.day}: ${e.text}`)
  while (lines.length > 1 && lines.join('\n').length > JOURNAL_MAX_CHARS) lines.shift()
  if (lines.length === 0) return ''
  const page = lines.join('\n')
  const bounded =
    page.length <= JOURNAL_MAX_CHARS
      ? page
      : `${page.slice(0, page.lastIndexOf(' ', JOURNAL_MAX_CHARS))}…`
  return `You turn back the pages of your own book:\n${bounded}`
}

// Nothing is said plainly: silence would read to the mind as never having asked.
function renderRecall(recalled: Recalled): string {
  const opening = `You cast your mind back to ${recalled.query}.`
  if (recalled.memories.length === 0) return `${opening} Nothing comes back.`
  return `${opening} What comes back:\n${recalled.memories.join('\n')}`
}

// Said in the mind's own words for the act, and honest about the cost of breaking off: naming
// an action drops what is left of the plan.
function renderUnderway(u: Underway): string {
  const step = u.of > 1 ? ` (step ${u.step} of ${u.of})` : ''
  return (
    `You are in the middle of: ${u.what}${step}. Your body carries it on by itself.\n` +
    'Answer wait and it goes on. Name another act and you break off, and what was left of it is let go.'
  )
}

// Sanitized here as well as at the verb, for the same reason `heardLine` is: a quote in a
// prompt is a fence, and model output is where one comes from.
function renderSaid(said: readonly string[]): string {
  const lines = said.slice(-OWN_WORDS_SHOWN)
  return lines
    .map(
      (text, i) =>
        `${i === lines.length - 1 ? 'You just said' : 'You said'}: "${sanitizeSpokenText(text)}"`,
    )
    .join('\n')
}

function renderScene(scene: PromptBlocks['scene']): string {
  const parts: string[] = []
  if (scene.ledgers.length > 0) {
    parts.push(`People here:\n${scene.ledgers.map((l) => `${l.name}: ${l.doc}`).join('\n')}`)
  }
  if (scene.memories.length > 0) {
    parts.push(`What you remember:\n${scene.memories.map(promptText).join('\n')}`)
  }
  if (parts.length === 0) return 'Nothing in particular comes back to you.'
  return parts.join('\n\n')
}
function renderSystem(blocks: PromptBlocks): string {
  // Rules of being + capabilities are static and identical for every agent;
  // identity and personality complete the byte-stable system prefix.
  const roster = renderRoster(blocks.roster ?? [])
  return [
    blocks.rulesOfBeing,
    CAPABILITIES,
    SPEECH_RULES,
    ...(roster.length === 0 ? [] : [roster]),
    renderIdentity(blocks.identity),
    renderPersonality(blocks.personality),
  ].join(BLOCK_DELIM)
}

function estTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function assemblePrompt(blocks: PromptBlocks): AssembledPrompt {
  const system = renderSystem(blocks)
  const journal = renderJournal(blocks.journal)
  const scene = renderScene(blocks.scene)
  const dayLog = blocks.dayLog.join('\n')
  const recalled = blocks.recalled === null ? '' : renderRecall(blocks.recalled)
  const lastOutcome = blocks.lastOutcome ?? ''
  const now = blocks.now.prose
  const heard = blocks.now.heard ?? ''
  const said = renderSaid(blocks.now.said ?? [])
  // Stable before volatile — the book changes only when the mind writes in it, dayLog is
  // append-only, the scene changes every turn — so the byte prefix stays cacheable.
  const underway = blocks.underway == null ? '' : renderUnderway(blocks.underway)
  const ordered = [journal, dayLog, scene, recalled, lastOutcome, now, heard, said, underway]
  const messages = ordered
    .filter((content) => content.length > 0)
    .map((content) => ({ role: 'user' as const, content }))
  const serialized = system + ordered.join('')
  return {
    system,
    messages,
    estTokens: estTokens(serialized),
    needsCompaction: estTokens(dayLog) > DAYLOG_COMPACTION_TOKENS,
  }
}

/** Appends only what the last moment did not already say, and returns the new previous set: a
 *  still scene stops paying for itself twice, and a replay rebuilds the same log. */
export function appendMoment(log: string[], prev: Set<string>, moment: string): Set<string> {
  const sentences = splitSentences(moment)
  const fresh = sentences.filter((s) => !prev.has(s))
  if (fresh.length > 0) log.push(fresh.join(' '))
  return new Set(sentences)
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// The overflow path only: sleep is the real compaction.
export function compactDayLog(dayLog: string[], summary: string): string[] {
  return [`Your mind wanders back over the day: ${summary}`, ...dayLog.slice(-10)]
}
