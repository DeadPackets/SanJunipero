// ★ THE COVERAGE LAW: EVERY KIND THE WORLD CAN CREATE HAS A CELL.
//
// No test asserted this, and that is why a farmhouse stood with no art for a whole merge
// train while CI stayed green, and why `ingestArt` could register the founders' home under
// kind `hut` — a kind NOTHING PLACES — without one thing going red. The renderer answers a
// missing cell with `builtForm`, a deliberate palette-true prism, so the product never looks
// broken enough to fail a test. That is exactly why the law has to be measured here, on the
// codex, and never on the screen: `builtForm` always answers, so a gate that asks the
// renderer whether something drew has measured nothing.
//
// ★ AND THE FIRST VERSION OF THIS LAW HAD A BLIND SPOT, WHICH IS WHY IT IS NOW WORDED THAT WAY.
// It asked only about `makeCityTemplate()`. Four kinds — wagon, shed, scaffolding and standing
// stone — are stood by the gateway's `TOWN_STRUCTURES` dev town, `bridge` is raised by an agent
// at runtime through the `build` verb, and `grave` is placed by the world when somebody dies.
// None of the six is in the template, so the gate never looked at any of them, stayed green,
// and every one of them drew a grey prism. The template is one SOURCE of kinds, not the set.
//
// Two directions, because task 1's defect had both:
//   MISSING   a kind the world can create, in a facing it can stand in, with no cell.
//   ORPHAN    a registered cell whose kind nothing can ever create. `hut` was one for a train.
import {
  CITY_DWELLING_KINDS, isDwellingKind, type CityStructure,
} from '@sj/shared'
import { DEFAULT_FACING, STRUCTURE_FACINGS, facingKind, isStructureFacing, splitFacingKind, type StructureFacing } from './buildingArt.js'
import { cellDistance, mirrorX } from './sheet.js'
import type { RawImage } from './post/raw.js'

/** The public building the town keeps its food in. It is not a dwelling, and it is the one
 *  non-dwelling structure the user asked to be turned, so it carries the same two facings. */
export const STOREHOUSE_KIND = 'storehouse'

/** ★ THE EXEMPTION IS GONE, AND THAT IS THE FIX.
 *
 *  `BUILT_FORM_ONLY = ['well', 'fire_pit']` stood here, and `exemptionIsClosed()` was supposed
 *  to keep it honest. It did not: it only refused to waive a kind on `TWO_FACING_KINDS`, so it
 *  was satisfiable with the property broken — guard family #12 — and the well and the fire pit
 *  sat on that line, exempted, for a whole merge train, until a human looked at the running
 *  product and found two bare grey prisms in the middle of the town square.
 *
 *  There is now no lever. Every kind the world can create carries art; the only way to make
 *  this gate green is to draw the cell. */

/** USER RULING: two facings, SW and SE, for everything that can stand in both. Dwellings and
 *  the storehouse turn; so do the shed (it has a door) and the wagon (wheels and a tailgate
 *  along a 1×2 long axis). */
export const TWO_FACING_KINDS: readonly string[] =
  [...CITY_DWELLING_KINDS, STOREHOUSE_KIND, 'shed', 'wagon']

/** The kinds that ship ONE cell, each with the reason it cannot turn. This is NOT an exemption
 *  from art — every one of these ships a cell — it is an exemption from the SECOND cell, and
 *  `facingPartitionIsTotal` refuses to let a kind fall outside both lists unnoticed. */
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

/**
 * The union of every source that can put a structure in the world. The gate's blind spot was
 * that it knew only the first of these:
 *
 *  · `structures` — the city template, the town the world wakes with;
 *  · `recipes` — `config.structures.recipes`. A row WITH materials is a kind an agent raises
 *    through the `build` verb (house, well, bridge); a row with EMPTY inputs is a kind the
 *    world places and nobody builds (the grave, laid when somebody dies). Both are kinds the
 *    world creates, so the whole table counts, not the buildable half of it;
 *  · `extra` — the dev world's own fixture town. `TOWN_STRUCTURES` lives in `@sj/gateway`,
 *    which `@sj/forge` must not import, so the gateway passes its kinds in and asserts the
 *    same law on its own side (`ingestArt.test.ts`).
 */
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

/** kind → every facing that kind must ship: the ones the town stands it in, the default facing
 *  for every other kind the world can create, plus both facings for the kinds the user's
 *  two-facing ruling covers. */
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
