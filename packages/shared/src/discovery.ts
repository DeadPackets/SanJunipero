import { z } from 'zod'

export const DISCOVERY_EVENT = 'discovery_made'

/** A craft is a Recipe that makes or does something. A word is an expressive verb — the town
 *  learning to name an act that changes nothing. Both are somebody working something out. */
export type DiscoveryKind = 'craft' | 'word'

/** Who worked it out, and the words they used. Travels from the runtime to the arbiter and
 *  back out onto the event, because the arbiter itself never knows who is asking at codify. */
export type DiscoveryCredit = { agentId: string; intent: string }

/** One row of the archive, as the gateway serves it. `by` is resolved to a NAME here because
 *  an id is not a credit. */
export const DiscoveryRecordSchema = z
  .object({
    seq: z.number().int().positive(),
    tick: z.number().int().nonnegative(),
    recipeId: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(['craft', 'word']),
    byId: z.string().min(1),
    by: z.string().min(1),
    intent: z.string().min(1),
    makes: z.array(z.string().min(1)),
  })
  .strict()
export type DiscoveryRecord = z.infer<typeof DiscoveryRecordSchema>

export const DiscoveryResponseSchema = z
  .object({
    discoveries: z.array(DiscoveryRecordSchema),
  })
  .strict()
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>

// The intent is the agent's OWN words and never appears here: the chronicle is agent-visible,
// and a mind reading its own sentence back is the loop the one-way glass prevents.
export function discoveryHeadline(d: { kind: DiscoveryKind; name: string; by: string }): string {
  return d.kind === 'word' ? `${d.by} found a word: ${d.name}` : `${d.by} worked out ${d.name}`
}
