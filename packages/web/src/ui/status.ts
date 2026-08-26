// A person has exactly ONE STATE and zero or more CONDITIONS, and the two vocabularies are DISJOINT
// sets of words, asserted — so a condition can never quietly become a synonym of a state.

/** A structural read of `AgentBody`. An absent optional field simply never matches its row, so every
 *  rule here is correct before the fields it anticipates exist. */
export type AgentView = {
  alive: boolean
  asleep: boolean
  activity: { verb: string } | null
  needs: { hunger: number; energy: number; warmth: number; social: number }
  hp: number
  ill: boolean
  injuries: ReadonlyArray<{ kind: string; day: number }>
  collapsedSinceTick: number | null
  lastSpokeTick?: number
  thirst?: number
}

/**
 * STATE: exactly ONE per person per surface, first match wins in this order. Someone crossing the
 * square mid-conversation is in a conversation, so `talking` precedes `walking` and the array stays
 * the single priority table.
 */
export const STATES = [
  'gone', 'collapsed', 'asleep', 'talking', 'eating', 'working', 'walking', 'idle',
] as const
export type State = (typeof STATES)[number]
export const STATE_PRIORITY: readonly State[] = STATES

export const STATE_WORD: Readonly<Record<State, string>> = {
  gone: 'No longer living',
  collapsed: 'Collapsed',
  asleep: 'Asleep',
  talking: 'Talking',
  eating: 'Eating',
  working: 'Working',        // overridden by the verb's own gerund, which there always is one of
  walking: 'Walking',
  idle: 'Between things',    // NOT "resting", NOT "awake", NOT "idle" — those are the collision
}

/** How long after a word a person still reads as being in the conversation. The gateway's
 *  `TALK_WINDOW_TICKS` is the same idea; P1 keeps the viewer out of the gateway's modules. */
export const TALK_RECENT_TICKS = 20

/** A need at or under this is worth saying out loud. */
export const NEED_LOW = 30

const SPEECH_VERBS: ReadonlySet<string> = new Set(['speak', 'teach'])

/** t7 gerund ruling: drop a trailing 'e', append 'ing'; no other morphology. */
const gerund = (verb: string): string => `${verb.endsWith('e') ? verb.slice(0, -1) : verb}ing`
const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** `nowTick` is optional and only ever ADDS the conversation: with a clock, a person who spoke a
 *  moment ago reads as talking even while they walk. */
export function statusOf(a: AgentView, nowTick?: number): State {
  if (!a.alive) return 'gone'
  if (a.collapsedSinceTick !== null) return 'collapsed'
  if (a.asleep) return 'asleep'
  const verb = a.activity?.verb ?? null
  if (verb !== null && SPEECH_VERBS.has(verb)) return 'talking'
  if (nowTick !== undefined && a.lastSpokeTick !== undefined
    && nowTick - a.lastSpokeTick <= TALK_RECENT_TICKS) return 'talking'
  if (verb === null) return 'idle'
  if (verb === 'eat') return 'eating'
  if (verb === 'walk') return 'walking'
  return 'working'
}

/** The word to print: the verb's own gerund while a person is at work, else `STATE_WORD`. The gerund
 *  is used ONLY for `working`, so a walking talker can never be labelled "Walking". */
export function stateWord(a: AgentView, nowTick?: number): string {
  const s = statusOf(a, nowTick)
  if (s === 'working' && a.activity !== null) return sentenceCase(gerund(a.activity.verb))
  return STATE_WORD[s]
}

/** CONDITION: zero or more, from a DISJOINT vocabulary. A condition is never a state, so it
 *  can never duplicate one. */
export const CONDITIONS = ['unwell', 'hurt', 'hungry', 'cold', 'thirsty', 'spent'] as const
export type Condition = (typeof CONDITIONS)[number]

export const CONDITION_WORD: Readonly<Record<Condition, string>> = {
  unwell: 'Unwell', hurt: 'Hurt', hungry: 'Hungry',
  cold: 'Cold', thirsty: 'Thirsty', spent: 'Worn out',
}

const CONDITION_TEST: Readonly<Record<Condition, (a: AgentView) => boolean>> = {
  unwell: (a) => a.ill,
  hurt: (a) => a.injuries.length > 0,
  hungry: (a) => a.needs.hunger < NEED_LOW,
  cold: (a) => a.needs.warmth < NEED_LOW,
  thirsty: (a) => a.thirst !== undefined && a.thirst < NEED_LOW,
  spent: (a) => a.needs.energy < NEED_LOW,
}

export function conditionsOf(a: AgentView): Condition[] {
  return CONDITIONS.filter((c) => CONDITION_TEST[c](a))
}

/** DRIVE (P22 hook): what a person seems to WANT, once the society lane emits it. Empty today,
 *  and an empty set renders nothing at all — never a placeholder chip. */
export const DRIVES = [] as const
export type Drive = string
export function drivesOf(_a: AgentView): Drive[] {
  return []
}

// ── P17's mechanical guard ─────────────────────────────────────────────────────────────────

/** Any of these appearing as a PRINTED literal outside this module is the synonym bug coming
 *  back. */
export const BANNED_STATUS_LITERALS: readonly string[] =
  ['resting', 'Resting', 'awake', 'Awake', 'idle', 'Idle', 'at rest', 'sleeping', 'Sleeping']

/** The ids the code must keep, named rather than silently skipped. `idle` is a `State` id, an
 *  animation row and the player's stopped state; none is printed, and `Idle` is still banned. */
export const MACHINE_STATUS_IDS: readonly string[] = ['idle']

/** The two places a word can be printed from: a quoted string, and JSX text. Comments are
 *  stripped first, because a comment is not copy. */
const QUOTED = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g
const JSX_TEXT = />([^<>{}\n]*)</g
/** JSX text is `>…<`, and so is `a > b && c < d`. A run with code punctuation in it is code. */
const CODEY = /[=;()[\]:]/
const LINE_COMMENT = /\/\/[^\n]*/g
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g

/** Every viewer file that prints a banned status word. One entry per file, in the order given. */
export function statusLiteralOffenders(
  files: ReadonlyArray<{ path: string; source: string }>,
): string[] {
  const banned = BANNED_STATUS_LITERALS.filter((w) => !MACHINE_STATUS_IDS.includes(w))
  // whole words only, so `idle-se` and `sleeping_bag` are identifiers and not copy
  const patterns = banned.map((w) => new RegExp(`(?<![\\w-])${w}(?![\\w-])`))
  const out: string[] = []
  for (const f of files) {
    if (f.path.endsWith('status.ts')) continue    // the one module allowed to name them
    const stripped = f.source.replace(BLOCK_COMMENT, ' ').replace(LINE_COMMENT, ' ')
    const printed: string[] = []
    for (const m of stripped.matchAll(QUOTED)) printed.push(m[1] ?? m[2] ?? m[3] ?? '')
    for (const m of stripped.matchAll(JSX_TEXT)) {
      const text = m[1] ?? ''
      if (text.trim() !== '' && !CODEY.test(text)) printed.push(text)
    }
    if (printed.some((t) => patterns.some((p) => p.test(t)))) out.push(f.path)
  }
  return out
}
