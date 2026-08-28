import type { WorldState } from '@sj/engine/state'
import { kindWords } from './broadcastReady.js'

export type HoverKind = 'agent' | 'structure' | 'item' | 'crop'

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
      return s.builtBy === null ? words : `${words} — built by ${agentName(state, s.builtBy)}`
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
