import type { WorldState } from '@sj/engine/state'
import { kindWords } from './broadcastReady.js'

export type HoverKind = 'agent' | 'structure' | 'item' | 'crop'

/** What Escape puts down. The ring is not a rung of its own: it IS the pick's chrome, so it
 *  goes down with the pick. */
export type EscapeRung = 'keys' | 'paper' | 'interior' | 'subject' | 'fullscreen'

export type StageUp = Readonly<Record<EscapeRung, boolean>>

/** ONE ladder, topmost first — every Escape in the app resolves through this and nothing else. */
export function escapeStep(up: StageUp): EscapeRung | null {
  if (up.keys) return 'keys'
  if (up.paper) return 'paper'
  if (up.interior) return 'interior'
  if (up.subject) return 'subject'
  return up.fullscreen ? 'fullscreen' : null
}

export const CROP_STAGES = 4

// Typographic apostrophe — the chrome sets prose, not code.
const OWNS = '’s'

function agentName(state: WorldState, id: string): string {
  return state.agents[id]?.name ?? id
}

// One line for the pointer: what this is, whose it is, how far along it is. Named
// hoverLabel because charAnim already owns nameTagText(name) for the sprite tag itself.
export function hoverLabel(state: WorldState | null, kind: HoverKind, id: string): string | null {
  if (state === null) return null
  switch (kind) {
    case 'agent': {
      const a = state.agents[id]
      return a === undefined ? null : a.name
    }
    case 'structure': {
      const s = state.structures[id]
      if (s === undefined) return null
      // R4: prose to a viewer — a hover used to read "fire_pit"
      const words = kindWords(s.kind)
      // Genesis signs its own work with a builder who is nobody in the town. Naming it told a
      // viewer the scripted runner laid the first stone.
      const by = s.builtBy === null ? undefined : state.agents[s.builtBy]
      return by === undefined ? words : `${words} — built by ${by.name}`
    }
    case 'item': {
      const it = state.items[id]
      if (it === undefined) return null
      const base = `${it.kind} ×${it.qty}`
      return it.owner === undefined ? base : `${base} · ${agentName(state, it.owner)}${OWNS}`
    }
    case 'crop': {
      const c = state.crops[id]
      return c === undefined ? null : `${c.kind} (stage ${c.stage}/${CROP_STAGES})`
    }
  }
}

/** A structure is not here: it has a place of its own, with its whole provenance on it. */
export function itemCropDetail(
  state: WorldState | null,
  thing: { kind: 'item' | 'crop'; id: string },
): string | null {
  if (state === null) return null
  if (thing.kind === 'item') {
    const it = state.items[thing.id]
    if (it === undefined) return null
    const owner =
      it.owner === undefined ? 'claimed by no one' : `owned by ${agentName(state, it.owner)}`
    return `${kindWords(it.kind)} ×${it.qty}, ${owner}`
  }
  const c = state.crops[thing.id]
  if (c === undefined) return null
  const growth = c.withered ? 'withered' : `stage ${c.stage} of ${CROP_STAGES}`
  return `${kindWords(c.kind)}, planted on day ${c.plantedDay}, ${growth}`
}

export function thingKind(
  state: WorldState | null,
  thing: { kind: 'item' | 'crop'; id: string },
): string | null {
  if (state === null) return null
  return (thing.kind === 'item' ? state.items[thing.id]?.kind : state.crops[thing.id]?.kind) ?? null
}
