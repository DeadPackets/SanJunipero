import { z } from 'zod'

/** Keys are grammar, verbs are lexicon. The verb is a free word, so a mind can mint one and the
 *  town can keep it; the thirteen cases below are the only slots any act — native or minted —
 *  names its object in. A verb that wants a fourteenth takes it in `text` or `description` and
 *  reads the words itself, the way `speak`, `write` and `inscribe` already do. */
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

// Every key present, every key nullable, no key beyond these: the object a grammar-constrained
// decoder can compile. No `.default()` anywhere — the ai SDK emits this schema at `io: 'input'`,
// where a default drops its key out of `required` and gives back the open object this replaces.
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

/** An act that names nothing: every key answered null. The one place the closed shape's default
 *  lives, since a `.default()` on the schema itself would unmake the grammar it emits. */
export const NO_PARAMS: ClosedIntentParams = Object.freeze(
  Object.fromEntries(CLOSED_KEYS.map((key) => [key, null])),
) as ClosedIntentParams

/** The keys this act actually named. A null is a key the act never asked for, and each verb
 *  takes only the keys it reads, so the nulls come off where the closed answer is read. */
export const namedParams = (params: Record<string, unknown>): Partial<ClosedIntentParams> =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null))
