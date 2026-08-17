import {
  LibraryItemManifestSchema, parseLibraryItemManifest,
  type AssetRecord, type LibraryItemManifest,
} from '@sj/shared'
import type { AssetCodex } from '../codex.js'
import { downscaleNearest, type RawImage } from '../post/raw.js'
import type { LibraryEntry } from './catalog.js'

export const LIBRARY_INDEX_VERSION = 'v1-library-index'
export const ICON_SUFFIX = '#icon'

function manifest(e: LibraryEntry): LibraryItemManifest {
  return LibraryItemManifestSchema.parse({
    version: 'v1-library-item', kind: e.kind, category: e.category,
    spritePx: e.spritePx, iconPx: e.iconPx, interior: e.interior,
  })
}

// Sprites and icons are square canvases at the entry's declared size (runner law), so the
// codex row's pixel dimensions come from the entry and this stays synchronous.
export function registerLibraryEntry(codex: AssetCodex, e: LibraryEntry, args: {
  sprite: Buffer; icon: Buffer; score: number | null; attempts: number; costUsd: number
}): { spriteRecord: AssetRecord; iconRecord: AssetRecord } {
  const meta = JSON.stringify(manifest(e))
  const common = {
    class: 'item' as const, desc: e.desc, meta, footprint: { w: 1, h: 1 },
    status: 'ready' as const, score: args.score, attempts: args.attempts,
  }
  const spriteRecord = codex.register({
    ...common, kind: e.kind, png: args.sprite,
    widthPx: e.spritePx, heightPx: e.spritePx, costUsd: args.costUsd,
  })
  // The icon is a downscale of a sprite already paid for: its own row books no extra spend.
  const iconRecord = codex.register({
    ...common, kind: `${e.kind}${ICON_SUFFIX}`, png: args.icon,
    widthPx: e.iconPx, heightPx: e.iconPx, costUsd: 0,
  })
  return { spriteRecord, iconRecord }
}

// Largest integer divisor that fits the sprite inside iconPx, then centred on a square
// canvas. Nearest sampling means alpha and quantized colours survive untouched, and k=1
// makes an already-small sprite a byte-for-byte no-op.
export function deriveIcon(sprite: RawImage, iconPx: number): RawImage {
  const long = Math.max(sprite.width, sprite.height)
  let k = 1
  while (Math.ceil(long / k) > iconPx) k++
  const w = Math.max(1, Math.ceil(sprite.width / k)), h = Math.max(1, Math.ceil(sprite.height / k))
  const small = k === 1 ? sprite : downscaleNearest(sprite, w, h)
  if (small.width === iconPx && small.height === iconPx) return small

  const data = new Uint8ClampedArray(iconPx * iconPx * 4)
  const ox = (iconPx - small.width) >> 1, oy = (iconPx - small.height) >> 1
  for (let y = 0; y < Math.min(small.height, iconPx); y++) {
    const src = (y * small.width) * 4
    data.set(small.data.subarray(src, src + Math.min(small.width, iconPx) * 4),
      ((y + oy) * iconPx + ox) * 4)
  }
  return { width: iconPx, height: iconPx, data }
}

export type LibraryIndexEntry = {
  kind: string; category: string; spriteId: string; iconId: string
  spritePx: number; iconPx: number; score: number | null; attempts: number; costUsd: number
}

export function libraryIndexJson(records: AssetRecord[]): string {
  const sprites = new Map<string, AssetRecord>()
  const icons = new Map<string, AssetRecord>()
  for (const r of records) {
    if (r.class !== 'item' || r.kind === null) continue
    if (parseLibraryItemManifest(r.meta) === null) continue
    if (r.kind.endsWith(ICON_SUFFIX)) icons.set(r.kind.slice(0, -ICON_SUFFIX.length), r)
    else sprites.set(r.kind, r)
  }

  const entries: LibraryIndexEntry[] = []
  for (const [kind, s] of sprites) {
    const icon = icons.get(kind)
    const m = parseLibraryItemManifest(s.meta)!
    entries.push({
      kind, category: m.category, spriteId: s.id, iconId: icon?.id ?? '',
      spritePx: m.spritePx, iconPx: m.iconPx,
      score: s.score, attempts: s.attempts, costUsd: s.costUsd,
    })
  }
  return JSON.stringify({ version: LIBRARY_INDEX_VERSION, entries }, null, 2)
}
