import { makeCityTemplate, type CityStructure } from '@sj/shared'
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

export function devTown(anchor: { x: number; y: number } = SHOWCASE_ANCHOR): DevTown {
  const template = makeCityTemplate(anchor)
  const { terrain } = makeShowcaseMap(anchor)   // the SAME anchor, so tiles and walls agree
  const structures = template.structures.map((s: CityStructure): DevStructure => {
    const x = anchor.x + s.dx, y = anchor.y + s.dy
    return {
      id: devStructureId(s.kind, x, y),
      kind: s.kind, x, y, w: s.w, h: s.h,
      owner: s.owner,
      flammable: s.kind !== 'standing_stone' && s.kind !== 'well',
    }
  })
  return { terrain: terrain as TileId[][], structures, anchor: { x: anchor.x, y: anchor.y } }
}
