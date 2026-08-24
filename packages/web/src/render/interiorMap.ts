import { CITY_INTERIOR_SLOTS, type TownFacing } from '@sj/shared'
import { TILE_H, TILE_W } from './iso.js'

// ★ THE ROOM IS A MAP, NOT A BACKDROP — Option C, measured off `mocks/interiors` treatment `c`.
//
// The user chose C over A and B for one stated reason: "I want NPCs to be able to actually walk
// around and interact with objects." 72 tiles instead of 36 buys nothing unless a body can
// occupy them, so this module is the room as a GRID: which tiles are floor, which are taken by
// a piece of furniture, where a body stands to use one, and whether a walk between two tiles
// exists. Pure — no Pixi, no pixels — so every number here is measurable offline.
//
// THE PROJECTION DOES NOT CHANGE. It is the town's own 2:1 dimetric; what changes is the pixel
// scale of one tile. `INTERIOR_PX_SCALE` town pixels become one interior pixel, so the camera
// pushing through a doorway is a push-IN and never a change of world.

/** How many town pixels one interior pixel is worth. The mock's `ips`. */
export const INTERIOR_PX_SCALE = 4
/** One interior tile, in interior pixels: `TOWN_TILE × INTERIOR_PX_SCALE`. This is the tile the
 *  forge already authors against — `assetResolution.INTERIOR_TILE`. */
export const INTERIOR_TILE = { w: TILE_W * INTERIOR_PX_SCALE, h: TILE_H * INTERIOR_PX_SCALE } as const

/**
 * ★ ONE TEMPLATE SLOT IS 4 × 2 INTERIOR TILES, AND THAT IS WHERE THE WALKING ROOM COMES FROM.
 *
 * `cityTemplate.CITY_INTERIOR_SLOTS` is 3×3 and is engine truth: it is where the world says a
 * bed goes. It is NOT a unit of floor. Giving each slot a 4×2 block of tiles turns the same
 * furnished room into a 12×6 map, so a 1×1 furnishing stands on ONE of its block's eight tiles
 * and the other seven are floor a body can cross.
 */
export const TILES_PER_SLOT = { w: 4, h: 2 } as const
export const ROOM_TILES = {
  w: CITY_INTERIOR_SLOTS.w * TILES_PER_SLOT.w,
  h: CITY_INTERIOR_SLOTS.h * TILES_PER_SLOT.h,
} as const
/** Where inside its 4×2 block a furnishing's origin tile sits: one tile of clearance on the
 *  -x side, so nothing is jammed into the block seam. */
export const SLOT_ORIGIN_OFFSET = { x: 1, y: 0 } as const

/** The wall's height above the floor plane, in interior pixels — the height the wall art is
 *  authored at (`wall-*.png` is 256 × 160). */
export const WALL_H_PX = 160

// ── ★ THE ROOM'S HUMAN SCALE — AND WHY THE BODY WAS TWICE THE SIZE IT SHOULD BE ──────────
//
// WHAT THE BROWSER SHOWED: a sleeper dwarfs his own bed and the table beside him reads as a
// footstool. Measured off the glass: a body is 208 px against a 192 px bed, and against a
// 160 px WALL — a person a third taller than the room he is standing in.
//
// WHY, AND IT IS NOT AN 8% MISMATCH. Going indoors is TWO changes at once and only one of them
// ever reached a body:
//   1. PIXEL DENSITY — one interior pixel is `INTERIOR_PX_SCALE` town pixels.
//   2. WORLD SCALE — an interior tile is NOT a quarter of a town tile of ground. The library
//      authors furniture against it in the dimensions furniture actually has: a bed is 1×2, a
//      table 1×1, a chair 1×1. ONE INTERIOR TILE IS ONE METRE OF FLOOR, where a town tile is
//      a whole corner of a house's plot. Going through a door is a zoom in the WORLD, not only
//      in the pixels.
// The renderer multiplied a body by (1) alone, so it kept the town's body-to-tile ratio inside
// a room whose tile means something else entirely. Nothing showed it while the furniture was
// resampled to the town's own scale; Option C drew the furniture at its authored size and the
// disagreement became the picture.

/** ★ ONE METRE OF HEIGHT, IN INTERIOR PIXELS. In a 2:1 dimetric the vertical edge of a unit
 *  cube projects to exactly the tile's own height, so the room's height scale is not a taste
 *  call: it is `INTERIOR_TILE.h`. It is corroborated by the only two authored things in the
 *  room that have a known real size — the 160 px wall is 2.5 m, which is a cottage wall, and
 *  a 1×2 bed's 2-tile run is 2 m, which is a bed. */
export const INTERIOR_PX_PER_M = INTERIOR_TILE.h
/** A grown townsperson, standing. */
export const ADULT_HEIGHT_M = 1.7
/** How tall a standing body is drawn in the room, in interior px at `ROOM_ZOOM`. */
export const INTERIOR_BODY_PX = Math.round(ADULT_HEIGHT_M * INTERIOR_PX_PER_M)

/** The screen length of a run of `tiles` along one of the room's ground axes — how long a bed
 *  or a table is on the glass, as opposed to how wide its sprite is. */
export const groundRunPx = (tiles: number): number =>
  Math.hypot(tiles * (INTERIOR_TILE.w / 2), tiles * (INTERIOR_TILE.h / 2))

/** Interior tile → room space, the town's projection with the interior tile's own size. */
export function interiorToScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: (x - y) * (INTERIOR_TILE.w / 2), sy: (x + y) * (INTERIOR_TILE.h / 2) }
}

export type Slot = { x: number; y: number }
export type Tile = { x: number; y: number }
export type Size = { w: number; h: number }

/** The origin tile of a template slot. Total over the 3×3 grid, and the inverse of nothing —
 *  a tile does not have to belong to a slot, which is the point. */
export function slotToTile(slot: Slot): Tile {
  return {
    x: slot.x * TILES_PER_SLOT.w + SLOT_ORIGIN_OFFSET.x,
    y: slot.y * TILES_PER_SLOT.h + SLOT_ORIGIN_OFFSET.y,
  }
}

export const inRoom = (t: Tile): boolean =>
  t.x >= 0 && t.y >= 0 && t.x < ROOM_TILES.w && t.y < ROOM_TILES.h

// ── THE TWO WALLS, AND THE TWO FACINGS THEY PRESENT ──────────────────────────────────────
//
// ★ TASK 2, AND IT IS A TYPE FIX. The room used to decide which wall a `placement: 'wall'`
// furnishing hangs on with `slot.x > slot.y`, and NOTHING anywhere said which way the piece
// then faces. That is how a fireplace authored facing SW came to be mounted on the wall whose
// face points SE — the mismatch the user saw. A wall's face has exactly one direction, so it
// is named here, once, in `TownFacing` — the project's two-facing law. NE and NW are
// unauthored and are therefore not in the type, so no placement can ask for one.

export const WALL_KINDS = ['back-left', 'back-right'] as const
export type WallKind = (typeof WALL_KINDS)[number]

/** `back-right` runs along +x from the room origin, so its inner face looks down the +y axis —
 *  SW on screen. `back-left` runs along +y and looks down +x — SE. */
export const WALL_FACING = { 'back-left': 'se', 'back-right': 'sw' } as const satisfies
  Record<WallKind, TownFacing>

/** The wall a tile is against, or `null` when it touches neither. A wall furnishing in a tile
 *  that touches no wall is a PLACEMENT ERROR and reads as one, rather than hanging in the air
 *  on whichever wall an arbitrary comparison picked. */
export function wallOfTile(t: Tile): WallKind | null {
  if (t.y === 0) return 'back-right'
  if (t.x === 0) return 'back-left'
  return null
}

/** How far along its own wall a tile sits, in interior tiles from the room's far corner. */
export const alongWall = (wall: WallKind, t: Tile): number =>
  wall === 'back-right' ? t.x : t.y

/**
 * A `placement: 'wall'` furnishing either STANDS at the foot of its wall — a hearth, a dresser:
 * masonry or joinery that reaches the ground — or HANGS on the wall face above it, like a shelf
 * or a lantern. The room hung all of them, which is what put a fireplace halfway up a wall.
 *
 * ★ HANDED BACK: `InteriorMeta` has no field for this, so the answer lives here as one table
 * rather than being guessed per piece. It belongs in the library manifest beside `placement`.
 */
export const WALL_PIECES_THAT_STAND: ReadonlySet<string> = new Set(['hearth', 'dresser'])

// ── THE PIECES, AND THE MAP THEY MAKE ────────────────────────────────────────────────────

/** A furnishing placed on the room map. `size` is in INTERIOR TILES, which is what the library
 *  manifest's `slots` has always meant: the forge sizes item art at `(w + h) × 64` px off the
 *  128 × 64 interior tile (`assetResolution.nativeSizeFor`), so a 1×2 bed is authored 192 px
 *  across. The renderer used to read the same field as 2×2-town-tile SLOTS and drew that art at
 *  twice its own resolution. */
export type MapPiece = {
  kind: string
  tile: Tile
  size: Size
  /** `wall` pieces are part of the wall elevation; `floor` pieces stand on the floor. */
  placement: 'floor' | 'wall'
  /** A rug is walked ON, not around. */
  flat: boolean
  /** Set for a wall piece: the face it presents. Never `ne`/`nw` — those do not exist. */
  facing: TownFacing | null
}

export type RoomMap = {
  w: number
  h: number
  pieces: MapPiece[]
  /** 1 where a body cannot stand. Row-major, `w × h`. */
  blocked: Uint8Array
}

/** Every tile a piece covers. */
export function tilesOf(p: MapPiece): Tile[] {
  const out: Tile[] = []
  for (let dy = 0; dy < p.size.h; dy++)
    for (let dx = 0; dx < p.size.w; dx++) out.push({ x: p.tile.x + dx, y: p.tile.y + dy })
  return out
}

export type PieceInput = {
  kind: string
  slot: Slot
  size?: Size
  placement?: 'floor' | 'wall'
  flat?: boolean
}

/**
 * The room the furnishings make. A wall piece is pushed onto the wall its slot touches, so it
 * is part of the elevation rather than an object standing in front of one; its facing is the
 * wall's, by construction, which is the only way the art and the surface can agree.
 */
export function roomMapOf(inputs: readonly PieceInput[]): RoomMap {
  const blocked = new Uint8Array(ROOM_TILES.w * ROOM_TILES.h)
  const pieces: MapPiece[] = []
  for (const input of inputs) {
    const size = input.size ?? { w: 1, h: 1 }
    const placement = input.placement ?? 'floor'
    let tile = slotToTile(input.slot)
    let facing: TownFacing | null = null
    if (placement === 'wall') {
      // A slot column 0 is against the back-left wall, a slot row 0 against the back-right.
      // The origin offset is what would otherwise lift a wall piece off its own wall.
      const wall: WallKind = input.slot.x === 0 && input.slot.y > 0 ? 'back-left' : 'back-right'
      tile = wall === 'back-left' ? { x: 0, y: tile.y } : { x: tile.x, y: 0 }
      facing = WALL_FACING[wall]
    }
    const piece: MapPiece = { kind: input.kind, tile, size, placement, flat: input.flat === true, facing }
    pieces.push(piece)
    if (piece.flat) continue
    for (const t of tilesOf(piece)) {
      if (!inRoom(t)) continue
      blocked[t.y * ROOM_TILES.w + t.x] = 1
    }
  }
  return { w: ROOM_TILES.w, h: ROOM_TILES.h, pieces, blocked }
}

export const isWalkable = (map: RoomMap, t: Tile): boolean =>
  inRoom(t) && map.blocked[t.y * map.w + t.x] === 0

/** How many tiles of this room a body can stand on. The number the C stat strip calls "tiles in
 *  room", less what the furniture takes. */
export const walkableCount = (map: RoomMap): number =>
  map.blocked.reduce((n, b) => n + (b === 0 ? 1 : 0), 0)

/** The floor tiles orthogonally beside a piece — where a body stands to use it. Deterministic
 *  order, so two viewers watching the same room put the same body in the same place. */
export function standingTiles(map: RoomMap, p: MapPiece): Tile[] {
  const seen = new Set<number>()
  const out: Tile[] = []
  for (const t of tilesOf(p)) {
    for (const [dx, dy] of NEIGHBOURS) {
      const n = { x: t.x + dx, y: t.y + dy }
      const key = n.y * map.w + n.x
      if (seen.has(key) || !isWalkable(map, n)) continue
      seen.add(key)
      out.push(n)
    }
  }
  return out.sort((a, b) => (a.y - b.y) || (a.x - b.x))
}

// ── WALKING IT ───────────────────────────────────────────────────────────────────────────

/** Four-directional, in the engine's own neighbour order (`engine/path.ts`): a room path and a
 *  town path break their ties the same way, so a body does not walk by two different laws. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [1, 0], [0, 1]]

/**
 * The tiles a body steps through to get from `from` to `to`, excluding the tile it starts on.
 * `null` when no walk exists. Uniform-cost — a room floor is a room floor — so this is a
 * breadth-first search, and the frontier is expanded in NEIGHBOURS order for determinism.
 */
export function interiorPath(map: RoomMap, from: Tile, to: Tile): Tile[] | null {
  if (!isWalkable(map, from) || !isWalkable(map, to)) return null
  if (from.x === to.x && from.y === to.y) return []
  const key = (t: Tile): number => t.y * map.w + t.x
  const prev = new Map<number, number>()
  const seen = new Set<number>([key(from)])
  let frontier: Tile[] = [from]
  while (frontier.length > 0) {
    const next: Tile[] = []
    for (const cur of frontier) {
      for (const [dx, dy] of NEIGHBOURS) {
        const n = { x: cur.x + dx, y: cur.y + dy }
        if (!isWalkable(map, n) || seen.has(key(n))) continue
        seen.add(key(n))
        prev.set(key(n), key(cur))
        if (n.x === to.x && n.y === to.y) {
          const path: Tile[] = []
          for (let k: number | undefined = key(n); k !== undefined && k !== key(from); k = prev.get(k))
            path.push({ x: k % map.w, y: Math.floor(k / map.w) })
          return path.reverse()
        }
        next.push(n)
      }
    }
    frontier = next
  }
  return null
}

// ── WHAT A BODY CAN DO WITH EACH PIECE ───────────────────────────────────────────────────

/**
 * ★ THE HONEST LEDGER, AND ITS ONE UNCOMFORTABLE FACT: THE ENGINE HAS NO FURNISHINGS.
 *
 * `grep -rn furnishing packages/engine/src` returns nothing. Every verb that could plausibly
 * act on one addresses either a STRUCTURE (`sleep`, `stow`, `stoke`, `extinguish` — all
 * `{structureId}`) or an ITEM in hand (`kindle`, `snuff` — `{itemId}`). A body inside a
 * structure carries `insideId` and no interior position at all, so where it stands in the room
 * is the renderer's own truth and cannot yet be the world's.
 *
 * So `verb` here is the verb that comes CLOSEST, `via` is what it actually addresses, and
 * `needs` is the exact thing the engine would have to grow. Nothing in this file invents a
 * verb; a row with a `needs` is a gap handed back, not a feature half-built.
 *
 * `approach` is how a body relates to the piece once it has walked to a standing tile — the
 * same vocabulary `interiors.occupancyOf` already sorts depth by.
 */
export type PieceAct = {
  kind: string
  /** the closest verb the engine already has, or `null` when there is none at all */
  verb: string | null
  /** what that verb actually addresses today */
  via: 'structure' | 'held-item' | 'none'
  approach: 'in' | 'at' | 'on'
  /** what a body can do with it in the room the renderer draws */
  what: string
  /** the engine change that would make `what` world truth rather than a picture */
  needs: string | null
}

export const INTERIOR_ACTS: readonly PieceAct[] = [
  {
    kind: 'bed', verb: 'sleep', via: 'structure', approach: 'in',
    what: 'walk to a tile beside it, lie in it and sleep; a partnered pair takes one cell each',
    needs: 'sleep validates `sleepableKinds` on the HOUSE and nothing names the bed. It needs an '
      + 'optional `{furnishingId}` so a sleeper is in a particular bed, and so a second sleeper '
      + 'can be refused when the cells are taken.',
  },
  {
    kind: 'hearth', verb: 'stoke', via: 'structure', approach: 'at',
    what: 'walk to a tile beside it and feed, light or put out the fire',
    needs: 'stoke/extinguish take a `{structureId}` in `HEAT_SOURCE_KINDS` — the town fire pit. A '
      + 'hearth is a furnishing, so no verb reaches it. It needs furnishings to be addressable '
      + '(a `{structureId, furnishingId}` pair) and `house` hearths added to the heat sources.',
  },
  {
    kind: 'table', verb: 'stow', via: 'structure', approach: 'at',
    what: 'walk to a tile beside it and put an item down, or take one back',
    needs: 'stow moves an item to `{t:"structure"}` — into the HOUSE, not onto the table. An item '
      + 'location of `{t:"furnishing", id}` would put the bowl on the table, and the room could '
      + 'then draw what is standing on it.',
  },
  {
    kind: 'chair', verb: null, via: 'none', approach: 'in',
    what: 'walk to a tile beside it and sit on it',
    needs: 'a `sit` verb, and an agent field that says "seated at <furnishingId>", cleared by '
      + 'walk/enter/exit — so the room can draw the body IN the chair instead of standing over it.',
  },
  {
    kind: 'rug', verb: null, via: 'none', approach: 'on',
    what: 'walk across it — the one piece that does not block its own tiles',
    needs: null,
  },
]

export const actFor = (kind: string): PieceAct | null =>
  INTERIOR_ACTS.find((a) => a.kind === kind) ?? null
