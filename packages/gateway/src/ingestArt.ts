// Idempotent ingest of the APPROVED production art → the forge codex.
// Characters register one packed v4-hires-atlas record each (class rig-part, kind
// `character:<id>`); buildings register their hi-res cell + v4-hires-building manifest (kind =
// engine structure kind, with the facing riding in it: `house`, `house:se`); library items
// register a world sprite and an icon each (class item, kinds `bed` and `bed#icon`).
// Re-running registers nothing when bytes+manifest are unchanged; regenerated art gets a
// new record that wins by seq (the renderer's newest-ready law).
//
// ★ EVERY ROOT IS COMMITTED NOW. This file used to read three session scratchpads. Every one
// of them was emptied with the art inside it, twice over, and each time the measurement was
// the same: `class building: 0`, `class item: 0`, `class rig-part: 0` — a town of procedural
// prisms, checkerboard furniture and checkerboard villagers, with CI green throughout. The
// terrain survived every wipe because terrain art is code-painted or committed.
// So the buildings (round 4), the fifty items and the five founder sheets all come out of
// `packages/forge/content/` now, and `@sj/forge` owns reading them. What is left below is the
// four structures that have never had art in any root at all.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import {
  AssetCodex, decodePng, loadMaterialBook, registerCommittedBuildings, registerCommittedCast,
  registerCommittedItems, registerGeneratedTerrain,
} from '@sj/forge'
import {
  ROAD_AUTOTILE_KEYS, TERRAIN_TILE_KINDS, roadAutotileKind, type BuildingManifest,
} from '@sj/shared'

// durable session scratchpad (same precedent as the forge production scripts);
// override with SJ_ART_ROOT for other machines
export const DEFAULT_ART_ROOT =
  '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'

// The scratchpad structures that have NO committed cell. The storehouse left this list when it
// got an authored one: two roots registering the same kind fight over `latestByKind` and each
// re-registers on every boot, so a kind belongs to exactly one root.
export const BUILDING_ART_DIRS: readonly string[] = [
  'production/building-wagon', 'production/building-shed',
  'production/building-scaffolding', 'production/building-standing-stone',
]

export type IngestEntry = {
  kind: string
  /** `missing` is art the scratchpad no longer holds. It is REPORTED, never thrown: one absent
   *  founder used to abort the whole function, so the buildings after it in the loop never
   *  registered either and the town woke with no art at all. */
  action: 'registered' | 'unchanged' | 'missing'
  id: string
  detail?: string
}

function latestByKind(codex: AssetCodex, klass: string, kind: string) {
  return codex.listSince(0).filter(r => r.status === 'ready' && r.class === klass && r.kind === kind).at(-1) ?? null
}

function upsert(
  codex: AssetCodex,
  input: {
    klass: 'rig-part' | 'building'; kind: string; desc: string; png: Buffer
    widthPx: number; heightPx: number; meta: string; footprint: { w: number; h: number }
  },
): IngestEntry {
  const existing = latestByKind(codex, input.klass, input.kind)
  if (existing !== null && existing.meta === input.meta) {
    const stored = codex.get(existing.id)
    if (stored !== null && stored.png.equals(input.png)) {
      return { kind: input.kind, action: 'unchanged', id: existing.id }
    }
  }
  const rec = codex.register({
    class: input.klass, desc: input.desc, kind: input.kind, meta: input.meta,
    footprint: input.footprint, png: input.png, widthPx: input.widthPx, heightPx: input.heightPx,
    status: 'ready', score: null, attempts: 1, costUsd: 0,
  })
  return { kind: input.kind, action: 'registered', id: rec.id }
}

async function ingestBuilding(codex: AssetCodex, root: string, dir: string): Promise<IngestEntry> {
  const base = join(root, dir)
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as BuildingManifest
  if (manifest.version !== 'v4-hires-building') throw new Error(`${dir}: manifest version is not v4-hires-building`)
  const png = readFileSync(join(base, 'cell.png'))
  const img = await decodePng(png)
  return upsert(codex, {
    klass: 'building', kind: manifest.kind, desc: `building v4: ${manifest.kind}`,
    png, widthPx: img.width, heightPx: img.height,
    meta: JSON.stringify(manifest), footprint: manifest.footprint,
  })
}

// ★ THE ANCHOR-DERIVED HOME IS RETIRED. The founders' home used to be the committed style
// anchor, chroma-keyed and re-celled at ingest time — first under kind `hut`, which nothing
// places, and the anchor's own architecture is the medieval one the user rejected. `house` is
// now an authored cell in `forge/content/buildings`, alongside the cottage, the cabin, the
// farmhouse and the storehouse, in both facings. `registerCommittedBuildings` puts all ten in.

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

// ★ ONE ABSENT FILE USED TO COST THE WHOLE TOWN ITS ART.
//
// The five founders and five structures below all read one session scratchpad, and when it
// emptied the first ENOENT escaped the loop and nothing behind it registered either — not the
// other founders, not the buildings, not the anchor home. So a per-item failure is REPORTED
// and stepped over, and the committed roots register first because they cannot go missing.
//
// Four structures still live here. Unlike the founders they have never had art in ANY root:
// the wagon, the shed, the scaffolding and the standing stone were never commissioned, so
// there is nothing committed to move. They are also not placed by `cityTemplate`, which is why
// round 4's structure gate stays green without them.
async function tryIngest(
  kind: string, run: () => Promise<IngestEntry>,
): Promise<IngestEntry> {
  try {
    return await run()
  } catch (e) {
    return { kind, action: 'missing', id: '', detail: e instanceof Error ? e.message : String(e) }
  }
}

export async function ingestProductionArt(
  db: Database.Database,
  opts: { artRoot?: string } = {},
): Promise<IngestEntry[]> {
  const root = opts.artRoot ?? process.env['SJ_ART_ROOT'] ?? DEFAULT_ART_ROOT
  if (!existsSync(root)) throw new Error(`ingestProductionArt: art root not found: ${root}`)
  const codex = new AssetCodex(db)
  const out: IngestEntry[] = [
    ...registerCommittedBuildings(codex),
    ...registerCommittedCast(codex),
  ]
  for (const dir of BUILDING_ART_DIRS) {
    out.push(await tryIngest(dir, () => ingestBuilding(codex, root, dir)))
  }
  return out
}
