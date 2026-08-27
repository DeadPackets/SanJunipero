import { DEFAULT_CONFIG, type SimConfig } from '@sj/shared'
import type { TileId, WorldState } from './state.js'

export type Point = { x: number; y: number }

// grass, dirt, water, forest, rock, sand, farmland, road, path, sapling, channel.
// A channel is impassable but drinkable; a sapling walks like the grass it grew from.
// The keys stay literal rather than the T_* names: computed keys leave the object in
// dictionary mode, and findPath reads this table once per neighbour per node.
export function terrainCostFor(config: SimConfig): Record<TileId, number> {
  return {
    0: 1,
    1: 1,
    2: Infinity,
    3: 2,
    4: 3,
    5: 1.2,
    6: 1,
    7: config.pathing.roadCost,
    8: config.desirePaths.pathCost,
    9: 1,
    10: Infinity,
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

// The same two questions about structures, answered from one walk of them instead of one walk
// per tile — what a search that expands thousands of tiles over an unchanging world can do.
export type PathCtx = {
  decks: Set<number>
  blocked: Set<number>
  cost: Record<TileId, number>
  width: number
}

function pathCtx(state: WorldState, config: SimConfig): PathCtx {
  const width = state.terrain[0]!.length
  const decks = new Set<number>()
  const blocked = new Set<number>()
  for (const s of Object.values(state.structures)) {
    const into = s.kind === BRIDGE_KIND && s.stage === 'complete' ? decks : blocked
    for (let y = s.y; y < s.y + s.h; y++) {
      if (y < 0 || y >= state.terrain.length) continue
      for (let x = s.x; x < s.x + s.w; x++) {
        if (x < 0 || x >= width) continue
        into.add(y * width + x)
      }
    }
  }
  return { decks, blocked, cost: terrainCostFor(config), width }
}

const onDeck = (state: WorldState, x: number, y: number, ctx?: PathCtx): boolean =>
  ctx === undefined ? bridgeAt(state, x, y) : ctx.decks.has(y * ctx.width + x)

const underStructure = (state: WorldState, x: number, y: number, ctx?: PathCtx): boolean => {
  if (ctx !== undefined) return ctx.blocked.has(y * ctx.width + x)
  for (const s of Object.values(state.structures)) {
    if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return true
  }
  return false
}

export function isPassable(state: WorldState, x: number, y: number, ctx?: PathCtx): boolean {
  if (y < 0 || y >= state.terrain.length) return false
  const row = state.terrain[y]!
  if (x < 0 || x >= row.length) return false
  if (onDeck(state, x, y, ctx)) return true
  if (!Number.isFinite(TERRAIN_COST[row[x]!])) return false
  return !underStructure(state, x, y, ctx)
}

// The single place that prices a step. Terrain is what the map says; a bridge deck is
// what the town built over it, and it walks like the road it is.
export function stepCostAt(
  state: WorldState,
  x: number,
  y: number,
  config: SimConfig,
  ctx?: PathCtx,
): number {
  if (onDeck(state, x, y, ctx)) return config.pathing.roadCost
  return (ctx?.cost ?? terrainCostFor(config))[state.terrain[y]![x]!]
}

// Neighbor order + comparator prefer lower y then lower x: deterministic ties under a Manhattan heuristic.
// Movement is 4-directional so a path can't cut corners; canStep enforces that invariant for any step.
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
]

// Legal when the destination is passable and a diagonal step doesn't squeeze between two impassable tiles.
export function canStep(
  state: WorldState,
  x: number,
  y: number,
  dx: number,
  dy: number,
  ctx?: PathCtx,
): boolean {
  if (!isPassable(state, x + dx, y + dy, ctx)) return false
  if (
    dx !== 0 &&
    dy !== 0 &&
    !isPassable(state, x + dx, y, ctx) &&
    !isPassable(state, x, y + dy, ctx)
  )
    return false
  return true
}

type Node = { x: number; y: number; g: number; h: number; f: number; parent: Node | null }

// A finished search and one that ran out of budget are both walkable answers; only the second is
// a lie about where the walking ends, and `capped` is the bit that tells them apart.
export type PathSearch = { path: [number, number][]; capped: boolean }

function pathTo(node: Node): [number, number][] {
  const path: [number, number][] = []
  for (let n: Node | null = node; n.parent; n = n.parent) path.push([n.x, n.y])
  return path.reverse()
}

// Closest to the goal wins; the existing (y, x) comparator breaks the tie, so the frontier a
// budget stops at is the same frontier on every machine.
function closerToGoal(a: Node, b: Node): boolean {
  return a.h < b.h || (a.h === b.h && (a.y < b.y || (a.y === b.y && a.x < b.x)))
}

// One walk is searched by `validate` and again by `duration` over the same immutable world, so
// the answer is kept against the identity of that world and the config it was judged under.
const memo = new WeakMap<WorldState, { config: SimConfig; key: string; found: PathSearch | null }>()

export function searchPath(
  state: WorldState,
  from: Point,
  to: Point,
  config: SimConfig = DEFAULT_CONFIG,
): PathSearch | null {
  if (from.x === to.x && from.y === to.y) return { path: [], capped: false }
  const key = `${from.x},${from.y}|${to.x},${to.y}`
  const hit = memo.get(state)
  if (hit?.config === config && hit.key === key) return hit.found
  const found = runSearch(state, from, to, config)
  memo.set(state, { config, key, found })
  return found
}

function runSearch(
  state: WorldState,
  from: Point,
  to: Point,
  config: SimConfig,
): PathSearch | null {
  const ctx = pathCtx(state, config)
  if (!isPassable(state, to.x, to.y, ctx)) return null
  const width = ctx.width
  // Charging a full grass tile per remaining step over-estimates the moment anything is cheaper
  // than grass — a road is 0.6 — and an over-estimating A* returns a short route, not a cheap one.
  const minCost = Math.min(...Object.values(ctx.cost).filter(Number.isFinite))
  const h = (x: number, y: number) => (Math.abs(x - to.x) + Math.abs(y - to.y)) * minCost
  const key = (x: number, y: number) => y * width + x
  const best = new Map<number, Node>()
  const start: Node = {
    x: from.x,
    y: from.y,
    g: 0,
    h: h(from.x, from.y),
    f: h(from.x, from.y),
    parent: null,
  }
  best.set(key(from.x, from.y), start)
  const open: Node[] = [start]
  const closed = new Set<number>()
  const budget = config.pathing.maxNodes
  let expansions = 0
  let frontier = start

  while (open.length > 0) {
    let mi = 0
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!,
        b = open[mi]!
      if (a.f < b.f || (a.f === b.f && (a.y < b.y || (a.y === b.y && a.x < b.x)))) mi = i
    }
    const cur = open.splice(mi, 1)[0]!
    const ck = key(cur.x, cur.y)
    if (closed.has(ck)) continue
    closed.add(ck)
    if (cur.x === to.x && cur.y === to.y) return { path: pathTo(cur), capped: false }
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx,
        ny = cur.y + dy
      if (!canStep(state, cur.x, cur.y, dx, dy, ctx) || closed.has(key(nx, ny))) continue
      const g = cur.g + stepCostAt(state, nx, ny, config, ctx)
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

export function findPath(
  state: WorldState,
  from: Point,
  to: Point,
  config: SimConfig = DEFAULT_CONFIG,
): [number, number][] | null {
  return searchPath(state, from, to, config)?.path ?? null
}
