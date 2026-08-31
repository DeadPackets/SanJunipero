import type { SimConfig } from '@sj/shared'
import { doorTile } from './interiors.js'
import { effectiveConfig } from './laws.js'
import { nameTravels } from './naming.js'
import type { WorldState } from './state.js'

// What travels on the air, and what it carries. A leaf, so the mouth that speaks and the ear
// the packet is built from read one rule and never two.

const dist = (x1: number, y1: number, x2: number, y2: number): number =>
  Math.hypot(x2 - x1, y2 - y1)

const chebyshev = (x1: number, y1: number, x2: number, y2: number): number =>
  Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))

// A wall stops sound: speech carries iff both share an interior, both are outdoors within
// earshot, or the one outdoors is standing in the other's doorway.
export function hears(
  state: WorldState,
  baseConfig: SimConfig,
  spoken: unknown,
  hearerId: string,
): boolean {
  const config = effectiveConfig(baseConfig, state.laws)
  const p = spoken as { x?: unknown; y?: unknown; insideId?: unknown } | null
  const hearer = state.agents[hearerId]
  if (!hearer || typeof p?.x !== 'number' || typeof p.y !== 'number') return false

  // Occlusion off drops the wall, not the distance: plain earshot.
  if (!config.occlusion.enabled)
    return dist(hearer.x, hearer.y, p.x, p.y) <= config.movement.earshotRadius

  const speakerInside = typeof p.insideId === 'string' ? p.insideId : null
  const hearerInside = hearer.insideId ?? null
  if (speakerInside !== null && hearerInside !== null) return speakerInside === hearerInside
  if (speakerInside === null && hearerInside === null) {
    return dist(hearer.x, hearer.y, p.x, p.y) <= config.movement.earshotRadius
  }

  const structure = state.structures[speakerInside ?? hearerInside!]
  if (!structure) return false
  const door = doorTile(state, structure)
  if (!door) return false
  const outdoors = speakerInside !== null ? { x: hearer.x, y: hearer.y } : { x: p.x, y: p.y }
  return chebyshev(outdoors.x, outdoors.y, door.x, door.y) <= 1
}

const RE_META = /[.*+?^${}()|[\]\\]/g

// Whole name only. A mind that says "the wellspring" has not said "the well", and a place is
// learned by being named, never by sharing letters with one. The cheap test runs first: nearly
// every sentence names no place at all, and that answer costs no pattern.
function saidAloud(lowered: string, name: string): boolean {
  const lower = name.toLowerCase()
  if (!lowered.includes(lower)) return false
  const escaped = lower.replace(RE_META, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(lowered)
}

export type Spoken = { agentId: string; text: string; x: number; y: number; insideId?: string }

/** The places a mouth just put into other heads. Only names the speaker itself knows travel:
 *  you cannot tell anyone about a mill you have never heard of. */
export function placesNamedAloud(
  state: WorldState,
  config: SimConfig,
  spoke: Spoken,
): { agentId: string; structureIds: string[] }[] {
  const speaker = state.agents[spoke.agentId]
  if (!speaker) return []
  const lowered = spoke.text.toLowerCase()
  const named = (speaker.knownPlaces ?? []).filter((id) => {
    const name = state.structures[id]?.name
    return name !== undefined && nameTravels(name) && saidAloud(lowered, name)
  })
  if (named.length === 0) return []

  const out: { agentId: string; structureIds: string[] }[] = []
  for (const id of Object.keys(state.agents).sort()) {
    const a = state.agents[id]!
    if (id === spoke.agentId || !a.alive) continue
    if (!hears(state, config, spoke, id)) continue
    const known = new Set(a.knownPlaces ?? [])
    const fresh = named.filter((s) => !known.has(s))
    if (fresh.length > 0) out.push({ agentId: id, structureIds: fresh })
  }
  return out
}
