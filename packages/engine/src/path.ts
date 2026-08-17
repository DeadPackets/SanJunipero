import { DEFAULT_CONFIG, type SimConfig } from '@sj/shared'
import type { TileId, WorldState } from './state.js'

export type Point = { x: number; y: number }

// grass, dirt, water, forest, rock, sand, farmland, road, path, sapling, channel.
// A channel is impassable but drinkable; a sapling walks like the grass it grew from.
export function terrainCostFor(config: SimConfig): Record<TileId, number> {
  return {
    0: 1, 1: 1, 2: Infinity, 3: 2, 4: 3, 5: 1.2, 6: 1,
    7: config.pathing.roadCost, 8: config.desirePaths.pathCost, 9: 1, 10: Infinity,
  }
}

export const TERRAIN_COST: Record<TileId, number> = terrainCostFor(DEFAULT_CONFIG)

export const BRIDGE_KIND = 'bridge'

// The only structure that opens ground instead of closing it. Under construction it is still
// scaffolding over open water, and nobody walks on scaffolding.
export function bridgeAt(state: WorldState, x: number, y: number): boolean {
  for (const s of Object.values(state.structures)) {
    if (s.kind !== BRIDGE_KIND || s.stage !== 'complete') continue
    if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return true
  }
  return false
}

export function isPassable(state: WorldState, x: number, y: number): boolean {
  if (y < 0 || y >= state.terrain.length) return false
  const row = state.terrain[y]!
  if (x < 0 || x >= row.length) return false
  if (bridgeAt(state, x, y)) return true
  if (!Number.isFinite(TERRAIN_COST[row[x]!])) return false
  for (const s of Object.values(state.structures)) {
    if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return false
  }
  return true
}

// The single place that prices a step (G4). Terrain is what the map says; a bridge deck is
// what the town built over it, and it walks like the road it is.
export function stepCostAt(state: WorldState, x: number, y: number, config: SimConfig): number {
  if (bridgeAt(state, x, y)) return config.pathing.roadCost
  return terrainCostFor(config)[state.terrain[y]![x]!]!
}

// Neighbor order + comparator prefer lower y then lower x: deterministic ties under a Manhattan heuristic.
// Movement is 4-directional so a path can't cut corners; canStep enforces that invariant for any step.
const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]]

// Legal when the destination is passable and a diagonal step doesn't squeeze between two impassable tiles.
export function canStep(state: WorldState, x: number, y: number, dx: number, dy: number): boolean {
  if (!isPassable(state, x + dx, y + dy)) return false
  if (dx !== 0 && dy !== 0 && !isPassable(state, x + dx, y) && !isPassable(state, x, y + dy)) return false
  return true
}

type Node = { x: number; y: number; g: number; h: number; f: number; parent: Node | null }

// A finished search and a search that ran out of budget are both walkable answers; only the
// second one is a lie about where the walking ends. `capped` is the one bit that tells them
// apart, and it is why a long walk is a partial and not a refusal.
export type PathSearch = { path: Array<[number, number]>; capped: boolean }

function pathTo(node: Node): Array<[number, number]> {
  const path: Array<[number, number]> = []
  for (let n: Node | null = node; n && n.parent; n = n.parent) path.push([n.x, n.y])
  return path.reverse()
}

// Closest to the goal wins; the existing (y, x) comparator breaks the tie, so the frontier a
// budget stops at is the same frontier on every machine.
function closerToGoal(a: Node, b: Node): boolean {
  return a.h < b.h || (a.h === b.h && (a.y < b.y || (a.y === b.y && a.x < b.x)))
}

export function searchPath(state: WorldState, from: Point, to: Point, config: SimConfig = DEFAULT_CONFIG): PathSearch | null {
  if (from.x === to.x && from.y === to.y) return { path: [], capped: false }
  if (!isPassable(state, to.x, to.y)) return null
  const width = state.terrain[0]!.length
  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y)
  const key = (x: number, y: number) => y * width + x
  const best = new Map<number, Node>()
  const start: Node = { x: from.x, y: from.y, g: 0, h: h(from.x, from.y), f: h(from.x, from.y), parent: null }
  best.set(key(from.x, from.y), start)
  const open: Node[] = [start]
  const closed = new Set<number>()
  const budget = config.pathing.maxNodes
  let expansions = 0
  let frontier = start

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
    if (cur.x === to.x && cur.y === to.y) return { path: pathTo(cur), capped: false }
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx, ny = cur.y + dy
      if (!canStep(state, cur.x, cur.y, dx, dy) || closed.has(key(nx, ny))) continue
      const g = cur.g + stepCostAt(state, nx, ny, config)
      const known = best.get(key(nx, ny))
      if (known && known.g <= g) continue
      const node: Node = { x: nx, y: ny, g, h: h(nx, ny), f: g + h(nx, ny), parent: cur }
      best.set(key(nx, ny), node)
      open.push(node)
      if (closerToGoal(node, frontier)) frontier = node
    }
    // Spent the budget: walk as far toward the goal as the search actually got. An empty
    // partial is no walk at all, so it reads as the refusal it is.
    if (++expansions >= budget) {
      const path = pathTo(frontier)
      return path.length === 0 ? null : { path, capped: true }
    }
  }
  return null
}

export function findPath(state: WorldState, from: Point, to: Point, config: SimConfig = DEFAULT_CONFIG): Array<[number, number]> | null {
  return searchPath(state, from, to, config)?.path ?? null
}
