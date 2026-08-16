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

export type CharacterArt = { url: string; manifest: CharacterAtlasManifest | null }

// v4 atlas record → its immutable png + manifest; older/no codex art → the
// gateway's character route (v2 sheet or placeholder) sliced by v2 geometry.
export function characterArt(records: AssetRecord[], agentId: string): CharacterArt {
  const rec = resolveAsset(records, CHARACTER_CLASS, `character:${agentId}`)
  if (rec === null) return { url: `/assets/character/${agentId}.png`, manifest: null }
  const manifest = parseCharacterAtlasManifest(rec.meta)
  if (manifest === null) return { url: `/assets/character/${agentId}.png`, manifest: null }
  return { url: `/assets/${rec.id}.png`, manifest }
}

export const TILE_HALF_W = 16 // iso TILE_W/2 — a footprint's diamond spans (w+h)·16 px

export type BuildingArt = { url: string; anchor: { x: number; y: number } | null; scale: number | null }

// v4 hi-res building → feet-anchored, scaled so the art width spans the footprint
// diamond; anything else draws at natural size with the bottom-center anchor law.
export function buildingArt(records: AssetRecord[], kind: string, fw: number, fh: number): BuildingArt {
  const rec = resolveAsset(records, 'building', kind)
  if (rec === null) return { url: '/assets/placeholder/building.png', anchor: null, scale: null }
  const m = parseBuildingManifest(rec.meta)
  if (m === null) return { url: `/assets/${rec.id}.png`, anchor: null, scale: null }
  return {
    url: `/assets/${rec.id}.png`,
    anchor: { x: m.cell.feetX / m.cell.w, y: m.cell.feetY / m.cell.h },
    scale: ((fw + fh) * TILE_HALF_W) / m.cell.w,
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
    if (oldUrl !== newUrl && this.#cache.has(oldUrl)) {
      const old = await this.#cache.get(oldUrl)!
      old.source.unload() // texture GC gotcha — spec §15
      await Assets.unload(oldUrl)
      this.#cache.delete(oldUrl)
    }
    return next
  }
}
