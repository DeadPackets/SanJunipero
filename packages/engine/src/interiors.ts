import { isRoofedKind, roomCapacity, T_ROAD, type SimConfig } from '@sj/shared'
import type { Structure, WorldState } from './state.js'
import { isPassable, type Point } from './path.js'

// The ring of tiles hugging a footprint, clockwise on screen from the south-east corner. Exported
// because it is the codebase's one "nearest tile" tiebreak, and graves reuse it.
export function perimeter(s: { x: number; y: number; w: number; h: number }): Point[] {
  const x0 = s.x - 1,
    x1 = s.x + s.w,
    y0 = s.y - 1,
    y1 = s.y + s.h
  const ring: Point[] = []
  for (let x = x1; x >= x0; x--) ring.push({ x, y: y1 })
  for (let y = y1 - 1; y > y0; y--) ring.push({ x: x0, y })
  for (let x = x0; x <= x1; x++) ring.push({ x, y: y0 })
  for (let y = y0 + 1; y < y1; y++) ring.push({ x: x1, y })
  return ring
}

// Road ring preferred, passable ring as fallback, so a turned building's door is not a side wall
// onto grass. Read off the terrain: world state carries no facing and does not need one here.
export function doorTile(state: WorldState, s: Structure): Point | null {
  const ring = perimeter(s)
  const start = ring.findIndex((p) => p.x === s.x + Math.floor((s.w - 1) / 2) && p.y === s.y + s.h)
  let passable: Point | null = null
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(start + i) % ring.length]!
    if (!isPassable(state, p.x, p.y)) continue
    // A door is on a FACE, never at a corner: a corner touches the building diagonally, and a
    // body standing there is beside the building rather than at its door.
    if (!onCorner(s, p) && state.terrain[p.y]?.[p.x] === T_ROAD) return p
    passable ??= p
  }
  return passable
}

const onCorner = (s: { x: number; y: number; w: number; h: number }, p: Point): boolean =>
  (p.x < s.x || p.x >= s.x + s.w) && (p.y < s.y || p.y >= s.y + s.h)

export function insideOf(state: WorldState, agentId: string): string | null {
  return state.agents[agentId]?.insideId ?? null
}

export function occupantsOf(state: WorldState, structureId: string): string[] {
  return Object.keys(state.agents)
    .sort()
    .filter((id) => state.agents[id]!.insideId === structureId)
}

// Two tiles of floor per body — physics, not ownership. In shared because the city template must
// lay a bed per body and cannot import the engine.
export { TILES_PER_BODY, roomCapacity } from '@sj/shared'

/** True when no more bodies fit. `enter` refuses on it and perception says it out loud, so a
 *  mind reads "full" off the packet instead of paying a turn to be told. */
export function roomIsFull(state: WorldState, s: { id: string; w: number; h: number }): boolean {
  return occupantsOf(state, s.id).length >= roomCapacity(s)
}

// Two agents can reach each other only from the same side of a wall.
export function sameInterior(state: WorldState, aId: string, bId: string): boolean {
  return insideOf(state, aId) === insideOf(state, bId)
}

/** How many bodies the standing roofs hold, against how many bodies there are. A run that wants
 *  to watch a town build shelter has to start below 1.0, and this is the one place to ask. */
export type ShelterLedger = { roofs: number; slots: number; bodies: number; per: number }

export function shelterLedger(state: WorldState, config: SimConfig): ShelterLedger {
  let roofs = 0
  let slots = 0
  for (const s of Object.values(state.structures)) {
    if (s.stage !== 'complete' || !isRoofedKind(config, s.kind)) continue
    roofs++
    slots += roomCapacity(s)
  }
  const bodies = Object.values(state.agents).filter((a) => a.alive).length
  return { roofs, slots, bodies, per: bodies === 0 ? Infinity : slots / bodies }
}
