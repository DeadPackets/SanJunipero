import { CITY_INTERIOR_SLOTS, type TownFacing } from '@sj/shared'
import { TILE_H, TILE_W } from './iso.js'

// The room as a GRID: which tiles are floor, which a furnishing takes, where a body stands to
// use one, and whether a walk between two tiles exists. Pure — no Pixi, no pixels. The
// projection is the town's own 2:1; only the pixel scale of one tile changes.

/** How many town pixels one interior pixel is worth. */
export const INTERIOR_PX_SCALE = 4
/** One interior tile, in interior pixels: `TOWN_TILE × INTERIOR_PX_SCALE`. This is the tile the
 *  forge already authors against — `assetResolution.INTERIOR_TILE`. */
export const INTERIOR_TILE = {
  w: TILE_W * INTERIOR_PX_SCALE,
  h: TILE_H * INTERIOR_PX_SCALE,
} as const

/** `CITY_INTERIOR_SLOTS` is engine truth about where a bed goes, not a unit of floor. Giving
 *  each slot a 4 × 2 block leaves seven walkable tiles around a 1×1 furnishing. */
export const TILES_PER_SLOT = { w: 4, h: 2 } as const
export const ROOM_TILES = {
  w: CITY_INTERIOR_SLOTS.w * TILES_PER_SLOT.w,
  h: CITY_INTERIOR_SLOTS.h * TILES_PER_SLOT.h,
} as const

/** Forced, not chosen: a 2 × 2 house's room is 12 × 6, so one plan tile is 6 interior tiles
 *  across and 3 deep — and a house, a storehouse and a cabin all still come out at 12 × 6. */
export const ROOM_TILES_PER_PLAN_TILE = { w: 6, h: 3 } as const

export function roomTilesFor(plan: { w: number; h: number }): Size {
  return {
    w: Math.max(1, plan.w) * ROOM_TILES_PER_PLAN_TILE.w,
    h: Math.max(1, plan.h) * ROOM_TILES_PER_PLAN_TILE.h,
  }
}

/** How many interior tiles one template slot owns in a room this size. The template grid is
 *  3 × 3 for every kind, so this is a division and never a second table. */
export function tilesPerSlot(room: Size = ROOM_TILES, slots: Size = CITY_INTERIOR_SLOTS): Size {
  return {
    w: Math.max(1, Math.floor(room.w / Math.max(1, slots.w))),
    h: Math.max(1, Math.floor(room.h / Math.max(1, slots.h))),
  }
}
/** Where inside its 4×2 block a furnishing's origin tile sits: one tile of clearance on the
 *  -x side, so nothing is jammed into the block seam. */
export const SLOT_ORIGIN_OFFSET = { x: 1, y: 0 } as const

/** The wall's height above the floor plane, in interior pixels — the height the wall art is
 *  authored at (`wall-*.png` is 256 × 160). */
export const WALL_H_PX = 160

// ── THE ROOM'S HUMAN SCALE ───────────────────────────────────────────────────────────────
//
// Going indoors is TWO changes, not one: pixel density (`INTERIOR_PX_SCALE` town px to one
// interior px) AND world scale — one interior tile is ONE METRE of floor, where a town tile is
// a whole corner of a plot. A body scaled by density alone comes out taller than the wall.

/** One metre of height, in interior px. In a 2:1 dimetric the vertical edge of a unit cube
 *  projects to exactly the tile's own height, so this is `INTERIOR_TILE.h` and not a taste
 *  call — corroborated by the 160 px wall (2.5 m) and a 1×2 bed's 2-tile run (2 m). */
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
export function slotToTile(
  slot: Slot,
  room: Size = ROOM_TILES,
  slots: Size = CITY_INTERIOR_SLOTS,
): Tile {
  const per = tilesPerSlot(room, slots)
  return {
    x: slot.x * per.w + SLOT_ORIGIN_OFFSET.x,
    y: slot.y * per.h + SLOT_ORIGIN_OFFSET.y,
  }
}

/**
 * Where inside its own block a piece sits: on the side its neighbour's slot is on, so two
 * adjacent slots do not land two tiles apart. Only the depth axis — a block is four tiles
 * across, where two pieces side by side already read as a pair, and two deep, where they do not.
 */
export function seatInBlock(
  slot: Slot,
  others: readonly Slot[],
  room: Size = ROOM_TILES,
  slots: Size = CITY_INTERIOR_SLOTS,
): Tile {
  const base = slotToTile(slot, room, slots)
  const nearer = others.some((o) => o.x === slot.x && o.y === slot.y + 1)
  const further = others.some((o) => o.x === slot.x && o.y === slot.y - 1)
  if (nearer === further) return base // both sides, or neither: stay where you are
  return { x: base.x, y: base.y + (nearer ? tilesPerSlot(room, slots).h - 1 : 0) }
}

export const inRoom = (t: Tile, room: Size = ROOM_TILES): boolean =>
  t.x >= 0 && t.y >= 0 && t.x < room.w && t.y < room.h

// ── THE TWO WALLS, AND THE TWO FACINGS THEY PRESENT ──────────────────────────────────────
//
// A wall's face has exactly one direction, so it is named here once, in `TownFacing`. NE and NW
// are unauthored and are therefore not in the type, so no placement can ask for one.

export const WALL_KINDS = ['back-left', 'back-right'] as const
export type WallKind = (typeof WALL_KINDS)[number]

/** `back-right` runs along +x from the room origin, so its inner face looks down the +y axis —
 *  SW on screen. `back-left` runs along +y and looks down +x — SE. */
export const WALL_FACING = { 'back-left': 'se', 'back-right': 'sw' } as const satisfies Record<
  WallKind,
  TownFacing
>

/** The wall a tile is against, or `null` when it touches neither — a wall furnishing in a tile
 *  that touches no wall is a PLACEMENT ERROR and reads as one, not as art hanging in the air. */
export function wallOfTile(t: Tile): WallKind | null {
  if (t.y === 0) return 'back-right'
  if (t.x === 0) return 'back-left'
  return null
}

/** How far along its own wall a tile sits, in interior tiles from the room's far corner. */
export const alongWall = (wall: WallKind, t: Tile): number => (wall === 'back-right' ? t.x : t.y)

/** A `placement: 'wall'` piece either STANDS at the foot of its wall — masonry or joinery that
 *  reaches the ground — or HANGS on the face above it. `InteriorMeta` has no field for this. */
export const WALL_PIECES_THAT_STAND: ReadonlySet<string> = new Set(['hearth', 'dresser'])

/** How far above the ground's near vertex each piece's own surface sits, measured off the
 *  shipped art: a body anchored at its feet would otherwise lie under a mattress, not on it. */
export const FURNISHING_SEAT_PX: Readonly<Record<string, number>> = {
  bed: 44,
  chair: 34,
  bench: 30,
}

/** How far above the floor a body drawn INSIDE `kind` is lifted. 0 for anything else, so a
 *  body standing on the floor is untouched. */
export const seatLiftPx = (kind: string | null): number =>
  kind === null ? 0 : (FURNISHING_SEAT_PX[kind] ?? 0)

// ── THE PIECES, AND THE MAP THEY MAKE ────────────────────────────────────────────────────

/** A furnishing placed on the room map. `size` is in INTERIOR TILES, which is what the library
 *  manifest's `slots` has always meant — never 2×2-town-tile slots. */
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

/** The room the furnishings make. A wall piece is pushed onto the wall its slot touches and
 *  takes that wall's facing by construction, so the art and the surface cannot disagree. */
export function roomMapOf(
  inputs: readonly PieceInput[],
  room: Size = ROOM_TILES,
  slots: Size = CITY_INTERIOR_SLOTS,
): RoomMap {
  const blocked = new Uint8Array(room.w * room.h)
  const pieces: MapPiece[] = []
  const taken = inputs.map((i) => i.slot)
  for (const [i, input] of inputs.entries()) {
    const size = input.size ?? { w: 1, h: 1 }
    const placement = input.placement ?? 'floor'
    let tile = seatInBlock(
      input.slot,
      taken.filter((_, j) => j !== i),
      room,
      slots,
    )
    let facing: TownFacing | null = null
    if (placement === 'wall') {
      // A slot column 0 is against the back-left wall, a slot row 0 against the back-right.
      // The origin offset is what would otherwise lift a wall piece off its own wall.
      const wall: WallKind = input.slot.x === 0 && input.slot.y > 0 ? 'back-left' : 'back-right'
      tile = wall === 'back-left' ? { x: 0, y: tile.y } : { x: tile.x, y: 0 }
      facing = WALL_FACING[wall]
    }
    const piece: MapPiece = {
      kind: input.kind,
      tile,
      size,
      placement,
      flat: input.flat === true,
      facing,
    }
    pieces.push(piece)
    if (piece.flat) continue
    for (const t of tilesOf(piece)) {
      if (!inRoom(t, room)) continue
      blocked[t.y * room.w + t.x] = 1
    }
  }
  return { w: room.w, h: room.h, pieces, blocked }
}

export const isWalkable = (map: RoomMap, t: Tile): boolean =>
  inRoom(t, map) && map.blocked[t.y * map.w + t.x] === 0

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
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

// ── WALKING IT ───────────────────────────────────────────────────────────────────────────

/** Four-directional, in the engine's own neighbour order (`engine/path.ts`): a room path and a
 *  town path break their ties the same way, so a body does not walk by two different laws. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
]

/** The tiles a body steps through from `from` to `to`, excluding the start; `null` when no walk
 *  exists. Uniform cost, so breadth-first, expanded in NEIGHBOURS order for determinism. */
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
          for (
            let k: number | undefined = key(n);
            k !== undefined && k !== key(from);
            k = prev.get(k)
          )
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
 * The engine has no furnishings: every verb addresses a structure or a held item, and a body
 * inside one carries `insideId` and no interior position. So `verb` is the CLOSEST verb that
 * exists, `via` what it actually addresses, and `needs` the engine change still missing.
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
    kind: 'bed',
    verb: 'sleep',
    via: 'structure',
    approach: 'in',
    what: 'walk to a tile beside it, lie in it and sleep; a partnered pair takes one cell each',
    needs:
      'sleep validates `sleepableKinds` on the HOUSE and nothing names the bed. It needs an ' +
      'optional `{furnishingId}` so a sleeper is in a particular bed, and so a second sleeper ' +
      'can be refused when the cells are taken.',
  },
  {
    kind: 'hearth',
    verb: 'stoke',
    via: 'structure',
    approach: 'at',
    what: 'walk to a tile beside it and feed, light or put out the fire',
    needs:
      'stoke/extinguish take a `{structureId}` in `HEAT_SOURCE_KINDS` — the town fire pit. A ' +
      'hearth is a furnishing, so no verb reaches it. It needs furnishings to be addressable ' +
      '(a `{structureId, furnishingId}` pair) and `house` hearths added to the heat sources.',
  },
  {
    kind: 'table',
    verb: 'stow',
    via: 'structure',
    approach: 'at',
    what: 'walk to a tile beside it and put an item down, or take one back',
    needs:
      'stow moves an item to `{t:"structure"}` — into the HOUSE, not onto the table. An item ' +
      'location of `{t:"furnishing", id}` would put the bowl on the table, and the room could ' +
      'then draw what is standing on it.',
  },
  {
    kind: 'chair',
    verb: null,
    via: 'none',
    approach: 'in',
    what: 'walk to a tile beside it and sit on it',
    needs:
      'a `sit` verb, and an agent field that says "seated at <furnishingId>", cleared by ' +
      'walk/enter/exit — so the room can draw the body IN the chair instead of standing over it.',
  },
  {
    kind: 'rug',
    verb: null,
    via: 'none',
    approach: 'on',
    what: 'walk across it — the one piece that does not block its own tiles',
    needs: null,
  },
]

export const actFor = (kind: string): PieceAct | null =>
  INTERIOR_ACTS.find((a) => a.kind === kind) ?? null
