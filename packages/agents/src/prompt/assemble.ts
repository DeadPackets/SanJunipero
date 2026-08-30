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

export type PromptBlocks = {
  rulesOfBeing: string // block 1 — never changes, identical for all agents
  identity: IdentityCore // block 2 — never changes
  personality: { doc: PersonalityDoc; autobiography: string[] } // block 3 — changes at sleep only
  scene: { ledgers: { name: string; doc: string }[]; memories: ScoredMemory[] } // block 4 — per scene
  dayLog: string[] // block 5 — append-only all day
  // block 6 — every turn. `heard` is another mouth's bytes and rides its own message, so no
  // utterance can ever read as a sentence the narrator wrote.
  now: { prose: string; heard?: string }
}

export type AssembledPrompt = {
  system: string // blocks 1+2+3, fixed delimiters
  messages: { role: 'user'; content: string }[] // stable→volatile: [dayLog.join('\n'), scene, now]
  estTokens: number // ceil(totalChars/4)
  needsCompaction: boolean // est(dayLog) > 6000 tokens
}

// Byte-stable, so blocks 1-3 form an unbroken cache prefix until sleep rewrites block 3.
const BLOCK_DELIM = '\n\n---\n\n'

const DAYLOG_COMPACTION_TOKENS = 6000

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
  const scene = renderScene(blocks.scene)
  const dayLog = blocks.dayLog.join('\n')
  const now = blocks.now.prose
  const heard = blocks.now.heard ?? ''
  // dayLog is append-only all day; the scene changes every turn. Stable
  // before volatile keeps the byte prefix cacheable across turns.
  const messages: { role: 'user'; content: string }[] = [
    { role: 'user', content: dayLog },
    { role: 'user', content: scene },
    { role: 'user', content: now },
  ]
  if (heard.length > 0) messages.push({ role: 'user', content: heard })
  const serialized = `${system}${dayLog}${scene}${now}${heard}`
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
