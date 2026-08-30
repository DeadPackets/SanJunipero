import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CITY_HEARTH_KIND,
  FOUNDER_IDS,
  cityStructures,
  parseCharacterAtlasManifest,
  parseLibraryItemManifest,
} from '@sj/shared'
import { BUILDINGS_CONTENT_DIR, STRUCTURE_FACINGS, listCommittedBuildings } from './buildingArt.js'
import { loadReferenceSheet, paletteSwatchPng } from './referenceSheet.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import { decodePng, type RawImage } from './post/raw.js'
import {
  alphaBinaryGate,
  classDensityGate,
  nativeDensityGate,
  PALETTE_DISTANCE_MAX,
  paletteDistance,
  soleSilhouetteGate,
  spriteDensity,
} from './pixelGates.js'
import { mirrorX } from './sheet.js'
import { mirrorFacingGate } from './structureArt.js'
import { ICON_PX, TOWN_TILE } from './assetResolution.js'
import { LIBRARY, LIBRARY_COUNTS } from './library/catalog.js'
import { ICON_SUFFIX } from './library/register.js'
import {
  ITEMS_CONTENT_DIR,
  listCommittedItems,
  registerCommittedItems,
} from './library/committed.js'
import { CELL_NAMES_V4 } from './mirror.js'
import {
  CAST_CONTENT_DIR,
  characterKind,
  listCommittedCast,
  registerCommittedCast,
} from './castArt.js'
import {
  castArtCoverage,
  coverageFailure,
  itemArtCoverage,
  requiredCastKinds,
  requiredItemKinds,
} from './artCoverage.js'

// Reads the CODEX, not the renderer: `makePlaceholder` answers every class, so a gate that asks
// "did something draw?" passes forever.

// One decode per PNG for the whole file: the 21 building cells and the 5 atlases are each read
// by several rows below.
const DECODED = new Map<string, Promise<RawImage>>()
function pngOf(key: string, bytes: Buffer): Promise<RawImage> {
  const hit = DECODED.get(key)
  if (hit) return hit
  const decoded = decodePng(bytes)
  DECODED.set(key, decoded)
  return decoded
}

/** The registration the dev world does at boot, against a real codex. */
function registeredKinds(klass: 'item' | 'rig-part'): string[] {
  const db = openForgeDb(':memory:')
  try {
    const codex = new AssetCodex(db)
    registerCommittedItems(codex)
    registerCommittedCast(codex)
    return codex
      .listSince(0)
      .filter((r) => r.status === 'ready' && r.class === klass && r.kind !== null)
      .map((r) => r.kind!)
  } finally {
    db.close()
  }
}

describe('every item the catalog specifies has committed art, sprite and icon', () => {
  it('is measuring the library it thinks it is', () => {
    expect(LIBRARY).toHaveLength(Object.values(LIBRARY_COUNTS).reduce((s, n) => s + n, 0))
    for (const [category, n] of Object.entries(LIBRARY_COUNTS))
      expect(
        LIBRARY.filter((e) => e.category === category),
        category,
      ).toHaveLength(n)
    // 50 items is 100 codex records: the world sprite and the inventory icon are separate
    // rows and go missing separately.
    expect(requiredItemKinds()).toHaveLength(LIBRARY.length * 2)
  })

  it('MISSING: no library kind is left to the placeholder', () => {
    const c = itemArtCoverage(registeredKinds('item'))
    expect(c.missing, coverageFailure('items', c).join('\n')).toEqual([])
  })

  it('ORPHAN: no item record is registered under a kind the catalog does not carry', () => {
    const c = itemArtCoverage(registeredKinds('item'))
    expect(c.orphans, coverageFailure('items', c).join('\n')).toEqual([])
  })

  it('the fallback cannot satisfy this gate: makePlaceholder writes no codex row', () => {
    // If coverage were read off the renderer, an EMPTY codex would pass — the placeholder
    // draws every kind. It must report the whole library instead.
    const empty = itemArtCoverage([])
    expect(empty.missing).toHaveLength(LIBRARY.length * 2)
    expect(empty.missing).toContain('bed')
    expect(empty.missing).toContain(`bed${ICON_SUFFIX}`)
    expect(empty.covered).toEqual([])
  })
})

/** Every boot re-runs this ingest, and `listSince(0)` zod-parses every row of the assets table.
 *  Per item and per character, that is quadratic in the art catalogue. */
describe('★ the committed-art ingest scans the codex once, not once per item', () => {
  it('is idempotent on a second boot without re-reading the table per piece', () => {
    const db = openForgeDb(':memory:')
    try {
      const codex = new AssetCodex(db)
      const first = [...registerCommittedItems(codex), ...registerCommittedCast(codex)]
      expect(first.length).toBeGreaterThan(50)

      let scans = 0
      const real = codex.listSince.bind(codex)
      codex.listSince = (since: number) => {
        scans++
        return real(since)
      }

      const again = [...registerCommittedItems(codex), ...registerCommittedCast(codex)]
      // the second boot registers nothing — otherwise a low scan count means nothing was checked
      expect(again.map((e) => e.action)).toEqual(again.map(() => 'unchanged'))
      // items + interiors + cast: three whole-table passes, not one per piece
      expect(scans, `${scans} full codex scans for ${again.length} pieces`).toBeLessThanOrEqual(3)
    } finally {
      db.close()
    }
  })
})

describe('every founder the town spawns has a committed sheet', () => {
  it('is measuring the cast it thinks it is', () => {
    expect(requiredCastKinds()).toEqual([...FOUNDER_IDS].map(characterKind).sort())
  })

  it('MISSING: no villager is left to the placeholder', () => {
    const c = castArtCoverage(registeredKinds('rig-part'))
    expect(c.missing, coverageFailure('cast', c).join('\n')).toEqual([])
  })

  it('ORPHAN: no sheet is registered for someone the town never spawns', () => {
    const c = castArtCoverage(registeredKinds('rig-part'))
    expect(c.orphans, coverageFailure('cast', c).join('\n')).toEqual([])
  })

  it('the fallback cannot satisfy this gate either', () => {
    const empty = castArtCoverage([])
    expect(empty.missing).toEqual(requiredCastKinds())
    expect(empty.missing).toContain('character:omar')
  })
})

// Shipping the content ends the live failure, so the shape of the defect is kept as a fixture.
describe('the pre-recovery tree, as a fixture', () => {
  it('an empty codex reports all fifty items and all five founders', () => {
    const items = itemArtCoverage([])
    const cast = castArtCoverage([])
    expect(items.missing).toHaveLength(100)
    expect(cast.missing).toHaveLength(5)
    expect(coverageFailure('items', items)[0]).toMatch(/100 kinds the world asks for/)
    expect(coverageFailure('cast', cast)[0]).toMatch(/5 kinds the world asks for/)
  })

  it('half a library is still a failure, and names only the half that is absent', () => {
    // The sprite half shipped and the icon half did not — the world would look finished and
    // every inventory row would be a checkerboard.
    const spritesOnly = LIBRARY.map((e) => e.kind)
    const c = itemArtCoverage(spritesOnly)
    expect(c.covered).toEqual(spritesOnly.slice().sort())
    expect(c.missing).toEqual(LIBRARY.map((e) => `${e.kind}${ICON_SUFFIX}`).sort())
    expect(c.orphans).toEqual([])
  })

  it('and an unreferenced record is a defect in the other direction', () => {
    const c = itemArtCoverage([...requiredItemKinds(), 'lantern_OLD'])
    expect(c.missing).toEqual([])
    expect(c.orphans).toEqual(['lantern_OLD'])
    expect(castArtCoverage([...requiredCastKinds(), 'character:ghost']).orphans).toEqual([
      'character:ghost',
    ])
  })
})

describe('nothing an art pipeline depends on is missing from the tree as shipped', () => {
  it('the reference every generation carries resolves, and is not a picture of an object', async () => {
    const refs = await loadReferenceSheet()
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0]!.equals(await paletteSwatchPng())).toBe(true)
  })

  it('the committed content roots the boot reads are all present', () => {
    for (const [name, dir] of [
      ['buildings', BUILDINGS_CONTENT_DIR],
      ['items', ITEMS_CONTENT_DIR],
      ['cast', CAST_CONTENT_DIR],
    ] as const)
      expect(existsSync(dir), `content/${name} is not in the tree`).toBe(true)
  })
})

// ── ★ THE COMMITTED BUILDINGS, WHICH NOTHING WAS ASKING ABOUT ─────────────────────────────
describe('★ the committed buildings', () => {
  const buildings = listCommittedBuildings()

  it('ships the kinds the world can place, in the facings it can place them in', () => {
    expect(buildings.length).toBeGreaterThan(0)
    for (const b of buildings) expect(STRUCTURE_FACINGS).toContain(b.facing)
  })

  it.each(buildings.map((b) => [b.dir, b] as const))('%s clears the pixel bar', async (_dir, b) => {
    const img = await pngOf(b.dir, b.png)
    expect(alphaBinaryGate(img).failures).toEqual([])
    expect(paletteDistance(img)).toBeLessThan(PALETTE_DISTANCE_MAX)
    expect(img.width, 'a building cell is square').toBe(img.height)
  })

  // A turned building is not a flipped one: flipping moves the door to the other wall and gets
  // the light wrong, because the sun does not flip with the building.
  it('★ no SE cell is its SW cell mirrored — the gate that had no caller', async () => {
    const img = new Map<string, RawImage>()
    for (const b of buildings) img.set(b.dir, await pngOf(b.dir, b.png))
    const pairs = buildings
      .filter((b) => b.facing === 'se')
      .map((b) => {
        const sw = buildings.find((o) => o.kind === b.kind && o.facing !== b.facing)
        expect(sw, `${b.kind}: an SE cell with no SW cell to turn from`).toBeDefined()
        return { kind: b.kind, sw: img.get(sw!.dir)!, se: img.get(b.dir)! }
      })
    expect(
      pairs.length,
      'no two-facing building to judge — the gate would be vacuous',
    ).toBeGreaterThanOrEqual(7)
    const r = mirrorFacingGate(pairs)
    expect(r.failures.join('\n')).toBe('')
    // anti-vacuity: the gate must red on a cell that IS a mirror, or the line above proves
    // nothing about the gate
    const one = pairs[0]!
    expect(
      mirrorFacingGate([{ kind: one.kind, sw: one.sw, se: mirrorX(one.sw) }]).failures,
    ).toHaveLength(1)
  })

  it('★ one density across the whole class — computed by three generators, read by none', async () => {
    const members = await Promise.all(
      buildings.map(async (b) => {
        const img = await pngOf(b.dir, b.png)
        return {
          name: b.dir,
          density: spriteDensity({
            canvas: { w: img.width, h: img.height },
            footprint: b.manifest.footprint,
            tile: TOWN_TILE,
          }),
        }
      }),
    )
    const cls = classDensityGate(members)
    expect(cls.failures.join('; ')).toBe('')
    expect(cls.densities, 'the class drifted onto two densities').toHaveLength(1)
  })

  it('and every cell carries the native density its footprint asks for', async () => {
    const bad: string[] = []
    for (const b of buildings) {
      const img = await pngOf(b.dir, b.png)
      bad.push(
        ...nativeDensityGate({
          name: b.dir,
          canvas: { w: img.width, h: img.height },
          footprint: b.manifest.footprint,
          tile: TOWN_TILE,
        }).failures,
      )
    }
    expect(bad).toEqual([])
  })
})

describe('the committed items', () => {
  const items = listCommittedItems()

  it('ship one directory per catalog kind', () => {
    expect(items.map((i) => i.kind).sort()).toEqual(LIBRARY.map((e) => e.kind).sort())
  })

  it.each(items.map((i) => [i.kind, i] as const))(
    '%s clears the pixel bar',
    async (_kind, item) => {
      const sprite = await decodePng(item.sprite)
      const icon = await decodePng(item.icon)
      // the entry's OWN size: a 1x2 bed covers 192 px of the interior tile, a 1x1 chair 128
      expect(
        [sprite.width, sprite.height],
        'the world sprite is the size its footprint covers',
      ).toEqual([item.entry.spritePx, item.entry.spritePx])
      expect([icon.width, icon.height], 'the icon is the C-level icon').toEqual([ICON_PX, ICON_PX])
      // INTEGER DOWNSCALE ONLY: the icon must be a whole divide of the sprite, never a resample.
      expect(item.entry.spritePx % ICON_PX, 'the icon is a whole divide of the sprite').toBe(0)
      for (const img of [sprite, icon]) {
        expect(alphaBinaryGate(img).failures).toEqual([])
        expect(paletteDistance(img)).toBeLessThan(PALETTE_DISTANCE_MAX)
      }
      // the renderer needs the manifest to parse, or the room draws the placeholder anyway
      expect(parseLibraryItemManifest(JSON.stringify(item.manifest))).not.toBeNull()
      expect(item.manifest.spritePx).toBe(item.entry.spritePx)
      expect(item.manifest.iconPx).toBe(ICON_PX)
      expect(item.manifest.interior !== undefined).toBe(item.entry.category === 'furniture')
    },
  )
})

describe('the committed cast', () => {
  const cast = listCommittedCast()

  it('ships one directory per founder', () => {
    expect(cast.map((c) => c.id).sort()).toEqual([...FOUNDER_IDS].sort())
  })

  it.each(cast.map((c) => [c.id, c] as const))('%s addresses all 24 cells', async (_id, c) => {
    expect(Object.keys(c.manifest.cells).sort()).toEqual([...CELL_NAMES_V4].sort())
    expect(parseCharacterAtlasManifest(JSON.stringify(c.manifest))).not.toBeNull()
    const atlas = await pngOf(`cast:${c.id}`, c.atlas)
    // Every rect the manifest promises must be inside the atlas it promises it in: a rect
    // that overhangs draws garbage or nothing, and neither fails any other test.
    for (const [name, r] of Object.entries(c.manifest.cells)) {
      expect(r.x + r.w, `${name} overhangs the atlas width`).toBeLessThanOrEqual(atlas.width)
      expect(r.y + r.h, `${name} overhangs the atlas height`).toBeLessThanOrEqual(atlas.height)
      expect(r.feetY, `${name} feet anchor is outside the cell`).toBeLessThan(r.h)
      expect(r.feetX, `${name} feet anchor is outside the cell`).toBeLessThan(r.w)
    }
    expect(alphaBinaryGate(atlas).failures).toEqual([])
    expect(paletteDistance(atlas)).toBeLessThan(PALETTE_DISTANCE_MAX)
  })

  it.each(cast.map((c) => [c.id, c] as const))(
    '%s draws one body per cell and nothing else',
    async (id, c) => {
      const atlas = await pngOf(`cast:${c.id}`, c.atlas)
      const bad: string[] = []
      for (const [name, r] of Object.entries(c.manifest.cells)) {
        const cell = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) }
        for (let y = 0; y < r.h; y++) {
          const src = ((r.y + y) * atlas.width + r.x) * 4
          cell.data.set(atlas.data.subarray(src, src + r.w * 4), y * r.w * 4)
        }
        for (const f of soleSilhouetteGate(cell).failures) bad.push(`${id}/${name}: ${f}`)
      }
      expect(bad).toEqual([])
    },
  )
})

describe('★ every hearth kind names where its chimney and its flame are painted', () => {
  const buildings = listCommittedBuildings()
  const hearthKinds = new Set([
    ...cityStructures()
      .filter((c) => c.furnishings.some((f) => f.kind === CITY_HEARTH_KIND))
      .map((c) => c.kind),
    'fire_pit',
  ])

  it('a house with a hearth has a chimney cell point, in both facings', () => {
    const roofed = buildings.filter((b) => hearthKinds.has(b.kind) && b.kind !== 'fire_pit')
    expect(roofed.length).toBeGreaterThanOrEqual(8)
    for (const b of roofed) {
      const c = b.manifest.points?.chimney
      expect(c, `${b.dir} has no points.chimney`).toBeDefined()
      expect(c!.x).toBeLessThan(b.manifest.cell.w)
      expect(c!.y).toBeLessThan(b.manifest.cell.feetY / 2) // a chimney is on the roof, not the floor
    }
  })

  it('the open fire and the lamp post point at their painted flame', () => {
    for (const dir of ['fire_pit', 'lamp_post']) {
      const b = buildings.find((x) => x.dir === dir)!
      const f = b.manifest.points?.flame
      expect(f, `${dir} has no points.flame`).toBeDefined()
      expect(f!.y).toBeLessThan(b.manifest.cell.feetY)
    }
  })

  it('a window glow is only ever on a cell painted lit — one kind today', () => {
    const lit = buildings.filter((b) => b.manifest.points?.window !== undefined).map((b) => b.dir)
    expect(lit).toEqual(['cabin'])
  })
})
