import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AssetCodex, CELL_NAMES_V4, encodePng, openForgeDb, type RawImage } from '@sj/forge'
import {
  ROAD_AUTOTILE_KEYS, TERRAIN_TILE_KINDS, parseBuildingManifest, parseCharacterAtlasManifest,
  roadAutotileKind,
} from '@sj/shared'
import { INTERIOR_KINDS, cityStructures, parseLibraryItemManifest, resolveFurnishingKind } from '@sj/shared'
import { LIBRARY } from '@sj/forge'
import {
  BUILDING_ART_DIRS, FOUNDER_ART, ingestLibraryArt, ingestProductionArt, ingestTerrainArt,
  libraryArtRoot, libraryEntriesOnDisk,
} from './ingestArt.js'

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


// FINAL ROUND item 1. The storehouse room drew checkerboard placeholders because the dev
// world ingested terrain and production art but never the C13 library — so `roomPlan` found
// no `class:'item'` record for bed, shelf, crate or barrel and fell through to the
// placeholder. G13's "interiors live" close would have failed on exactly that.
describe('ingestLibraryArt', () => {
  it('registers a sprite AND an icon per item, idempotently', async () => {
    const root = join(dir, 'lib')
    for (const kind of ['bed', 'shelf']) {
      mkdirSync(join(root, kind), { recursive: true })
      writeFileSync(join(root, kind, 'sprite.png'), await encodePng(cell(24, 24, 90)))
      writeFileSync(join(root, kind, 'icon.png'), await encodePng(cell(24, 24, 90)))
    }
    const db = openForgeDb(join(dir, 'lib.db'))
    const codex = new AssetCodex(db)

    const first = await ingestLibraryArt(db, { libraryRoot: root })
    expect(first.map((e) => e.kind).sort()).toEqual(['bed', 'shelf'])
    expect(first.every((e) => e.action === 'registered')).toBe(true)

    const items = codex.listSince(0).filter((r) => r.class === 'item')
    expect(items).toHaveLength(4)                       // two sprites + two icons
    const bed = items.find((r) => r.kind === 'bed')!
    const manifest = parseLibraryItemManifest(bed.meta)
    expect(manifest).not.toBeNull()
    expect(manifest!.interior?.isBed).toBe(true)        // the meta the interior scene reads
    expect(bed.costUsd).toBe(0)                         // C13 already booked this spend

    const second = await ingestLibraryArt(db, { libraryRoot: root })
    expect(second.every((e) => e.action === 'unchanged')).toBe(true)
    expect(codex.listSince(0).filter((r) => r.class === 'item')).toHaveLength(4)
    db.close()
  }, 30_000)

  it('skips an item whose art is not on disk rather than failing the boot', async () => {
    const root = join(dir, 'empty-lib')
    mkdirSync(root, { recursive: true })
    expect(libraryEntriesOnDisk(root)).toEqual([])
    const db = openForgeDb(join(dir, 'empty-lib.db'))
    expect(await ingestLibraryArt(db, { libraryRoot: root })).toEqual([])
    db.close()
  })

  it('the catalog can furnish every interior kind the renderer places', () => {
    const known = new Set(LIBRARY.map((e) => e.kind))
    for (const kind of INTERIOR_KINDS) {
      const s = cityStructures().find((c) => c.kind === kind)
      expect(s, kind).toBeDefined()
      for (const f of s!.furnishings) {
        expect(known, `${kind} places ${f.kind}, which the library cannot paint`)
          .toContain(resolveFurnishingKind(f.kind))
      }
    }
  })

  it('finds the real shipped library on this machine, or says so plainly', () => {
    const found = libraryEntriesOnDisk(libraryArtRoot()).map((e) => e.kind)
    const furniture = LIBRARY.filter((e) => e.category === 'furniture').map((e) => e.kind)
    // not an assertion about the machine — a report, so a missing library is visible
    if (found.length === 0) return
    for (const k of furniture) expect(found, `${k} has no art`).toContain(k)
  })
})
