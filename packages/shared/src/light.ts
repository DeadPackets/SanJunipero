import { DEFAULT_CONFIG, isHearthKind, type SimConfig } from './config.js'
import { dayPhaseFromTick } from './time.js'

// The physics of light, so the engine's witness radius and the render read one function.
// Structurally typed: WorldState belongs to the engine and this package is underneath it.

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

// The one reader of the glow table. A kind that is not in it throws no light.
export function glowRadiusFor(config: SimConfig, kind: string): number | undefined {
  return (config.light.glowRadius as Record<string, number | undefined>)[kind]
}

// The same table at world defaults, for the render side, which has no config in its hands.
export const LIGHT_GLOW_RADIUS: Readonly<Record<string, number>> = DEFAULT_CONFIG.light.glowRadius

// glowRadius is keyed by kind, so a fed house threw no light at all until this: the fire in it
// is the hearth's fire, so the reach of it is the hearth's reach.
export function structureGlowRadius(config: SimConfig, kind: string): number | undefined {
  return glowRadiusFor(config, kind) ?? (isHearthKind(config, kind) ? glowRadiusFor(config, 'hearth') : undefined)
}

const chebyshev = (ax: number, ay: number, bx: number, by: number): number =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by))

// Where a thing in the world actually is: on the ground, in a hand, or on a shelf.
function itemAt(state: LitWorld, item: LitWorld['items'][string]): { x: number; y: number } | null {
  if (item.loc.t === 'tile') return { x: item.loc.x, y: item.loc.y }
  if (item.loc.t === 'agent') return state.agents[item.loc.id] ?? null
  const s = state.structures[item.loc.id]
  return s === undefined ? null : { x: s.x, y: s.y }
}

// Everything alight in the world right now, as footprints with a reach. One walk of the world
// answers both "is this tile lit" and "is there a flame near this pair of hands".
export type Flame = {
  id: string; source: 'item' | 'structure'
  x: number; y: number; w: number; h: number; radius: number
}

// Keyed on the identity of the world, which the fold replaces on every event — so a state that
// is still the state it was answers "what is alight" once, however many tiles ask.
const memo = new WeakMap<LitWorld, { tick: number; config: SimConfig; flames: Flame[] }>()

export function flamesAt(state: LitWorld, tick: number, config: SimConfig): Flame[] {
  const hit = memo.get(state)
  if (hit !== undefined && hit.tick === tick && hit.config === config) return hit.flames
  const out: Flame[] = []
  for (const id of Object.keys(state.items).sort()) {
    const item = state.items[id]!
    const radius = glowRadiusFor(config, item.kind)
    if (radius === undefined || item.litUntilTick === undefined || item.litUntilTick < tick) continue
    const at = itemAt(state, item)
    if (at !== null) out.push({ id, source: 'item', x: at.x, y: at.y, w: 1, h: 1, radius })
  }
  for (const id of Object.keys(state.structures).sort()) {
    const s = state.structures[id]!
    const radius = structureGlowRadius(config, s.kind)
    if (radius === undefined || s.stage !== 'complete') continue
    if (s.fueledUntilTick === undefined || s.fueledUntilTick < tick) continue
    out.push({ id, source: 'structure', x: s.x, y: s.y, w: s.w, h: s.h, radius })
  }
  memo.set(state, { tick, config, flames: out })
  return out
}

// Distance to the nearest tile of the flame's footprint, so a long hearth reaches from the end
// you are standing at and not from a corner nobody is near.
export function distanceToFlame(f: Flame, x: number, y: number): number {
  const nx = Math.min(Math.max(x, f.x), f.x + f.w - 1)
  const ny = Math.min(Math.max(y, f.y), f.y + f.h - 1)
  return chebyshev(nx, ny, x, y)
}

// Is any flame within `radius` of (x, y) — a fixed reach, not each flame's own glow. This is
// the question work in the dark asks; `lightLevelAt` asks the glow-radius one.
export function litSourceWithin(
  state: LitWorld, x: number, y: number, tick: number, config: SimConfig, radius: number,
): boolean {
  return flamesAt(state, tick, config).some((f) => distanceToFlame(f, x, y) <= radius)
}

// How bright a TILE is, which is the only question the witness rule ever asks (§19).
export function lightLevelAt(
  state: LitWorld, x: number, y: number, tick: number, config: SimConfig,
): number {
  if (!config.nightWitness.enabled) return 1
  const phase = dayPhaseFromTick(tick)
  if (phase === 'day') return 1
  if (flamesAt(state, tick, config).some((f) => distanceToFlame(f, x, y) <= f.radius)) return 1
  return phase === 'dusk' ? config.nightWitness.duskFactor : config.nightWitness.nightFactor
}

// The viewer is in the signature and unused on purpose: a torch does not let you see into the
// dark, it lets the dark see you. That asymmetry is the deterrence.
export function visionRadiusAt(
  state: LitWorld,
  _viewer: { x: number; y: number },
  x: number, y: number, tick: number, config: SimConfig,
): number {
  return Math.round(config.movement.sightRadius * lightLevelAt(state, x, y, tick, config))
}

// The three words a body would use, never a number. Asks the light law, not the witness law:
// reading it off lightLevelAt made the dark answer nightWitness.enabled, a dial about theft.
export function lightBandAt(
  state: LitWorld, x: number, y: number, tick: number, config: SimConfig,
): 'bright' | 'dim' | 'dark' {
  if (!config.light.enabled) return 'bright'
  const phase = dayPhaseFromTick(tick)
  if (phase === 'day') return 'bright'
  if (flamesAt(state, tick, config).some((f) => distanceToFlame(f, x, y) <= f.radius)) return 'bright'
  return phase === 'dusk' ? 'dim' : 'dark'
}

// The band's own word, not a second threshold: dusk is not dark, and fumblesInTheDark has always
// charged for night alone. The threshold is the phase boundary, not a number anybody chose.
export function isDark(
  state: LitWorld, x: number, y: number, tick: number, config: SimConfig,
): boolean {
  return lightBandAt(state, x, y, tick, config) === 'dark'
}
