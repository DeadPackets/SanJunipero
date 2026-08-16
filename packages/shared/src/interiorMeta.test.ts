import { describe, it, expect } from 'vitest'
import {
  INTERIOR_KINDS, InteriorMetaSchema, LibraryItemManifestSchema,
  parseLibraryItemManifest, resolveFurnishingKind, FURNISHING_KIND_ALIASES,
} from './interiorMeta.js'

const BED = {
  slots: { w: 1, h: 2 }, placement: 'floor' as const,
  interiorKinds: ['hut' as const], isBed: true as const,
}
const MANIFEST = {
  version: 'v1-library-item' as const, kind: 'bed', category: 'furniture' as const,
  spritePx: 24, iconPx: 24 as const, interior: BED,
}

describe('InteriorMetaSchema', () => {
  it('parses a full furniture meta', () => {
    expect(InteriorMetaSchema.parse(BED)).toEqual(BED)
    expect(InteriorMetaSchema.parse({
      slots: { w: 1, h: 1 }, placement: 'wall', interiorKinds: ['hut', 'storehouse', 'shed'],
      isHearth: true, providesLight: true,
    }).providesLight).toBe(true)
  })

  it('rejects slots wider than 2, an invented placement, and an unknown key', () => {
    expect(() => InteriorMetaSchema.parse({ ...BED, slots: { w: 3, h: 1 } })).toThrow()
    expect(() => InteriorMetaSchema.parse({ ...BED, placement: 'ceiling' })).toThrow()
    expect(() => InteriorMetaSchema.parse({ ...BED, nope: 1 })).toThrow()
  })

  it('flags are literal true — false is not a way to say "no"', () => {
    expect(() => InteriorMetaSchema.parse({ ...BED, isBed: false })).toThrow()
  })

  it('rejects an empty interiorKinds list and a kind outside INTERIOR_KINDS', () => {
    expect(() => InteriorMetaSchema.parse({ ...BED, interiorKinds: [] })).toThrow()
    expect(() => InteriorMetaSchema.parse({ ...BED, interiorKinds: ['barn'] })).toThrow()
  })

  // C10 T10 declares `type InteriorKind = 'hut' | 'storehouse' | 'shed'`; the two must not drift.
  it('INTERIOR_KINDS is exactly C10 T10 s literal list, in order', () => {
    expect([...INTERIOR_KINDS]).toEqual(['hut', 'storehouse', 'shed'])
  })
})

describe('LibraryItemManifestSchema', () => {
  it('parses a furniture manifest and a non-furniture one without interior', () => {
    expect(LibraryItemManifestSchema.parse(MANIFEST)).toEqual(MANIFEST)
    const axe = { version: 'v1-library-item' as const, kind: 'axe', category: 'tool' as const, spritePx: 24, iconPx: 16 as const }
    expect(LibraryItemManifestSchema.parse(axe).interior).toBeUndefined()
  })

  it('rejects an off-grid icon size and an over-large sprite', () => {
    expect(() => LibraryItemManifestSchema.parse({ ...MANIFEST, iconPx: 20 })).toThrow()
    expect(() => LibraryItemManifestSchema.parse({ ...MANIFEST, spritePx: 32 })).toThrow()
    expect(() => LibraryItemManifestSchema.parse({ ...MANIFEST, version: 'v2-library-item' })).toThrow()
  })
})

describe('parseLibraryItemManifest', () => {
  it('round-trips a stringified manifest', () => {
    expect(parseLibraryItemManifest(JSON.stringify(MANIFEST))).toEqual(MANIFEST)
  })

  // The parseBuildingManifest contract: a bad meta column is null, never a throw.
  it('returns null for null, malformed JSON, and a shape that does not fit', () => {
    expect(parseLibraryItemManifest(null)).toBeNull()
    expect(parseLibraryItemManifest('{not json')).toBeNull()
    expect(parseLibraryItemManifest(JSON.stringify({ version: 'v1-library-item' }))).toBeNull()
  })
})

describe('resolveFurnishingKind', () => {
  it('maps C10 s one kind with no library entry and passes everything else through', () => {
    expect(resolveFurnishingKind('tools')).toBe('anvil')
    expect(resolveFurnishingKind('bed')).toBe('bed')
    expect(Object.keys(FURNISHING_KIND_ALIASES)).toEqual(['tools'])
  })
})
