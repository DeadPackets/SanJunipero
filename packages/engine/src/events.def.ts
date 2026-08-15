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

export const ActionStarted = z.object({
  agentId: z.string(), verb: z.string(), params: z.record(z.string(), z.unknown()), duration: z.number(),
}).strict()
export const ActionProgressed = z.object({ agentId: z.string(), ticks: z.number() }).strict()
export const ActionCompleted = z.object({
  agentId: z.string(), verb: z.string(), results: z.record(z.string(), z.unknown()).optional(),
}).strict()
export const ActionInterrupted = z.object({ agentId: z.string(), reason: z.string() }).strict()
export const SkillGained = z.object({ agentId: z.string(), track: z.string(), xp: z.number() }).strict()
export const AgentWoke = z.object({ agentId: z.string() }).strict()
export const AgentSlept = z.object({ agentId: z.string() }).strict()
export const AgentCollapsed = z.object({ agentId: z.string() }).strict()
export const AgentDied = z.object({ agentId: z.string(), cause: z.string() }).strict()
export const AgentInjured = z.object({ agentId: z.string(), kind: z.enum(['minor', 'serious', 'grave']) }).strict()
export const AgentInfected = z.object({ agentId: z.string() }).strict()
export const AgentFellIll = z.object({ agentId: z.string() }).strict()
export const AgentRecovered = z.object({ agentId: z.string() }).strict()
export const AgentTended = z.object({ agentId: z.string() }).strict()
export const HpChanged = z.object({ agentId: z.string(), delta: z.number() }).strict()
