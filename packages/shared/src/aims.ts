import { z } from 'zod'

/** What a mind is about, said outward: its own mood word, the first line it carries into the
 *  day, and the first thing it worries over, read off the newest personality document. A viewer
 *  meets a person through these three before anything has been written of them. */
export const AimSchema = z
  .object({
    agentId: z.string().min(1),
    mood: z.string().nullable(),
    goal: z.string().nullable(),
    worry: z.string().nullable(),
    /** the day the document was last written */
    day: z.number().int().nonnegative(),
  })
  .strict()
export type Aim = z.infer<typeof AimSchema>

export const AimsResponseSchema = z.object({ aims: z.array(AimSchema) }).strict()
export type AimsResponse = z.infer<typeof AimsResponseSchema>

/** The three lines off a personality document as stored. A document that is not JSON, or has
 *  no `current`, reads as nothing rather than as an error: the older docs were prose. */
export function aimOfDoc(doc: string): Pick<Aim, 'mood' | 'goal' | 'worry'> {
  const none = { mood: null, goal: null, worry: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(doc)
  } catch {
    return none
  }
  const cur = (parsed as { current?: unknown } | null)?.current
  if (typeof cur !== 'object' || cur === null) return none
  const c = cur as { mood?: unknown; goals?: unknown; worries?: unknown }
  const first = (v: unknown): string | null =>
    Array.isArray(v) && typeof v[0] === 'string' && v[0].trim() !== '' ? v[0].trim() : null
  return {
    mood: typeof c.mood === 'string' && c.mood.trim() !== '' ? c.mood.trim() : null,
    goal: first(c.goals),
    worry: first(c.worries),
  }
}
