import { z } from 'zod'

// The single source for interior placement vocabulary. C10 T10's FurnishingKind union is
// structurally identical, so that lane compiles untouched and may import this at its leisure.
//
// ★ THIS IS THE RENDERER'S ROOM VOCABULARY — WHAT HAS A ROOM DRAWN FOR IT. Enterability is NOT
// this list; it is `isRoofedKind`, and the viewer asks the config for it. The two are related by
// one law, held by `interiors.test.ts`: **every kind a body can enter must have a room here**,
// or walking through a door is a body vanishing into a shape.
//
// The reverse does not hold, and `shed` is why: it is not roofed, nothing enters it, and it
// keeps a room because its art and eight furnishing manifests are shipped and name it. That
// exception is pinned by name, so a second unenterable room kind cannot arrive quietly.
export const INTERIOR_KINDS =
  ['house', 'storehouse', 'shed', 'cabin', 'cottage', 'farmhouse'] as const
export type InteriorKind = (typeof INTERIOR_KINDS)[number]
export const InteriorKindSchema = z.enum(INTERIOR_KINDS)

export const LIBRARY_CATEGORIES = ['tool', 'food', 'material', 'ritual', 'furniture'] as const
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]

export const InteriorMetaSchema = z.object({
  slots: z.object({
    w: z.number().int().min(1).max(2), h: z.number().int().min(1).max(2),
  }).strict(),
  placement: z.enum(['floor', 'wall']),
  interiorKinds: z.array(InteriorKindSchema).min(1),
  // Literal true: absence is the only way to say "no", so a flag can never be half-set.
  isBed: z.literal(true).optional(),
  isHearth: z.literal(true).optional(),
  providesLight: z.literal(true).optional(),
}).strict()
export type InteriorMeta = z.infer<typeof InteriorMetaSchema>

export const LibraryItemManifestSchema = z.object({
  version: z.literal('v1-library-item'),
  kind: z.string().min(1),
  category: z.enum(LIBRARY_CATEGORIES),
  // The 24 px ceiling moved to the C-level bar (forge assetResolution.ts). The bound only
  // widens, so the 24 px manifests already in the codex keep parsing beside 128 px art.
  spritePx: z.number().int().min(16).max(256),
  iconPx: z.number().int().min(16).max(128),
  interior: InteriorMetaSchema.optional(),
}).strict()
export type LibraryItemManifest = z.infer<typeof LibraryItemManifestSchema>

export function parseLibraryItemManifest(meta: string | null): LibraryItemManifest | null {
  if (meta === null) return null
  try {
    const r = LibraryItemManifestSchema.safeParse(JSON.parse(meta))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

// C10 T10's six originals include `tools`, which the addendum resolves as "anvil + saw wall rack".
export const FURNISHING_KIND_ALIASES: Record<string, string> = { tools: 'anvil' }

export function resolveFurnishingKind(kind: string): string {
  return FURNISHING_KIND_ALIASES[kind] ?? kind
}
