import { z } from 'zod'

// A day the town kept. The id is the narrator's own scene id, so a
// /moment/<id> link outlives any renumbering of the feed it was found in.
export const MomentSchema = z
  .object({
    id: z.number().int().positive(),
    day: z.number().int().nonnegative(),
    startTick: z.number().int().nonnegative(),
    endTick: z.number().int().nonnegative(),
    title: z.string().min(1),
    cast: z.array(z.string().min(1)),
    location: z.string().nullable(),
  })
  .strict()
export type Moment = z.infer<typeof MomentSchema>

export const MomentsResponseSchema = z.object({ moments: z.array(MomentSchema) }).strict()
export type MomentsResponse = z.infer<typeof MomentsResponseSchema>
