import type { PersonalityDoc } from '../personality.js'
import type { ScoredMemory } from '../memory/retrieve.js'

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
  }
}

export type PromptBlocks = {
  rulesOfBeing: string // block 1 — never changes, identical for all agents
  identity: IdentityCore // block 2 — never changes
  personality: { doc: PersonalityDoc; autobiography: string[] } // block 3 — changes at sleep only
  scene: { ledgers: Array<{ name: string; doc: string }>; memories: ScoredMemory[] } // block 4 — per scene
  dayLog: string[] // block 5 — append-only all day
  now: { prose: string } // block 6 — every turn
}

export type AssembledPrompt = {
  system: string // blocks 1+2+3, fixed delimiters
  messages: Array<{ role: 'user'; content: string }> // [scene, dayLog.join('\n'), now]
  estTokens: number // ceil(totalChars/4)
  needsCompaction: boolean // est(dayLog) > 6000 tokens
}

// The delimiter between the three system blocks. Byte-stable so that blocks
// 1–3 form an unbroken cache prefix until sleep rewrites block 3.
const BLOCK_DELIM = '\n\n---\n\n'

export const DAYLOG_COMPACTION_TOKENS = 6000

function renderIdentity(id: IdentityCore): string {
  const v = id.voiceCard
  return [
    `Name: ${id.name}`,
    `Age: ${id.age}`,
    `Temperament: ${id.temperament}`,
    `Backstory: ${id.backstory}`,
    `Voice: ${v.register} — ${v.rhythm}`,
    `Tics: ${v.tics.join('; ')}`,
    `Never says: ${v.neverSays.join('; ')}`,
    `Example lines: ${v.exampleLines.join(' | ')}`,
  ].join('\n')
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
  return parts.join('\n\n')
}

function renderSystem(blocks: PromptBlocks): string {
  return [blocks.rulesOfBeing, renderIdentity(blocks.identity), renderPersonality(blocks.personality)].join(
    BLOCK_DELIM,
  )
}

function estTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function assemblePrompt(blocks: PromptBlocks): AssembledPrompt {
  const system = renderSystem(blocks)
  const scene = renderScene(blocks.scene)
  const dayLog = blocks.dayLog.join('\n')
  const now = blocks.now.prose
  const messages: Array<{ role: 'user'; content: string }> = [
    { role: 'user', content: scene },
    { role: 'user', content: dayLog },
    { role: 'user', content: now },
  ]
  const totalChars = system.length + scene.length + dayLog.length + now.length
  return {
    system,
    messages,
    estTokens: estTokens(`${system}${scene}${dayLog}${now}`),
    needsCompaction: estTokens(dayLog) > DAYLOG_COMPACTION_TOKENS,
  }
}

// Emergency mid-day summarize: the day's log collapses to one wandering line
// plus its ten most recent entries. Sleep is the real compaction; this is the
// overflow path.
export function compactDayLog(dayLog: string[], summary: string): string[] {
  return [`Your mind wanders back over the day: ${summary}`, ...dayLog.slice(-10)]
}
