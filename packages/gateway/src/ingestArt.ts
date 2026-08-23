// Idempotent ingest of the APPROVED production art → the forge codex.
// Characters register one packed v4-hires-atlas record each (class rig-part, kind
// `character:<id>`); buildings register their hi-res cell + v4-hires-building manifest (kind =
// engine structure kind, with the facing riding in it: `house`, `house:se`); library items
// register a world sprite and an icon each (class item, kinds `bed` and `bed#icon`).
// Re-running registers nothing when bytes+manifest are unchanged; regenerated art gets a
// new record that wins by seq (the renderer's newest-ready law).
//
// ★ EVERY ROOT IS COMMITTED NOW, AND THERE IS NO LONGER A SESSION SCRATCHPAD AT ALL. This file
// used to read three of them. Every one was emptied with the art inside it, twice over, and
// each time the measurement was the same: `class building: 0`, `class item: 0`,
// `class rig-part: 0` — a town of procedural prisms, checkerboard furniture and checkerboard
// villagers, with CI green throughout. The terrain survived every wipe because terrain art is
// code-painted or committed.
// So the buildings, the fifty items and the five founder sheets all come out of
// `packages/forge/content/` now, and `@sj/forge` owns reading them. The last four — the wagon,
// the shed, the scaffolding and the standing stone — had never been commissioned in any root;
// they have authored cells now, so the scratchpad reader they were the last users of is gone.
import type Database from 'better-sqlite3'
import {
  AssetCodex, loadMaterialBook, registerCommittedBuildings, registerCommittedCast,
  registerCommittedItems, registerGeneratedTerrain,
} from '@sj/forge'
import { ROAD_AUTOTILE_KEYS, TERRAIN_TILE_KINDS, roadAutotileKind } from '@sj/shared'

export type IngestEntry = {
  kind: string
  /** `missing` is art a root could not produce. It is REPORTED, never thrown: one absent
   *  founder used to abort the whole function and the town woke with no art at all. */
  action: 'registered' | 'unchanged' | 'missing'
  id: string
  detail?: string
}

// ★ THE ANCHOR-DERIVED HOME IS RETIRED. The founders' home used to be the committed style
// anchor, chroma-keyed and re-celled at ingest time — first under kind `hut`, which nothing
// places, and the anchor's own architecture is the medieval one the user rejected. `house` is
// now an authored cell in `forge/content/buildings`, alongside the cottage, the cabin, the
// farmhouse and the storehouse, in both facings. `registerCommittedBuildings` puts every
// committed cell in — twenty of them, once the eight bare kinds got art.

// Terrain art is code-painted, so it needs no art root and costs nothing: the flat kind ×
// variant tiles AND C13's 15-tile road strip (kind `road:<key>`). Until this runs the codex
// holds no terrain records at all and the map bakes C6's flat diamonds.
export async function ingestTerrainArt(db: Database.Database): Promise<IngestEntry[]> {
  const codex = new AssetCodex(db)
  const existing = new Map<string, string>()
  for (const r of codex.listSince(0)) {
    if (r.status === 'ready' && r.class === 'terrain' && r.kind !== null) existing.set(r.kind, r.id)
  }
  const wanted = [...TERRAIN_TILE_KINDS, ...ROAD_AUTOTILE_KEYS.map(roadAutotileKind)]
  if (wanted.every((k) => existing.has(k))) {
    return wanted.map((kind) => ({ kind, action: 'unchanged' as const, id: existing.get(kind)! }))
  }
  // Generated materials when they ship, code-painted tiles when they do not — the same art
  // independence the ground bake lives by, so a half-generated batch still wakes a whole map.
  const { records, report } = await registerGeneratedTerrain(codex, await loadMaterialBook())
  if (report.generated > 0) {
    console.log(`dev world: ${report.generated} generated terrain tiles, ${report.painted} code-painted`)
  }
  return records.map((r) => ({ kind: r.kind ?? '', action: 'registered' as const, id: r.id }))
}

// The premade library — 50 painted items, fifteen of them the furniture the interior scenes
// place on their slots. Without this a room draws every furnishing as the item placeholder,
// which is what the storehouse was showing.
//
// ★ THE LIBRARY ROOT IS GONE, AND THAT IS THE FIX. This read `$C13/library`, a session
// scratchpad, through a `libraryEntriesOnDisk` filter that treated an absent sprite as "not an
// error — the renderer falls back to the placeholder". When the scratchpad emptied, all fifty
// were absent, the filter returned [], the ingest reported success, and every item in the
// world became a checkerboard with nothing red anywhere. Tolerating a missing file is right
// for art that might not be made yet and wrong for art that has been paid for and shipped.
// `registerCommittedItems` reads `forge/content/items` and THROWS on a half-present item.
export async function ingestLibraryArt(db: Database.Database): Promise<IngestEntry[]> {
  return registerCommittedItems(new AssetCodex(db))
}

// The five founder sheets, one packed atlas each. Same story, same fix: these lived in
// `$C5/production`, the scratchpad emptied, and `class rig-part: 0` is what that measured to.
export async function ingestCastArt(db: Database.Database): Promise<IngestEntry[]> {
  return registerCommittedCast(new AssetCodex(db))
}

// ★ ONE ABSENT FILE USED TO COST THE WHOLE TOWN ITS ART, AND NOW THERE IS NO FILE TO BE ABSENT.
//
// The founders and the last four structures both read a session scratchpad, and when it emptied
// the first ENOENT escaped the loop and nothing behind it registered either. The step-over that
// answered it is gone with its subject: both roots are committed, and a committed root that is
// half on disk THROWS by design — `listCommittedBuildings` calls half a cell an error, not a
// skip, because that is how art goes quietly missing. What used to be a boot-time report is a
// suite-time gate: `structureArt.test.ts` fails on a directory the tree does not hold.
export async function ingestProductionArt(db: Database.Database): Promise<IngestEntry[]> {
  const codex = new AssetCodex(db)
  return [...registerCommittedBuildings(codex), ...registerCommittedCast(codex)]
}
