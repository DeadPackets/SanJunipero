import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  AssetCodex, LIBRARY, encodePng, listCommittedBuildings, listCommittedCast, listCommittedItems,
  openForgeDb, castArtCoverage, itemArtCoverage, coverageFailure, type RawImage,
} from '@sj/forge'
import {
  DWELLING_FOOTPRINTS, FOUNDER_IDS, ROAD_AUTOTILE_KEYS, TERRAIN_TILE_KINDS,
  parseBuildingManifest, parseCharacterAtlasManifest, roadAutotileKind,
} from '@sj/shared'
import { INTERIOR_KINDS, cityStructures, parseLibraryItemManifest, resolveFurnishingKind } from '@sj/shared'
import {
  BUILDING_ART_DIRS, ingestCastArt, ingestLibraryArt, ingestProductionArt, ingestTerrainArt,
} from './ingestArt.js'

const dir = mkdtempSync(join(tmpdir(), 'sj-ingest-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function cell(w: number, h: number, r: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([r, 80, 60, 255], i * 4)
  return { width: w, height: h, data }
}

/** The four structures that have never had art in any root — the only scratchpad left. */
async function buildArtRoot(root: string, mark: number): Promise<void> {
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
  it('registers the committed cells + the committed cast + 4 scratchpad structures, idempotently', async () => {
    const root = join(dir, 'art')
    await buildArtRoot(root, 100)
    const db = openForgeDb(join(dir, 'codex.db'))
    const codex = new AssetCodex(db)

    const committed = listCommittedBuildings().length + listCommittedCast().length
    const first = await ingestProductionArt(db, { artRoot: root })
    expect(first).toHaveLength(committed + BUILDING_ART_DIRS.length)
    expect(first.every((e) => e.action === 'registered')).toBe(true)
    expect(first.map((e) => e.kind)).toContain('character:omar')
    expect(first.map((e) => e.kind)).toContain('standing_stone')
    // ★ `house`, not `hut`. This line asserted `hut` for a whole merge train after the template
    // renamed the kind, which is how a test can codify the very seam it was meant to hold.
    expect(first.map((e) => e.kind)).toContain('house')

    // the character record carries a parseable v4 atlas manifest with all 24 cells
    const omar = codex.listSince(0).find((r) => r.kind === 'character:omar')!
    expect(omar.class).toBe('rig-part')
    const atlas = parseCharacterAtlasManifest(omar.meta)!
    expect(Object.keys(atlas.cells)).toHaveLength(24)
    expect(atlas.figureH).toBeGreaterThan(0)

    // building record carries the v4-hires-building manifest as-is
    const shed = codex.listSince(0).find((r) => r.kind === 'shed')!
    expect(parseBuildingManifest(shed.meta)?.cell.feetY).toBe(23)

    // the founders' home: an authored, committed cell, at the footprint the template gives it
    const home = codex.listSince(0).find((r) => r.kind === 'house')!
    const homeManifest = parseBuildingManifest(home.meta)!
    expect(homeManifest.footprint).toEqual(DWELLING_FOOTPRINTS.house)
    expect(homeManifest.cell.feetY).toBeLessThan(homeManifest.cell.h)
    expect(codex.listSince(0).some((r) => r.kind === 'hut'), 'nothing places `hut`').toBe(false)
    // and its turned twin, which nothing places yet and everything is ready for
    expect(codex.listSince(0).some((r) => r.kind === 'house:se')).toBe(true)

    // second run: nothing new
    const second = await ingestProductionArt(db, { artRoot: root })
    expect(second.every((e) => e.action === 'unchanged')).toBe(true)
    expect(codex.listSince(0)).toHaveLength(first.length)

    // regen (changed bytes) → a NEW record that wins by seq
    await buildArtRoot(root, 200)
    const third = await ingestProductionArt(db, { artRoot: root })
    // only the scratchpad art changed bytes; the committed roots are untouched
    expect(third.filter((e) => e.action === 'registered')).toHaveLength(BUILDING_ART_DIRS.length)
    const sheds = codex.listSince(0).filter((r) => r.kind === 'shed')
    expect(sheds).toHaveLength(2)
    expect(sheds.at(-1)!.seq).toBeGreaterThan(sheds[0]!.seq)

    db.close()
  }, 30_000)

  // ★ THE REASON THE TOWN HAD NO ART AT ALL. The art root was a session scratchpad holding the
  // whole directory tree and zero files. One ENOENT on the first entry aborted the loop, so
  // everything behind it in the same loop never registered either.
  it('steps over art the scratchpad no longer holds instead of losing the rest', async () => {
    const root = join(dir, 'art-gapped')
    await buildArtRoot(root, 100)
    rmSync(join(root, BUILDING_ART_DIRS[0]!, 'manifest.json'), { force: true })
    const db = openForgeDb(join(dir, 'gapped.db'))

    const entries = await ingestProductionArt(db, { artRoot: root })
    const missing = entries.filter((e) => e.action === 'missing')
    expect(missing.map((e) => e.kind)).toEqual([BUILDING_ART_DIRS[0]])
    expect(missing[0]!.detail).toMatch(/ENOENT/)
    // everything downstream of the gap still landed — including the art the gap used to eat
    const kinds = new Set(new AssetCodex(db).listSince(0).map((r) => r.kind))
    expect(kinds).toContain('house')
    expect(kinds).toContain('character:omar')
    expect(kinds).toContain('standing_stone')
    db.close()
  }, 30_000)

  it('gives each kind exactly one root, so two roots never fight over it', () => {
    const committed = new Set([
      ...listCommittedBuildings().map((c) => c.codexKind),
      ...listCommittedCast().map((c) => c.codexKind),
      ...listCommittedItems().map((c) => c.kind),
    ])
    const scratch = BUILDING_ART_DIRS.map((d) =>
      d.replace('production/building-', '').replace('standing-stone', 'standing_stone'))
    expect(scratch.filter((k) => committed.has(k)),
      'a kind in both roots re-registers on every boot, forever').toEqual([])
  })
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
// world ingested terrain and production art but never the library — so `roomPlan` found
// no `class:'item'` record for bed, shelf, crate or barrel and fell through to the
// placeholder. G13's "interiors live" close would have failed on exactly that.
describe('ingestLibraryArt', () => {
  it('registers a sprite AND an icon for every one of the fifty, idempotently', async () => {
    const db = openForgeDb(join(dir, 'lib.db'))
    const codex = new AssetCodex(db)

    const first = await ingestLibraryArt(db)
    expect(first.map((e) => e.kind).sort()).toEqual(LIBRARY.map((e) => e.kind).sort())
    expect(first.every((e) => e.action === 'registered')).toBe(true)

    const items = codex.listSince(0).filter((r) => r.class === 'item')
    expect(items, 'fifty sprites and fifty icons').toHaveLength(LIBRARY.length * 2)
    const bed = items.find((r) => r.kind === 'bed')!
    const manifest = parseLibraryItemManifest(bed.meta)
    expect(manifest).not.toBeNull()
    expect(manifest!.interior?.isBed).toBe(true)        // the meta the interior scene reads
    expect(bed.costUsd).toBe(0)                         // the generation booked its own spend

    const second = await ingestLibraryArt(db)
    expect(second.every((e) => e.action === 'unchanged')).toBe(true)
    expect(codex.listSince(0).filter((r) => r.class === 'item')).toHaveLength(LIBRARY.length * 2)
    db.close()
  }, 30_000)

  it('the catalog can furnish every interior kind the renderer places', () => {
    const known = new Set(LIBRARY.map((e) => e.kind))
    // A kind the plan no longer stands (the workshop shed) has no template room to check —
    // the renderer serves it INTERIOR_LAYOUTS instead, and that set is checked in @sj/web.
    const standing = INTERIOR_KINDS.filter((k) => cityStructures().some((c) => c.kind === k))
    expect(standing.length).toBeGreaterThan(0)
    for (const kind of standing) {
      const s = cityStructures().find((c) => c.kind === kind)
      expect(s, kind).toBeDefined()
      for (const f of s!.furnishings) {
        expect(known, `${kind} places ${f.kind}, which the library cannot paint`)
          .toContain(resolveFurnishingKind(f.kind))
      }
    }
  })
})

describe('ingestCastArt', () => {
  it('registers one packed sheet per founder, idempotently', async () => {
    const db = openForgeDb(join(dir, 'cast.db'))
    const codex = new AssetCodex(db)

    const first = await ingestCastArt(db)
    expect(first.map((e) => e.kind).sort())
      .toEqual([...FOUNDER_IDS].map((id) => `character:${id}`).sort())
    expect(first.every((e) => e.action === 'registered')).toBe(true)
    expect((await ingestCastArt(db)).every((e) => e.action === 'unchanged')).toBe(true)
    expect(codex.listSince(0).filter((r) => r.class === 'rig-part')).toHaveLength(FOUNDER_IDS.length)
    db.close()
  }, 30_000)
})

// ★ VACUOUS GUARD #8, KILLED AND REPLACED.
//
// This block used to hold one test — "finds the real shipped library on this machine, or says
// so plainly" — whose whole body was:
//
//     const found = libraryEntriesOnDisk(libraryArtRoot()).map(e => e.kind)
//     if (found.length === 0) return
//     for (const k of furniture) expect(found).toContain(k)
//
// It passed in EXACTLY the state the repository was in: the scratchpad it looked in held zero
// files, `found` was empty, and the early return skipped every assertion. It was green through
// the entire period the library did not exist, which is the only period it was ever needed. A
// guard that turns itself off when its subject is missing measures nothing at all.
//
// The replacement cannot do that. It asks the coverage law, which is derived from the CATALOG
// — a constant in the source — and never from what happens to be on disk. An empty tree makes
// it report a hundred missing kinds; there is no input that makes it pass by being empty.
describe('the boot resolves every kind the world will ask for', () => {
  it('after a real boot ingest, nothing is left to the placeholder', async () => {
    const root = join(dir, 'boot-art')
    await buildArtRoot(root, 100)
    const db = openForgeDb(join(dir, 'boot.db'))
    await ingestProductionArt(db, { artRoot: root })
    await ingestLibraryArt(db)
    const all = new AssetCodex(db).listSince(0).filter((r) => r.status === 'ready')
    const kindsOf = (klass: string) =>
      all.filter((r) => r.class === klass && r.kind !== null).map((r) => r.kind!)

    const items = itemArtCoverage(kindsOf('item'))
    expect(items.missing, coverageFailure('items', items).join('\n')).toEqual([])
    expect(items.orphans, coverageFailure('items', items).join('\n')).toEqual([])
    expect(items.covered).toHaveLength(LIBRARY.length * 2)

    const cast = castArtCoverage(kindsOf('rig-part'))
    expect(cast.missing, coverageFailure('cast', cast).join('\n')).toEqual([])
    expect(cast.orphans, coverageFailure('cast', cast).join('\n')).toEqual([])
    db.close()
  }, 30_000)

  it('and an empty codex reports every one of them, so the guard cannot go vacuous', () => {
    expect(itemArtCoverage([]).missing).toHaveLength(LIBRARY.length * 2)
    expect(castArtCoverage([]).missing).toHaveLength(FOUNDER_IDS.length)
  })
})
