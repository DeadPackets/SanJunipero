import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FOUNDER_IDS, parseCharacterAtlasManifest, parseLibraryItemManifest } from '@sj/shared'
import { BUILDINGS_CONTENT_DIR } from './buildingArt.js'
import { loadReferenceSheet, paletteSwatchPng } from './referenceSheet.js'
import { openForgeDb } from './db.js'
import { AssetCodex } from './codex.js'
import { decodePng } from './post/raw.js'
import { alphaBinaryGate, paletteGate } from './pixelGates.js'
import { ICON_PX, WORLD_SPRITE_PX } from './assetResolution.js'
import { LIBRARY, LIBRARY_COUNTS } from './library/catalog.js'
import { ICON_SUFFIX } from './library/register.js'
import { ITEMS_CONTENT_DIR, listCommittedItems, registerCommittedItems } from './library/committed.js'
import { CELL_NAMES_V4 } from './mirror.js'
import { CAST_CONTENT_DIR, characterKind, listCommittedCast, registerCommittedCast } from './castArt.js'
import {
  castArtCoverage, coverageFailure, itemArtCoverage, requiredCastKinds, requiredItemKinds,
} from './artCoverage.js'

// ★ THE GATE THAT WOULD HAVE CAUGHT THE OTHER TWO.
//
// Round 4 wrote the same gate for structures after a farmhouse stood with no art for a merge
// train. It only ever asked about buildings. Measured on that same tip:
//
//   class building:  10 records
//   class item:       0 records    <- fifty items, all of them paid for, none of them on disk
//   class rig-part:   0 records    <- five founders, all of them paid for, none of them on disk
//
// IT MUST NOT BE SATISFIABLE BY THE FALLBACK. `makePlaceholder` answers EVERY class, so a gate
// that asks "did something draw?" passes forever. Everything below reads the CODEX — the same
// class/kind columns `textures.ts` and `roomPlan` resolve on — and the placeholder writes no
// codex row. `the fallback cannot satisfy this gate` states that in a test.

/** The registration the dev world does at boot, against a real codex. */
function registeredKinds(klass: 'item' | 'rig-part'): string[] {
  const db = openForgeDb(':memory:')
  try {
    const codex = new AssetCodex(db)
    registerCommittedItems(codex)
    registerCommittedCast(codex)
    return codex.listSince(0)
      .filter((r) => r.status === 'ready' && r.class === klass && r.kind !== null)
      .map((r) => r.kind!)
  } finally {
    db.close()
  }
}

describe('every item the catalog specifies has committed art, sprite and icon', () => {
  it('is measuring the library it thinks it is', () => {
    expect(LIBRARY).toHaveLength(
      Object.values(LIBRARY_COUNTS).reduce((s, n) => s + n, 0))
    for (const [category, n] of Object.entries(LIBRARY_COUNTS))
      expect(LIBRARY.filter((e) => e.category === category), category).toHaveLength(n)
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

// ★ THE RED PROOF, FROZEN. Shipping the content ends the live failure, so the exact shape of
// the defect this lane found is kept as data. Same technique round 4 used for `hut`.
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
    expect(castArtCoverage([...requiredCastKinds(), 'character:ghost']).orphans)
      .toEqual(['character:ghost'])
  })
})

// ★ THE SAME DEFECT SHAPE, FOUND IN A THIRD PLACE. `loadReferenceSheet()` demanded three
// files that have never existed in this repository, so `gen-rigs.ts` and `gen-terrain.ts`
// threw on their first line and the discovery lane's `discoveryArt` shipped as a tested
// no-op. Nothing asserted the dependency was there. This is that assertion: every entry
// point that needs a reference must get one, from the repo as shipped, with no curation step.
describe('nothing an art pipeline depends on is missing from the tree as shipped', () => {
  it('the reference every generation carries resolves, and is not a picture of an object', async () => {
    const refs = await loadReferenceSheet()
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0]!.equals(await paletteSwatchPng())).toBe(true)
  })

  it('the committed content roots the boot reads are all present', () => {
    for (const [name, dir] of [
      ['buildings', BUILDINGS_CONTENT_DIR], ['items', ITEMS_CONTENT_DIR], ['cast', CAST_CONTENT_DIR],
    ] as const) expect(existsSync(dir), `content/${name} is not in the tree`).toBe(true)
  })
})

describe('the committed items', () => {
  const items = listCommittedItems()

  it('ship one directory per catalog kind', () => {
    expect(items.map((i) => i.kind).sort()).toEqual(LIBRARY.map((e) => e.kind).sort())
  })

  it.each(items.map((i) => [i.kind, i] as const))('%s clears the pixel bar', async (_kind, item) => {
    const sprite = await decodePng(item.sprite)
    const icon = await decodePng(item.icon)
    // the entry's OWN size: a 1x2 bed covers 192 px of the interior tile, a 1x1 chair 128
    expect([sprite.width, sprite.height], 'the world sprite is the size its footprint covers')
      .toEqual([item.entry.spritePx, item.entry.spritePx])
    expect([icon.width, icon.height], 'the icon is the C-level icon').toEqual([ICON_PX, ICON_PX])
    // INTEGER DOWNSCALE ONLY: the icon must be a whole divide of the sprite, or it came off
    // a fractional resample and ships the mush this bar exists to keep out.
    expect(item.entry.spritePx % ICON_PX, 'the icon is a whole divide of the sprite').toBe(0)
    for (const img of [sprite, icon]) {
      expect(alphaBinaryGate(img).failures).toEqual([])
      expect(paletteGate(img).failures).toEqual([])
    }
    // the renderer needs the manifest to parse, or the room draws the placeholder anyway
    expect(parseLibraryItemManifest(JSON.stringify(item.manifest))).not.toBeNull()
    expect(item.manifest.spritePx).toBe(item.entry.spritePx)
    expect(item.manifest.iconPx).toBe(ICON_PX)
    expect((item.manifest.interior !== undefined))
      .toBe(item.entry.category === 'furniture')
  })
})

describe('the committed cast', () => {
  const cast = listCommittedCast()

  it('ships one directory per founder', () => {
    expect(cast.map((c) => c.id).sort()).toEqual([...FOUNDER_IDS].sort())
  })

  it.each(cast.map((c) => [c.id, c] as const))('%s addresses all 24 cells', async (_id, c) => {
    expect(Object.keys(c.manifest.cells).sort()).toEqual([...CELL_NAMES_V4].sort())
    expect(parseCharacterAtlasManifest(JSON.stringify(c.manifest))).not.toBeNull()
    const atlas = await decodePng(c.atlas)
    // Every rect the manifest promises must be inside the atlas it promises it in: a rect
    // that overhangs draws garbage or nothing, and neither fails any other test.
    for (const [name, r] of Object.entries(c.manifest.cells)) {
      expect(r.x + r.w, `${name} overhangs the atlas width`).toBeLessThanOrEqual(atlas.width)
      expect(r.y + r.h, `${name} overhangs the atlas height`).toBeLessThanOrEqual(atlas.height)
      expect(r.feetY, `${name} feet anchor is outside the cell`).toBeLessThan(r.h)
      expect(r.feetX, `${name} feet anchor is outside the cell`).toBeLessThan(r.w)
    }
    expect(alphaBinaryGate(atlas).failures).toEqual([])
    expect(paletteGate(atlas).failures).toEqual([])
  })
})
