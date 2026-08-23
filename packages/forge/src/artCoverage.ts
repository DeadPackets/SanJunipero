// ★ THE COVERAGE LAW, EXTENDED FROM STRUCTURES TO ITEMS AND TO THE CAST.
//
// `structureArt.ts` asserts that a kind standing in the town has a cell. It was written after
// a farmhouse stood with no art for a whole merge train and CI stayed green. The SAME hole was
// open two more times over, wider, and nothing caught either:
//
//   class item:      0 records   every one of the fifty library items drew the placeholder
//   class rig-part:  0 records   every villager in the town drew the placeholder
//
// Both were paid for, both were written to a session scratchpad, and the scratchpad was
// emptied. The reason no test noticed is the reason `structureArt.ts` gives for buildings:
// THE FALLBACK ALWAYS ANSWERS. `makePlaceholder` returns a palette-true checkerboard for every
// class, so a gate that asks the renderer "did something draw?" passes forever, whatever the
// codex holds. Every assertion here therefore reads the CODEX — the same class/kind columns
// `textures.ts` and `roomPlan` resolve on — and the placeholder writes no codex row.
//
// Two directions, both of which have actually happened in this repo:
//   MISSING   a kind the world will ask for, with no record to answer it.
//   ORPHAN    a record registered under a kind nothing asks for. `hut` was one for a train.
import { FOUNDER_IDS } from '@sj/shared'
import { LIBRARY } from './library/catalog.js'
import { ICON_SUFFIX } from './library/register.js'
import { characterKind } from './castArt.js'

export type Coverage = {
  /** `bed`, `character:omar` — the world asks for it and no record answers */
  missing: string[]
  /** a record is registered and nothing in the world asks for it */
  orphans: string[]
  /** every kind that IS covered, for the report table */
  covered: string[]
}

function compare(required: readonly string[], registered: readonly string[]): Coverage {
  const have = new Set(registered)
  const want = new Set(required)
  const missing: string[] = [], covered: string[] = []
  for (const k of [...want].sort()) (have.has(k) ? covered : missing).push(k)
  return { missing, orphans: [...have].filter((k) => !want.has(k)).sort(), covered }
}

// ── items ───────────────────────────────────────────────────────────────────────────────────

/** Every codex kind the fifty-item library must answer to. An item is TWO records, not one:
 *  the world sprite the ground draws and the icon the roster and inventory draw. Shipping the
 *  sprite alone leaves every inventory row a checkerboard, which is how the icon half of this
 *  went missing without being noticed separately from the sprite half. */
export function requiredItemKinds(): string[] {
  return LIBRARY.flatMap((e) => [e.kind, `${e.kind}${ICON_SUFFIX}`]).sort()
}

/** `registered` is the codex `kind` column of every ready class-`item` record. */
export function itemArtCoverage(registered: readonly string[]): Coverage {
  return compare(requiredItemKinds(), registered)
}

// ── the cast ────────────────────────────────────────────────────────────────────────────────

/** Every codex kind the cast must answer to: one packed sheet per founder. The renderer looks
 *  a villager up by `character:<agentId>` and falls through to the placeholder on a miss. */
export function requiredCastKinds(): string[] {
  return FOUNDER_IDS.map(characterKind).sort()
}

/** `registered` is the codex `kind` column of every ready class-`rig-part` record. */
export function castArtCoverage(registered: readonly string[]): Coverage {
  return compare(requiredCastKinds(), registered)
}

// ── the report ──────────────────────────────────────────────────────────────────────────────

export function coverageFailure(label: string, c: Coverage): string[] {
  const out: string[] = []
  if (c.missing.length) out.push(
    `${label}: ${c.missing.length} kind${c.missing.length === 1 ? '' : 's'} the world asks for ` +
    `with no codex record —\n    ${c.missing.join('\n    ')}`)
  if (c.orphans.length) out.push(
    `${label}: ${c.orphans.length} record${c.orphans.length === 1 ? '' : 's'} registered under a ` +
    `kind nothing asks for —\n    ${c.orphans.join('\n    ')}`)
  return out
}
