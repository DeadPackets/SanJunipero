import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AssetCodex, CELL_NAMES_V4, encodePng, openForgeDb, type RawImage } from '@sj/forge'
import {
  ROAD_AUTOTILE_KEYS, TERRAIN_TILE_KINDS, parseBuildingManifest, parseCharacterAtlasManifest,
  roadAutotileKind,
} from '@sj/shared'
import { BUILDING_ART_DIRS, FOUNDER_ART, ingestProductionArt, ingestTerrainArt } from './ingestArt.js'

const dir = mkdtempSync(join(tmpdir(), 'sj-ingest-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function cell(w: number, h: number, r: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([r, 80, 60, 255], i * 4)
  return { width: w, height: h, data }
}

// magenta-background "cottage" for the style-anchor chain
function magentaCottage(): RawImage {
  const w = 40, h = 40
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([255, 0, 255, 255], i * 4)
  for (let y = 10; y < 34; y++) for (let x = 8; x < 32; x++) data.set([200, 150, 90, 255], (y * w + x) * 4)
  return { width: w, height: h, data }
}

async function buildArtRoot(root: string, mark: number): Promise<void> {
  for (const f of FOUNDER_ART) {
    const base = join(root, f.dir)
    mkdirSync(join(base, 'cells'), { recursive: true })
    const cells: Record<string, { w: number; h: number; feetX: number; feetY: number }> = {}
    for (const name of CELL_NAMES_V4) {
      const img = cell(10, 12, mark)
      writeFileSync(join(base, 'cells', `${name}.png`), await encodePng(img))
      cells[name] = { w: 10, h: 12, feetX: 5, feetY: 11 }
    }
    writeFileSync(join(base, 'manifest.json'), JSON.stringify({ version: 'v4-hires', figureH: 12, cells }))
  }
  for (const d of BUILDING_ART_DIRS) {
    const base = join(root, d)
    mkdirSync(base, { recursive: true })
    const kind = d.replace('production/building-', '').replace('standing-stone', 'standing_stone')
    writeFileSync(join(base, 'cell.png'), await encodePng(cell(20, 24, mark)))
    writeFileSync(join(base, 'manifest.json'), JSON.stringify({
      version: 'v4-hires-building', kind, footprint: { w: 1, h: 1 },
      cell: { w: 20, h: 24, feetX: 10, feetY: 23 },
    }))
  }
}

describe('ingestProductionArt', () => {
  it('registers 5 founder atlases + 5 buildings + the anchor cottage, idempotently', async () => {
    const root = join(dir, 'art')
    await buildArtRoot(root, 100)
    const anchor = join(dir, 'style-anchor.png')
    writeFileSync(anchor, await encodePng(magentaCottage()))
    const db = openForgeDb(join(dir, 'codex.db'))
    const codex = new AssetCodex(db)

    const first = await ingestProductionArt(db, { artRoot: root, styleAnchorPath: anchor })
    expect(first).toHaveLength(11)
    expect(first.every((e) => e.action === 'registered')).toBe(true)
    expect(first.map((e) => e.kind)).toContain('character:omar')
    expect(first.map((e) => e.kind)).toContain('standing_stone')
    expect(first.map((e) => e.kind)).toContain('hut')

    // character record carries a parseable v4 atlas manifest with all 24 cells
    const omar = codex.listSince(0).find((r) => r.kind === 'character:omar')!
    expect(omar.class).toBe('rig-part')
    const atlas = parseCharacterAtlasManifest(omar.meta)!
    expect(Object.keys(atlas.cells)).toHaveLength(24)
    expect(atlas.figureH).toBe(12)

    // building record carries the v4-hires-building manifest as-is
    const shed = codex.listSince(0).find((r) => r.kind === 'shed')!
    expect(parseBuildingManifest(shed.meta)?.cell.feetY).toBe(23)

    // cottage: keyed, trimmed, ground-anchored, kind = the buildable 'hut'
    const hut = codex.listSince(0).find((r) => r.kind === 'hut')!
    const hutManifest = parseBuildingManifest(hut.meta)!
    expect(hutManifest.footprint).toEqual({ w: 2, h: 2 })
    expect(hutManifest.cell.feetY).toBeLessThan(hutManifest.cell.h)

    // second run: nothing new
    const second = await ingestProductionArt(db, { artRoot: root, styleAnchorPath: anchor })
    expect(second.every((e) => e.action === 'unchanged')).toBe(true)
    expect(codex.listSince(0)).toHaveLength(11)

    // regen (changed bytes) → a NEW record that wins by seq
    await buildArtRoot(root, 200)
    const third = await ingestProductionArt(db, { artRoot: root, styleAnchorPath: anchor })
    expect(third.filter((e) => e.action === 'registered')).toHaveLength(10) // all but the untouched cottage
    const omars = codex.listSince(0).filter((r) => r.kind === 'character:omar')
    expect(omars).toHaveLength(2)
    expect(omars.at(-1)!.seq).toBeGreaterThan(omars[0]!.seq)

    db.close()
  }, 30_000)
})

describe('ingestTerrainArt', () => {
  it('puts every flat tile kind and all 15 road-strip keys in the codex, idempotently', async () => {
    const db = openForgeDb(join(dir, 'terrain.db'))
    const codex = new AssetCodex(db)

    const first = await ingestTerrainArt(db)
    expect(first.every((e) => e.action === 'registered')).toBe(true)
    const ready = codex.listSince(0).filter((r) => r.status === 'ready' && r.class === 'terrain')
    const kinds = new Set(ready.map((r) => r.kind))
    for (const k of TERRAIN_TILE_KINDS) expect(kinds).toContain(k)
    for (const key of ROAD_AUTOTILE_KEYS) expect(kinds).toContain(roadAutotileKind(key))

    // a second boot over the same codex registers nothing — no duplicate rows to shadow
    const second = await ingestTerrainArt(db)
    expect(second.every((e) => e.action === 'unchanged')).toBe(true)
    expect(codex.listSince(0).filter((r) => r.class === 'terrain')).toHaveLength(ready.length)

    db.close()
  }, 30_000)
})
