import { Assets, type Texture } from 'pixi.js'
import {
  parseBuildingManifest, parseCharacterAtlasManifest,
  type AssetClass, type AssetRecord, type CharacterAtlasManifest,
} from '@sj/shared'

// (controller ruling) resolution runs on the codex kind column, never on desc parsing
export function resolveAsset(records: AssetRecord[], klass: AssetClass, kind: string): AssetRecord | null {
  let best: AssetRecord | null = null
  for (const r of records) {
    if (r.status !== 'ready' || r.class !== klass || r.kind !== kind) continue
    if (best === null || r.seq > best.seq) best = r
  }
  return best
}

export function resolveAssetId(records: AssetRecord[], klass: AssetClass, kind: string): string | null {
  return resolveAsset(records, klass, kind)?.id ?? null
}

// character sheets live in the codex as class rig-part, kind character:<agentId>
export const CHARACTER_CLASS: AssetClass = 'rig-part'

export type CharacterArt = {
  url: string
  manifest: CharacterAtlasManifest | null
  size: { w: number; h: number } | null // atlas pixel dims (record widthPx/heightPx)
}

// v4 atlas record → its immutable png + manifest; older/no codex art → the
// gateway's character route (v2 sheet or placeholder) sliced by v2 geometry.
export function characterArt(records: AssetRecord[], agentId: string): CharacterArt {
  const rec = resolveAsset(records, CHARACTER_CLASS, `character:${agentId}`)
  if (rec === null) return { url: `/assets/character/${agentId}.png`, manifest: null, size: null }
  const manifest = parseCharacterAtlasManifest(rec.meta)
  if (manifest === null) return { url: `/assets/character/${agentId}.png`, manifest: null, size: null }
  return { url: `/assets/${rec.id}.png`, manifest, size: { w: rec.widthPx, h: rec.heightPx } }
}

export const BUILDING_PX_PER_TILE = 32 // Style Bible: ~64px sprite for a 1×1 building → fit a 32·(w+h) square

export type BuildingArt = { url: string; anchor: { x: number; y: number } | null; scale: number | null }

// v4 hi-res building → feet-anchored, scaled to fit the Style Bible's 32·(w+h) px
// square; anything else draws at natural size with the bottom-center anchor law.
export function buildingArt(records: AssetRecord[], kind: string, fw: number, fh: number): BuildingArt {
  const rec = resolveAsset(records, 'building', kind)
  if (rec === null) return { url: '/assets/placeholder/building.png', anchor: null, scale: null }
  const m = parseBuildingManifest(rec.meta)
  if (m === null) return { url: `/assets/${rec.id}.png`, anchor: null, scale: null }
  const target = (fw + fh) * BUILDING_PX_PER_TILE
  return {
    url: `/assets/${rec.id}.png`,
    anchor: { x: m.cell.feetX / m.cell.w, y: m.cell.feetY / m.cell.h },
    scale: Math.min(target / m.cell.w, target / m.cell.h),
  }
}

// hi-res sources downscale smoothly (user ruling); world tiles/UI stay nearest
export function smoothSource(t: Texture): Texture {
  t.source.autoGenerateMipmaps = true
  t.source.scaleMode = 'linear'
  return t
}

export function textureUrlFor(records: AssetRecord[], klass: AssetClass, kind: string): string {
  const id = resolveAssetId(records, klass, kind)
  return id !== null ? `/assets/${id}.png` : `/assets/placeholder/${klass}.png`
}

export class TextureBook {
  #cache = new Map<string, Promise<Texture>>()

  get(url: string): Promise<Texture> {
    let p = this.#cache.get(url)
    if (p === undefined) {
      Assets.add({ alias: url, src: url })
      p = Assets.load<Texture>(url)
      this.#cache.set(url, p)
    }
    return p
  }

  async swap(oldUrl: string, newUrl: string): Promise<Texture> {
    const next = await this.get(newUrl) // load the replacement FIRST — no blank frame
    if (oldUrl !== newUrl) {
      const oldP = this.#cache.get(oldUrl)
      if (oldP !== undefined) {
        // claim the entry synchronously: concurrent swaps off a shared url (all
        // structures leave the placeholder at once) must unload exactly once
        this.#cache.delete(oldUrl)
        const old = await oldP
        old.source.unload() // texture GC gotcha — spec §15
        await Assets.unload(oldUrl)
      }
    }
    return next
  }
}
