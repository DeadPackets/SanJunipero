import { describe, it, expect } from 'vitest'
import { INTERIOR_KINDS, resolveFurnishingKind, type LibraryCategory } from '@sj/shared'
import { LIBRARY, LibraryEntrySchema, libraryEntry, LIBRARY_COUNTS } from './catalog.js'

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

  // Controller icon ruling: 24 px for every class, not just furniture. At the same size as
  // the sprite the icon is the same art, which is exactly the point — the 16 px cell was the
  // weakest surface in the library and the only thing failing on seven otherwise clean items.
  it('every icon is 24 px, sprite and icon alike', () => {
    for (const e of LIBRARY) {
      expect(e.iconPx, e.kind).toBe(24)
      expect(e.spritePx, e.kind).toBe(24)
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

  // The C10 bedSlots law: only a hut can hold a bed.
  it('a hut has at least one bed available; a shed and a storehouse have none', () => {
    const beds = byCategory('furniture').filter(e => e.interior!.isBed === true)
    expect(beds.length).toBeGreaterThan(0)
    for (const b of beds) expect(b.interior!.interiorKinds).toEqual(['hut'])
  })

  // C12 §10: the art never labels the danger. Knowledge is the town's, not the picture's.
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
