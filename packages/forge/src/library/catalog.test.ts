import { describe, it, expect } from 'vitest'
import { INTERIOR_KINDS, resolveFurnishingKind, type LibraryCategory } from '@sj/shared'
import { LIBRARY, LibraryEntrySchema, libraryEntry, LIBRARY_COUNTS, SHORT_OF_FOOTPRINT } from './catalog.js'
import { ICON_PX, WORLD_SPRITE_PX, nativeSizeFor, resolveScale } from '../assetResolution.js'
import { GEN_SIZE } from '../imageClient.js'

const byCategory = (c: LibraryCategory) => LIBRARY.filter(e => e.category === c)

describe('the library catalog', () => {
  it('is exactly 50 entries with unique kinds', () => {
    expect(LIBRARY).toHaveLength(50)
    expect(new Set(LIBRARY.map(e => e.kind)).size).toBe(50)
  })

  it('splits 10 / 10 / 9 / 6 / 15 across the five categories', () => {
    expect(LIBRARY_COUNTS).toEqual({ tool: 10, food: 10, material: 9, ritual: 6, furniture: 15 })
    for (const [c, n] of Object.entries(LIBRARY_COUNTS))
      expect(byCategory(c as LibraryCategory), c).toHaveLength(n)
  })

  it('every entry parses the schema', () => {
    for (const e of LIBRARY) expect(() => LibraryEntrySchema.parse(e), e.kind).not.toThrow()
  })

  it('interior is present on furniture and absent everywhere else — both directions', () => {
    for (const e of LIBRARY)
      expect(e.interior !== undefined, e.kind).toBe(e.category === 'furniture')
    const chair = libraryEntry('chair')!
    expect(() => LibraryEntrySchema.parse({ ...chair, interior: undefined })).toThrow()
    const axe = libraryEntry('axe')!
    expect(() => LibraryEntrySchema.parse({ ...axe, interior: chair.interior })).toThrow()
  })

  // The published rule is INTEGER DOWNSCALE OF A CROP, not `512 % spritePx === 0`: 192 x 2 = 384
  // px taken out of a 512 generation and halved. `resolveScale` throws on a fractional factor.
  it('every entry is authored at the size its own footprint covers', () => {
    for (const e of LIBRARY) {
      expect(e.iconPx, e.kind).toBe(ICON_PX)
      expect(resolveScale({ w: e.iconPx, h: e.iconPx }).factor, e.kind).toBeGreaterThanOrEqual(2)
      // integer downscale of a crop, at whatever size this entry is authored
      const r = resolveScale({ w: e.spritePx, h: e.spritePx })
      expect(Number.isInteger(r.factor), e.kind).toBe(true)
      expect(r.rawCrop.w, e.kind).toBeLessThanOrEqual(GEN_SIZE)
      if (e.interior === undefined) {
        expect(e.spritePx, e.kind).toBe(WORLD_SPRITE_PX)
        continue
      }
      const want = nativeSizeFor('item', e.interior.slots).w
      expect(e.spritePx, `${e.kind} — declared bigger than its art`)
        .toBe(SHORT_OF_FOOTPRINT.has(e.kind) ? WORLD_SPRITE_PX : want)
    }
  })

  // ★ THE GAP, NAMED. Two 1x2 kinds have no 192 px art, so they keep the size their pixels
  // actually are. This test exists so the list can only ever shrink on purpose.
  it('names every furnishing still short of the ground it covers', () => {
    expect([...SHORT_OF_FOOTPRINT].sort()).toEqual(['bench', 'loom'])
    for (const kind of SHORT_OF_FOOTPRINT) {
      const e = LIBRARY.find((x) => x.kind === kind)!
      expect(e.interior, kind).toBeDefined()
      expect(nativeSizeFor('item', e.interior!.slots).w, kind).toBeGreaterThan(e.spritePx)
    }
  })

  it('resolves all six C10 T10 furnishing originals', () => {
    for (const k of ['bed', 'hearth', 'table', 'shelf', 'crate', 'tools'])
      expect(libraryEntry(resolveFurnishingKind(k)), k).not.toBeNull()
    expect(libraryEntry('nonesuch')).toBeNull()
  })

  it('every interiorKind named is a real interior kind', () => {
    for (const e of byCategory('furniture'))
      for (const k of e.interior!.interiorKinds)
        expect(INTERIOR_KINDS, e.kind).toContain(k)
  })

  // Only a house can hold a bed.
  it('a house has at least one bed available; a shed and a storehouse have none', () => {
    const beds = byCategory('furniture').filter(e => e.interior!.isBed === true)
    expect(beds.length).toBeGreaterThan(0)
    for (const b of beds) expect(b.interior!.interiorKinds).toEqual(['house'])
  })

  // The art never labels the danger. Knowledge is the town's, not the picture's.
  it('the two mushrooms differ by exactly one word', () => {
    const a = libraryEntry('field_mushroom')!.desc.split(/\s+/)
    const b = libraryEntry('pale_mushroom')!.desc.split(/\s+/)
    expect(a).toHaveLength(b.length)
    const sa = new Set(a), sb = new Set(b)
    expect([...sa].filter(w => !sb.has(w))).toHaveLength(1)
    expect([...sb].filter(w => !sa.has(w))).toHaveLength(1)
  })

  // Naming law: every desc is viewer-reachable prose, so no warnings and no registry vocabulary.
  it('no desc leaks a warning word or any pipeline vocabulary', () => {
    const BANNED = ['poison', 'poisonous', 'toxic', 'deadly', 'danger', 'dangerous',
      'safe', 'edible', 'model', 'prompt', 'generated', 'sprite', 'pixel']
    for (const e of LIBRARY) {
      const low = e.desc.toLowerCase()
      for (const w of BANNED) expect(low, `${e.kind} leaks "${w}"`).not.toContain(w)
      expect(e.desc, e.kind).not.toContain('AI')
    }
  })

  it('kinds are snake_case registry vocabulary that never leaks into the prose', () => {
    for (const e of LIBRARY) {
      expect(e.kind, e.kind).toMatch(/^[a-z][a-z_]*[a-z]$/)
      expect(e.desc.length, e.kind).toBeGreaterThan(20)
      if (e.kind.includes('_')) expect(e.desc, e.kind).not.toContain(e.kind)
    }
  })
})
