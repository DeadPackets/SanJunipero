import {
  INTERIOR_KINDS, cityStructures, parseLibraryItemManifest, resolveFurnishingKind,
  type AssetRecord, type InteriorKind, type InteriorMeta,
} from '@sj/shared'
import type { Structure, WorldState } from '@sj/engine/state'

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

export type InteriorPhase = 'town' | 'entering' | 'inside' | 'exiting'
export const INTERIOR_FADE_MS = 260

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
