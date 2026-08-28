import { z } from 'zod'

// The recognizer's wire contract, written down once: @sj/arbiter writes the rows, the gateway
// reads them by plain SELECT, and the web reads what the gateway serves.

/** The arbiter's own file, never the world db the gateway serves to strangers. Underscore-prefixed
 *  to stay out of the `<mindId>.db` namespace the amnesia guard walks. */
export const ARBITER_DB_FILE = '_arbiter.db'

/** Every kind the recognizer may name. A ruling outside the list falls back to `custom`. */
export const CONSTRUCT_TYPES = ['festival', 'faith', 'council', 'market', 'custom'] as const
export type ConstructKind = (typeof CONSTRUCT_TYPES)[number]

/** One row of `constructs` as SQLite hands it back; the JSON columns are still text here. */
export const ConstructRowSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CONSTRUCT_TYPES).catch('custom'),
  name: z.string().min(1).nullable(),
  name_provenance: z.string().nullable(),
  anchor: z.string().nullable(),
  participants: z.string(),
  first_tick: z.number().int().nonnegative(),
  recurrences: z.string(),
})
export type ConstructRow = z.infer<typeof ConstructRowSchema>

/** One construct as `GET /api/constructs` serves it. */
export const ConstructRecordSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(CONSTRUCT_TYPES),
    /** The town's own word for it, quoted from a mouth, or null while it has none. */
    name: z.string().min(1).nullable(),
    members: z.array(z.string().min(1)),
    firstDay: z.number().int().nonnegative(),
    /** Times they came back to it, the first gathering included. */
    gatherings: z.number().int().positive(),
    anchor: z.object({ x: z.number().int(), y: z.number().int() }).strict().nullable(),
    /** The whole utterance the name was taken from, and whose mouth it came out of. */
    quote: z.string().min(1).nullable(),
    saidBy: z.string().min(1).nullable(),
  })
  .strict()
export type ConstructRecord = z.infer<typeof ConstructRecordSchema>

export const ConstructsResponseSchema = z.array(ConstructRecordSchema)
