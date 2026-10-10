import { z } from 'zod'
import { parseMeta } from './assetManifest.js'

// The renderer's room vocabulary, not enterability — that is roofed. Every enterable kind must
// have a room here (interiors.test.ts); shed is the one unenterable exception, pinned by name.
export const INTERIOR_KINDS = [
  'house',
  'storehouse',
  'shed',
  'cabin',
  'cottage',
  'farmhouse',
] as const
export type InteriorKind = (typeof INTERIOR_KINDS)[number]
export const InteriorKindSchema = z.enum(INTERIOR_KINDS)

export const LIBRARY_CATEGORIES = ['tool', 'food', 'material', 'ritual', 'furniture'] as const
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]

export const InteriorMetaSchema = z
  .object({
    slots: z
      .object({
        w: z.number().int().min(1).max(2),
        h: z.number().int().min(1).max(2),
      })
      .strict(),
    placement: z.enum(['floor', 'wall']),
    interiorKinds: z.array(InteriorKindSchema).min(1),
    // Literal true: absence is the only way to say "no", so a flag can never be half-set.
    isBed: z.literal(true).optional(),
    isHearth: z.literal(true).optional(),
    providesLight: z.literal(true).optional(),
  })
  .strict()
export type InteriorMeta = z.infer<typeof InteriorMetaSchema>

export const LibraryItemManifestSchema = z
  .object({
    version: z.literal('v1-library-item'),
    kind: z.string().min(1),
    category: z.enum(LIBRARY_CATEGORIES),
    // The 24 px ceiling moved to the C-level bar (forge assetResolution.ts). The bound only
    // widens, so the 24 px manifests already in the codex keep parsing beside 128 px art.
    spritePx: z.number().int().min(16).max(256),
    iconPx: z.number().int().min(16).max(128),
    interior: InteriorMetaSchema.optional(),
  })
  .strict()
export type LibraryItemManifest = z.infer<typeof LibraryItemManifestSchema>

export const parseLibraryItemManifest = (meta: string | null): LibraryItemManifest | null =>
  parseMeta(LibraryItemManifestSchema, meta)

// The six original furnishings include `tools`, which the addendum resolves as "anvil + saw wall rack".
export const FURNISHING_KIND_ALIASES: Record<string, string> = { tools: 'anvil' }

export function resolveFurnishingKind(kind: string): string {
  return FURNISHING_KIND_ALIASES[kind] ?? kind
}

export const BuildingAppearanceRecipeSchema = z
  .object({
    version: z.literal('v1-building-appearance'),
    use: z.enum(['personal-home', 'public-shop', 'public-meeting', 'generic']),
    facade: z.enum(['plaster', 'timber', 'stone']),
    roof: z.enum(['gable', 'hip']),
    door: z.literal('front-entry'),
    windows: z.enum(['domestic', 'shopfront', 'assembly', 'paired']),
  })
  .strict()
export type BuildingAppearanceRecipe = z.infer<typeof BuildingAppearanceRecipeSchema>

const appearance = (recipe: BuildingAppearanceRecipe): BuildingAppearanceRecipe =>
  BuildingAppearanceRecipeSchema.parse(recipe)

export const BUILDING_APPEARANCE_PROTOTYPES = {
  home: appearance({
    version: 'v1-building-appearance',
    use: 'personal-home',
    facade: 'plaster',
    roof: 'gable',
    door: 'front-entry',
    windows: 'domestic',
  }),
  shop: appearance({
    version: 'v1-building-appearance',
    use: 'public-shop',
    facade: 'timber',
    roof: 'gable',
    door: 'front-entry',
    windows: 'shopfront',
  }),
  meeting: appearance({
    version: 'v1-building-appearance',
    use: 'public-meeting',
    facade: 'stone',
    roof: 'hip',
    door: 'front-entry',
    windows: 'assembly',
  }),
} as const

export const FALLBACK_BUILDING_APPEARANCE = appearance({
  version: 'v1-building-appearance',
  use: 'generic',
  facade: 'plaster',
  roof: 'gable',
  door: 'front-entry',
  windows: 'paired',
})

const HOME_KINDS = new Set(['house', 'cottage', 'cabin', 'farmhouse'])
const SHOP_KINDS = new Set(['bakery', 'smithy', 'storehouse', 'tavern', 'shop'])
const MEETING_KINDS = new Set(['civic_hall', 'town_hall', 'church', 'school', 'meeting_hall'])

export function buildingAppearanceFor(kind: string): BuildingAppearanceRecipe {
  if (HOME_KINDS.has(kind)) return BUILDING_APPEARANCE_PROTOTYPES.home
  if (SHOP_KINDS.has(kind)) return BUILDING_APPEARANCE_PROTOTYPES.shop
  if (MEETING_KINDS.has(kind)) return BUILDING_APPEARANCE_PROTOTYPES.meeting
  return FALLBACK_BUILDING_APPEARANCE
}

export const BUILDING_WINDOW_FRACTIONS = {
  domestic: { front: [0.22, 0.76], side: [0.5] },
  shopfront: { front: [0.16, 0.84], side: [0.5] },
  assembly: { front: [0.13, 0.38, 0.62, 0.87], side: [0.28, 0.72] },
  paired: { front: [0.24, 0.76], side: [0.5] },
} as const

export function frontDoorFraction(faceSpan: number): number {
  if (!Number.isFinite(faceSpan) || faceSpan <= 0) return 0.5
  return (Math.floor((faceSpan - 1) / 2) + 0.5) / faceSpan
}

export function buildingWindowMask(
  recipe: BuildingAppearanceRecipe,
  faceSpan: number,
  mirroredDoor: boolean,
) {
  const pattern = BUILDING_WINDOW_FRACTIONS[recipe.windows]
  const lane = frontDoorFraction(faceSpan)
  const door = mirroredDoor ? 1 - lane : lane
  const clearance = 0.45 / Math.max(1, faceSpan)
  return {
    front: pattern.front.filter((fraction) => Math.abs(fraction - door) > clearance),
    side: [...pattern.side],
  }
}
