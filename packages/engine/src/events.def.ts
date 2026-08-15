import { z } from 'zod'

export const TickAdvanced = z.object({}).strict()
export const AgentSpawned = z.object({
  id: z.string(), name: z.string(), x: z.number(), y: z.number(), ageDays: z.number(),
}).strict()
export const AgentMoved = z.object({ id: z.string(), x: z.number(), y: z.number() }).strict()
export const NeedChanged = z.object({
  id: z.string(), need: z.enum(['hunger', 'energy', 'warmth', 'social']), delta: z.number(),
}).strict()

export const ItemLoc = z.discriminatedUnion('t', [
  z.object({ t: z.literal('tile'), x: z.number(), y: z.number() }).strict(),
  z.object({ t: z.literal('agent'), id: z.string() }).strict(),
  z.object({ t: z.literal('structure'), id: z.string() }).strict(),
])
export const ItemSpawned = z.object({ id: z.string(), kind: z.string(), qty: z.number(), loc: ItemLoc }).strict()
export const ItemMoved = z.object({ id: z.string(), loc: ItemLoc }).strict()
export const ItemQtyChanged = z.object({ id: z.string(), delta: z.number() }).strict()
export const StructurePlanned = z.object({
  id: z.string(), kind: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  maxHp: z.number(), flammable: z.boolean(), builderId: z.string(),
}).strict()
export const StructureProgressed = z.object({ id: z.string(), ticks: z.number() }).strict()
export const StructureCompleted = z.object({ id: z.string() }).strict()
export const StructureDamaged = z.object({ id: z.string(), amount: z.number() }).strict()
export const StructureDestroyed = z.object({ id: z.string() }).strict()
