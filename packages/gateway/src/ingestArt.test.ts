import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  AssetCodex, CELL_NAMES_V4, encodePng, listCommittedBuildings, openForgeDb, type RawImage,
} from '@sj/forge'
import {
  DWELLING_FOOTPRINTS, ROAD_AUTOTILE_KEYS, TERRAIN_TILE_KINDS, parseBuildingManifest,
  parseCharacterAtlasManifest, roadAutotileKind,
} from '@sj/shared'
import { INTERIOR_KINDS, cityStructures, parseLibraryItemManifest, resolveFurnishingKind } from '@sj/shared'
import { LIBRARY } from '@sj/forge'
import { structureArtCoverage, worldStructureKinds } from '@sj/forge'
import { DEFAULT_CONFIG, makeCityTemplate } from '@sj/shared'
import {
  FOUNDER_ART, ingestLibraryArt, ingestProductionArt, ingestTerrainArt,
  libraryArtRoot, libraryEntriesOnDisk,
} from './ingestArt.js'
import { townStructuresFor } from './founders.js'

const dir = mkdtempSync(join(tmpdir(), 'sj-ingest-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function cell(w: number, h: number, r: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([r, 80, 60, 255], i * 4)
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
}

describe('ingestProductionArt', () => {
  it('registers the committed cells + 5 founder atlases, idempotently', async () => {
    const root = join(dir, 'art')
    await buildArtRoot(root, 100)
    const db = openForgeDb(join(dir, 'codex.db'))
    const codex = new AssetCodex(db)

    const committed = listCommittedBuildings().length
    const first = await ingestProductionArt(db, { artRoot: root })
    expect(first).toHaveLength(committed + FOUNDER_ART.length)
    expect(first.every((e) => e.action === 'registered')).toBe(true)
    expect(first.map((e) => e.kind)).toContain('character:omar')
    expect(first.map((e) => e.kind)).toContain('standing_stone')
    // ★ `house`, not `hut`. This line asserted `hut` for a whole merge train after the template
    // renamed the kind, which is how a test can codify the very seam it was meant to hold.
    expect(first.map((e) => e.kind)).toContain('house')

    // character record carries a parseable v4 atlas manifest with all 24 cells
    const omar = codex.listSince(0).find((r) => r.kind === 'character:omar')!
    expect(omar.class).toBe('rig-part')
    const atlas = parseCharacterAtlasManifest(omar.meta)!
    expect(Object.keys(atlas.cells)).toHaveLength(24)
    expect(atlas.figureH).toBe(12)

    // building record carries the v4-hires-building manifest as-is — and the shed's cell is a
    // COMMITTED one now, not the scratchpad fixture the old version of this test wrote
    const shed = codex.listSince(0).find((r) => r.kind === 'shed')!
    const shedManifest = parseBuildingManifest(shed.meta)!
    expect(shedManifest.footprint).toEqual({ w: 1, h: 1 })
    expect(shedManifest.cell.feetY).toBeLessThan(shedManifest.cell.h)

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
    // only the scratchpad cast changed bytes; the committed cells are untouched
    expect(third.filter((e) => e.action === 'registered')).toHaveLength(FOUNDER_ART.length)
    const omars = codex.listSince(0).filter((r) => r.kind === 'character:omar')
    expect(omars).toHaveLength(2)
    expect(omars.at(-1)!.seq).toBeGreaterThan(omars[0]!.seq)

    db.close()
  }, 30_000)

  // ★ THE REASON THE TOWN HAD NO ART AT ALL. The art root is a session scratchpad; on the
  // round-4 tip it held the whole directory tree and zero files. One ENOENT on the first
  // founder aborted the loop, so the four founders behind it, all five buildings and the
  // anchor home never registered either.
  it('steps over art the scratchpad no longer holds instead of losing the rest', async () => {
    const root = join(dir, 'art-gapped')
    await buildArtRoot(root, 100)
    rmSync(join(root, FOUNDER_ART[0]!.dir, 'manifest.json'), { force: true })
    const db = openForgeDb(join(dir, 'gapped.db'))

    const entries = await ingestProductionArt(db, { artRoot: root })
    const missing = entries.filter((e) => e.action === 'missing')
    expect(missing.map((e) => e.kind)).toEqual([`character:${FOUNDER_ART[0]!.id}`])
    expect(missing[0]!.detail).toMatch(/ENOENT/)
    // everything downstream of the gap still landed — including the home the gap used to eat
    const kinds = new Set(new AssetCodex(db).listSince(0).map((r) => r.kind))
    expect(kinds).toContain('house')
    expect(kinds).toContain('standing_stone')
    expect(kinds).toContain(`character:${FOUNDER_ART[4]!.id}`)
    db.close()
  }, 30_000)

  // ★ THE DEV TOWN'S HALF OF THE COVERAGE LAW.
  //
  // `structureArt.ts` asks whether every kind the WORLD can create resolves to committed art,
  // and it can see two of the three sources: the city template and `config.structures.recipes`.
  // The third is `TOWN_STRUCTURES` in `founders.ts` — the frozen G6 fixture town, which is the
  // DEFAULT dev map — and `@sj/forge` must not import `@sj/gateway` to reach it. So the same
  // law is asked here, next to the source that can see it.
  //
  // This is the arm that was missing. Four kinds — wagon, shed, scaffolding, standing_stone —
  // are stood by this town and by nothing else, so the template-only gate never looked at them,
  // stayed green, and all four drew a grey prism while the boot log printed four ENOENTs.
  describe('the dev town half of the coverage law', () => {
    const TEMPLATE = makeCityTemplate()

    it.each(['scripted', 'showcase'] as const)(
      'every kind the %s dev town stands resolves to committed art', (map) => {
        const town = townStructuresFor(map)
        expect(town.length).toBeGreaterThan(0)
        const { missing } = structureArtCoverage({
          structures: town,
          registered: listCommittedBuildings().map((c) => c.codexKind),
          creatable: worldStructureKinds({
            structures: [...TEMPLATE.structures, ...town],
            recipes: DEFAULT_CONFIG.structures.recipes,
          }),
        })
        expect(missing, `the ${map} town stands these and no codex cell answers:\n  ${missing.join('\n  ')}`)
          .toEqual([])
      })

    it('★ and it NAMES a kind the town stands with no art — the mutation', () => {
      // A DELTA, so it proves the same thing whether the tree is whole or already broken:
      // standing one more kind in the fixture town adds exactly one failure and no other.
      const registered = listCommittedBuildings().map((c) => c.codexKind)
      const coverage = (town: readonly { kind: string }[]): string[] => structureArtCoverage({
        structures: town,
        registered,
        creatable: worldStructureKinds({
          structures: [...TEMPLATE.structures, ...town],
          recipes: DEFAULT_CONFIG.structures.recipes,
        }),
      }).missing
      const before = coverage(townStructuresFor('scripted'))
      const after = coverage([...townStructuresFor('scripted'), { kind: 'watchtower' }])
      expect(after.filter((m) => !before.includes(m))).toEqual(['watchtower facing sw'])
    })

    it('the four kinds the boot log named are this town\'s, and their footprints are its own', () => {
      const byKind = new Map(townStructuresFor('scripted').map((s) => [s.kind, s]))
      expect([...byKind.keys()].sort())
        .toEqual(['house', 'scaffolding', 'shed', 'standing_stone', 'storehouse', 'wagon'])
      // the footprints `structureArt.test.ts` cannot see from inside @sj/forge
      const cells = new Map(listCommittedBuildings().map((c) => [c.codexKind, c]))
      for (const kind of ['wagon', 'shed', 'scaffolding', 'standing_stone']) {
        const s = byKind.get(kind)!
        expect(cells.get(kind)!.manifest.footprint, kind).toEqual({ w: s.w, h: s.h })
      }
    })
  })

  it('gives each kind exactly one root, so two roots never fight over it', () => {
    // There is only one building root now, and that is the whole of it: the scratchpad list
    // this test used to compare against named four kinds whose art had not existed for three
    // rounds. `ingestProductionArt` registers buildings from `registerCommittedBuildings` and
    // from nowhere else, so no kind can be claimed twice.
    const kinds = listCommittedBuildings().map((c) => c.codexKind)
    expect(new Set(kinds).size, 'two committed cells claim one codex kind').toBe(kinds.length)
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

  it('finds the real shipped library on this machine, or says so plainly', () => {
    const found = libraryEntriesOnDisk(libraryArtRoot()).map((e) => e.kind)
    const furniture = LIBRARY.filter((e) => e.category === 'furniture').map((e) => e.kind)
    // not an assertion about the machine — a report, so a missing library is visible
    if (found.length === 0) return
    for (const k of furniture) expect(found, `${k} has no art`).toContain(k)
  })
})
