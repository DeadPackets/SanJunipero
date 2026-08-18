import {
  INTERIOR_KINDS, cityStructures, parseLibraryItemManifest, resolveFurnishingKind,
  type AssetRecord, type InteriorKind, type InteriorMeta,
} from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'
import { OVERLAP_RANK, depthOrder, type DepthBox } from './depth.js'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { SLOT_TILES } from './roomShell.js'
import { SCENE_TOTAL_MS } from '../ui/sceneTransition.js'

// The vocabulary is @sj/shared's (C13 interiorMeta.ts) — one source, so a kind added there
// cannot go missing here. Re-exported because Task 11 and the gate read it off this module.
export { INTERIOR_KINDS }
export type { InteriorKind }

export type FurnishingKind = 'bed' | 'hearth' | 'table' | 'shelf' | 'crate' | 'tools'
export type Furnishing = { kind: FurnishingKind; slot: { x: number; y: number } }

// The C10 plan's declared minimum room. It is the floor the renderer can always draw, and
// the contract the gate re-asserts; roomFurnishings() serves the richer C13 set on top.
export const INTERIOR_LAYOUTS: Record<InteriorKind, Furnishing[]> = {
  hut: [
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
}

export type RoomFurnishing = { kind: string; slot: { x: number; y: number } }

// The city template furnishes each of its eleven buildings; every hut is furnished alike, so
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

// The C13 library's bed is one slot wide and two deep; a partnered pair (C9 §3 co_slept)
// takes one cell each, and the third sleeper gets no cell rather than lying on someone.
export const BED_FOOTPRINT = { w: 1, h: 2 } as const

function bedCells(kind: InteriorKind, records: AssetRecord[]): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = []
  for (const f of roomPlan(kind, records)) {
    if (f.meta === null ? f.kind !== 'bed' : f.meta.isBed !== true) continue
    const size = f.meta?.slots ?? BED_FOOTPRINT
    for (let dy = 0; dy < size.h; dy++) {
      for (let dx = 0; dx < size.w; dx++) cells.push({ x: f.slot.x + dx, y: f.slot.y + dy })
    }
  }
  return cells
}

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

export type Slot = { x: number; y: number }
export type SlotSize = { w: number; h: number }

/**
 * WHAT THE BROWSER CAUGHT: the room drew library furniture at NATIVE size while a body drew at
 * `CHAR_TARGET_PX`. A sleeper was three times the length of the bed he was in, and three 24 px
 * objects rattled around a 192 px floor — which is a large part of what "way too under
 * detailed" is looking at.
 *
 * The room takes ONE integer factor for every furnishing: the largest that keeps the library's
 * biggest sprite inside a single slot's ground. Integer, because a fractional factor resamples
 * pixel art; one factor for the whole room, because two pieces must never disagree about how
 * big the room is.
 */
export const LIBRARY_MAX_SPRITE_PX = 24
export function furnishingScale(slotTiles: number): number {
  return Math.max(1, Math.floor((slotTiles * TILE_W) / LIBRARY_MAX_SPRITE_PX))
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
  slot: Slot
  size: SlotSize
  /** which half of an 'in' furnishing this is; `null` for anything drawn whole */
  half: 'back' | 'front' | null
}

export const furnishingId = (kind: string, slot: Slot): string => `${kind}:${slot.x},${slot.y}`

/** Broad phase only: how far a room sprite may rise above the ground it stands on, in slots.
 *  Generous on purpose — it decides whether two pieces CAN overlap, never who wins. */
export const ROOM_SPRITE_RISE_SLOTS = 2

export type PlacedItem = { kind: string; slot: Slot; meta: InteriorMeta | null }
export type PlacedBody = { id: string; slot: Slot; inside: string | null }

/**
 * Where a body actually stands, given what it is doing.
 *
 * You lie IN a bed, so the body keeps the bed cell it was given. You stand AT a table — never
 * inside it — so the body takes the slot BEHIND the furnishing, and the depth then falls out
 * of the geometry instead of out of a special case. Anything else stands where it stands.
 */
export function occupantSlot(mode: OccupancyMode, own: Slot, at: Slot | null): Slot {
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
    const id = furnishingId(item.kind, item.slot)
    byId.set(id, item)
    if (occupancyOf(item.kind) !== 'in') {
      out.push({ id, kind: 'furniture', slot: item.slot, size, half: null })
      continue
    }
    const halfH = size.h / 2
    out.push({ id: `${id}#back`, kind: 'furniture', slot: item.slot, size: { w: size.w, h: halfH }, half: 'back' })
    out.push({
      id: `${id}#front`, kind: 'furniture',
      slot: { x: item.slot.x, y: item.slot.y + halfH }, size: { w: size.w, h: halfH }, half: 'front',
    })
  }
  for (const b of bodies) {
    const host = b.inside === null ? undefined : byId.get(b.inside)
    const mode = host === undefined ? 'beside' : occupancyOf(host.kind)
    const slot = occupantSlot(mode, b.slot, host?.slot ?? null)
    out.push({ id: b.id, kind: 'body', slot, size: { w: 1, h: 1 }, half: null })
  }
  return out
}

/** A piece's box in SLOT space, plus a generous screen box for the broad phase. */
export function roomDepthBox(p: RoomPiece): DepthBox {
  const x0 = p.slot.x, y0 = p.slot.y, x1 = p.slot.x + p.size.w, y1 = p.slot.y + p.size.h
  const near = tileToScreen(x1 * SLOT_TILES, y1 * SLOT_TILES)
  const far = tileToScreen(x0 * SLOT_TILES, y0 * SLOT_TILES)
  const east = tileToScreen(x1 * SLOT_TILES, y0 * SLOT_TILES)
  const west = tileToScreen(x0 * SLOT_TILES, y1 * SLOT_TILES)
  const rise = ROOM_SPRITE_RISE_SLOTS * SLOT_TILES * TILE_W
  return {
    id: p.id,
    rank: p.kind === 'body' ? OVERLAP_RANK.body : OVERLAP_RANK.structure,
    x0, y0, x1, y1,
    sx0: west.sx, sy0: far.sy - rise, sx1: east.sx, sy1: near.sy,
  }
}

/** Painter's order for the room, back to front, as piece ids. The town's authority, applied
 *  to slot space — one depth rule for the whole product, not two. */
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
