import {
  TOWN_RINGS_GENESIS,
  TOWN_SQUARE,
  makeCityTemplate,
  townOrigin,
  type CityStructure,
} from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import { SHOWCASE_ANCHOR, makeShowcaseMap } from './showcaseMap.js'

// Terrain and structures come from the same makeCityTemplate() call at the same anchor, so the
// roads and the buildings cannot describe two different towns.

export type DevStructure = {
  id: string
  kind: string
  x: number
  y: number
  w: number
  h: number
  /** null = public. The template's own ownership assignment, not an invention of this module. */
  owner: string | null
  /** The face the building presents, straight off the template. A spawn computed from the south
   *  face puts founders through a side wall once buildings turn to suit their plot. */
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

/** The showcase town's square in world coordinates — a FUNCTION of the ring count, because the
 *  template's own corner walks one PITCH north-west per ring. */
export function devTownSquare(
  rings: number = TOWN_RINGS_GENESIS,
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
): { x: number; y: number } {
  return { x: anchor.x + townOrigin(rings), y: anchor.y + townOrigin(rings) }
}

/** Where this array's (0, 0) stands in the authored frame. The engine subtracts `state.origin`
 *  from the authored `TOWN_SQUARE`; with no origin it silently reads a square for another town. */
export function devWorldOrigin(
  rings: number = TOWN_RINGS_GENESIS,
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
): { x: number; y: number } {
  const square = devTownSquare(rings, anchor)
  return { x: TOWN_SQUARE.x - square.x, y: TOWN_SQUARE.y - square.y }
}

/** `rings` grows the LATTICE — blocks, streets and the ground the next ring needs. It does not
 *  stand more buildings: `cityStructures` is genesis's eleven at every ring count. */
export function devTown(
  anchor: { x: number; y: number } = SHOWCASE_ANCHOR,
  rings: number = TOWN_RINGS_GENESIS,
): DevTown {
  const template = makeCityTemplate(anchor, rings)
  const { terrain } = makeShowcaseMap(anchor, rings) // the SAME anchor and rings, so tiles and walls agree
  const structures = template.structures.map((s: CityStructure): DevStructure => {
    const x = anchor.x + s.dx,
      y = anchor.y + s.dy
    return {
      id: devStructureId(s.kind, x, y),
      kind: s.kind,
      x,
      y,
      w: s.w,
      h: s.h,
      owner: s.owner,
      facing: s.facing,
      flammable: s.kind !== 'standing_stone' && s.kind !== 'well',
    }
  })
  return { terrain: terrain as TileId[][], structures, anchor: { x: anchor.x, y: anchor.y } }
}
