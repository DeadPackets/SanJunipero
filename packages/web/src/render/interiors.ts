import {
  DEFAULT_CONFIG,
  INTERIOR_KINDS,
  cityStructures,
  citySlotsFor,
  parseLibraryItemManifest,
  resolveFurnishingKind,
  type AssetRecord,
  type InteriorKind,
  type InteriorMeta,
} from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import { OVERLAP_RANK, depthOrder, type DepthBox } from './depth.js'
import {
  INTERIOR_BODY_PX,
  INTERIOR_TILE,
  interiorToScreen,
  roomTilesFor,
  seatInBlock,
} from './interiorMap.js'
import { CHAR_TARGET_PX } from './charAnim.js'
import { SCENE_TOTAL_MS } from '../ui/sceneTransition.js'

// The vocabulary is @sj/shared's — one source, so a kind added there cannot go missing here.
export type { InteriorKind }

// `bench` joined for the cabin. A refuge is a fire and somewhere to sit by it, and the bench is
// the piece the library already ships for that (1x2 floor, honey-wood planks on two trestles).
type FurnishingKind = 'bed' | 'hearth' | 'table' | 'shelf' | 'crate' | 'tools' | 'bench'
export type Furnishing = { kind: FurnishingKind; slot: { x: number; y: number } }

// The declared minimum room: the floor the renderer can always draw, and the contract the gate
// re-asserts. `roomFurnishings()` serves the richer set on top.
export const INTERIOR_LAYOUTS: Record<InteriorKind, Furnishing[]> = {
  house: [
    { kind: 'bed', slot: { x: 2, y: 1 } },
    { kind: 'hearth', slot: { x: 0, y: 2 } },
    { kind: 'table', slot: { x: 1, y: 2 } },
  ],
  storehouse: [
    { kind: 'shelf', slot: { x: 0, y: 1 } },
    { kind: 'shelf', slot: { x: 1, y: 1 } },
    { kind: 'crate', slot: { x: 2, y: 2 } },
  ],
  shed: [
    { kind: 'tools', slot: { x: 1, y: 1 } },
    { kind: 'crate', slot: { x: 2, y: 1 } },
  ],
  // A fire and somewhere to sit by it. The floor a body sleeps on is the floor itself.
  cabin: [
    { kind: 'hearth', slot: { x: 0, y: 2 } },
    { kind: 'bench', slot: { x: 1, y: 2 } },
  ],
  // The shared dwellings' fallback floor. The real rooms come from the city template, which
  // lays one bed per body out of `roomCapacity`; this is only what is drawn if that is empty.
  cottage: [
    { kind: 'bed', slot: { x: 0, y: 0 } },
    { kind: 'hearth', slot: { x: 0, y: 2 } },
    { kind: 'bench', slot: { x: 1, y: 1 } },
  ],
  farmhouse: [
    { kind: 'bed', slot: { x: 0, y: 0 } },
    { kind: 'hearth', slot: { x: 0, y: 2 } },
    { kind: 'bench', slot: { x: 1, y: 1 } },
  ],
}

/** The room's own size, off the building's plan. Drawing every dwelling on a house's floor
 *  would put the picture at odds with `roomCapacity`; `roomTilesFor` owns the factor. */
export function roomSizeOf(kind: InteriorKind): { w: number; h: number } {
  const plan = DEFAULT_CONFIG.structures.recipes[kind]
  return roomTilesFor(plan === undefined ? { w: 2, h: 2 } : { w: plan.w, h: plan.h })
}

/** The template slot grid this kind's furnishings are laid on — wider for a household that
 *  needs more beds than a 3-wide grid can hold. `slotToTile` divides the room by it. */
export const slotGridOf = (kind: InteriorKind): { w: number; h: number } => citySlotsFor(kind)

export type RoomFurnishing = { kind: string; slot: { x: number; y: number } }

// The city template furnishes each of its eleven buildings; every house is furnished alike, so
// one structure per kind is the whole vocabulary. Built once — this runs per interior open.
const CITY_FURNISHINGS: Record<InteriorKind, RoomFurnishing[]> = (() => {
  const out = {} as Record<InteriorKind, RoomFurnishing[]>
  for (const kind of INTERIOR_KINDS) {
    const s = cityStructures().find((c) => c.kind === kind)
    const source: RoomFurnishing[] =
      s !== undefined && s.furnishings.length > 0 ? s.furnishings : INTERIOR_LAYOUTS[kind]
    out[kind] = source.map((f) => ({ kind: resolveFurnishingKind(f.kind), slot: { ...f.slot } }))
  }
  return out
})()

export function roomFurnishings(kind: InteriorKind): RoomFurnishing[] {
  return CITY_FURNISHINGS[kind]
}

export type RoomItem = RoomFurnishing & { meta: InteriorMeta | null; url: string | null }

function libraryRecord(records: AssetRecord[], kind: string): AssetRecord | null {
  let best: AssetRecord | null = null
  for (const r of records) {
    if (r.status !== 'ready' || r.class !== 'item' || r.kind !== kind) continue
    if (best === null || r.seq > best.seq) best = r
  }
  return best
}

// The room as the renderer needs it: the template's slot, the library's placement facts and the
// sprite to draw. A furnishing with no codex record still lays out — art independence.
export function roomPlan(kind: InteriorKind, records: AssetRecord[]): RoomItem[] {
  return roomFurnishings(kind).map((f) => {
    const rec = libraryRecord(records, f.kind)
    const manifest = rec === null ? null : parseLibraryItemManifest(rec.meta)
    return {
      ...f,
      meta: manifest?.interior ?? null,
      url: rec === null ? null : `/assets/${rec.id}.png`,
    }
  })
}

/** The room's lights are derived from what the room CONTAINS and never from how any of it is
 *  drawn: the hearth reaches the screen as a wall elevation, so there is no object sprite to
 *  hang a glow on. */
export type RoomLight = { id: string; kind: string; tile: { x: number; y: number } }

export function roomLights(
  pieces: readonly { kind: string; tile: { x: number; y: number } }[],
  lightKinds: ReadonlySet<string>,
): RoomLight[] {
  return pieces
    .filter((p) => lightKinds.has(p.kind))
    .map((p) => ({ id: furnishingId(p.kind, p.tile), kind: p.kind, tile: p.tile }))
}

export type Interior = {
  structure: Structure
  kind: InteriorKind
  occupants: string[]
  items: string[]
}

const isInteriorKind = (kind: string): kind is InteriorKind =>
  (INTERIOR_KINDS as readonly string[]).includes(kind)

// Occupancy is engine truth: `insideId`, which the viewer camera never writes. Ids are sorted
// so two browsers watching the same tick lay the same room out.
export function interiorOf(state: WorldState, structureId: string): Interior | null {
  const structure = state.structures[structureId]
  if (structure === undefined || !isInteriorKind(structure.kind)) return null
  const occupants = Object.values(state.agents)
    .filter((a) => a.insideId === structureId)
    .map((a) => a.id)
    .sort()
  const items = Object.values(state.items)
    .filter((i) => i.loc.t === 'structure' && i.loc.id === structureId)
    .map((i) => i.id)
    .sort()
  return { structure, kind: structure.kind, occupants, items }
}

// The library's bed is one interior tile wide and two deep; a partnered pair takes one cell
// each and a third sleeper gets none rather than lying on someone. The cells are INTERIOR TILES.
export const BED_FOOTPRINT = { w: 1, h: 2 } as const

function bedCells(kind: InteriorKind, plan: RoomItem[]): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = []
  // The same seating the room map uses, over the same list in the same order — a sleeper's
  // cell and the bed's own tiles are one answer or a body lies beside its bed.
  const slots = plan.map((p) => p.slot)
  for (const [i, f] of plan.entries()) {
    if (f.meta === null ? f.kind !== 'bed' : f.meta.isBed !== true) continue
    const size = f.meta?.slots ?? BED_FOOTPRINT
    const at = seatInBlock(
      f.slot,
      slots.filter((_, j) => j !== i),
      roomSizeOf(kind),
      slotGridOf(kind),
    )
    for (let dy = 0; dy < size.h; dy++) {
      for (let dx = 0; dx < size.w; dx++) cells.push({ x: at.x + dx, y: at.y + dy })
    }
  }
  return cells
}

/** Which interior tile each sleeper lies in, off the room's ALREADY-BUILT plan — the caller
 *  holds one per plan change, so a sleeping room does not re-read the codex every frame. */
export function bedSlots(
  kind: InteriorKind,
  sleeping: string[],
  plan: RoomItem[] = roomPlan(kind, []),
): Record<string, { x: number; y: number }> {
  const cells = bedCells(kind, plan)
  const out: Record<string, { x: number; y: number }> = {}
  sleeping.forEach((id, i) => {
    const cell = cells[i]
    if (cell !== undefined) out[id] = cell
  })
  return out
}

// ── FURNITURE THAT TOUCHES THE FLOOR, AND BODIES THAT LIE *IN* THE BED ───────────────────
//
// The interior answers to the SAME depth authority as the town (depth.ts). A body in a bed is a
// box INSIDE the bed's box, which the geometric rule reads as "neither in front", so an 'in'
// furnishing is drawn as TWO pieces split at its own mid-line and the body goes between them.

/** 'in' (a bed, a chair) draws the body BETWEEN the furniture's back and front halves;
 *  'at' (a table, an anvil) draws the body behind it; 'beside' is plain depth order. */
export type OccupancyMode = 'in' | 'at' | 'beside'

/** Total over `CITY_FURNISHING_KINDS` — a kind added to the template with no mode fails the
 *  test rather than silently falling through. */
export const FURNITURE_OCCUPANCY: Record<string, OccupancyMode> = {
  bed: 'in',
  chair: 'in',
  bench: 'in',
  table: 'at',
  hearth: 'at',
  anvil: 'at',
  shelf: 'beside',
  crate: 'beside',
  barrel: 'beside',
  rug: 'beside',
}

export function occupancyOf(kind: string): OccupancyMode {
  return FURNITURE_OCCUPANCY[kind] ?? 'beside'
}

/** Contact shadow: an ellipse under every object, sized from what is drawn, half as tall as it
 *  is wide — the ground plane's own ratio. `lift` exists because an iso object's lowest drawn
 *  pixel is the NEAR VERTEX of its ground, not the centre; a body's feet already are that. */
export const CONTACT_SHADOW_ALPHA = 0.22
const CONTACT_SHADOW_SHARE = 0.42
export function contactShadow(widthPx: number): {
  rx: number
  ry: number
  alpha: number
  lift: number
} {
  const rx = Math.max(0, widthPx) * CONTACT_SHADOW_SHARE
  const ry = rx / 2
  return { rx, ry, alpha: CONTACT_SHADOW_ALPHA, lift: ry }
}

/** A cell of the room grid. Since Option C that grid IS the 128x64 interior tile lattice
 *  (`interiorMap.ROOM_TILES`), NOT the template's 3x3 slots — `slotToTile` is the boundary. */
export type Tile = { x: number; y: number }
type TileSize = { w: number; h: number }

/** The tile the library authors against — `assetResolution.INTERIOR_TILE.w`. Its art covers
 *  exactly the span its footprint takes on that tile and the scene zoom is 1, so the factor is
 *  1 for every footprint and nothing in the room is resampled. */
export const LIBRARY_TILE_PX = 128
export function furnishingDivisor(): number {
  return Math.max(1, Math.round(LIBRARY_TILE_PX / INTERIOR_TILE.w))
}
export function furnishingScale(): number {
  return 1 / furnishingDivisor()
}

/**
 * `INTERIOR_PX_SCALE` is the PIXEL factor and it is not the WORLD factor: furniture is authored
 * against a tile that means a METRE, where a town tile means a corner of a plot. So the room
 * asks for the height the ROOM says a person is, and the factor between the two scales is the
 * factor between the two heights and nothing else.
 */
export function interiorBodyScale(townCellScale: number): number {
  return townCellScale * (INTERIOR_BODY_PX / CHAR_TARGET_PX)
}

/** Furnishings that LIE on the floor rather than stand on it: anchored at the CENTRE of their
 *  own ground and casting no contact shadow, or a rug floats up the back wall. */
const FLAT_FURNISHINGS: ReadonlySet<string> = new Set(['rug'])
export const isFlat = (kind: string): boolean => FLAT_FURNISHINGS.has(kind)

/** One drawable in the room. An 'in' furnishing contributes two, split at its mid-line. */
export type RoomPiece = {
  id: string
  kind: 'furniture' | 'body'
  tile: Tile
  size: TileSize
  /** which half of an 'in' furnishing this is; `null` for anything drawn whole */
  half: 'back' | 'front' | null
  /**
   * The ground the sprite is anchored on — and for a split piece it is the WHOLE piece's.
   * `tile`/`size` are the DEPTH box, with the front half pushed half a footprint nearer, and
   * spending that a second time as a POSITION tears the piece in two. Both halves are cut from
   * ONE texture, so both stand where that texture stands.
   */
  anchor: { tile: Tile; size: TileSize }
}

export const furnishingId = (kind: string, tile: Tile): string => `${kind}:${tile.x},${tile.y}`

/** Broad phase only: how far a room sprite may rise above the ground it stands on, in interior
 *  tiles. Generous on purpose — it decides whether two pieces CAN overlap, never who wins. */
const ROOM_SPRITE_RISE_TILES = 3

export type PlacedItem = { kind: string; tile: Tile; meta: InteriorMeta | null }
export type PlacedBody = { id: string; tile: Tile; inside: string | null }

/** Where a body actually stands, given what it is doing. You lie IN a bed and keep its cell;
 *  you stand AT a table, so the body takes the slot BEHIND it and depth falls out of geometry. */
function occupantTile(mode: OccupancyMode, own: Tile, at: Tile | null): Tile {
  if (mode !== 'at' || at === null) return own
  return { x: at.x, y: Math.max(0, at.y - 1) }
}

/** Every drawable in the room, in a stable order. */
export function interiorPieces(
  items: readonly PlacedItem[],
  bodies: readonly PlacedBody[],
): RoomPiece[] {
  const out: RoomPiece[] = []
  const byId = new Map<string, PlacedItem>()
  for (const item of items) {
    const size = item.meta?.slots ?? { w: 1, h: 1 }
    const id = furnishingId(item.kind, item.tile)
    byId.set(id, item)
    const anchor = { tile: item.tile, size }
    if (occupancyOf(item.kind) !== 'in') {
      out.push({ id, kind: 'furniture', tile: item.tile, size, half: null, anchor })
      continue
    }
    const halfH = size.h / 2
    out.push({
      id: `${id}#back`,
      kind: 'furniture',
      tile: item.tile,
      size: { w: size.w, h: halfH },
      half: 'back',
      anchor,
    })
    out.push({
      id: `${id}#front`,
      kind: 'furniture',
      tile: { x: item.tile.x, y: item.tile.y + halfH },
      size: { w: size.w, h: halfH },
      half: 'front',
      anchor,
    })
  }
  for (const b of bodies) {
    const host = b.inside === null ? undefined : byId.get(b.inside)
    const mode = host === undefined ? 'beside' : occupancyOf(host.kind)
    const tile = occupantTile(mode, b.tile, host?.tile ?? null)
    const size = { w: 1, h: 1 }
    out.push({ id: b.id, kind: 'body', tile, size, half: null, anchor: { tile, size } })
  }
  return out
}

/** A piece's box in TILE space, plus a generous screen box for the broad phase. */
function roomDepthBox(p: RoomPiece): DepthBox {
  const x0 = p.tile.x,
    y0 = p.tile.y,
    x1 = p.tile.x + p.size.w,
    y1 = p.tile.y + p.size.h
  const near = interiorToScreen(x1, y1)
  const far = interiorToScreen(x0, y0)
  const east = interiorToScreen(x1, y0)
  const west = interiorToScreen(x0, y1)
  const rise = ROOM_SPRITE_RISE_TILES * INTERIOR_TILE.w
  return {
    id: p.id,
    rank: p.kind === 'body' ? OVERLAP_RANK.body : OVERLAP_RANK.structure,
    x0,
    y0,
    x1,
    y1,
    sx0: west.sx,
    sy0: far.sy - rise,
    sx1: east.sx,
    sy1: near.sy,
  }
}

/** Painter's order for the room, back to front, as piece ids. The town's authority, applied
 *  to the interior tile lattice — one depth rule for the whole product, not two. */
export function interiorOrder(pieces: readonly RoomPiece[]): string[] {
  return depthOrder(pieces.map(roomDepthBox))
}

export type InteriorPhase = 'town' | 'entering' | 'inside' | 'exiting'
/** The room's fade IS a scene change, so it takes the scene vocabulary's length rather than a
 *  number of its own — one motion table, both runtimes. */
export const INTERIOR_FADE_MS = SCENE_TOTAL_MS

// Pure: the caller owns the clock. A viewer who turns around mid-fade reverses; the fade never
// finishes a move that was abandoned.
export function interiorTransition(
  prev: InteriorPhase,
  entered: boolean,
  nowMs: number,
  sinceMs = 0,
): InteriorPhase {
  const done = nowMs - sinceMs >= INTERIOR_FADE_MS
  switch (prev) {
    case 'town':
      return entered ? 'entering' : 'town'
    case 'entering':
      return entered ? (done ? 'inside' : 'entering') : 'exiting'
    case 'inside':
      return entered ? 'inside' : 'exiting'
    case 'exiting':
      return entered ? 'entering' : done ? 'town' : 'exiting'
  }
}

export type InteriorPhaseState = { phase: InteriorPhase; sinceMs: number }

export function advanceInterior(
  state: InteriorPhaseState,
  entered: boolean,
  nowMs: number,
): InteriorPhaseState {
  const next = interiorTransition(state.phase, entered, nowMs, state.sinceMs)
  return next === state.phase ? state : { phase: next, sinceMs: nowMs }
}
