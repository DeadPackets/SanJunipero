import { TOWN_RINGS_GENESIS, TOWN_SQUARE, makeCityTemplate, townOrigin, type CityStructure } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { SHOWCASE_ANCHOR, makeShowcaseMap } from './showcaseMap.js'

// THE ONE DERIVATION. Before this module the dev world laid the city template's TILES and then
// placed six hand-authored buildings from an unrelated fixture on top of them — the roads and
// the buildings described two different towns, which is what read as "chaos". Terrain and
// structures now come from the same makeCityTemplate() call at the same anchor, so they cannot
// disagree again.

export type DevStructure = {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  /** null = public. The template's own ownership assignment, not an invention of this module. */
  owner: string | null
  /** The face the building presents, straight off the template. A spawn computed from the
   *  south face put half the founders through a side wall once the town started turning
   *  buildings to suit their plot. */
  facing: 'sw' | 'se'
  flammable: boolean
}

export type DevTown = {
  terrain: TileId[][]
  structures: DevStructure[]
  anchor: { x: number; y: number }
}

/** Deterministic, collision-free, and readable in a log. Two calls are byte-equal. */
export function devStructureId(kind: string, x: number, y: number): string {
  return `structure_${kind}_${x}_${y}`
}

/** ★ THE SHOWCASE TOWN'S SQUARE, in world coordinates. The town grows outward around the
 *  square, so it is the one town coordinate that has a world coordinate — and it is a FUNCTION
 *  of the ring count, because the template's own corner walks one PITCH north-west per ring.
 *  (68, 68) at three rings; (30, 30) at one. */
export function devTownSquare(
  rings: number = TOWN_RINGS_GENESIS, anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
): { x: number; y: number } {
  return { x: anchor.x + townOrigin(rings), y: anchor.y + townOrigin(rings) }
}

/**
 * ★ WHERE THIS ARRAY'S (0, 0) STANDS IN THE AUTHORED FRAME — and why the dev world has to say.
 *
 * The engine finds the town by reading the AUTHORED constant `TOWN_SQUARE` (65, 78) and
 * subtracting `state.origin` (`town.ts` `townSquareOf`). Everything the claim seam does hangs
 * off that one tile: the blocks, the plots, the street rings, the plat rule's river.
 *
 * The showcase lays the same `makeCityTemplate` town at its OWN anchor, so its square is
 * (68, 68) at ring 3. With no origin the engine looked for a square at (65, 78) — and found
 * one, because (65, 78) lands on a paved tile of the plaza's own street ring. Not null, not an
 * error: a confident answer about a town three tiles west and ten north of the one that is
 * drawn. Every plot it offered sat off the lattice a viewer can see, and `layBlock` would have
 * paved a second, misaligned grid over the first.
 *
 * The field's own meaning is the whole fix. The array's (0, 0) really does stand at authored
 * (-3, 10), because the showcase array IS the authored frame at a different offset. The check
 * that this is a derivation and not a fudge: under it the showcase's channel reads as authored
 * columns 48, 49 and 50 — exactly the channel `CITY_GROUND` knows — at EVERY ring count, and
 * `devTown.test.ts` asserts that agreement rather than trusting it.
 */
export function devWorldOrigin(
  rings: number = TOWN_RINGS_GENESIS, anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
): { x: number; y: number } {
  const square = devTownSquare(rings, anchor)
  return { x: TOWN_SQUARE.x - square.x, y: TOWN_SQUARE.y - square.y }
}

/** `rings` grows the LATTICE — the blocks, the streets and the ground the next ring needs.
 *  It does not stand more buildings: `cityStructures` is genesis's eleven at every count, and
 *  wiring an agent's build to a plot claim is the world-growth lane's open C-2. So a ring-3
 *  showcase is the same town in a town-sized road grid, which is exactly the case the chunked
 *  ground baker exists for and nobody had seen on a screen. */
export function devTown(
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR, rings: number = TOWN_RINGS_GENESIS,
): DevTown {
  const template = makeCityTemplate(anchor, rings)
  const { terrain } = makeShowcaseMap(anchor, rings)   // the SAME anchor and rings, so tiles and walls agree
  const structures = template.structures.map((s: CityStructure): DevStructure => {
    const x = anchor.x + s.dx, y = anchor.y + s.dy
    return {
      id: devStructureId(s.kind, x, y),
      kind: s.kind, x, y, w: s.w, h: s.h,
      owner: s.owner, facing: s.facing,
      flammable: s.kind !== 'standing_stone' && s.kind !== 'well',
    }
  })
  return { terrain: terrain as TileId[][], structures, anchor: { x: anchor.x, y: anchor.y } }
}
