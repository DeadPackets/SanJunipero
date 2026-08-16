// Idempotent ingest of the APPROVED production art (durable scratchpad → forge codex).
// Characters pack into one v4-hires-atlas record each (kind character:<id>); buildings
// register their hi-res cell + v4-hires-building manifest (kind = engine structure kind).
// Re-running registers nothing when bytes+manifest are unchanged; regenerated art gets a
// new record that wins by seq (the renderer's newest-ready law).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import {
  AssetCodex, CELL_NAMES_V4, cellAnchor, chromaKey, decodePng, encodePng,
  packCharacterAtlas, processHiResCell, registerTerrainTiles, type RawImage,
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

export const BUILDING_ART_DIRS: readonly string[] = [
  'production/building-storehouse', 'production/building-wagon', 'production/building-shed',
  'production/building-scaffolding', 'production/building-standing-stone',
]

export type IngestEntry = { kind: string; action: 'registered' | 'unchanged'; id: string }

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

// The previously-approved anchor cottage serves the engine's one buildable kind ('hut').
// Its committed source is the raw magenta-keyed style anchor; the same hi-res cell chain
// the v4 buildings used makes it codex-resolvable with a mechanical ground-anchor manifest.
export async function cottageCell(styleAnchorPng: Buffer): Promise<{ cell: RawImage; anchor: CellAnchor }> {
  const raw = await decodePng(styleAnchorPng)
  let keyed = raw
  let transparent = 0
  for (let i = 3; i < raw.data.length; i += 4) if (raw.data[i] === 0) transparent++
  if (transparent / (raw.width * raw.height) < 0.1) {
    for (const tolerance of [72, 110]) {
      keyed = chromaKey(raw, { tolerance })
      let clear = 0
      for (let i = 3; i < keyed.data.length; i += 4) if (keyed.data[i] === 0) clear++
      if (clear / (keyed.width * keyed.height) >= 0.1) break
    }
  }
  const cell = processHiResCell(keyed)
  return { cell, anchor: cellAnchor(cell) }
}

async function ingestCottage(codex: AssetCodex, styleAnchorPath: string): Promise<IngestEntry> {
  const { cell, anchor } = await cottageCell(readFileSync(styleAnchorPath))
  const manifest: BuildingManifest = {
    version: 'v4-hires-building', kind: 'hut', footprint: { w: 2, h: 2 }, cell: anchor,
  }
  const png = await encodePng(cell)
  return upsert(codex, {
    klass: 'building', kind: 'hut', desc: 'building v4: anchor cottage (hut dwelling)',
    png, widthPx: cell.width, heightPx: cell.height,
    meta: JSON.stringify(manifest), footprint: manifest.footprint,
  })
}

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
  const recs = await registerTerrainTiles(codex)
  return recs.map((r) => ({ kind: r.kind ?? '', action: 'registered' as const, id: r.id }))
}

export async function ingestProductionArt(
  db: Database.Database,
  opts: { artRoot?: string; styleAnchorPath?: string } = {},
): Promise<IngestEntry[]> {
  const root = opts.artRoot ?? process.env['SJ_ART_ROOT'] ?? DEFAULT_ART_ROOT
  if (!existsSync(root)) throw new Error(`ingestProductionArt: art root not found: ${root}`)
  const codex = new AssetCodex(db)
  const out: IngestEntry[] = []
  for (const f of FOUNDER_ART) out.push(await ingestCharacter(codex, root, f.id, f.dir))
  for (const dir of BUILDING_ART_DIRS) out.push(await ingestBuilding(codex, root, dir))
  const anchorPath = opts.styleAnchorPath
    ?? fileURLToPath(new URL('../../forge/content/reference/style-anchor.png', import.meta.url))
  if (existsSync(anchorPath)) out.push(await ingestCottage(codex, anchorPath))
  return out
}
