import { z } from 'zod'

export const IndoorDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['bed', 'hearth', 'table', 'storage']) }).strict(),
  z.object({ kind: z.literal('beside'), targetId: z.string().min(1) }).strict(),
])
export type IndoorDestination = z.infer<typeof IndoorDestinationSchema>
