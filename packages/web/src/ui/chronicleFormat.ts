import type { SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'

// Human-framed one-liners for the viewer-worthy subset; null hides plumbing (spec §5/§8).
export function describeEvent(ev: SimEvent, state: WorldState | null): string | null {
  const p = ev.payload as Record<string, unknown>
  const name = (agentId: unknown): string =>
    (typeof agentId === 'string' ? state?.agents[agentId]?.name ?? agentId : 'Someone')
  const structureKind = (id: unknown): string =>
    (typeof id === 'string' ? state?.structures[id]?.kind ?? 'building' : 'building')

  switch (ev.type) {
    case 'agent_spoke':
      return `${name(p.agentId)}: "${String(p.text)}"`
    case 'agent_died':
      return `${name(p.agentId)} has died (${String(p.cause)}).`
    case 'structure_completed':
      return `The ${structureKind(p.id)} is finished.`
    case 'structure_planned':
      return `${name(p.builderId)} began a ${String(p.kind)}.`
    case 'crop_planted':
      return `${String(p.kind)} was planted.`
    case 'crop_harvested': {
      const kind = typeof p.cropId === 'string' ? state?.crops[p.cropId]?.kind ?? 'harvest' : 'harvest'
      return `The ${kind} came in.`
    }
    case 'fire_ignited':
      return `Fire! The ${structureKind(p.structureId)} is burning.`
    case 'weather_changed':
      return `The weather turned ${String(p.kind)}.`
    case 'agent_collapsed':
      return `${name(p.agentId)} collapsed.`
    case 'agent_tended':
      return `${name(p.agentId)} was tended.`
    case 'action_completed':
      return p.verb === 'give' ? `${name(p.agentId)} gave something away.` : null
    default:
      return null // tick_advanced, need_changed, agent_moved, and any future type
  }
}
