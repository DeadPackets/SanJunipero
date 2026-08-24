import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { interiorPieceKind, materialKind, type AssetRecord } from '@sj/shared'
import type { AssetCodex } from './codex.js'
import { INTERIOR_TILE } from './assetResolution.js'

// ★ THE INTERIOR TILESET — Option C's nine pieces, and where they came from.
//
// The interior-mock round generated twelve images for treatment C: five furnishings, which
// already ship as committed library items, and SEVEN floor-and-wall pieces, which had nowhere
// to live because nothing in the product could draw a wall from art. They lived in a mock
// worktree, which is exactly how the round-3 library was lost twice. They are committed here,
// beside the buildings, the cast and the items, and registered into the codex at ingest.
//
// ★ NOTHING IS RE-GENERATED AND NOTHING IS PAID FOR AGAIN. The mock's `art/spend.json` books
// the whole round at $1.80; these are those bytes, moved. `costUsd: 0` on every row.
//
// The remaining two of the nine are cut from these in code: the far-row shade and the seam the
// two walls meet in, which is why the stat strip says nine pieces from seven generations.

export const INTERIORS_CONTENT_DIR =
  fileURLToPath(new URL('../content/interiors', import.meta.url))

/** A floor material is sampled continuously across the room, so it has no orientation and is
 *  registered the way the ground's own materials are. A wall is an ELEVATION: a flat, square-on
 *  view of the inside face of one wall, sheared onto the wall plane by the renderer. */
export type InteriorPieceRole = 'floor-material' | 'wall'

export type InteriorPiece = {
  id: string
  role: InteriorPieceRole
  w: number
  h: number
  desc: string
}

/** One wall strip spans four interior tiles of wall: `4 × 128 / 2` = 256 px across. */
export const WALL_STRIP_TILES = 4
export const WALL_STRIP_PX = { w: (WALL_STRIP_TILES * INTERIOR_TILE.w) / 2, h: 160 } as const

export const INTERIOR_PIECES: readonly InteriorPiece[] = [
  {
    id: 'floor', role: 'floor-material', w: 512, h: 512,
    desc: 'wide horizontal honey-wood floorboards, three to the square, seamless in both axes',
  },
  {
    id: 'flagstone', role: 'floor-material', w: 256, h: 256,
    desc: 'irregular warm-grey and cream flagstones with pale mortar, laid edge to edge',
  },
  {
    id: 'wall-plain', role: 'wall', ...WALL_STRIP_PX,
    desc: 'lime-washed cream plaster over a honey-wood wainscot, with a rail and a deep skirting',
  },
  {
    id: 'wall-window', role: 'wall', ...WALL_STRIP_PX,
    desc: 'a deep-set cottage window of six leaded panes, a folded shutter and a pot of sage on the sill',
  },
  {
    id: 'wall-door', role: 'wall', ...WALL_STRIP_PX,
    desc: 'a five-plank honey-wood door with iron strap hinges, a ring latch and a stone threshold',
  },
  {
    id: 'wall-chimney', role: 'wall', ...WALL_STRIP_PX,
    desc: 'a warm-grey stone chimney breast rising out of the plaster, with a mantel and soot above the opening',
  },
  {
    id: 'wall-dresser', role: 'wall', ...WALL_STRIP_PX,
    desc: 'a tall honey-wood dresser of open crockery shelves over two closed cupboard doors',
  },
]

/**
 * The codex kind a piece is registered under. A floor material takes the ground's own
 * `material:` namespace, because the renderer already resolves a continuous interior floor
 * through `resolveMaterial('interior-floor')` and a second namespace for the same idea would
 * be two things to keep in step. A wall takes `interior:` — it is an elevation, not a material,
 * and it is never sampled continuously.
 */
export function interiorCodexKind(piece: InteriorPiece): string {
  return piece.role === 'floor-material'
    ? materialKind(piece.id === 'floor' ? 'interior-floor' : `interior-${piece.id}`)
    : interiorPieceKind(piece.id)
}

export type CommittedInterior = InteriorPiece & { png: Buffer; kind: string }

/** Every committed interior piece. A declared piece with no file on disk is an ERROR, not a
 *  skip: half a tileset is how art goes quietly missing, and it has twice. */
export function listCommittedInteriors(root: string = INTERIORS_CONTENT_DIR): CommittedInterior[] {
  if (!existsSync(root)) return []
  return INTERIOR_PIECES.map((piece) => {
    const path = join(root, `${piece.id}.png`)
    if (!existsSync(path)) throw new Error(`interiors/${piece.id}.png is missing`)
    return { ...piece, png: readFileSync(path), kind: interiorCodexKind(piece) }
  })
}

export type InteriorIngestEntry = { kind: string; action: 'registered' | 'unchanged'; id: string }

/** Idempotent, on the same law the committed items register by: unchanged bytes register
 *  nothing, and re-authored art gets a new record that wins by seq. */
export function registerCommittedInteriors(
  codex: AssetCodex, opts: { root?: string } = {},
): InteriorIngestEntry[] {
  const latest = new Map<string, AssetRecord>()
  for (const r of codex.listSince(0)) {
    if (r.status === 'ready' && r.class === 'terrain' && r.kind !== null) latest.set(r.kind, r)
  }
  const out: InteriorIngestEntry[] = []
  for (const piece of listCommittedInteriors(opts.root)) {
    const existing = latest.get(piece.kind)
    if (existing !== undefined && codex.get(existing.id)?.png.equals(piece.png) === true) {
      out.push({ kind: piece.kind, action: 'unchanged', id: existing.id })
      continue
    }
    const rec = codex.register({
      class: 'terrain', desc: piece.desc, kind: piece.kind, meta: null,
      footprint: { w: 1, h: 1 }, png: piece.png,
      widthPx: piece.w, heightPx: piece.h,
      status: 'ready', score: null, attempts: 1,
      costUsd: 0,   // the interior-mock round already booked this generation
    })
    out.push({ kind: piece.kind, action: 'registered', id: rec.id })
  }
  return out
}
