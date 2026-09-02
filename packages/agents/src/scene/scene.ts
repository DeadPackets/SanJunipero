import { z } from 'zod'
import { stateHash, type SceneKind } from '@sj/shared'
import type { Tie } from '../memory/ties.js'

export type Move = 'press' | 'give_way' | 'deflect' | 'tease' | 'none'

// Task 13 compiles a law into the engine's own predicate; until it exists the only shape a
// proposal can carry is the empty one.
type LawPredicate = { kind: 'none' }

export type SceneLine = {
  agentId: string
  text: string
  aside: string
  move: Move
  tick: number
}

export type Scene = {
  id: string
  kind: SceneKind
  openedTick: number
  lastLineTick: number
  participants: string[]
  floor: string | null
  thread: SceneLine[]
  topic: string | null
  stakes: number
  proposal?: { lawText: string; predicate: LawPredicate }
  invitation?: { verb: 'court' | 'propose' | 'lie_with'; from: string; to: string }
  passes: number
  closedTick: number | null
  closeReason?: 'ended' | 'left' | 'night' | 'capped' | 'timeout'
}

export const SceneTurnSchema = z
  .object({
    thought: z.string(),
    speech: z.string().nullable(),
    gesture: z.string().nullable(),
    move: z.enum(['press', 'give_way', 'deflect', 'tease', 'none']),
    stance: z.enum(['for', 'against', 'unsure']).nullable(),
    answer: z.enum(['accept', 'refuse']).nullable(),
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
  ties: Tie[]
  thread: SceneLine[]
  /** The tenth line and after: say the thing you came to say, the scene is ending. */
  wrapUp: boolean
  /** The tick this line is said on. The mind is told the hour it reads to, because nothing
   *  closes a talk for being late any more. */
  tick: number
  /** What this body has left in it, 0–100. Said as weariness, never as a number. */
  energy: number
}

export type TieKind =
  | 'promise'
  | 'debt'
  | 'slight'
  | 'grudge'
  | 'attraction'
  | 'secret'
  | 'alliance'
  | 'kin'

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

// Twelve lines is the cap, so twelve is also every line the thread ever holds; the tenth is
// where the floor-holder is told to land it.
export const LINE_CAP = 12
export const WRAP_CUE_LINE = 10
export const CLOSING_PASSES = 2
/** A talk needs somebody to answer. The opener and the tick sweep count to the same number, so
 *  no scene can open under a rule the same tick would close it under. */
export const TALKERS_NEEDED = 2
/** Wall clock, not ticks: a mind that never answers is a provider stall, not a slow hour. */
export const FLOOR_TIMEOUT_MS = 30_000

/** Stable across a snapshot and a restore, because it is derived from the two things that do
 *  not change: when the scene opened and who was in it. */
export function sceneId(openedTick: number, participants: readonly string[]): string {
  return `scene_${openedTick}_${stateHash([...participants].sort().join(',')).slice(0, 8)}`
}

export function openScene(opts: {
  openedTick: number
  participants: readonly string[]
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
    floor: opts.opener,
    thread: [],
    topic: opts.topic,
    stakes: opts.stakes,
    passes: 0,
    closedTick: null,
  }
}

const firstNameOf = (name: string): string => name.split(/\s+/)[0] ?? name

const RE_META = /[.*+?^${}()|[\]\\]/g

/** Where a name is spoken in a line, or -1. Whole word, so "Sal" is not "Salma". */
function namedAt(text: string, name: string): number {
  const bare = firstNameOf(name)
  if (bare.length === 0) return -1
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${bare.replace(RE_META, '\\$&')}(?![\\p{L}\\p{N}])`,
    'iu',
  )
  return text.search(re)
}

/** After a line the floor goes to whoever it named, else to whoever has said least, ties by
 *  warmth and then by id so two equal claims never decide it differently twice. */
export function nextFloor(
  scene: Scene,
  speakerId: string,
  text: string,
  nameOf: (id: string) => string | null,
  warmth: (id: string) => number,
): string | null {
  const others = scene.participants.filter((id) => id !== speakerId)
  if (others.length === 0) return null
  const named = others
    .map((id) => ({ id, at: namedAt(text, nameOf(id) ?? '') }))
    .filter((c) => c.at >= 0)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  if (named.length > 0) return named[0]!.id
  const spoken = (id: string): number => scene.thread.filter((l) => l.agentId === id).length
  const ranked = others
    .map((id) => ({ id, said: spoken(id), warm: warmth(id) }))
    .sort((a, b) => a.said - b.said || b.warm - a.warm || a.id.localeCompare(b.id))
  return ranked[0]!.id
}

const PROPOSAL_PATTERNS = [/from now on/i, /call it/i, /we should all/i, /new rule/i]

export const proposesALaw = (text: string): boolean => PROPOSAL_PATTERNS.some((p) => p.test(text))

const QUARREL_TIE_KINDS: readonly TieKind[] = ['grudge', 'slight']

/** A line names an open grudge or slight when the person that tie is about is named in it.
 *  Ties do not exist until Task 11, so `tiesOf` answers `[]` and this is false everywhere. */
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
      if (namedAt(text, nameOf(tie.personId) ?? '') >= 0) return true
    }
  }
  return false
}

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
  if (proposesALaw(text)) return 'council'
  if (ctx.gathering) return 'gathering'
  return scene.kind
}

/** The last lines as this mind holds them: its own asides stay, everyone else's are its own
 *  business. Without this a mind cannot read what it was thinking two lines ago. */
export function threadFor(scene: Scene, agentId: string): SceneLine[] {
  return scene.thread.map((l) => (l.agentId === agentId ? l : { ...l, aside: '' }))
}

export const wrapUpDue = (scene: Scene): boolean => scene.thread.length >= WRAP_CUE_LINE - 1

export function appendLine(scene: Scene, line: SceneLine): void {
  scene.thread.push(line)
  if (scene.thread.length > LINE_CAP) scene.thread.shift()
  scene.lastLineTick = line.tick
}
