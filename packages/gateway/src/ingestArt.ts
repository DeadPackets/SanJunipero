// Idempotent ingest of the committed production art → the forge codex. Regenerated art gets a
// new record that wins by seq (the renderer's newest-ready law).
import type Database from 'better-sqlite3'
import {
  AssetCodex,
  loadMaterialBook,
  registerCommittedBuildings,
  registerCommittedCast,
  registerCommittedItems,
  registerGeneratedTerrain,
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

// Terrain art is code-painted, so it needs no art root and costs nothing. Until this runs the
// codex holds no terrain records at all and the map bakes flat diamonds.
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
    console.log(
      `dev world: ${report.generated} generated terrain tiles, ${report.painted} code-painted`,
    )
  }
  return records.map((r) => ({ kind: r.kind ?? '', action: 'registered' as const, id: r.id }))
}

// The premade library — 50 painted items, fifteen of them the furniture the interior scenes
// place. `registerCommittedItems` THROWS on a half-present item rather than falling back.
export async function ingestLibraryArt(db: Database.Database): Promise<IngestEntry[]> {
  return registerCommittedItems(new AssetCodex(db))
}

// The five founder sheets, one packed atlas each.
export async function ingestCastArt(db: Database.Database): Promise<IngestEntry[]> {
  return registerCommittedCast(new AssetCodex(db))
}

export async function ingestProductionArt(db: Database.Database): Promise<IngestEntry[]> {
  const codex = new AssetCodex(db)
  return [...registerCommittedBuildings(codex), ...registerCommittedCast(codex)]
}
