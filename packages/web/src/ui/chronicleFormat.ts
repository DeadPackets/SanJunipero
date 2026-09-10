import { SOMEONE, type SimEvent, agentName, kindWords } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { chronicleLabel } from './importantFeed.js'

// `The weather turned storm.` Three of the five kinds the config ships are nouns, not adjectives.
// An unnamed kind keeps the old shape, which is the right one for an adjective.
const WEATHER_LINE: Record<string, string> = {
  sunny: 'The sky cleared.',
  cloudy: 'It clouded over.',
  rain: 'The rain came on.',
  storm: 'A storm blew in.',
  snow: 'It began to snow.',
}

// Human-framed one-liners for the viewer-worthy subset; null hides plumbing (spec §5/§8).
export function describeEvent(ev: SimEvent, state: WorldState | null): string | null {
  // The paper's own sentence first, so the live column and the chronicle beside it cannot print
  // one tick two ways. What is left below is what the paper leaves out on purpose.
  const shared = chronicleLabel(ev, state)
  if (shared !== null) return shared

  const p = ev.payload as Record<string, unknown>
  const name = (agentId: unknown): string =>
    typeof agentId === 'string' ? agentName(state?.agents, agentId) : SOMEONE

  switch (ev.type) {
    case 'agent_spoke':
      return `${name(p.agentId)}: "${String(p.text)}"`
    case 'structure_planned':
      return `${name(p.builderId)} began a ${kindWords(String(p.kind))}.`
    case 'crop_planted': {
      const kind = kindWords(String(p.kind))
      return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} was planted.`
    }
    case 'crop_harvested': {
      const kind =
        typeof p.cropId === 'string' ? (state?.crops[p.cropId]?.kind ?? 'harvest') : 'harvest'
      return `The ${kindWords(kind)} came in.`
    }
    case 'weather_changed': {
      const kind = String(p.kind)
      return WEATHER_LINE[kind] ?? `The weather turned ${kindWords(kind)}.`
    }
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
