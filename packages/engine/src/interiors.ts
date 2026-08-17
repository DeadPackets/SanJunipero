import type { Structure, WorldState } from './state.js'
import { isPassable, type Point } from './path.js'

// The ring of tiles hugging a footprint, ordered clockwise on screen (y grows south)
// starting from the south-east corner. Pure geometry — no state read. Exported because
// it is the codebase's one "nearest tile" tiebreak, and graves reuse it (C11 Task 6).
export function perimeter(s: { x: number; y: number; w: number; h: number }): Point[] {
  const x0 = s.x - 1, x1 = s.x + s.w, y0 = s.y - 1, y1 = s.y + s.h
  const ring: Point[] = []
  for (let x = x1; x >= x0; x--) ring.push({ x, y: y1 })
  for (let y = y1 - 1; y > y0; y--) ring.push({ x: x0, y })
  for (let x = x0; x <= x1; x++) ring.push({ x, y: y0 })
  for (let y = y0 + 1; y < y1; y++) ring.push({ x: x1, y })
  return ring
}

// South-centre first, then clockwise around the ring; null when nothing is passable.
export function doorTile(state: WorldState, s: Structure): Point | null {
  const ring = perimeter(s)
  const start = ring.findIndex((p) => p.x === s.x + Math.floor((s.w - 1) / 2) && p.y === s.y + s.h)
  for (let i = 0; i < ring.length; i++) {
    const p = ring[(start + i) % ring.length]!
    if (isPassable(state, p.x, p.y)) return p
  }
  return null
}

export function insideOf(state: WorldState, agentId: string): string | null {
  return state.agents[agentId]?.insideId ?? null
}

export function occupantsOf(state: WorldState, structureId: string): string[] {
  return Object.keys(state.agents).sort().filter((id) => state.agents[id]!.insideId === structureId)
}

// Two agents can reach each other only from the same side of a wall.
export function sameInterior(state: WorldState, aId: string, bId: string): boolean {
  return insideOf(state, aId) === insideOf(state, bId)
}
