import { describe, it, expect } from 'vitest'
import { parseLibraryItemManifest, type AssetRecord } from '@sj/shared'
import { openForgeDb } from '../db.js'
import { AssetCodex } from '../codex.js'
import type { RawImage } from '../post/raw.js'
import { LIBRARY, libraryEntry } from './catalog.js'
import { registerLibraryEntry, libraryIndexJson, deriveIcon, LIBRARY_INDEX_VERSION } from './register.js'

const png = (tag: string) => Buffer.from(`png:${tag}`)
const args = { sprite: png('s'), icon: png('i'), score: 8.5, attempts: 1, costUsd: 0.11 }
const codex = () => new AssetCodex(openForgeDb(':memory:'))

function solid(w: number, h: number, alphaAt?: (x: number, y: number) => number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    data[i] = (x * 8) & 255; data[i + 1] = (y * 8) & 255; data[i + 2] = 64
    data[i + 3] = alphaAt ? alphaAt(x, y) : 255
  }
  return { width: w, height: h, data }
}

describe('registerLibraryEntry', () => {
  it('writes two rows whose manifests both carry the interior meta of a furniture entry', () => {
    const c = codex()
    const bed = libraryEntry('bed')!
    const { spriteRecord, iconRecord } = registerLibraryEntry(c, bed, args)

    for (const r of [spriteRecord, iconRecord]) {
      const m = parseLibraryItemManifest(r.meta)!
      expect(m, r.kind!).not.toBeNull()
      expect(m.kind).toBe('bed')
      expect(m.category).toBe('furniture')
      expect(m.interior).toEqual(bed.interior)
      expect(r.class).toBe('item')
      expect(r.status).toBe('ready')
      expect(r.footprint).toEqual({ w: 1, h: 1 })
      expect(r.desc).toBe(bed.desc)
    }
    expect(spriteRecord.kind).toBe('bed')
    expect(iconRecord.kind).toBe('bed#icon')
    expect(spriteRecord.widthPx).toBe(bed.spritePx)
    expect(iconRecord.widthPx).toBe(bed.iconPx)
    expect(c.get(spriteRecord.id)!.png.toString()).toBe('png:s')
    expect(c.get(iconRecord.id)!.png.toString()).toBe('png:i')
  })

  it('a tool entry carries no interior on either row', () => {
    const c = codex()
    const { spriteRecord, iconRecord } = registerLibraryEntry(c, libraryEntry('axe')!, args)
    for (const r of [spriteRecord, iconRecord])
      expect(parseLibraryItemManifest(r.meta)!.interior).toBeUndefined()
    expect(iconRecord.kind!.endsWith('#icon')).toBe(true)
  })
})

describe('deriveIcon', () => {
  it('lands on iconPx square by an integer downscale', () => {
    const out = deriveIcon(solid(24, 24), 16)
    expect(out.width).toBe(16)
    expect(out.height).toBe(16)
  })

  it('never upscales: a 16 px sprite into a 16 px icon comes back byte-identical', () => {
    const src = solid(16, 16)
    const out = deriveIcon(src, 16)
    expect(out.width).toBe(16)
    expect([...out.data]).toEqual([...src.data])
  })

  it('preserves transparency rather than blending it away', () => {
    const src = solid(24, 24, (x, y) => (x < 4 || y < 4 ? 0 : 255))
    const out = deriveIcon(src, 16)
    let clear = 0, opaque = 0
    for (let i = 3; i < out.data.length; i += 4) {
      if (out.data[i] === 0) clear++
      else if (out.data[i] === 255) opaque++
    }
    expect(clear).toBeGreaterThan(0)
    expect(opaque).toBeGreaterThan(0)
    expect(clear + opaque).toBe(16 * 16)
  })

  it('is deterministic', () => {
    const src = solid(24, 24)
    expect([...deriveIcon(src, 16).data]).toEqual([...deriveIcon(src, 16).data])
  })
})

describe('libraryIndexJson', () => {
  it('lists all 50 entries with both asset ids and parses as JSON', () => {
    const c = codex()
    const records: AssetRecord[] = []
    for (const e of LIBRARY) {
      const r = registerLibraryEntry(c, e, args)
      records.push(r.spriteRecord, r.iconRecord)
    }
    expect(records).toHaveLength(100)

    const index = JSON.parse(libraryIndexJson(records)) as {
      version: string
      entries: { kind: string; spriteId: string; iconId: string; category: string }[]
    }
    expect(index.version).toBe(LIBRARY_INDEX_VERSION)
    expect(index.entries).toHaveLength(50)
    expect(index.entries.map(e => e.kind)).toEqual(LIBRARY.map(e => e.kind))
    for (const e of index.entries) {
      expect(e.spriteId, e.kind).toMatch(/^asset_/)
      expect(e.iconId, e.kind).toMatch(/^asset_/)
      expect(e.spriteId).not.toBe(e.iconId)
    }
  })

  it('ignores rows that are not library rows', () => {
    const c = codex()
    const { spriteRecord, iconRecord } = registerLibraryEntry(c, libraryEntry('axe')!, args)
    const stray = c.register({
      class: 'building', desc: 'a shed', kind: 'shed', footprint: { w: 1, h: 1 },
      png: png('b'), widthPx: 64, heightPx: 64, status: 'ready', score: null, attempts: 1, costUsd: 0,
    })
    const index = JSON.parse(libraryIndexJson([spriteRecord, stray, iconRecord])) as { entries: unknown[] }
    expect(index.entries).toHaveLength(1)
  })
})
