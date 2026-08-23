// ★ THE COVERAGE LAW: A KIND THAT STANDS IN THE TOWN HAS A CELL.
//
// No test asserted this, and that is why a farmhouse stood with no art for a whole merge
// train while CI stayed green, and why `ingestArt` could register the founders' home under
// kind `hut` — a kind NOTHING PLACES — without one thing going red. The renderer answers a
// missing cell with `builtForm`, a deliberate palette-true prism, so the product never looks
// broken enough to fail a test. That is exactly why the law has to be measured here, on the
// codex, and never on the screen: `builtForm` always answers, so a gate that asks the
// renderer whether something drew has measured nothing.
//
// Two directions, because task 1's defect had both:
//   MISSING   a kind the template places, in a facing it can be placed in, with no cell.
//   ORPHAN    a registered cell whose kind nothing places. `hut` was one for a whole train.
import {
  CITY_DWELLING_KINDS, isDwellingKind, type CityStructure,
} from '@sj/shared'
import { DEFAULT_FACING, STRUCTURE_FACINGS, facingKind, isStructureFacing, splitFacingKind, type StructureFacing } from './buildingArt.js'
import { cellDistance, mirrorX } from './sheet.js'
import type { RawImage } from './post/raw.js'

/** The public building the town keeps its food in. It is not a dwelling, and it is the one
 *  non-dwelling structure the user asked to be turned, so it carries the same two facings. */
export const STOREHOUSE_KIND = 'storehouse'

/** ★ THE CLOSED EXEMPTION. These two kinds are MEANT to draw `builtForm`: `builtForm.ts` says
 *  so in as many words — the well and the fire pit have no art in any root until the structure
 *  set is commissioned, and a prism in the plaza is the deliberate stand-in, not a hole.
 *
 *  It is closed on purpose. `exemptionIsClosed` asserts that nothing which must carry art can
 *  ever be listed here, so the way to make this gate green is to draw the missing cell, never
 *  to add a name to this line. */
export const BUILT_FORM_ONLY: readonly string[] = ['well', 'fire_pit']

/** USER RULING: two facings, SW and SE. Every dwelling turns, and so does the storehouse. */
export const TWO_FACING_KINDS: readonly string[] = [...CITY_DWELLING_KINDS, STOREHOUSE_KIND]

/** Every kind that must carry art, and never a kind that must not. */
export function exemptionIsClosed(): string[] {
  return BUILT_FORM_ONLY.filter((k) => TWO_FACING_KINDS.includes(k))
    .map((k) => `${k} must carry art and cannot be exempted into builtForm`)
}

// ── what the template asks for ──────────────────────────────────────────────────────────────

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

/** kind → every facing that kind must ship: the ones the town stands it in, plus both facings
 *  for the kinds the user's two-facing ruling covers. */
export function requiredFacings(
  structures: readonly (CityStructure | { kind: string })[],
): Map<string, Set<StructureFacing>> {
  const out = placedFacings(structures)
  for (const [kind, set] of out) {
    if (BUILT_FORM_ONLY.includes(kind)) { out.delete(kind); continue }
    if (TWO_FACING_KINDS.includes(kind)) for (const f of STRUCTURE_FACINGS) set.add(f)
  }
  return out
}

// ── the measurement ─────────────────────────────────────────────────────────────────────────

export type ArtCoverage = {
  /** `farmhouse facing sw` — the town stands it and no cell answers */
  missing: string[]
  /** `hut` — a cell is registered and nothing places it */
  orphans: string[]
  /** every kind × facing that IS covered, for the report table */
  covered: string[]
}

/** `registered` is the codex `kind` column of every ready class-`building` record. */
export function structureArtCoverage(a: {
  structures: readonly (CityStructure | { kind: string })[]
  registered: readonly string[]
}): ArtCoverage {
  const have = new Set(a.registered)
  const required = requiredFacings(a.structures)
  const missing: string[] = [], covered: string[] = []
  for (const [kind, facings] of [...required].sort((x, y) => x[0].localeCompare(y[0]))) {
    for (const f of STRUCTURE_FACINGS) {
      if (!facings.has(f)) continue
      ;(have.has(facingKind(kind, f)) ? covered : missing).push(`${kind} facing ${f}`)
    }
  }
  const placedKinds = new Set(a.structures.map((s) => s.kind))
  const orphans = [...have]
    .map((k) => ({ codexKind: k, ...splitFacingKind(k) }))
    .filter((k) => !placedKinds.has(k.kind))
    .map((k) => k.codexKind)
    .sort()
  return { missing, orphans, covered }
}

// ── SE IS NOT A MIRROR ──────────────────────────────────────────────────────────────────────
//
// In this projection the two visible walls are the +y face (screen-left) and the +x face
// (screen-right). Turning a building ninety degrees moves the door and the windows from one
// to the other AND reverses the roof ridge. Flipping the SW cell moves the door to the right
// wall and reverses the ridge too — and gets the LIGHT wrong, because the sun does not flip
// with the building. A mirrored cell is therefore the cheap wrong answer that looks almost
// right, which is precisely the kind a gate has to catch.
//
// A mirror scores exactly 0 here. Two independent generations of the same building, turned,
// score far above the floor; the measured values for the shipped set are in the round-4 report.
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
