import { z } from 'zod'
import {
  INVITATION_VERBS,
  STAKES_BY_KIND,
  stateHash,
  type InvitationVerb,
  type SceneKind,
  SCENE_MOVES,
  type SceneMove,
} from '@sj/shared'
import type { LawPredicate } from '@sj/engine'
import type { Tie } from '../memory/ties.js'

/** What a line is doing: the shared list, so the log always holds what a mind may say. */
export type Move = SceneMove
const MOVES = SCENE_MOVES

/** Where one mind stands on a rule somebody put to the room. */
export type Stance = 'for' | 'against' | 'unsure'

export type SceneLine = {
  agentId: string
  text: string
  aside: string
  move: Move
  tick: number
  /** A body arriving or going, carried in the thread so the roster above it never has to be
   *  rewritten. Empty text: nothing was said. */
  presence?: 'joined' | 'left'
}

export type Scene = {
  id: string
  kind: SceneKind
  openedTick: number
  lastLineTick: number
  /** The minds that engaged. Everyone else who can hear is `audience`. */
  participants: string[]
  /** In earshot and not in the talk. They keep taking ordinary turns, pay for nothing, and hear
   *  the summary when it closes. */
  audience: string[]
  /** Whoever opened it. The floor comes back here on a pass, and their own pass ends it. */
  anchor: string
  floor: string | null
  thread: SceneLine[]
  topic: string | null
  stakes: number
  /** A rule put to the room, whoever put it, and where each of the others came down on it.
   *  The predicate is empty until the court reads the words at the close. */
  proposal?: {
    lawText: string
    proposedBy: string
    stances: Record<string, Stance>
    predicate: LawPredicate
    /** Set when this talk is the vote on a rule an earlier council tabled. */
    tabledId?: string
  }
  invitation?: { verb: InvitationVerb; from: string; to: string; askedTick: number }
  /** Whoever in this talk the town is meeting for the first time. Absent in every talk between
   *  people who already know each other, which is nearly all of them. */
  stranger?: string
  passes: number
  timeouts: number
  closedTick: number | null
  closeReason?: 'ended' | 'left' | 'capped' | 'timeout'
}

export const SceneTurnSchema = z
  .object({
    thought: z.string(),
    speech: z.string().nullable(),
    /** Who the line is for, by name, out of the roster the prompt hands over. Null speaks to
     *  the room and lets the anchor answer. */
    to: z.string().nullable(),
    gesture: z.string().nullable(),
    move: z.enum(MOVES),
    stance: z.enum(['for', 'against', 'unsure']).nullable(),
    answer: z.enum(['accept', 'refuse']).nullable(),
    /** An invitation this line puts to whoever it is aimed at. Null in every ordinary line. */
    ask: z.enum(INVITATION_VERBS).nullable(),
    leave: z.boolean(),
    importance: z.number().int().min(1).max(10),
  })
  .strict()
export type SceneTurn = z.infer<typeof SceneTurnSchema>

/** The thread as one mind sees it: its own asides, and nobody else's. */
export type SceneAsk = {
  scene: Scene
  agentId: string
  cast: { id: string; name: string }[]
  /** In earshot, not in the talk. Named to the floor-holder so a line can pull one of them in. */
  audience: { id: string; name: string }[]
  ties: Tie[]
  thread: SceneLine[]
  /** Two lines short of the cap and after: say the thing you came to say, the scene is ending. */
  wrapUp: boolean
  /** The tick this line is said on. The mind is told the hour it reads to, because nothing
   *  closes a talk for being late any more. */
  tick: number
  /** What this body has left in it, 0–100. Said as weariness, never as a number. */
  energy: number
  /** The last few things this mind said anywhere, newest last, so it does not say them again. */
  recent: readonly string[]
}

export const TIE_KINDS = [
  'promise',
  'debt',
  'slight',
  'grudge',
  'attraction',
  'secret',
  'alliance',
  'kin',
] as const
export type TieKind = (typeof TIE_KINDS)[number]

export type TieDelta = {
  agentId: string
  personId: string
  kind: TieKind
  text: string
  settled?: true
}

export type SceneCloseAsk = { scene: Scene; cast: { id: string; name: string }[] }
export type SceneClose = { summary: string; deltas: TieDelta[] }

/** The one call a scene makes per line, and the one it makes at the end. Task 8b writes the
 *  prompts behind it; nothing here knows what a prompt looks like. */
export type SceneLlm = {
  line(ask: SceneAsk): Promise<SceneTurn>
  close(ask: SceneCloseAsk): Promise<SceneClose>
}

/** A talk needs somebody to answer. The opener and the tick sweep count to the same number, so
 *  no scene can open under a rule the same tick would close it under. */
export const TALKERS_NEEDED = 2
/** How long a talk runs, in lines: twelve for the pair `TALKERS_NEEDED` asks for, four more for
 *  every mind past that, and forty-eight however big it gets. */
export function lineCapFor(talkers: number): number {
  return Math.min(48, Math.max(12, 4 * talkers))
}
// Two lines short of the cap is where the floor-holder is told to land it.
const WRAP_CUE_BEFORE_CAP = 2
/** Two silent floors close a scene the provider stopped answering for. */
export const CLOSING_TIMEOUTS = 2
/** Wall clock, not ticks: a mind that never answers is a provider stall, not a slow hour. Above
 *  the scene caller's own 40 s bound, or the floor moves on while the line is still coming. */
export const FLOOR_TIMEOUT_MS = 45_000

/** Stable across a snapshot and a restore, because it is derived from the two things that do
 *  not change: when the scene opened and who was in it. */
export function sceneId(openedTick: number, participants: readonly string[]): string {
  return `scene_${openedTick}_${stateHash([...participants].sort().join(',')).slice(0, 8)}`
}

export function openScene(opts: {
  openedTick: number
  participants: readonly string[]
  audience?: readonly string[]
  opener: string
  topic: string | null
  stakes: number
}): Scene {
  const participants = [...new Set(opts.participants)].sort()
  return {
    id: sceneId(opts.openedTick, participants),
    kind: 'talk',
    openedTick: opts.openedTick,
    lastLineTick: opts.openedTick,
    participants,
    audience: [...new Set(opts.audience ?? [])].filter((id) => !participants.includes(id)).sort(),
    anchor: opts.opener,
    floor: opts.opener,
    thread: [],
    topic: opts.topic,
    stakes: opts.stakes,
    passes: 0,
    timeouts: 0,
    closedTick: null,
  }
}

const firstNameOf = (name: string): string => name.split(/\s+/)[0] ?? name

const RE_META = /[.*+?^${}()|[\]\\]/g

/** Where a name is spoken AS AN ADDRESS, or -1. The name has to open the line or stand behind a
 *  comma, and be closed by punctuation: "Yusuf, is that true?" is a question put to him,
 *  "Yusuf said so" is a remark about him and hands him nothing. */
function addressedAt(text: string, name: string): number {
  const bare = firstNameOf(name)
  if (bare.length === 0) return -1
  const re = new RegExp(
    `(?:^|[,;:—–-])\\s*${bare.replace(RE_META, '\\$&')}\\s*(?:[,;:?!.…—–-]|$)`,
    'iu',
  )
  return text.search(re)
}

/** Whether a name is spoken in a line at all, addressed or only talked about. Whole word, so
 *  "Sal" is not "Salma". What a quarrel is named by; the floor asks the stricter question. */
function mentions(text: string, name: string): boolean {
  const bare = firstNameOf(name)
  if (bare.length === 0) return false
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${bare.replace(RE_META, '\\$&')}(?![\\p{L}\\p{N}])`,
    'iu',
  )
  return re.test(text)
}

/** Whoever this line was addressed to, out of these, earliest first. */
export function addressedIn(
  text: string,
  ids: readonly string[],
  nameOf: (id: string) => string | null,
): string | null {
  const hits = ids
    .map((id) => ({ id, at: addressedAt(text, nameOf(id) ?? '') }))
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  return hits[0]?.id ?? null
}

/** The name a mind wrote in `to`, back to an id. It is handed the roster to choose from, so a
 *  name that is not on it is a miss and the floor falls through to the anchor. */
export function idNamed(
  to: string,
  ids: readonly string[],
  nameOf: (id: string) => string | null,
): string | null {
  const wanted = to.trim().toLowerCase()
  if (wanted.length === 0) return null
  for (const id of ids) {
    const name = nameOf(id) ?? ''
    if (id.toLowerCase() === wanted) return id
    if (name.toLowerCase() === wanted || firstNameOf(name).toLowerCase() === wanted) return id
  }
  return null
}

/** After a line the floor goes to whoever it was for: the mind named in `to`, else the one the
 *  words addressed, else back to the anchor. An audience name is a legal answer to both — that
 *  is how a bystander is drawn into the talk. The last resort is warmth, ties by id, so two
 *  equal claims never decide it differently twice. */
export function nextFloor(
  scene: Scene,
  speakerId: string,
  text: string,
  to: string | null,
  nameOf: (id: string) => string | null,
  warmth: (id: string) => number,
): string | null {
  const candidates = [...scene.participants, ...scene.audience].filter((id) => id !== speakerId)
  if (candidates.length === 0) return null
  const asked = to === null ? null : idNamed(to, candidates, nameOf)
  if (asked !== null) return asked
  const addressed = addressedIn(text, candidates, nameOf)
  if (addressed !== null) return addressed
  if (scene.anchor !== speakerId && scene.participants.includes(scene.anchor)) return scene.anchor
  const others = scene.participants.filter((id) => id !== speakerId)
  if (others.length === 0) return null
  return others
    .map((id) => ({ id, warm: warmth(id) }))
    .sort((a, b) => b.warm - a.warm || a.id.localeCompare(b.id))[0]!.id
}

// What a person sounds like putting a rule to a room, and what they sound like letting one go.
// Loose on purpose: a false proposal costs a talk that ends with nobody agreeing anything, and
// the tally, the six-a-day cap and the repeal path are all downstream of it.
const PROPOSAL_PATTERNS = [
  /from now on/i,
  /from this day/i,
  /let us agree/i,
  /the rule is/i,
  /new rule/i,
  /nobody (?:may|shall|is to)/i,
  /no longer (?:ours|holds|stands)|the rule no longer/i,
  /let go of the rule/i,
]

export const proposesALaw = (text: string): boolean => PROPOSAL_PATTERNS.some((p) => p.test(text))

/** The id the rule this scene passes will carry. Derived from the scene's own id, which is
 *  derived from the opening tick and the cast, so one council can never ratify twice. */
export const lawIdOf = (scene: Scene): string => scene.id.replace(/^scene_/, 'law_')

export type CouncilTally = { for: string[]; against: string[]; unsure: string[]; passed: boolean }

/** Where the room came down. The one who put it counts for it; silence is not opposition, so a
 *  majority is of whoever took a side — but a rule said to a departing back passes nothing, so
 *  somebody other than the proposer has to have answered at all. */
export function tallyCouncil(scene: Scene): CouncilTally {
  const proposal = scene.proposal
  if (proposal === undefined) return { for: [], against: [], unsure: [], passed: false }
  const voters = Object.keys(proposal.stances)
    .filter((id) => id !== proposal.proposedBy)
    .sort()
  const heldBy = (stance: Stance): string[] =>
    voters.filter((id) => proposal.stances[id] === stance)
  const forIt = [proposal.proposedBy, ...heldBy('for')]
  const against = heldBy('against')
  return {
    for: forIt,
    against,
    unsure: heldBy('unsure'),
    passed: voters.length > 0 && forIt.length > against.length,
  }
}

/** Everyone still in the talk but the one who put the rule has said where they stand, so there
 *  is nothing left for the talk to settle. */
export function councilDecided(scene: Scene): boolean {
  const proposal = scene.proposal
  if (proposal === undefined) return false
  const others = scene.participants.filter((id) => id !== proposal.proposedBy)
  return others.length > 0 && others.every((id) => proposal.stances[id] !== undefined)
}

const QUARREL_TIE_KINDS: readonly TieKind[] = ['grudge', 'slight']

/** A line names an open grudge or slight when the person that tie is about is named in it. The
 *  loose match, not `addressedAt`: a quarrel is named by talking ABOUT somebody. */
function namesAQuarrel(
  scene: Scene,
  text: string,
  tiesOf: (agentId: string) => readonly Tie[],
  nameOf: (id: string) => string | null,
): boolean {
  for (const holder of scene.participants) {
    for (const tie of tiesOf(holder)) {
      if (tie.settledTick !== null) continue
      if (!QUARREL_TIE_KINDS.includes(tie.kind)) continue
      if (!scene.participants.includes(tie.personId)) continue
      if (mentions(text, nameOf(tie.personId) ?? '')) return true
    }
  }
  return false
}

/** An open slight or grudge standing between two people who are BOTH in this talk, whether or
 *  not anybody has said so out loud. What makes a scene of the same kind worth one more. */
export function openQuarrelTie(scene: Scene, tiesOf: (agentId: string) => readonly Tie[]): boolean {
  for (const holder of scene.participants) {
    for (const tie of tiesOf(holder)) {
      if (tie.settledTick !== null) continue
      if (!QUARREL_TIE_KINDS.includes(tie.kind)) continue
      if (scene.participants.includes(tie.personId)) return true
    }
  }
  return false
}

/** What this scene is worth to the people in it, 0-10. Never falls: a talk that became a
 *  quarrel and cooled again is still a talk that had a quarrel in it. */
export function stakesFor(current: number, kind: SceneKind, quarrelTie: boolean): number {
  return Math.min(10, Math.max(current, STAKES_BY_KIND[kind]) + (quarrelTie ? 1 : 0))
}

/** A rule needs a room. Two people saying "from now on" to each other have made a promise,
 *  and a promise between two is not the town agreeing to anything. */
const COUNCIL_MINIMUM = 3

/** Whether enough people are in and around this talk for it to decide anything for the town. */
export const roomForACouncil = (scene: Scene): boolean =>
  scene.participants.length + scene.audience.length >= COUNCIL_MINIMUM

/** The kind this scene has become, given the line just said. Evaluated on open and on every
 *  line; a scene only ever moves off `talk`. */
export function upgradedKind(
  scene: Scene,
  text: string,
  ctx: {
    tiesOf: (agentId: string) => readonly Tie[]
    nameOf: (id: string) => string | null
    gathering: boolean
  },
): SceneKind {
  if (namesAQuarrel(scene, text, ctx.tiesOf, ctx.nameOf)) return 'quarrel'
  if (proposesALaw(text) && scene.participants.length + scene.audience.length >= COUNCIL_MINIMUM)
    return 'council'
  if (ctx.gathering) return 'gathering'
  return scene.kind
}

/** The last lines as this mind holds them: its own asides stay, everyone else's are its own
 *  business. Without this a mind cannot read what it was thinking two lines ago. */
export function threadFor(scene: Scene, agentId: string): SceneLine[] {
  return scene.thread.map((l) => (l.agentId === agentId ? l : { ...l, aside: '' }))
}

/** How long this scene may run, read off the cast it has now. */
export const lineCapOf = (scene: Scene): number => lineCapFor(scene.participants.length)

export const wrapUpDue = (scene: Scene): boolean =>
  scene.thread.length + 1 >= lineCapOf(scene) - WRAP_CUE_BEFORE_CAP

export function appendLine(scene: Scene, line: SceneLine): void {
  scene.thread.push(line)
  if (scene.thread.length > lineCapOf(scene)) scene.thread.shift()
  scene.lastLineTick = line.tick
}
