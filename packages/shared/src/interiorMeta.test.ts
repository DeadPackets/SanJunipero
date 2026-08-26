import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, isRoofedKind } from './config.js'
import {
  INTERIOR_KINDS,
  InteriorMetaSchema,
  LibraryItemManifestSchema,
  parseLibraryItemManifest,
  resolveFurnishingKind,
  FURNISHING_KIND_ALIASES,
} from './interiorMeta.js'

const BED = {
  slots: { w: 1, h: 2 },
  placement: 'floor' as const,
  interiorKinds: ['house' as const],
  isBed: true as const,
}
const MANIFEST = {
  version: 'v1-library-item' as const,
  kind: 'bed',
  category: 'furniture' as const,
  spritePx: 24,
  iconPx: 24 as const,
  interior: BED,
}

describe('InteriorMetaSchema', () => {
  it('parses a full furniture meta', () => {
    expect(InteriorMetaSchema.parse(BED)).toEqual(BED)
    expect(
      InteriorMetaSchema.parse({
        slots: { w: 1, h: 1 },
        placement: 'wall',
        interiorKinds: ['house', 'storehouse', 'shed'],
        isHearth: true,
        providesLight: true,
      }).providesLight,
    ).toBe(true)
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

  // An implication, not an equality: everything roofed must have a room here. The converse is
  // allowed and has one member.
  const roofedKinds = Object.keys(DEFAULT_CONFIG.structures.recipes)
    .filter((k) => isRoofedKind(DEFAULT_CONFIG, k))
    .sort()

  // The ledger this lane carried — `['cottage','farmhouse']` while their rooms were being
  // drawn — is EMPTY, so the law stands bare: nothing a body can walk into is missing a room.
  it('★ every kind a body can walk into has a room drawn for it', () => {
    expect(roofedKinds.length).toBeGreaterThan(1)
    const missing = roofedKinds.filter((k) => !(INTERIOR_KINDS as readonly string[]).includes(k))
    expect(missing).toEqual([])
  })

  it('★ and the rooms nobody can enter are exactly the shed, by name', () => {
    const unenterable = [...INTERIOR_KINDS].filter((k) => !isRoofedKind(DEFAULT_CONFIG, k)).sort()
    // shed is not roofed and the engine refuses enter on it by name; it keeps a room because its
    // shipped art and furnishing manifests name it.
    expect(unenterable).toEqual(['shed'])
  })
})

describe('LibraryItemManifestSchema', () => {
  it('parses a furniture manifest and a non-furniture one without interior', () => {
    expect(LibraryItemManifestSchema.parse(MANIFEST)).toEqual(MANIFEST)
    const axe = {
      version: 'v1-library-item' as const,
      kind: 'axe',
      category: 'tool' as const,
      spritePx: 24,
      iconPx: 16 as const,
    }
    expect(LibraryItemManifestSchema.parse(axe).interior).toBeUndefined()
  })

  it('takes C-level sizes beside the 24 px art already in the codex', () => {
    expect(
      LibraryItemManifestSchema.parse({ ...MANIFEST, spritePx: 128, iconPx: 64 }).spritePx,
    ).toBe(128)
    expect(
      LibraryItemManifestSchema.parse({ ...MANIFEST, spritePx: 24, iconPx: 24 }).spritePx,
    ).toBe(24)
  })

  it('rejects sizes off either end of the bound, and an unknown version', () => {
    expect(() => LibraryItemManifestSchema.parse({ ...MANIFEST, iconPx: 8 })).toThrow()
    expect(() => LibraryItemManifestSchema.parse({ ...MANIFEST, spritePx: 512 })).toThrow()
    expect(() => LibraryItemManifestSchema.parse({ ...MANIFEST, spritePx: 24.5 })).toThrow()
    expect(() =>
      LibraryItemManifestSchema.parse({ ...MANIFEST, version: 'v2-library-item' }),
    ).toThrow()
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
