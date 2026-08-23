// Idempotent ingest of the APPROVED production art → the forge codex.
// Characters pack into one v4-hires-atlas record each (kind character:<id>); buildings
// register their hi-res cell + v4-hires-building manifest (kind = engine structure kind,
// with the facing riding in it: `house`, `house:se`).
// Re-running registers nothing when bytes+manifest are unchanged; regenerated art gets a
// new record that wins by seq (the renderer's newest-ready law).
//
// TWO ROOTS, ONE OF WHICH IS DURABLE. The town's buildings come from `forge/content/buildings`,
// which is COMMITTED. The cast still comes from a session scratchpad, and that scratchpad has
// already been emptied once with every character cell in it — see `tryIngest`.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import {
  AssetCodex, CELL_NAMES_V4, LIBRARY, decodePng, encodePng, loadMaterialBook, packCharacterAtlas,
  registerCommittedBuildings, registerGeneratedTerrain, registerLibraryEntry,
  type LibraryEntry, type RawImage,
} from '@sj/forge'
import {
  ROAD_AUTOTILE_KEYS, TERRAIN_TILE_KINDS, roadAutotileKind,
  type BuildingManifest, type CellAnchor,
} from '@sj/shared'

// durable session scratchpad (same precedent as the forge production scripts);
// override with SJ_ART_ROOT for other machines
export const DEFAULT_ART_ROOT =
  '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'

export const FOUNDER_ART: readonly { id: string; dir: string }[] = [
  { id: 'omar', dir: 'character-v4' }, // the approved reference character
  { id: 'amara', dir: 'production/amara' },
  { id: 'yusuf', dir: 'production/yusuf' },
  { id: 'nadia', dir: 'production/nadia' },
  { id: 'salma', dir: 'production/salma' },
]

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

type CharManifestFile = { version: string; figureH: number; cells: Record<string, CellAnchor> }

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

async function ingestCharacter(codex: AssetCodex, root: string, id: string, dir: string): Promise<IngestEntry> {
  const base = join(root, dir)
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as CharManifestFile
  if (manifest.version !== 'v4-hires') throw new Error(`${id}: manifest version ${manifest.version} is not v4-hires`)
  const cells = new Map<string, RawImage>()
  for (const name of CELL_NAMES_V4) {
    cells.set(name, await decodePng(readFileSync(join(base, 'cells', `${name}.png`))))
  }
  const { image, manifest: atlas } = packCharacterAtlas(cells, manifest.figureH)
  const png = await encodePng(image)
  return upsert(codex, {
    klass: 'rig-part', kind: `character:${id}`, desc: `character sheet v4: ${id}`,
    png, widthPx: image.width, heightPx: image.height,
    meta: JSON.stringify(atlas), footprint: { w: 1, h: 1 },
  })
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

// C13's premade library — 50 painted items, fifteen of them the furniture the interior
// scenes place on their slots. Without this a room draws every furnishing as the item
// placeholder, which is what the storehouse was showing. Same convention as the production
// art above: the art lives in the durable scratchpad, overridable for another machine.
export const DEFAULT_LIBRARY_ROOT =
  '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c13/library'

export function libraryArtRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env['SJ_LIBRARY_ROOT'] ?? DEFAULT_LIBRARY_ROOT
}

// The entries whose art is actually on disk. A missing sprite is not an error — the renderer
// falls back to the placeholder, the same art independence the ground bake lives by.
export function libraryEntriesOnDisk(root: string): LibraryEntry[] {
  return LIBRARY.filter((e) => existsSync(join(root, e.kind, 'sprite.png'))
    && existsSync(join(root, e.kind, 'icon.png')))
}

export async function ingestLibraryArt(
  db: Database.Database, opts: { libraryRoot?: string } = {},
): Promise<IngestEntry[]> {
  const root = opts.libraryRoot ?? libraryArtRoot()
  const codex = new AssetCodex(db)
  const out: IngestEntry[] = []
  for (const entry of libraryEntriesOnDisk(root)) {
    const sprite = readFileSync(join(root, entry.kind, 'sprite.png'))
    const existing = latestByKind(codex, 'item', entry.kind)
    if (existing !== null) {
      const stored = codex.get(existing.id)
      if (stored !== null && stored.png.equals(sprite)) {
        out.push({ kind: entry.kind, action: 'unchanged', id: existing.id })
        continue
      }
    }
    // C13 already booked what this art cost in its own ledger; re-booking here would
    // double-count the spend, so the ingest is free by construction.
    const { spriteRecord } = registerLibraryEntry(codex, entry, {
      sprite, icon: readFileSync(join(root, entry.kind, 'icon.png')),
      score: 10, attempts: 1, costUsd: 0,
    })
    out.push({ kind: entry.kind, action: 'registered', id: spriteRecord.id })
  }
  return out
}

// ★ ONE ABSENT FILE USED TO COST THE WHOLE TOWN ITS ART.
//
// This function's art lives in a session scratchpad, and on this tip that scratchpad holds the
// whole directory tree and ZERO files. The first founder threw ENOENT, the throw escaped the
// loop, and neither the four founders behind it nor the five buildings nor the anchor home
// after them ever registered — so every structure drew `builtForm` and every founder drew the
// checkerboard. Art that is committed (the terrain, and now the buildings) survived it.
//
// So a per-item failure is now REPORTED and stepped over. The committed cells register first,
// because they are the ones that cannot go missing.
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
  const out: IngestEntry[] = [...registerCommittedBuildings(codex)]
  for (const f of FOUNDER_ART) {
    out.push(await tryIngest(`character:${f.id}`, () => ingestCharacter(codex, root, f.id, f.dir)))
  }
  for (const dir of BUILDING_ART_DIRS) {
    out.push(await tryIngest(dir, () => ingestBuilding(codex, root, dir)))
  }
  return out
}
