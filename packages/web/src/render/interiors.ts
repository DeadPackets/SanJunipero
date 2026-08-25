import {
  DEFAULT_CONFIG, INTERIOR_KINDS, cityStructures, citySlotsFor, parseLibraryItemManifest,
  resolveFurnishingKind,
  type AssetRecord, type InteriorKind, type InteriorMeta,
} from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import { OVERLAP_RANK, depthOrder, type DepthBox } from './depth.js'
import {
  INTERIOR_BODY_PX, INTERIOR_TILE, interiorToScreen, roomTilesFor, seatInBlock,
} from './interiorMap.js'
import { CHAR_TARGET_PX } from './charAnim.js'
import { SCENE_TOTAL_MS } from '../ui/sceneTransition.js'

// The vocabulary is @sj/shared's (C13 interiorMeta.ts) — one source, so a kind added there
// cannot go missing here. Re-exported because Task 11 and the gate read it off this module.
export { INTERIOR_KINDS } from '@sj/shared'
export type { InteriorKind }

// `bench` joined for the cabin. A refuge is a fire and somewhere to sit by it, and the bench is
// the piece the library already ships for that (1x2 floor, honey-wood planks on two trestles).
export type FurnishingKind = 'bed' | 'hearth' | 'table' | 'shelf' | 'crate' | 'tools' | 'bench'
export type Furnishing = { kind: FurnishingKind; slot: { x: number; y: number } }

// The C10 plan's declared minimum room. It is the floor the renderer can always draw, and
// the contract the gate re-asserts; roomFurnishings() serves the richer C13 set on top.
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

/**
 * ★ THE ROOM'S OWN SIZE, off the building's plan. A cottage is 3×2 outside and a farmhouse 4×2,
 * and the world says they sleep three and four — so drawing all three dwellings on a house's
 * floor would put the picture at odds with `roomCapacity`, which is the arithmetic the whole
 * dwelling ladder is priced on. `interiorMap.roomTilesFor` owns the factor and it is forced by
 * the house's landed 12×6.
 */
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
    const source: RoomFurnishing[] = s !== undefined && s.furnishings.length > 0
      ? s.furnishings
      : INTERIOR_LAYOUTS[kind]
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

// The room as the renderer needs it: the city template's slot, the C13 library's placement
// facts (wall vs floor, footprint, isBed/isHearth/providesLight) and the sprite to draw.
// A furnishing with no codex record still lays out — art independence, same law as the ground.
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

export type Interior = {
  structure: Structure
  kind: InteriorKind
  occupants: string[]
  items: string[]
}

const isInteriorKind = (kind: string): kind is InteriorKind =>
  (INTERIOR_KINDS as readonly string[]).includes(kind)

// Occupancy is engine truth: C9's `insideId`. The viewer camera never writes it. Ids are
// sorted so two browsers watching the same tick lay the same room out (G10 parity).
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

// The C13 library's bed is one interior tile wide and two deep; a partnered pair (C9 §3
// co_slept) takes one cell each, and the third sleeper gets no cell rather than lying on
// someone. The cells are INTERIOR TILES: `slotToTile` puts the template's slot on the map.
export const BED_FOOTPRINT = { w: 1, h: 2 } as const

function bedCells(kind: InteriorKind, records: AssetRecord[]): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = []
  // The same seating the room map uses, over the same list in the same order — a sleeper's
  // cell and the bed's own tiles are one answer or a body lies beside its bed.
  const plan = roomPlan(kind, records)
  const slots = plan.map((p) => p.slot)
  for (const [i, f] of plan.entries()) {
    if (f.meta === null ? f.kind !== 'bed' : f.meta.isBed !== true) continue
    const size = f.meta?.slots ?? BED_FOOTPRINT
    const at = seatInBlock(f.slot, slots.filter((_, j) => j !== i), roomSizeOf(kind), slotGridOf(kind))
    for (let dy = 0; dy < size.h; dy++) {
      for (let dx = 0; dx < size.w; dx++) cells.push({ x: at.x + dx, y: at.y + dy })
    }
  }
  return cells
}

/** Which interior tile each sleeper lies in. */
export function bedSlots(
  kind: InteriorKind, sleeping: string[], records: AssetRecord[] = [],
): Record<string, { x: number; y: number }> {
  const cells = bedCells(kind, records)
  const out: Record<string, { x: number; y: number }> = {}
  sleeping.forEach((id, i) => {
    const cell = cells[i]
    if (cell !== undefined) out[id] = cell
  })
  return out
}

// ── FURNITURE THAT TOUCHES THE FLOOR, AND BODIES THAT LIE *IN* THE BED (U4, task 67) ─────
//
// THE DEFECT: the room sorted furniture at `slot.x + slot.y` and bodies at the same `+ 0.5`,
// so a sleeping body ALWAYS drew in front of the bed it was lying in, and two furnishings on
// one diagonal tied and settled by arrival order. Nothing cast a shadow, so every object
// floated, and every sprite was offset by exactly one tile whatever its footprint — which
// stood a two-slot bed half outside its own ground.
//
// The interior now answers to the SAME depth authority as the town (depth.ts). A slot is a
// box in slot space; a body in a bed is a box INSIDE the bed's box, which the geometric rule
// reads as "neither in front" — so the tie is broken by an explicit rule instead of by +0.5:
// an 'in' furnishing is drawn as TWO pieces split at its own mid-line, and the body goes
// between them. That is the only honest way to put a body inside a bed in a painter's
// renderer.

/** 'in' (a bed, a chair) draws the body BETWEEN the furniture's back and front halves;
 *  'at' (a table, an anvil) draws the body behind it; 'beside' is plain depth order. */
export type OccupancyMode = 'in' | 'at' | 'beside'

/** Total over `CITY_FURNISHING_KINDS` — a kind added to the template with no mode fails the
 *  test rather than silently falling through. */
export const FURNITURE_OCCUPANCY: Record<string, OccupancyMode> = {
  bed: 'in', chair: 'in', bench: 'in',
  table: 'at', hearth: 'at', anvil: 'at',
  shelf: 'beside', crate: 'beside', barrel: 'beside', rug: 'beside',
}

export function occupancyOf(kind: string): OccupancyMode {
  return FURNITURE_OCCUPANCY[kind] ?? 'beside'
}

/** Contact shadow: an ellipse under every object, sized from what is drawn, so nothing
 *  floats. Half as tall as it is wide — the ground plane's own ratio.
 *
 *  `lift` is how far ABOVE a bottom-anchored sprite's own anchor the ellipse's centre goes.
 *  An iso object's lowest drawn pixel is the NEAR VERTEX of the ground it stands on, not the
 *  centre of it, so an ellipse centred on the anchor hangs out below the object and reads as
 *  the object levitating over its own shadow — which is what the browser showed. Lifting by
 *  `ry` puts the ellipse's near edge on that lowest pixel, where it belongs. A body is
 *  anchored at its FEET, which already is the ground centre, so a body takes no lift. */
export const CONTACT_SHADOW_ALPHA = 0.22
export const CONTACT_SHADOW_SHARE = 0.42
export function contactShadow(
  widthPx: number,
): { rx: number; ry: number; alpha: number; lift: number } {
  const rx = Math.max(0, widthPx) * CONTACT_SHADOW_SHARE
  const ry = rx / 2
  return { rx, ry, alpha: CONTACT_SHADOW_ALPHA, lift: ry }
}

/** A cell of the room grid. Since Option C that grid IS the 128x64 interior tile lattice
 *  (`interiorMap.ROOM_TILES`), NOT the template's 3x3 slots — `slotToTile` is the boundary. */
export type Tile = { x: number; y: number }
export type TileSize = { w: number; h: number }

/**
 * WHAT THE BROWSER CAUGHT: the room drew library furniture at NATIVE size while a body drew at
 * `CHAR_TARGET_PX`. A sleeper was three times the length of the bed he was in, and three 24 px
 * objects rattled around a 192 px floor — which is a large part of what "way too under
 * detailed" is looking at. The fix at the time was a DIVISOR of 2 against a scene zoom of 4:
 * a composite of 2.0, i.e. every 128 px sprite pixel-DOUBLED on its way to the glass.
 *
 * ★ OPTION C RETIRES THE DIVISOR, AND THAT IS THE POINT OF OPTION C. The room's unit is now
 * the 128×64 INTERIOR tile the library already authors against, drawn at a scene zoom of 1.
 * A footprint of `(w, h)` interior tiles covers `(w + h) × 64` px of ground and the art for it
 * is authored at exactly `(w + h) × 64` px (`forge/assetResolution.nativeSizeFor`), so the
 * factor is 1 for every footprint and NOTHING is resampled anywhere in the room. It is derived,
 * not chosen: `LIBRARY_TILE_PX / INTERIOR_TILE.w`. `drawScale.test.ts` proves it over five
 * footprints.
 */
/** The tile the library authors against — `assetResolution.INTERIOR_TILE.w`. */
export const LIBRARY_TILE_PX = 128
export function furnishingDivisor(): number {
  return Math.max(1, Math.round(LIBRARY_TILE_PX / INTERIOR_TILE.w))
}
export function furnishingScale(): number {
  return 1 / furnishingDivisor()
}

/**
 * ★ AND THE SAME QUESTION FOR A BODY, WHICH IS WHERE OPTION C BROKE.
 *
 * `characterCell` hands back `CHAR_TARGET_PX / figureH` — the town's own scale. The room used
 * that `× INTERIOR_PX_SCALE`, and the browser showed a person a third taller than the wall he
 * stood against, longer than the bed he slept in, towering over a table.
 *
 * ★ `INTERIOR_PX_SCALE` IS THE PIXEL FACTOR AND IT IS NOT THE WORLD FACTOR. Furniture is
 * authored against a tile that means a METRE; the town's tile means a corner of a plot. A body
 * carried across on the pixel factor alone keeps a ratio that belongs to the other scale. The
 * room asks for the height the ROOM says a person is (`interiorMap.INTERIOR_BODY_PX`), and the
 * factor between the two scales is the factor between the two heights and nothing else.
 *
 * This is a DOWNSCALE of the cast atlas (a 954 px figure to 109 px, from 208), so it takes the
 * room further from resampled-up art rather than nearer to it.
 */
export function interiorBodyScale(townCellScale: number): number {
  return townCellScale * (INTERIOR_BODY_PX / CHAR_TARGET_PX)
}

/** Furnishings that LIE on the floor rather than stand on it. A flat piece is anchored at the
 *  CENTRE of its own ground and casts no contact shadow. Hung from its bottom edge, a rug in
 *  the far corner slot floated up the back wall — which is also what the browser showed. */
export const FLAT_FURNISHINGS: ReadonlySet<string> = new Set(['rug'])
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
   * ★ THE GROUND THE SPRITE IS ANCHORED ON — and for a split piece it is the WHOLE piece's.
   *
   * `tile`/`size` are the DEPTH box: the front half's tile is pushed half a footprint nearer
   * the viewer so a body sorts BETWEEN the halves. That is a depth fact, and the renderer was
   * spending it a second time as a POSITION. The browser showed the result — a chair whose
   * back floated a tile clear of its own seat, with the cushion drawn twice, in every room.
   * Both halves are cut from ONE texture, so both stand where that texture stands; `applyHalf`
   * lifts the back one by the front one's own pixel height, which is the only offset that puts
   * the upper frame back exactly where it was cut from.
   */
  anchor: { tile: Tile; size: TileSize }
}

export const furnishingId = (kind: string, tile: Tile): string => `${kind}:${tile.x},${tile.y}`

/** Broad phase only: how far a room sprite may rise above the ground it stands on, in interior
 *  tiles. Generous on purpose — it decides whether two pieces CAN overlap, never who wins. */
export const ROOM_SPRITE_RISE_TILES = 3

export type PlacedItem = { kind: string; tile: Tile; meta: InteriorMeta | null }
export type PlacedBody = { id: string; tile: Tile; inside: string | null }

/**
 * Where a body actually stands, given what it is doing.
 *
 * You lie IN a bed, so the body keeps the bed cell it was given. You stand AT a table — never
 * inside it — so the body takes the slot BEHIND the furnishing, and the depth then falls out
 * of the geometry instead of out of a special case. Anything else stands where it stands.
 */
export function occupantTile(mode: OccupancyMode, own: Tile, at: Tile | null): Tile {
  if (mode !== 'at' || at === null) return own
  return { x: at.x, y: Math.max(0, at.y - 1) }
}

/** Every drawable in the room, in a stable order. */
export function interiorPieces(
  items: ReadonlyArray<PlacedItem>, bodies: ReadonlyArray<PlacedBody>,
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
      id: `${id}#back`, kind: 'furniture',
      tile: item.tile, size: { w: size.w, h: halfH }, half: 'back', anchor,
    })
    out.push({
      id: `${id}#front`, kind: 'furniture',
      tile: { x: item.tile.x, y: item.tile.y + halfH }, size: { w: size.w, h: halfH },
      half: 'front', anchor,
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
export function roomDepthBox(p: RoomPiece): DepthBox {
  const x0 = p.tile.x, y0 = p.tile.y, x1 = p.tile.x + p.size.w, y1 = p.tile.y + p.size.h
  const near = interiorToScreen(x1, y1)
  const far = interiorToScreen(x0, y0)
  const east = interiorToScreen(x1, y0)
  const west = interiorToScreen(x0, y1)
  const rise = ROOM_SPRITE_RISE_TILES * INTERIOR_TILE.w
  return {
    id: p.id,
    rank: p.kind === 'body' ? OVERLAP_RANK.body : OVERLAP_RANK.structure,
    x0, y0, x1, y1,
    sx0: west.sx, sy0: far.sy - rise, sx1: east.sx, sy1: near.sy,
  }
}

/** Painter's order for the room, back to front, as piece ids. The town's authority, applied
 *  to the interior tile lattice — one depth rule for the whole product, not two. */
export function interiorOrder(pieces: readonly RoomPiece[]): string[] {
  return depthOrder(pieces.map(roomDepthBox))
}

export type InteriorPhase = 'town' | 'entering' | 'inside' | 'exiting'
/** The room's fade IS a scene change, so it takes the scene vocabulary's length rather than a
 *  number of its own — one motion table, both runtimes (Task 90/91). */
export const INTERIOR_FADE_MS = SCENE_TOTAL_MS

// Pure: the caller owns the clock. `sinceMs` is when `prev` began — advanceInterior keeps it
// for a caller that would rather not. A viewer who turns around mid-fade reverses; the fade
// never finishes a move that was abandoned.
export function interiorTransition(
  prev: InteriorPhase, entered: boolean, nowMs: number, sinceMs = 0,
): InteriorPhase {
  const done = nowMs - sinceMs >= INTERIOR_FADE_MS
  switch (prev) {
    case 'town': return entered ? 'entering' : 'town'
    case 'entering': return entered ? (done ? 'inside' : 'entering') : 'exiting'
    case 'inside': return entered ? 'inside' : 'exiting'
    case 'exiting': return entered ? 'entering' : (done ? 'town' : 'exiting')
  }
}

export type InteriorPhaseState = { phase: InteriorPhase; sinceMs: number }

export function advanceInterior(
  state: InteriorPhaseState, entered: boolean, nowMs: number,
): InteriorPhaseState {
  const next = interiorTransition(state.phase, entered, nowMs, state.sinceMs)
  return next === state.phase ? state : { phase: next, sinceMs: nowMs }
}
