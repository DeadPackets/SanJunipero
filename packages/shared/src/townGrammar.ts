// sx=(dx-dy)*16, sy=(dx+dy)*8 — equal +dx/+dy is pure depth, so a lattice rectangle renders
// as a diamond. Only SW/SE have art, so blocks build out along their south and east edges only.

/** 16 tiles of block, 3 of street. STREET was 2 and gave 71.6 px against a 72 px floor. */
export const BLOCK = 16
export const STREET = 3
/** Tiles between two block origins. */
export const PITCH = BLOCK + STREET

/** Where the two plots start along each built edge — a 7-tile plot pitch. */
export const PLOT_OFFSETS = [2, 9] as const
/** Along the street, and into the block. Depth is capped at 2: a 4×4 at a block corner
 *  physically overlapped its neighbour. */
export const MAX_ALONG = 4
export const MAX_DEEP = 2
/** The screen-pixel floor two building centres may never come closer than. */
export const MIN_SEP = 72

export const TOWN_FACINGS = ['sw', 'se'] as const
export type TownFacing = (typeof TOWN_FACINGS)[number]

// ---------------------------------------------------------------- the projection

/** TILE_W / 2 and TILE_H / 2 of the Style Bible 32×16 grid, restated here because `shared`
 *  cannot import the renderer and every number in this file is measured in them. */
export const ISO_HALF_W = 16
export const ISO_HALF_H = 8

export const screenOf = (dx: number, dy: number): { sx: number; sy: number } =>
  ({ sx: (dx - dy) * ISO_HALF_W, sy: (dx + dy) * ISO_HALF_H })

export const centreOf = (s: { dx: number; dy: number; w: number; h: number }): { sx: number; sy: number } =>
  screenOf(s.dx + s.w / 2, s.dy + s.h / 2)

// ---------------------------------------------------------------- the ground

/** What the grammar is allowed to know about a tile. It plats onto `dry` and nothing else. */
export type GroundKind = 'dry' | 'water' | 'bank'
export type Ground = (dx: number, dy: number) => GroundKind

/** A river is a reason for the town's shape, not a stripe: the grid is not platted where it would
 *  stand in water, which is why ring 1 plats five blocks and not eight. */
export const riverCentre = (dy: number): number => -6 + 5 * Math.sin(dy / 17) + dy * 0.22

export const isRiverWater = (dx: number, dy: number): boolean =>
  Math.abs(dx - riverCentre(dy)) < 3

export const isRiverBank = (dx: number, dy: number): boolean =>
  !isRiverWater(dx, dy) && Math.abs(dx - riverCentre(dy)) < 4.6

export const RIVER_GROUND: Ground = (dx, dy) =>
  isRiverWater(dx, dy) ? 'water' : isRiverBank(dx, dy) ? 'bank' : 'dry'

/** Ground with nothing in it — for measuring the lattice itself. */
export const DRY_GROUND: Ground = () => 'dry'

// ---------------------------------------------------------------- the lattice

export type BlockId = { i: number; j: number }
export type TileXY = { dx: number; dy: number }
export type BlockRect = { dx0: number; dy0: number; dx1: number; dy1: number }

export const blockRect = (i: number, j: number): BlockRect => ({
  dx0: i * PITCH, dy0: j * PITCH, dx1: i * PITCH + BLOCK - 1, dy1: j * PITCH + BLOCK - 1,
})

export function blockTiles(i: number, j: number): TileXY[] {
  const r = blockRect(i, j)
  const out: TileXY[] = []
  for (let dy = r.dy0; dy <= r.dy1; dy++) for (let dx = r.dx0; dx <= r.dx1; dx++) out.push({ dx, dy })
  return out
}

/** The street tiles doors open onto: the block's south street row and east street column. Platting
 *  requires these dry, which makes "every door fronts a road" a property of the plat rule. */
export function frontageTiles(i: number, j: number): TileXY[] {
  const x0 = i * PITCH, y0 = j * PITCH
  const out: TileXY[] = []
  for (let dx = x0; dx < x0 + BLOCK; dx++) out.push({ dx, dy: y0 + BLOCK })
  for (let dy = y0; dy < y0 + BLOCK; dy++) out.push({ dx: x0 + BLOCK, dy })
  return out
}

/** A block is platted only if it stands entirely on dry land AND its frontage is not in the
 *  channel. The square, block (0,0), is never platted — `plattedBlocks` holds that rule. */
export function blockIsPlattable(i: number, j: number, ground: Ground): boolean {
  for (const t of blockTiles(i, j)) if (ground(t.dx, t.dy) !== 'dry') return false
  for (const t of frontageTiles(i, j)) if (ground(t.dx, t.dy) === 'water') return false
  return true
}

/** A plot is anchored to its STREET and the building grows away from it, the way real frontage
 *  works: a south plot fixes the street row its south wall meets, an east plot the column. */
export type Plot =
  | { block: BlockId; slot: string; face: 'sw'; dx: number; anchorY: number; maxAlong: number; maxDeep: number }
  | { block: BlockId; slot: string; face: 'se'; dy: number; anchorX: number; maxAlong: number; maxDeep: number }

/** Four plots per block: two fronting the south street, two the east. The SE corner is left as
 *  garden — a plot there is a building on two streets at once, and it overlapped. */
export function plotsOf(i: number, j: number): Plot[] {
  const x0 = i * PITCH, y0 = j * PITCH
  const block: BlockId = { i, j }
  const out: Plot[] = []
  PLOT_OFFSETS.forEach((ox, n) => out.push({
    block, slot: `s${n}`, face: 'sw', dx: x0 + ox, anchorY: y0 + BLOCK,
    maxAlong: MAX_ALONG, maxDeep: MAX_DEEP,
  }))
  PLOT_OFFSETS.forEach((oy, n) => out.push({
    block, slot: `e${n}`, face: 'se', dy: y0 + oy, anchorX: x0 + BLOCK,
    maxAlong: MAX_ALONG, maxDeep: MAX_DEEP,
  }))
  return out
}

export type PlacedStructure = {
  kind: string
  dx: number; dy: number; w: number; h: number
  owner: string | null
  facing: TownFacing
  block: BlockId
  slot: string
}

/** Seat a building on a plot. `along` runs with the street and `deep` into the block, so the
 *  same building on an east plot is that building turned ninety degrees. */
export function place(plot: Plot, kind: string, along: number, deep: number, owner: string | null): PlacedStructure {
  const common = { kind, owner, block: plot.block, slot: plot.slot }
  return plot.face === 'sw'
    ? { ...common, facing: 'sw', dx: plot.dx, dy: plot.anchorY - deep, w: along, h: deep }
    : { ...common, facing: 'se', dx: plot.anchorX - deep, dy: plot.dy, w: deep, h: along }
}

export function placedTiles(s: { dx: number; dy: number; w: number; h: number }): TileXY[] {
  const out: TileXY[] = []
  for (let dy = s.dy; dy < s.dy + s.h; dy++) for (let dx = s.dx; dx < s.dx + s.w; dx++) out.push({ dx, dy })
  return out
}

/** The road tile the door opens onto — NOT a tile of the building. SW doors open on the +y
 *  face, SE doors on the +x face; there is no third answer because there is no third facing. */
export function doorFrontOf(s: { dx: number; dy: number; w: number; h: number; facing: TownFacing }): TileXY {
  return s.facing === 'sw'
    ? { dx: s.dx + ((s.w - 1) >> 1), dy: s.dy + s.h }
    : { dx: s.dx + s.w, dy: s.dy + ((s.h - 1) >> 1) }
}

// ---------------------------------------------------------------- growth

/** The shell of blocks at Chebyshev distance `r` from the square. */
export function ringBlocks(r: number): BlockId[] {
  if (r === 0) return [{ i: 0, j: 0 }]
  const out: BlockId[] = []
  for (let i = -r; i <= r; i++)
    for (let j = -r; j <= r; j++) if (Math.max(Math.abs(i), Math.abs(j)) === r) out.push({ i, j })
  return out
}

/** Every block platted out to `rings`, in growth order, skipping the square and the river. */
export function plattedBlocks(rings: number, ground: Ground): BlockId[] {
  const out: BlockId[] = []
  for (let r = 0; r <= rings; r++) {
    const shell = [...ringBlocks(r)].sort((a, b) =>
      (Math.abs(a.i) + Math.abs(a.j)) - (Math.abs(b.i) + Math.abs(b.j)) || a.i - b.i || a.j - b.j)
    for (const b of shell) {
      if (b.i === 0 && b.j === 0) continue        // ring 0 is the square; it is never built on
      if (blockIsPlattable(b.i, b.j, ground)) out.push(b)
    }
  }
  return out
}

/** Plots in growth order: nearest the square first, so the town densifies before it sprawls. */
export function freePlots(rings: number, ground: Ground): Plot[] {
  const out = plattedBlocks(rings, ground).flatMap((b) => plotsOf(b.i, b.j))
  return out.sort((a, b) =>
    Math.max(Math.abs(a.block.i), Math.abs(a.block.j)) - Math.max(Math.abs(b.block.i), Math.abs(b.block.j))
    || (Math.abs(a.block.i) + Math.abs(a.block.j)) - (Math.abs(b.block.i) + Math.abs(b.block.j))
    || a.block.i - b.block.i || a.block.j - b.block.j
    || a.slot.localeCompare(b.slot))
}

/** The streets bounding every platted block, and the square. Water is cut out of the set: a
 *  road does not cross a river until somebody builds a bridge. */
export function streetTiles(rings: number, ground: Ground): TileXY[] {
  const seen = new Set<string>()
  const out: TileXY[] = []
  const add = (dx: number, dy: number): void => {
    const k = `${dx},${dy}`
    if (seen.has(k) || ground(dx, dy) === 'water') return
    seen.add(k)
    out.push({ dx, dy })
  }
  for (const b of [...plattedBlocks(rings, ground), { i: 0, j: 0 }]) {
    const x0 = b.i * PITCH, y0 = b.j * PITCH
    for (let s = 0; s < STREET; s++) {
      for (let dx = x0 - STREET; dx < x0 + BLOCK + STREET; dx++) { add(dx, y0 + BLOCK + s); add(dx, y0 - 1 - s) }
      for (let dy = y0 - STREET; dy < y0 + BLOCK + STREET; dy++) { add(x0 + BLOCK + s, dy); add(x0 - 1 - s, dy) }
    }
  }
  return out
}

// ---------------------------------------------------------------- the measurements

export type Massed = { dx: number; dy: number; w: number; h: number }

export function closestPair(structures: readonly Massed[]): number {
  let worst = Infinity
  for (let a = 0; a < structures.length; a++)
    for (let b = a + 1; b < structures.length; b++) {
      const p = centreOf(structures[a]!), q = centreOf(structures[b]!)
      worst = Math.min(worst, Math.hypot(p.sx - q.sx, p.sy - q.sy))
    }
  return worst
}

/** Two numbers: the well, the fire pit and a bridge are not seated on plots, and the monuments
 *  are 73.76 px apart — closer than any pair the lattice governs. Seated-on-a-plot is the test. */
export type TownSpacing = {
  /** Closest pair among plot-seated buildings. The invariant, and the only claim the floor makes. */
  latticeFloor: number
  /** Closest pair in the whole town, monuments and decks included. NOT the invariant. */
  wholeTown: number
  governed: number
  ungoverned: number
}

export function townSpacing(governed: readonly Massed[], ungoverned: readonly Massed[]): TownSpacing {
  return {
    latticeFloor: closestPair(governed),
    wholeTown: closestPair([...governed, ...ungoverned]),
    governed: governed.length,
    ungoverned: ungoverned.length,
  }
}

/** Everything that can be wrong with a town, in one list. An empty list is the whole claim. */
export function townErrors(
  structures: readonly PlacedStructure[],
  roads: readonly TileXY[],
  ground: Ground = RIVER_GROUND,
): string[] {
  const errs: string[] = []
  const road = new Set(roads.map((t) => `${t.dx},${t.dy}`))
  const occupied = new Set<string>()
  for (const s of structures)
    for (const t of placedTiles(s)) {
      const k = `${t.dx},${t.dy}`
      if (occupied.has(k)) errs.push(`two buildings on ${k}`)
      occupied.add(k)
      if (ground(t.dx, t.dy) === 'water') errs.push(`${s.kind} in water at ${k}`)
      if (road.has(k)) errs.push(`${s.kind} on a road at ${k}`)
    }
  for (let a = 0; a < structures.length; a++)
    for (let b = a + 1; b < structures.length; b++) {
      const p = centreOf(structures[a]!), q = centreOf(structures[b]!)
      const d = Math.hypot(p.sx - q.sx, p.sy - q.sy)
      if (d < MIN_SEP) errs.push(`${structures[a]!.kind} and ${structures[b]!.kind} are ${d.toFixed(1)} px apart`)
    }
  for (const s of structures) {
    const d = doorFrontOf(s)
    if (!road.has(`${d.dx},${d.dy}`)) errs.push(`${s.kind} door on ${d.dx},${d.dy}, not a road`)
  }
  return errs
}

/** Exhaustive: the lattice is periodic on PITCH in both axes and a building never leaves its own
 *  block, so a floor that holds across a 3x3 patch holds for the infinite lattice. */
export function latticeFloor(offsets: readonly number[] = PLOT_OFFSETS): {
  closest: number; worst: string; overlaps: number; pairings: number
} {
  const patch: ReadonlyArray<[number, number]> =
    [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]]
  const ps = patch.flatMap(([i, j]) => plotsAt(i, j, offsets))
  const sizes: Array<[number, number]> = []
  for (let a = 1; a <= MAX_ALONG; a++) for (let d = 1; d <= MAX_DEEP; d++) sizes.push([a, d])
  let closest = Infinity, worst = '', overlaps = 0, pairings = 0
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++)
      for (const [a1, d1] of sizes) {
        const s1 = place(ps[i]!, 'x', a1, d1, null)
        const t1 = new Set(placedTiles(s1).map((t) => `${t.dx},${t.dy}`))
        for (const [a2, d2] of sizes) {
          const s2 = place(ps[j]!, 'x', a2, d2, null)
          pairings++
          if (placedTiles(s2).some((t) => t1.has(`${t.dx},${t.dy}`))) { overlaps++; continue }
          const p = centreOf(s1), q = centreOf(s2)
          const d = Math.hypot(p.sx - q.sx, p.sy - q.sy)
          if (d < closest) {
            closest = d
            worst = `(${s1.block.i},${s1.block.j}) ${s1.slot} ${a1}×${d1}  ↔  `
              + `(${s2.block.i},${s2.block.j}) ${s2.slot} ${a2}×${d2}`
          }
        }
      }
  return { closest, worst, overlaps, pairings }
}

/** `plotsOf` with the plot offsets as a parameter, so the survey above can be run against a
 *  lattice the grammar does NOT use and shown to break. Nothing else may call it. */
function plotsAt(i: number, j: number, offsets: readonly number[]): Plot[] {
  const x0 = i * PITCH, y0 = j * PITCH
  const block: BlockId = { i, j }
  return [
    ...offsets.map((ox, n): Plot => ({
      block, slot: `s${n}`, face: 'sw', dx: x0 + ox, anchorY: y0 + BLOCK,
      maxAlong: MAX_ALONG, maxDeep: MAX_DEEP,
    })),
    ...offsets.map((oy, n): Plot => ({
      block, slot: `e${n}`, face: 'se', dy: y0 + oy, anchorX: x0 + BLOCK,
      maxAlong: MAX_ALONG, maxDeep: MAX_DEEP,
    })),
  ]
}

/** ★ THE TOWN IS AS LARGE AS IT HAS GROWN. Nothing here assumes a viewport and nothing here
 *  knows a map size: a renderer that needs a number gets it from the BUILT SET. */
export function townExtent(structures: readonly { dx: number; dy: number; w: number; h: number }[]): {
  tiles: BlockRect | null
  screen: { sx0: number; sy0: number; sx1: number; sy1: number }
} {
  if (structures.length === 0) return { tiles: null, screen: { sx0: 0, sy0: 0, sx1: 0, sy1: 0 } }
  let dx0 = Infinity, dy0 = Infinity, dx1 = -Infinity, dy1 = -Infinity
  for (const s of structures) {
    dx0 = Math.min(dx0, s.dx); dy0 = Math.min(dy0, s.dy)
    dx1 = Math.max(dx1, s.dx + s.w - 1); dy1 = Math.max(dy1, s.dy + s.h - 1)
  }
  return {
    tiles: { dx0, dy0, dx1, dy1 },
    // The screen box of a tile box is its four CORNERS: west is (dx0,dy1), east is (dx1,dy0).
    screen: {
      sx0: screenOf(dx0, dy1).sx, sy0: screenOf(dx0, dy0).sy,
      sx1: screenOf(dx1, dy0).sx, sy1: screenOf(dx1, dy1).sy,
    },
  }
}
