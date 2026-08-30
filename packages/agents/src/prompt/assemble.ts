// Last of four files, and the only one that renders bytes. A mind's prompt is built by:
//   runtime/bridge.ts        the world -> a PerceptionPacket
//   prompt/prose.ts          the packet -> the prose of block 6
//   runtime/agentRuntime.ts  fills the PromptBlocks below, turn by turn
//   prompt/assemble.ts       renders them into system + messages (here)
import type { PersonalityDoc } from '../personality.js'
import type { ScoredMemory } from '../memory/retrieve.js'
import { CAPABILITIES, SPEECH_RULES } from './rulesOfBeing.js'

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

/** What a deliberate cast back over one's own past brought up, ready to be read next turn. */
export type Recalled = { query: string; memories: string[] }

export type PromptBlocks = {
  rulesOfBeing: string // block 1 — never changes, identical for all agents
  identity: IdentityCore // block 2 — never changes
  personality: { doc: PersonalityDoc; autobiography: string[] } // block 3 — changes at sleep only
  journal: JournalEntry[] // the mind's own book — changes only when it writes in it
  scene: { ledgers: { name: string; doc: string }[]; memories: ScoredMemory[] } // block 4 — per scene
  dayLog: string[] // block 5 — append-only all day
  recalled: Recalled | null // only on the turn after a mind cast its mind back
  // block 6 — every turn. `heard` is another mouth's bytes and rides its own message, so no
  // utterance can ever read as a sentence the narrator wrote.
  now: { prose: string; heard?: string }
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

/** Pages a mind can turn back in one sitting. */
export const JOURNAL_LINES = 5
const JOURNAL_MAX_CHARS = 1200

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

// Rereading one's own book is the physical version of recall: the last few pages in the order
// they were written, oldest dropped first so a long hand cannot flood the page.
function renderJournal(entries: JournalEntry[]): string {
  const lines = entries.slice(-JOURNAL_LINES).map((e) => `Day ${e.day}: ${e.text}`)
  while (lines.length > 1 && lines.join('\n').length > JOURNAL_MAX_CHARS) lines.shift()
  if (lines.length === 0) return ''
  const page = lines.join('\n')
  // A single page longer than the whole budget is cut at a word, and the ellipsis shows the cut.
  const bounded =
    page.length <= JOURNAL_MAX_CHARS
      ? page
      : `${page.slice(0, page.lastIndexOf(' ', JOURNAL_MAX_CHARS))}…`
  return `You turn back the pages of your own book:\n${bounded}`
}

// What the beat spent casting back brought up. Nothing is an answer too, and it is said plainly
// rather than left as silence the mind would read as never having asked.
function renderRecall(recalled: Recalled): string {
  const opening = `You cast your mind back to ${recalled.query}.`
  if (recalled.memories.length === 0) return `${opening} Nothing comes back.`
  return `${opening} What comes back:\n${recalled.memories.join('\n')}`
}

function renderScene(scene: PromptBlocks['scene']): string {
  const parts: string[] = []
  if (scene.ledgers.length > 0) {
    parts.push(`People here:\n${scene.ledgers.map((l) => `${l.name}: ${l.doc}`).join('\n')}`)
  }
  if (scene.memories.length > 0) {
    parts.push(`What you remember:\n${scene.memories.map((m) => m.text).join('\n')}`)
  }
  if (parts.length === 0) return 'Nothing in particular comes back to you.'
  return parts.join('\n\n')
}
function renderSystem(blocks: PromptBlocks): string {
  // Rules of being + capabilities are static and identical for every agent;
  // identity and personality complete the byte-stable system prefix.
  return [
    blocks.rulesOfBeing,
    CAPABILITIES,
    SPEECH_RULES,
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
  const now = blocks.now.prose
  const heard = blocks.now.heard ?? ''
  // One order drives all three readings of the blocks. The book changes only when the mind
  // writes in it, dayLog is append-only all day, and the scene changes every turn: stable
  // before volatile keeps the byte prefix cacheable.
  const ordered = [journal, dayLog, scene, recalled, now, heard]
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

// The overflow path only: sleep is the real compaction.
export function compactDayLog(dayLog: string[], summary: string): string[] {
  return [`Your mind wanders back over the day: ${summary}`, ...dayLog.slice(-10)]
}
