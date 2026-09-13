import { z } from 'zod'

// What the viewer is told about a rule the town wrote. The predicate is not here: which verb a
// law is compiled to is ops-plane, and the page shows the sentence the town actually said.
export const LawRowSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    proposedBy: z.string().min(1),
    proposerName: z.string().min(1),
    ratifiedTick: z.number().int().nonnegative(),
    repealedTick: z.number().int().nonnegative().nullable(),
    votes: z
      .object({ for: z.array(z.string().min(1)), against: z.array(z.string().min(1)) })
      .strict(),
    why: z.string(),
    // Whether the world holds anybody to it, or the town only holds each other to it.
    enforced: z.boolean(),
    breaches: z.number().int().nonnegative(),
  })
  .strict()
export type LawRow = z.infer<typeof LawRowSchema>

// Newest first, repealed laws included — a rule the town let go of is part of its story.
export const LawsResponseSchema = z.object({ laws: z.array(LawRowSchema) }).strict()
