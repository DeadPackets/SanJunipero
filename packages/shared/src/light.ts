import { DEFAULT_CONFIG, type SimConfig } from './config.js'
import { dayPhaseFromTick } from './time.js'

// Where the physics of light lives, so the engine's witness radius and C12's render read the
// same function and can never disagree about what a night looks like. Pure, no RNG, no state
// written — and structurally typed, because `WorldState` belongs to the engine and this
// package is underneath it.

// The least a light calculation needs to know about a world. `WorldState` satisfies it.
export type LitWorld = {
  agents: Record<string, { x: number; y: number }>
  items: Record<string, {
    kind: string
    litUntilTick?: number
    loc: { t: 'tile'; x: number; y: number } | { t: 'agent'; id: string } | { t: 'structure'; id: string }
  }>
  structures: Record<string, {
    kind: string; x: number; y: number; w: number; h: number; stage: string; fueledUntilTick?: number
  }>
}

// The one reader of the glow table (G4). A kind that is not in it throws no light.
export function glowRadiusFor(config: SimConfig, kind: string): number | undefined {
  return (config.light.glowRadius as Record<string, number | undefined>)[kind]
}

// The same table at world defaults, for the render side, which has no config in its hands.
export const LIGHT_GLOW_RADIUS: Readonly<Record<string, number>> = DEFAULT_CONFIG.light.glowRadius

const chebyshev = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by))

// Where a thing in the world actually is: on the ground, in a hand, or on a shelf.
function itemAt(state: LitWorld, item: LitWorld['items'][string]): { x: number; y: number } | null {
  if (item.loc.t === 'tile') return { x: item.loc.x, y: item.loc.y }
  if (item.loc.t === 'agent') return state.agents[item.loc.id] ?? null
  const s = state.structures[item.loc.id]
  return s === undefined ? null : { x: s.x, y: s.y }
}

// A flame reaches (x, y) if it is still burning at this tick and the tile is inside its glow —
// measured to the nearest footprint tile, so a long hearth lights from the end you stand at.
function inGlow(state: LitWorld, x: number, y: number, tick: number, config: SimConfig): boolean {
  for (const id of Object.keys(state.items).sort()) {
    const item = state.items[id]!
    const radius = glowRadiusFor(config, item.kind)
    if (radius === undefined || item.litUntilTick === undefined || item.litUntilTick < tick) continue
    const at = itemAt(state, item)
    if (at !== null && chebyshev(at.x, at.y, x, y) <= radius) return true
  }
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    const radius = glowRadiusFor(config, s.kind)
    if (radius === undefined || s.stage !== 'complete') continue
    if (s.fueledUntilTick === undefined || s.fueledUntilTick < tick) continue
    const nx = Math.min(Math.max(x, s.x), s.x + s.w - 1)
    const ny = Math.min(Math.max(y, s.y), s.y + s.h - 1)
    if (chebyshev(nx, ny, x, y) <= radius) return true
  }
  return false
}

// How bright a TILE is, which is the only question the witness rule ever asks (§19).
export function lightLevelAt(
  state: LitWorld, x: number, y: number, tick: number, config: SimConfig,
): number {
  if (!config.nightWitness.enabled) return 1
  const phase = dayPhaseFromTick(tick)
  if (phase === 'day') return 1
  if (inGlow(state, x, y, tick, config)) return 1
  return phase === 'dusk' ? config.nightWitness.duskFactor : config.nightWitness.nightFactor
}
