// THE COVERAGE LAW: every kind the world can create has a cell. Measured on the CODEX, never on
// the screen — `builtForm` always answers, so asking the renderer whether it drew measures nothing.
import {
  CITY_DWELLING_KINDS, isDwellingKind, type CityStructure,
} from '@sj/shared'
import { DEFAULT_FACING, STRUCTURE_FACINGS, facingKind, isStructureFacing, splitFacingKind, type StructureFacing } from './buildingArt.js'
import { cellDistance, mirrorX } from './sheet.js'
import type { RawImage } from './post/raw.js'

/** The public building the town keeps its food in. It is not a dwelling, and it is the one
 *  non-dwelling structure the user asked to be turned, so it carries the same two facings. */
export const STOREHOUSE_KIND = 'storehouse'


/** Two facings, SW and SE, for everything that can stand in both: dwellings, the storehouse, the
 *  shed (it has a door) and the wagon (wheels and a tailgate along a 1×2 long axis). */
export const TWO_FACING_KINDS: readonly string[] =
  [...CITY_DWELLING_KINDS, STOREHOUSE_KIND, 'shed', 'wagon']

/** The kinds that ship ONE cell, each with the reason it cannot turn. Not an exemption from art —
 *  every one ships a cell — but from the SECOND cell; `facingPartitionIsTotal` closes the gap. */
export const ONE_CELL_KINDS: Readonly<Record<string, string>> = {
  well: 'a circular stone ring: the same object from every angle',
  fire_pit: 'a ring of stones round a fire: the same object from every angle',
  standing_stone: 'a monolith — no front, no door, no ridge to reverse',
  grave: 'a headstone and a mound; the stone faces the reader whichever way the world turns',
  scaffolding: 'a cage of poles around nothing; its two visible faces are the same face',
  lamp_post: 'a post with a lantern on it: a vertical axis of rotation and nothing to face. '
    + 'It stands on the verge rather than on a plot, so no street ever tells it which way to look.',
  bridge: 'a deck, not a building. It turns by SWAPPING ITS FOOTPRINT — `buildFootprint` tries '
    + '1×2 and then 2×1 — and a footprint turn is not a facing, so a second cell here would be '
    + 'the wrong shape rather than the right one turned.',
}

/** Every creatable kind belongs to exactly one of the two lists above. This is what the old
 *  `exemptionIsClosed` should have been: it names what fell through instead of passing. */
export function facingPartitionIsTotal(creatable: readonly string[]): string[] {
  const out: string[] = []
  for (const k of creatable) {
    const two = TWO_FACING_KINDS.includes(k), one = k in ONE_CELL_KINDS
    if (two && one) out.push(`${k} is on BOTH the two-facing list and the one-cell list`)
    if (!two && !one) {
      out.push(`${k} is on neither list — say whether it turns, and if it does not, say why`)
    }
  }
  return out
}

// ── every kind the world can create ─────────────────────────────────────────────────────────

/** The union of every source that can put a structure in the world: the city template, the WHOLE
 *  recipe table, and `extra` — the gateway's kinds, which `@sj/forge` must not import. */
export function worldStructureKinds(a: {
  structures: readonly (CityStructure | { kind: string })[]
  recipes: Readonly<Record<string, unknown>>
  extra?: readonly string[]
}): string[] {
  return [...new Set([
    ...a.structures.map((s) => s.kind),
    ...Object.keys(a.recipes),
    ...(a.extra ?? []),
  ])].sort()
}

// ── what the world asks for ─────────────────────────────────────────────────────────────────

/** The template has no facing column today, so everything it places stands SW. When the
 *  template lane grows one, this reads it and the gate tightens with no edit here. */
export function structureFacing(s: CityStructure | { kind: string }): StructureFacing {
  const f = (s as { facing?: unknown }).facing
  return typeof f === 'string' && isStructureFacing(f) ? f : DEFAULT_FACING
}

/** kind → the facings the town actually stands it in. */
export function placedFacings(
  structures: readonly (CityStructure | { kind: string })[],
): Map<string, Set<StructureFacing>> {
  const out = new Map<string, Set<StructureFacing>>()
  for (const s of structures) {
    const set = out.get(s.kind) ?? new Set<StructureFacing>()
    set.add(structureFacing(s))
    out.set(s.kind, set)
  }
  return out
}

/** kind → every facing that kind must ship: the ones the town stands it in, the default for every
 *  other creatable kind, plus both facings for the two-facing kinds. */
export function requiredFacings(
  structures: readonly (CityStructure | { kind: string })[],
  creatable: readonly string[] = [],
): Map<string, Set<StructureFacing>> {
  const out = placedFacings(structures)
  // A kind nothing stands TODAY can still be created tomorrow — an agent builds a bridge, the
  // world lays a grave — and it stands the way everything stands until a facing column exists.
  for (const kind of creatable) if (!out.has(kind)) out.set(kind, new Set([DEFAULT_FACING]))
  for (const [kind, set] of out) {
    if (TWO_FACING_KINDS.includes(kind)) for (const f of STRUCTURE_FACINGS) set.add(f)
  }
  return out
}

// ── the measurement ─────────────────────────────────────────────────────────────────────────

export type ArtCoverage = {
  /** `farmhouse facing sw` — the world can create it and no cell answers */
  missing: string[]
  /** `hut` — a cell is registered and nothing can ever create that kind */
  orphans: string[]
  /** every kind × facing that IS covered, for the report table */
  covered: string[]
}

/** `registered` is the codex `kind` column of every ready class-`building` record.
 *  `creatable` is `worldStructureKinds(...)` — pass it, or the gate is the blind one again. */
export function structureArtCoverage(a: {
  structures: readonly (CityStructure | { kind: string })[]
  registered: readonly string[]
  creatable?: readonly string[]
}): ArtCoverage {
  const have = new Set(a.registered)
  const required = requiredFacings(a.structures, a.creatable ?? [])
  const missing: string[] = [], covered: string[] = []
  for (const [kind, facings] of [...required].sort((x, y) => x[0].localeCompare(y[0]))) {
    for (const f of STRUCTURE_FACINGS) {
      if (!facings.has(f)) continue
      ;(have.has(facingKind(kind, f)) ? covered : missing).push(`${kind} facing ${f}`)
    }
  }
  const known = new Set([...a.structures.map((s) => s.kind), ...(a.creatable ?? [])])
  const orphans = [...have]
    .map((k) => ({ codexKind: k, ...splitFacingKind(k) }))
    .filter((k) => !known.has(k.kind))
    .map((k) => k.codexKind)
    .sort()
  return { missing, orphans, covered }
}

// ── SE IS NOT A MIRROR ──────────────────────────────────────────────────────────────────────
// Turning a building moves the door and reverses the roof ridge; flipping does that too and gets
// the LIGHT wrong, because the sun does not flip with the building. A mirror scores exactly 0.
export const SE_MIRROR_MIN_DISTANCE = 0.05

/** 0 when `se` is `sw` flipped left-to-right; 1 when they share no pixel. */
export function seMirrorDistance(sw: RawImage, se: RawImage): number {
  return cellDistance(se, mirrorX(sw))
}

export function mirrorFacingGate(
  pairs: readonly { kind: string; sw: RawImage; se: RawImage }[],
): { ok: boolean; failures: string[]; measured: { kind: string; distance: number }[] } {
  const measured = pairs.map((p) => ({ kind: p.kind, distance: seMirrorDistance(p.sw, p.se) }))
  const failures = measured
    .filter((m) => m.distance < SE_MIRROR_MIN_DISTANCE)
    .map((m) => `${m.kind}: the SE cell is ${m.distance.toFixed(4)} from a mirror of its SW cell, ` +
      `below the ${SE_MIRROR_MIN_DISTANCE} floor — a turned building is not a flipped one`)
  return { ok: failures.length === 0, failures, measured }
}

export { isDwellingKind }
