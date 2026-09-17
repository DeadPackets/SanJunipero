import { makeOrchardTemplate, ORCHARD_ANCHOR, ORCHARD_SIZE } from '@sj/shared'
import { genesisTerrainAt } from '@sj/engine'
import type { TileId } from '@sj/engine/state'
import { devStructureId, type DevTown } from './devTown.js'

export const ORCHARD_MARGIN = 18
export const ORCHARD_DEV_ORIGIN = {
  x: ORCHARD_ANCHOR.x - ORCHARD_MARGIN,
  y: ORCHARD_ANCHOR.y - ORCHARD_MARGIN,
}

export function orchardTown(): DevTown {
  const anchor = { x: ORCHARD_MARGIN, y: ORCHARD_MARGIN },
    template = makeOrchardTemplate(anchor),
    span = ORCHARD_SIZE + 2 * ORCHARD_MARGIN
  const terrain = Array.from({ length: span }, (_, y) =>
    Array.from({ length: span }, (_, x) =>
      genesisTerrainAt(x + ORCHARD_DEV_ORIGIN.x, y + ORCHARD_DEV_ORIGIN.y),
    ),
  )
  for (const t of template.tiles) terrain[t.dy + anchor.y]![t.dx + anchor.x] = t.to as TileId
  const structures = template.structures.map((s) => ({
    id: devStructureId(s.kind, s.dx + anchor.x, s.dy + anchor.y),
    kind: s.kind,
    x: s.dx + anchor.x,
    y: s.dy + anchor.y,
    w: s.w,
    h: s.h,
    owner: s.owner,
    facing: s.facing,
    flammable: !['well', 'bridge', 'lamp_post'].includes(s.kind),
    ...(s.name === undefined ? {} : { name: s.name }),
  }))
  return { terrain, structures, anchor }
}
