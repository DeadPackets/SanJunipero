import { z } from 'zod'

export const TickAdvanced = z.object({}).strict()
export const AgentSpawned = z.object({
  id: z.string(), name: z.string(), x: z.number(), y: z.number(), ageDays: z.number(),
}).strict()
export const AgentMoved = z.object({ id: z.string(), x: z.number(), y: z.number() }).strict()
export const NeedChanged = z.object({
  id: z.string(), need: z.enum(['hunger', 'energy', 'warmth', 'social']), delta: z.number(),
}).strict()
