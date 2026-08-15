import type { TileId, WorldState } from './state.js'

export type Point = { x: number; y: number }

// grass, dirt, water, forest, rock, sand, farmland
export const TERRAIN_COST: Record<TileId, number> = { 0: 1, 1: 1, 2: Infinity, 3: 2, 4: 3, 5: 1.2, 6: 1 }

export function isPassable(state: WorldState, x: number, y: number): boolean {
  if (y < 0 || y >= state.terrain.length) return false
  const row = state.terrain[y]!
  if (x < 0 || x >= row.length) return false
  if (!Number.isFinite(TERRAIN_COST[row[x]!])) return false
  for (const s of Object.values(state.structures)) {
    if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return false
  }
  return true
}

// Neighbor order and open-list comparator both prefer lower y then lower x: with a
// consistent Manhattan heuristic this makes equal-cost path choice deterministic.
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]]

type Node = { x: number; y: number; g: number; f: number; parent: Node | null }

export function findPath(state: WorldState, from: Point, to: Point): Array<[number, number]> | null {
  if (from.x === to.x && from.y === to.y) return []
  if (!isPassable(state, to.x, to.y)) return null
  const width = state.terrain[0]!.length
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y)
  const key = (x: number, y: number) => y * width + x
  const best = new Map<number, Node>()
  const start: Node = { x: from.x, y: from.y, g: 0, f: h(from.x, from.y), parent: null }
  best.set(key(from.x, from.y), start)
  const open: Node[] = [start]
  const closed = new Set<number>()

  while (open.length > 0) {
    let mi = 0
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!, b = open[mi]!
      if (a.f < b.f || (a.f === b.f && (a.y < b.y || (a.y === b.y && a.x < b.x)))) mi = i
    }
    const cur = open.splice(mi, 1)[0]!
    const ck = key(cur.x, cur.y)
    if (closed.has(ck)) continue
    closed.add(ck)
    if (cur.x === to.x && cur.y === to.y) {
      const path: Array<[number, number]> = []
      for (let n: Node | null = cur; n && n.parent; n = n.parent) path.push([n.x, n.y])
      return path.reverse()
    }
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy
      if (!isPassable(state, nx, ny) || closed.has(key(nx, ny))) continue
      const g = cur.g + TERRAIN_COST[state.terrain[ny]![nx]!]!
      const known = best.get(key(nx, ny))
      if (known && known.g <= g) continue
      const node: Node = { x: nx, y: ny, g, f: g + h(nx, ny), parent: cur }
      best.set(key(nx, ny), node)
      open.push(node)
    }
  }
  return null
}
