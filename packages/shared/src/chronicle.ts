import { z } from 'zod'
import type { SimEvent } from './events.js'

// What the town would remember. The weight is editorial, not a score the town can win:
// it decides what surfaces in a curated feed, and nothing else reads it.
export const CHRONICLE_WEIGHTS: Record<string, number> = {
  agent_died: 20,
  agent_born: 18,
  co_slept: 12,
  structure_completed: 10,
  fire_ignited: 9,
  fire_spread: 7,
  structure_inscribed: 6,
  mystery_event: 4,
}

export const CHRONICLE_ICONS: Record<string, string> = {
  agent_died: 'cross',
  agent_born: 'spark',
  co_slept: 'heart',
  structure_completed: 'house',
  fire_ignited: 'flame',
  fire_spread: 'flame',
  structure_inscribed: 'quill',
  mystery_event: 'star',
}

export const CHRONICLE_TYPES: readonly string[] = Object.keys(CHRONICLE_WEIGHTS)
export const CHRONICLE_FALLBACK_ICON = 'star'

// A narrator "first" enters the same feed under its own type, so a reader cannot tell the
// two sources apart and a client needs no second shape.
export const MILESTONE_TYPE = 'first'
export const MILESTONE_ICON = 'spark'

export const ChronicleEntrySchema = z.object({
  seq: z.number().int().positive(),
  tick: z.number().int().nonnegative(),
  type: z.string().min(1),
  icon: z.string().min(1),
  label: z.string().min(1),
}).strict()
export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>

export const ChronicleResponseSchema = z.object({ entries: z.array(ChronicleEntrySchema) }).strict()
export type ChronicleResponse = z.infer<typeof ChronicleResponseSchema>

export function chronicleIcon(type: string): string {
  return CHRONICLE_ICONS[type] ?? CHRONICLE_FALLBACK_ICON
}

// Everything the line needs from the world, injected — so the gateway (which can reach the
// engine's authored mystery prose) and the viewer (which cannot) produce the same sentence
// from the same code rather than two formatters that drift apart.
export type ChronicleLookup = {
  agentName(id: string): string
  structureKind(id: string): string
  mysteryProse(kind: string): string | null
}

// Human-framed, one sentence, never mechanics. null means "this type has no line yet",
// which is how a future event type stays harmless.
export function chronicleLine(ev: SimEvent, look: ChronicleLookup): string | null {
  const p = ev.payload as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  switch (ev.type) {
    case 'agent_died':
      return `${look.agentName(str(p.agentId))} has died (${str(p.cause)}).`
    case 'agent_born':
      return `${str(p.name)} was born.`
    case 'co_slept':
      return `${look.agentName(str(p.aId))} and ${look.agentName(str(p.bId))} kept house together.`
    case 'structure_completed':
      return `The ${look.structureKind(str(p.id))} is finished.`
    case 'fire_ignited':
      return `Fire! The ${look.structureKind(str(p.structureId))} is burning.`
    case 'fire_spread':
      return `The fire has spread to the ${look.structureKind(str(p.toId))}.`
    case 'structure_inscribed':
      return `New words carved on the ${look.structureKind(str(p.structureId))}.`
    case 'mystery_event':
      return look.mysteryProse(str(p.kind))
    default:
      return null
  }
}
