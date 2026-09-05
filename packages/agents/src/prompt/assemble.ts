// Last stage of bridge -> prose -> agentRuntime -> assemble, and the only one that renders bytes.
import { ownSkillWords, sanitizeSpokenText, type RosterEntry } from '@sj/shared'
import { LAWS_SHOWN, LAW_TEXT_MAX } from '@sj/engine'
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
  // Xp by track, read fresh each turn and rendered in buckets: hands that have done nothing
  // render nothing, and a bucket turns over a few times a life, so the block stays cached.
  skills?: Record<string, number>
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
  // What the town has named, on the same terms and beside it: shared by every mind, and rewritten
  // only on the day somebody gives a habit a word.
  customs?: readonly string[]
  habits?: readonly string[]
  // What the town has agreed and holds each other to, in the words somebody actually said.
  // Texts alone: a rule has an id and a number, and a mind may hear neither.
  laws?: readonly string[]
  tabled?: readonly string[]
  frontier?: readonly string[]
  identity: IdentityCore // block 2 — never changes
  personality: { doc: PersonalityDoc; autobiography: string[] } // block 3 — changes at sleep only
  journal: JournalEntry[] // the mind's own book — changes only when it writes in it
  // block 4 — per scene. `knownFor` is what this face's hands have done, in the same buckets
  // the mind reads its own in; absent on hands the town would not remark on.
  scene: {
    ledgers: { name: string; doc: string; knownFor?: string }[]
    memories: ScoredMemory[]
  }
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
  needsCompaction: boolean // est(dayLog) > DAYLOG_COMPACTION_TOKENS
  // What each rendered block cost, and no entry for one it skipped. Same estimator as
  // `estTokens`, so the entries sum to it bar the delimiters and per-block rounding.
  blockTokens: Record<string, number>
}

// Byte-stable, so blocks 1-3 form an unbroken cache prefix until sleep rewrites block 3.
const BLOCK_DELIM = '\n\n---\n\n'

// 2,500 and not 6,000: over r13 the day log was already 27.6% of the turn prompt and 48% of
// its fresh-input dollars at a p90 of 3,348 tokens, which the old bound never reached.
const DAYLOG_COMPACTION_TOKENS = 2500

export const JOURNAL_LINES = 5
const JOURNAL_MAX_CHARS = 1200

/** Four, the same window the scene path keeps of a mind's own last lines. Two could not show a
 *  rut four turns wide, and a page of them is the mind talking to itself instead of to the town. */
export const OWN_WORDS_SHOWN = 4

function renderIdentity(id: IdentityCore): string {
  const v = id.voiceCard
  const hands = ownSkillWords(id.skills ?? {})
  const lines = [
    `Name: ${id.name}`,
    `Age: ${id.age}`,
    `Temperament: ${id.temperament}`,
    `Backstory: ${id.backstory}`,
    ...(hands.length === 0 ? [] : [`Your hands: ${hands.join('; ')}.`]),
    `Voice: ${v.register} ${v.rhythm}`,
    `Habits: ${v.tics.join('; ')}`,
    `Never says: ${v.neverSays.join('; ')}`,
    `Example lines, to show the voice and not to be reused word for word: ${v.exampleLines.join(' | ')}`,
  ]
  if (v.wordBudget) {
    lines.push(
      `You usually say about ${v.wordBudget.typical} words at a time; when it really matters to you, up to ${v.wordBudget.burst}.`,
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
  return `What you have written in your own book:\n${bounded}`
}

// Nothing is said plainly: silence would read to the mind as never having asked.
function renderRecall(recalled: Recalled): string {
  const opening = `You think back to ${recalled.query}.`
  if (recalled.memories.length === 0) return `${opening} Nothing comes back.`
  return `${opening} What comes back:\n${recalled.memories.join('\n')}`
}

// Said in the mind's own words for the act, and honest about the cost of breaking off: naming
// an action drops what is left of the plan.
function renderUnderway(u: Underway): string {
  const step = u.of > 1 ? ` (step ${u.step} of ${u.of})` : ''
  return (
    `You are in the middle of: ${u.what}${step}. You keep at it without thinking about it.\n` +
    'Answer wait and it carries on. Name another act and you stop, and whatever is left of it is dropped.'
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

function ledgerLine(l: PromptBlocks['scene']['ledgers'][number]): string {
  const who = l.knownFor === undefined ? l.name : `${l.name}, who ${l.knownFor}`
  return l.doc.length === 0 ? `${who}.` : `${who}: ${l.doc}`
}

function renderScene(scene: PromptBlocks['scene']): string {
  const parts: string[] = []
  if (scene.ledgers.length > 0) {
    parts.push(`People here:\n${scene.ledgers.map(ledgerLine).join('\n')}`)
  }
  if (scene.memories.length > 0) {
    parts.push(`What you remember:\n${scene.memories.map(promptText).join('\n')}`)
  }
  if (parts.length === 0) return 'Nothing in particular comes back to you.'
  return parts.join('\n\n')
}
// A habit the town has words for, and only the words: what kind of thing it is belongs to the
// recognizer, and a mind may never hear that.
// The court has always been handed this list and no mind ever was, so a mind could only reach
// past the verb list by guessing a name blind. Said as a thing somebody might do, not as a tree.
function renderFrontier(names: readonly string[]): string {
  if (names.length === 0) return ''
  const said = names.map((n) => n.charAt(0).toLowerCase() + n.slice(1))
  const head = said.slice(0, -1).join(', ')
  const tail = said.slice(-1).join('')
  return (
    'Nobody here has done any of these, and each one builds on something the town already ' +
    `does, so somebody could be the first: ${head === '' ? tail : `${head} and ${tail}`}. ` +
    'Say what you want to do in your own words and try it.'
  )
}

function renderLaws(texts: readonly string[], tabled: readonly string[]): string {
  const said = texts.slice(-LAWS_SHOWN).map((t) => `"${t.slice(0, LAW_TEXT_MAX)}"`)
  const agreed =
    said.length === 0 ? [] : ['The town has agreed on these and holds each other to them:', ...said]
  const waiting = tabled.length === 0 ? [] : ['Waiting for a vote:', ...tabled]
  return [...agreed, ...waiting].join('\n')
}

function renderCustoms(names: readonly string[], habits: readonly string[]): string {
  const lines: string[] = []
  if (names.length > 0) {
    const said = names.map((n) => `the ${n}`)
    const head = said.slice(0, -1).join(', ')
    const tail = said.slice(-1).join('')
    lines.push(`The town has taken to ${head === '' ? tail : `${head} and ${tail}`}.`)
  }
  if (habits.length > 0) lines.push(...habits)
  return lines.join('\n')
}

// Rules of being + capabilities are static and identical for every agent, and the cache keeps
// them as one unit: nothing per-mind may ever go in front of this.
function renderShared(rulesOfBeing: string): string {
  return [rulesOfBeing, CAPABILITIES, SPEECH_RULES].join(BLOCK_DELIM)
}

function estTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function assemblePrompt(blocks: PromptBlocks): AssembledPrompt {
  const shared = renderShared(blocks.rulesOfBeing)
  const roster = renderRoster(blocks.roster ?? [])
  const customs = renderCustoms(blocks.customs ?? [], blocks.habits ?? [])
  const laws = renderLaws(blocks.laws ?? [], blocks.tabled ?? [])
  const frontier = renderFrontier(blocks.frontier ?? [])
  const identity = renderIdentity(blocks.identity)
  const personality = renderPersonality(blocks.personality)
  const system = [
    shared,
    ...(roster.length === 0 ? [] : [roster]),
    ...(customs.length === 0 ? [] : [customs]),
    ...(laws.length === 0 ? [] : [laws]),
    ...(frontier.length === 0 ? [] : [frontier]),
    identity,
    personality,
  ].join(BLOCK_DELIM)
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
  const named: [string, string][] = [
    ['shared', shared],
    ['roster', roster],
    ['customs', customs],
    ['laws', laws],
    ['frontier', frontier],
    ['identity', identity],
    ['personality', personality],
    ['journal', journal],
    ['dayLog', dayLog],
    ['scene', scene],
    ['recalled', recalled],
    ['lastOutcome', lastOutcome],
    ['now', now],
    ['heard', heard],
    ['said', said],
    ['underway', underway],
  ]
  const blockTokens: Record<string, number> = {}
  for (const [name, text] of named) if (text.length > 0) blockTokens[name] = estTokens(text)
  return {
    system,
    messages,
    estTokens: estTokens(serialized),
    needsCompaction: estTokens(dayLog) > DAYLOG_COMPACTION_TOKENS,
    blockTokens,
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
  return [`Looking back over the day: ${summary}`, ...dayLog.slice(-10)]
}
