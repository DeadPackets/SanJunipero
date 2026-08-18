import { Assets, type Texture } from 'pixi.js'
import { progress, type MotionName } from '../ui/motion.js'
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

/** `url: null` means NO ART EXISTS for this kind — the renderer draws a palette-true built
 *  form instead. It must never mean the forge's checkerboard placeholder: a checkerboard in
 *  the middle of the plaza reads as a broken product, and the well and fire pit have no art
 *  in any root until v1 Task 17 commissions the structure set. */
export type BuildingArt = { url: string | null; anchor: { x: number; y: number } | null; scale: number | null }

// v4 hi-res building → feet-anchored, scaled to fit the Style Bible's 32·(w+h) px
// square; anything else draws at natural size with the bottom-center anchor law.
export function buildingArt(records: AssetRecord[], kind: string, fw: number, fh: number): BuildingArt {
  const rec = resolveAsset(records, 'building', kind)
  if (rec === null) return { url: null, anchor: null, scale: null }
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

// ── NOTHING POPS IN (U23 finish line 8) ───────────────────────────────────────────────────
//
// The codex hot-swap HARD-SWAPPED the texture: a building standing as a placeholder became a
// finished sprite between one frame and the next, in the middle of a shot. Art arriving is a
// reveal, so it takes MOTION.reveal like every other reveal in the product — one vocabulary,
// two runtimes (motion.ts).

/** The motion a swapped-in texture arrives on. */
export const ART_FADE: MotionName = 'reveal'

/** Fades a node from nothing to itself over `ART_FADE`. Node-safe: with no rAF (a test, a
 *  worker) the art simply arrives, which is the old behaviour and never a hole. */
export function fadeArtIn(node: { alpha: number; destroyed: boolean }): void {
  if (typeof requestAnimationFrame !== 'function') return
  const started = performance.now()
  node.alpha = 0
  const step = (): void => {
    if (node.destroyed) return
    const t = progress(ART_FADE, started, performance.now())
    node.alpha = t
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
