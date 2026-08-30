import { kindWords } from './broadcastReady.js'
import { chronicleLine, type SimEvent } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'

// Human-framed one-liners for the viewer-worthy subset; null hides plumbing (spec §5/§8).
export function describeEvent(ev: SimEvent, state: WorldState | null): string | null {
  const p = ev.payload as Record<string, unknown>
  const name = (agentId: unknown): string =>
    typeof agentId === 'string' ? (state?.agents[agentId]?.name ?? agentId) : 'Someone'
  // R4: a kind is a slug in the engine and PROSE to a viewer. The chronicle read "The
  // fire_pit is finished." on screen until this went through kindWords.
  const structureKind = (id: unknown): string =>
    kindWords(typeof id === 'string' ? (state?.structures[id]?.kind ?? 'building') : 'building')

  switch (ev.type) {
    case 'agent_spoke':
      return `${name(p.agentId)}: "${String(p.text)}"`
    // The feed's C11 vocabulary lives in one place, so the viewer's ticker and the chronicle
    // cannot drift into two different sentences for the same fact.
    case 'agent_died':
    case 'agent_harmed':
    case 'agent_afflicted':
    case 'affliction_worsened':
    case 'affliction_recovered':
    case 'agent_tended':
    case 'grave_placed':
    case 'fire_extinguished':
    case 'tile_changed':
    case 'world_grown':
    case 'fauna_killed':
    case 'agent_expressed':
    case 'discovery_made':
      return chronicleLine(ev, {
        agentName: (id) => name(id),
        structureKind: (id) => structureKind(id),
        mysteryProse: () => null,
      })
    case 'structure_completed':
      return `The ${structureKind(p.id)} is finished.`
    case 'structure_planned':
      return `${name(p.builderId)} began a ${kindWords(String(p.kind))}.`
    case 'crop_planted':
      return `${kindWords(String(p.kind))} was planted.`
    case 'crop_harvested': {
      const kind =
        typeof p.cropId === 'string' ? (state?.crops[p.cropId]?.kind ?? 'harvest') : 'harvest'
      return `The ${kind} came in.`
    }
    case 'fire_ignited':
      return `Fire! The ${structureKind(p.structureId)} is burning.`
    case 'weather_changed':
      return `The weather turned ${kindWords(String(p.kind))}.`
    case 'agent_collapsed':
      return `${name(p.agentId)} collapsed.`
    case 'action_completed':
      return p.verb === 'give' ? `${name(p.agentId)} gave something away.` : null
    default:
      return null // tick_advanced, needs_changed, agent_moved, and any future type
  }
}

// The recent-event ring is filtered by this, so the Chronicle's count and the lines under it are
// the same set. The verdict never depends on world state.
export function isNarratable(ev: SimEvent): boolean {
  return describeEvent(ev, null) !== null
}
