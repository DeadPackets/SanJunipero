import type { WorldState } from '@sj/engine/state'
import { LENSES, type Lens } from './route.js'
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

// The click line: the same fact, said in full, for the popover.
export function itemCropDetail(
  state: WorldState | null,
  kind: 'item' | 'crop',
  id: string,
): string | null {
  if (state === null) return null
  if (kind === 'item') {
    const it = state.items[id]
    if (it === undefined) return null
    const owner =
      it.owner === undefined ? 'claimed by no one' : `owned by ${agentName(state, it.owner)}`
    return `${it.kind} ×${it.qty}, ${owner}`
  }
  const c = state.crops[id]
  if (c === undefined) return null
  const growth = c.withered ? 'withered' : `stage ${c.stage}/${CROP_STAGES}`
  return `${c.kind}, planted day ${c.plantedDay}, ${growth}`
}

/** What Escape takes one step out of, in priority order, or `null` when it takes no step. Two
 *  window listeners cannot settle this between them, so the whole order lives here. */
export function escapeStep(
  insideId: string | null,
  dockOpen: boolean,
  onOnePerson: boolean,
  popoverOpen: boolean,
): 'popover' | 'room' | 'dock' | 'roster' | null {
  if (popoverOpen) return 'popover'
  if (insideId !== null) return 'room'
  if (dockOpen) return 'dock'
  return onOnePerson ? 'roster' : null
}

export function lensFromKey(key: string, current: Lens): Lens | null {
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
  if (step === 0) return null
  const i = LENSES.indexOf(current)
  return LENSES[(i + step + LENSES.length) % LENSES.length]!
}

const TEXT_ENTRY_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// The arrows belong to whatever has focus first: a text field types with them, the map pans with
// them, and any control that already consumed the press keeps it. Lens cycling is the fallback,
// never the interception.
export function lensKeyAllowed(
  tagName: string,
  isContentEditable: boolean,
  inApplication: boolean,
  alreadyHandled = false,
): boolean {
  return (
    !alreadyHandled &&
    !TEXT_ENTRY_TAGS.has(tagName.toUpperCase()) &&
    !isContentEditable &&
    !inApplication
  )
}
