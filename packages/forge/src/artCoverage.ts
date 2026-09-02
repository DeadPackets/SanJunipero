// The coverage law, extended from structures to items and to the cast. It reads the CODEX, not
// the renderer: `makePlaceholder` answers every class, so "did something draw?" passes forever.
import { FOOD_KINDS, FOUNDER_IDS, expandItemKinds, type SimConfig } from '@sj/shared'
import { LIBRARY, libraryEntry } from './library/catalog.js'
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
  const missing: string[] = [],
    covered: string[] = []
  for (const k of [...want].sort()) (have.has(k) ? covered : missing).push(k)
  return { missing, orphans: [...have].filter((k) => !want.has(k)).sort(), covered }
}

// ── items ───────────────────────────────────────────────────────────────────────────────────

/** Every codex kind the fifty-four-item library must answer to; an item is TWO records, the world
 *  sprite and the inventory icon, and they go missing separately. */
export function requiredItemKinds(): string[] {
  return LIBRARY.flatMap((e) => [e.kind, `${e.kind}${ICON_SUFFIX}`]).sort()
}

/** Every item kind a config can put in a hand: both sides of every craft, what a build consumes,
 *  what spoils, what a field grows, what a body wears. What the sim seeds on top of it — the
 *  founder kit, the storehouse, the ground's and the animals' yield — is `extra`, because the
 *  forge may not read a consumer lane. */
export function configItemKinds(config: SimConfig, extra: readonly string[] = []): string[] {
  const kinds = [...extra, ...FOOD_KINDS]
  for (const r of Object.values(config.crafting.recipes))
    kinds.push(...Object.keys(r.inputs), r.output.kind)
  for (const s of Object.values(config.structures.recipes)) kinds.push(...Object.keys(s.inputs))
  for (const table of [
    config.construction.houseMaterials,
    config.spoilage.days,
    config.crops,
    config.warmth.insulation,
  ])
    kinds.push(...Object.keys(table))
  return expandItemKinds(kinds)
}

/** The kinds the world can put in a hand that the catalog does not carry. The catalog is
 *  hand-listed, so this is the one gate that reads what the world can actually hold: every kind
 *  it names draws the placeholder wherever it is held. */
export function catalogGap(worldKinds: readonly string[]): string[] {
  return worldKinds.filter((k) => libraryEntry(k) === null)
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
  if (c.missing.length)
    out.push(
      `${label}: ${c.missing.length} kind${c.missing.length === 1 ? '' : 's'} the world asks for ` +
        `with no codex record —\n    ${c.missing.join('\n    ')}`,
    )
  if (c.orphans.length)
    out.push(
      `${label}: ${c.orphans.length} record${c.orphans.length === 1 ? '' : 's'} registered under a ` +
        `kind nothing asks for —\n    ${c.orphans.join('\n    ')}`,
    )
  return out
}
