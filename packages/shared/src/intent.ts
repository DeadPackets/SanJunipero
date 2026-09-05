import { z } from 'zod'

/** The only slots any act names its object in. A verb wanting a fourteenth takes it in `text`
 *  or `description` and reads the words itself, the way `speak` and `inscribe` already do. */
export const CLOSED_KEYS = [
  'x',
  'y',
  'itemId',
  'structureId',
  'targetId',
  'cropId',
  'nodeId',
  'faunaId',
  'kind',
  'recipe',
  'track',
  'text',
  'description',
] as const
export type ClosedKey = (typeof CLOSED_KEYS)[number]

const num = z.number().nullable()
// The world refuses a blank word a beat later, so the decoder is told up front.
const str = z.string().min(1).nullable()

// No `.default()` anywhere: the ai SDK emits this schema at `io: 'input'`, where a default drops
// its key out of `required` and gives back the open object this replaces. `NO_PARAMS` is instead.
export const ClosedIntentParams = z
  .object({
    x: num,
    y: num,
    itemId: str,
    structureId: str,
    targetId: str,
    cropId: str,
    nodeId: str,
    faunaId: str,
    kind: str,
    recipe: str,
    track: str,
    text: str,
    description: str,
  })
  .strict()
export type ClosedIntentParams = z.infer<typeof ClosedIntentParams>

export const Intent = z
  .object({
    verb: z.string().min(1).describe('The exact word of the act, such as walk or eat.'),
    params: ClosedIntentParams.describe(
      'Exactly what the act asks for, named by its keys; every other key is null.',
    ),
  })
  .strict()
export type Intent = z.infer<typeof Intent>

// Named here rather than at the schema: the turn's output ceiling is sized against this many
// steps of the closed grammar, and the two must not drift (llm/pins.test).
export const PLAN_MAX_STEPS = 12

/** One verb the town has minted, as every prompt lists it: the word to name it by, what it
 *  does in a line, and which of the closed keys an act of it must name. */
export type RosterEntry = { id: string; name: string; gloss: string; reads: ClosedKey[] }

// Three buckets and nothing finer: a number would be a score, and what the town says about a
// pair of hands changes a few times a life, so the prompt it sits in stays cached.
const SKILL_BUCKETS = [
  { xp: 20, said: 'is known for', own: 'you are known for' },
  { xp: 8, said: 'is handy at', own: 'you are handy at' },
  { xp: 3, said: 'has taken up', own: 'you have taken up' },
] as const

/** What the town would say about this much work at one track, or null when nobody would
 *  remark on it yet. */
export function skillWord(track: string, xp: number): string | null {
  const bucket = SKILL_BUCKETS.find((b) => xp >= b.xp)
  return bucket === undefined ? null : `${bucket.said} ${track}`
}

// Most done first, and the track name breaks a tie, so the same hands read the same way twice.
function ranked(skills: Record<string, number>): [string, number][] {
  return Object.entries(skills).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** The one thing these hands are most known for, as another person would say it. */
export function topSkillWord(skills: Record<string, number>): string | null {
  for (const [track, xp] of ranked(skills)) {
    const word = skillWord(track, xp)
    if (word !== null) return word
  }
  return null
}

/** The same buckets said back to the person whose hands they are, most done first. */
export function ownSkillWords(skills: Record<string, number>): string[] {
  const out: string[] = []
  for (const [track, xp] of ranked(skills)) {
    const bucket = SKILL_BUCKETS.find((b) => xp >= b.xp)
    if (bucket !== undefined) out.push(`${track} ${bucket.own}`)
  }
  return out
}

/** An act that names nothing: every key answered null. */
export const NO_PARAMS: ClosedIntentParams = Object.freeze(
  Object.fromEntries(CLOSED_KEYS.map((key) => [key, null])),
) as ClosedIntentParams

/** The keys this act actually named. A null is a key the act never asked for, and each verb
 *  takes only the keys it reads, so the nulls come off where the closed answer is read. */
export const namedParams = (params: Record<string, unknown>): Partial<ClosedIntentParams> =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null))
