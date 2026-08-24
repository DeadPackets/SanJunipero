import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@sj/shared'

// The book calls into Pixi's loader; nothing else in this file does. A tiny stand-in keeps the
// pure resolvers under test exactly as they were and lets `peek` be asserted at all.
const loads = new Map<string, { resolve: (t: unknown) => void; texture: unknown }>()
vi.mock('pixi.js', () => ({
  Assets: {
    add: vi.fn(),
    load: vi.fn((url: string) => new Promise((resolve) => {
      loads.set(url, { resolve, texture: { url, source: { unload: vi.fn() } } })
    })),
    unload: vi.fn(async () => {}),
  },
}))

const land = async (url: string): Promise<void> => {
  const l = loads.get(url)!
  l.resolve(l.texture)
  await Promise.resolve()
  await Promise.resolve()
}

import {
  TextureBook, buildingArt, characterArt, facingCellKind, resolveAssetId, textureUrlFor,
} from './textures.js'

const rec = (over: Partial<AssetRecord>): AssetRecord => ({
  id: 'asset_x', seq: 1, class: 'building', desc: 'house: timber dwelling', kind: 'house',
  footprint: { w: 2, h: 2 }, widthPx: 64, heightPx: 64, status: 'ready',
  score: 9, attempts: 1, costUsd: 0, createdAt: '2026-08-16 00:00:00', meta: null,
  ...over,
})

describe('resolveAssetId', () => {
  it('picks the newest ready record for the kind over an older one', () => {
    const records = [rec({ id: 'old', seq: 1 }), rec({ id: 'new', seq: 7 }), rec({ id: 'other', seq: 9, kind: 'barn' })]
    expect(resolveAssetId(records, 'building', 'house')).toBe('new')
  })

  it('ignores placeholder-status records', () => {
    const records = [rec({ id: 'ready1', seq: 1 }), rec({ id: 'ph', seq: 5, status: 'placeholder', score: null })]
    expect(resolveAssetId(records, 'building', 'house')).toBe('ready1')
  })

  it('resolves by the kind column, never by desc parsing', () => {
    // desc mentions house, kind says otherwise: no match; null kind never matches either
    const records = [rec({ id: 'a', kind: 'shed', desc: 'house lookalike' }), rec({ id: 'b', kind: null, desc: 'house: timber' })]
    expect(resolveAssetId(records, 'building', 'house')).toBeNull()
  })

  it('requires the class to match', () => {
    expect(resolveAssetId([rec({ class: 'item', footprint: { w: 1, h: 1 } })], 'building', 'house')).toBeNull()
  })
})

describe('textureUrlFor', () => {
  it('serves the resolved asset png', () => {
    expect(textureUrlFor([rec({ id: 'asset_9' })], 'building', 'house')).toBe('/assets/asset_9.png')
  })
  it('falls back to the class placeholder', () => {
    expect(textureUrlFor([], 'building', 'house')).toBe('/assets/placeholder/building.png')
  })
})

describe('characterArt (v4 manifest contract)', () => {
  const atlasMeta = JSON.stringify({
    version: 'v4-hires-atlas', figureH: 840,
    cells: { 'idle-sw': { x: 0, y: 0, w: 347, h: 848, feetX: 173, feetY: 843 } },
  })
  const charRec = (over: Partial<AssetRecord>): AssetRecord => rec({
    class: 'rig-part', kind: 'character:omar', desc: 'character sheet: omar', meta: atlasMeta,
    footprint: { w: 1, h: 1 }, ...over,
  })

  it('resolves a v4 atlas record to its immutable png + parsed manifest', () => {
    const art = characterArt([charRec({ id: 'asset_omar' })], 'omar')
    expect(art.url).toBe('/assets/asset_omar.png')
    expect(art.manifest?.figureH).toBe(840)
    expect(art.manifest?.cells['idle-sw']?.feetY).toBe(843)
  })

  it('falls back to the gateway character route with no manifest when meta is absent or not v4', () => {
    expect(characterArt([charRec({ meta: null })], 'omar')).toEqual({ url: '/assets/character/omar.png', manifest: null, size: null })
    expect(characterArt([], 'omar')).toEqual({ url: '/assets/character/omar.png', manifest: null, size: null })
  })

  it('newest ready atlas wins on regen', () => {
    const art = characterArt([charRec({ id: 'old', seq: 3 }), charRec({ id: 'new', seq: 8 })], 'omar')
    expect(art.url).toBe('/assets/new.png')
  })
})

describe('buildingArt (v4-hires-building manifest)', () => {
  const meta = JSON.stringify({
    version: 'v4-hires-building', kind: 'storehouse', footprint: { w: 2, h: 2 },
    cell: { w: 810, h: 866, feetX: 405, feetY: 861 },
  })

  it('feet-anchors and fits the art into the Style Bible 32·(w+h) square', () => {
    const art = buildingArt([rec({ id: 'asset_sh', kind: 'storehouse', meta })], 'storehouse', 2, 2)
    expect(art.url).toBe('/assets/asset_sh.png')
    expect(art.anchor).toEqual({ x: 405 / 810, y: 861 / 866 })
    expect(art.scale).toBeCloseTo(Math.min(128 / 810, 128 / 866), 10)
  })

  it('v2/no-meta records draw at natural size with the bottom-center law', () => {
    expect(buildingArt([rec({ id: 'housev2', kind: 'house' })], 'house', 2, 2)).toEqual({ url: '/assets/housev2.png', anchor: null, scale: null })
  })

  it('reports NO ART rather than a checkerboard, so the renderer can draw a built form', () => {
    expect(buildingArt([], 'house', 2, 2)).toEqual({ url: null, anchor: null, scale: null })
    expect(buildingArt([], 'well', 1, 1).url).toBeNull()
  })

  // ★ A TURNED BUILDING DRAWS ITS TURNED FACE. The claim seam seats a house sw or se and the
  // world now carries which; a turned 2x2 is byte-identical to an unturned one, so `w`/`h`
  // could never have answered. Seven kinds have a committed `-se` cell.
  describe('★ the face the building presents', () => {
    const sw = rec({ id: 'asset_house_sw', kind: 'house' })
    const se = rec({ id: 'asset_house_se', kind: 'house:se' })

    it('resolves the bare kind for sw and for a building with no facing at all', () => {
      expect(facingCellKind('house')).toBe('house')
      expect(facingCellKind('house', 'sw')).toBe('house')
      expect(buildingArt([sw, se], 'house', 2, 2).url).toBe('/assets/asset_house_sw.png')
      expect(buildingArt([sw, se], 'house', 2, 2, 'sw').url).toBe('/assets/asset_house_sw.png')
    })

    it('★ and the TURNED cell for se — the whole point of carrying the field', () => {
      expect(facingCellKind('house', 'se')).toBe('house:se')
      expect(buildingArt([sw, se], 'house', 2, 2, 'se').url).toBe('/assets/asset_house_se.png')
    })

    it('falls back to the bare cell when no turned one is committed — an art gap, not a hole', () => {
      expect(buildingArt([sw], 'house', 2, 2, 'se').url).toBe('/assets/asset_house_sw.png')
    })
  })
})

describe('★ TextureBook.peek — the room and its furniture arrive in the same frame', () => {
  it('is null before the bytes land and the texture after', async () => {
    const book = new TextureBook()
    expect(book.peek('/assets/a.png')).toBeNull()
    void book.get('/assets/a.png')
    expect(book.peek('/assets/a.png')).toBeNull()   // asked for, not yet in hand
    await land('/assets/a.png')
    expect(book.peek('/assets/a.png')).toEqual(loads.get('/assets/a.png')!.texture)
  })

  it('★ and THAT is the frame `get` alone could never make', async () => {
    // The defect, stated as an experiment. A caller holding only `get` cannot paint in the
    // frame it asks, because a resolved promise still defers to a microtask; `peek` can.
    const book = new TextureBook()
    void book.get('/assets/b.png')
    await land('/assets/b.png')

    let viaThen: unknown = null
    void book.get('/assets/b.png').then((t) => { viaThen = t })
    const viaPeek = book.peek('/assets/b.png')

    expect(viaPeek).not.toBeNull()   // in hand, this turn
    expect(viaThen).toBeNull()       // still a microtask away
    await Promise.resolve()
    expect(viaThen).toBe(viaPeek)
  })

  it('a swapped-out url stops peeking, so nothing hands out an unloaded texture', async () => {
    const book = new TextureBook()
    void book.get('/assets/old.png')
    await land('/assets/old.png')
    expect(book.peek('/assets/old.png')).not.toBeNull()

    const p = book.swap('/assets/old.png', '/assets/new.png')
    await land('/assets/new.png')
    await p
    expect(book.peek('/assets/old.png')).toBeNull()
    expect(book.peek('/assets/new.png')).not.toBeNull()
  })

  it('★ and the room reads it — the furniture path peeks BEFORE it awaits', () => {
    // A behavioural test would need a Pixi stage; this is the composition, and it is the thing
    // that regresses: somebody tidies the branch back into a bare `get(...).then(...)` and the
    // empty first frame is back with nothing to say so.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'interiorScene.ts'), 'utf8')
    const add = src.slice(src.indexOf('function addPiece('), src.indexOf('function bodyFor('))
    expect(add).toMatch(/const inHand = book\.peek\(url\)/)
    expect(add.indexOf('book.peek(url)')).toBeLessThan(add.indexOf('book.get(url)'))
  })
})
