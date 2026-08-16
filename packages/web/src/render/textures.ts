import { Assets, type Texture } from 'pixi.js'
import type { AssetClass, AssetRecord } from '@sj/shared'

// (controller ruling) resolution runs on the codex kind column, never on desc parsing
export function resolveAssetId(records: AssetRecord[], klass: AssetClass, kind: string): string | null {
  let best: AssetRecord | null = null
  for (const r of records) {
    if (r.status !== 'ready' || r.class !== klass || r.kind !== kind) continue
    if (best === null || r.seq > best.seq) best = r
  }
  return best?.id ?? null
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
