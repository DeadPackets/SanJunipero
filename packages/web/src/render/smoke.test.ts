import type { AssetRecord } from '@sj/shared'
import { Container, type Sprite, Texture } from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { HEARTH_KINDS, SMOKE_MAX_ALPHA } from './ambient.js'
import { feetOf } from './iso.js'
import type { Scene } from './scene.js'
import {
  chimneyOf,
  createSmoke,
  PUFF_DIAMETERS,
  puffAt,
  SMOKE_LOOP_MS,
  SMOKE_PUFFS,
  SMOKE_RISE_PX,
} from './smoke.js'
import { advanceWind } from './wind.js'

// ── the puff, as a function of its life ─────────────────────────────────────────────────

describe('★ U8 — a puff is born faint, swells, leans on the wind and fades', () => {
  it('alpha is 0.42·sin(π·prog): nothing at birth, the peak at mid-life, nothing at death', () => {
    expect(puffAt(0, 0).alpha).toBeCloseTo(0, 6)
    expect(puffAt(0.5, 0).alpha).toBeCloseTo(SMOKE_MAX_ALPHA, 6)
    expect(puffAt(1 - 1e-9, 0).alpha).toBeCloseTo(0, 6)
    let last = -1
    for (let p = 0; p <= 0.5; p += 0.01) {
      expect(puffAt(p, 0).alpha).toBeGreaterThanOrEqual(last)
      last = puffAt(p, 0).alpha
    }
  })

  it('grows through the whole-pixel diameters, never a fractional size', () => {
    let last = 0
    const seen = new Set<number>()
    for (let p = 0; p < 1; p += 0.01) {
      const d = puffAt(p, 0).diameter
      expect(PUFF_DIAMETERS).toContain(d)
      expect(d).toBeGreaterThanOrEqual(last)
      last = d
      seen.add(d)
    }
    expect(seen.size).toBe(PUFF_DIAMETERS.length)
  })

  it('rises with its life and drifts with the wind, further the older it is', () => {
    expect(puffAt(0, 1).rise).toBe(0)
    expect(puffAt(1, 1).rise).toBe(SMOKE_RISE_PX)
    expect(puffAt(0.5, 1).drift).toBeGreaterThan(0)
    expect(puffAt(0.5, -1).drift).toBeLessThan(0)
    expect(Math.abs(puffAt(0.9, 1).drift)).toBeGreaterThan(Math.abs(puffAt(0.3, 1).drift))
    expect(puffAt(0.5, 0).drift).toBe(0)
  })
})

// ── the chimney, read off the manifest ──────────────────────────────────────────────────

const HEARTH = [...HEARTH_KINDS].find((k) => k !== 'fire_pit')!

function record(kind: string, meta: unknown, id = `b-${kind}`): AssetRecord {
  return {
    id,
    seq: 1,
    class: 'building',
    kind,
    status: 'ready',
    meta: meta === null ? null : JSON.stringify(meta),
  } as unknown as AssetRecord
}

const CELL = { w: 512, h: 512, feetX: 256, feetY: 511 }
const manifest = (points?: unknown) => ({
  version: 'v4-hires-building',
  kind: HEARTH,
  footprint: { w: 2, h: 2 },
  cell: CELL,
  ...(points === undefined ? {} : { points }),
})

describe('★ U8 — the chimney comes from `points.chimney`, and its absence is "no smoke"', () => {
  it('places the chimney relative to the feet, through the sprite scale the building draws at', () => {
    const recs = [record(HEARTH, manifest({ chimney: { x: 344, y: 61 } }))]
    const c = chimneyOf(recs, HEARTH, 2, 2)!
    // a 2×2 draws its 512 cell to (2+2)·32 = 128 px: scale 0.25
    expect(c.dx).toBeCloseTo((344 - 256) * 0.25, 6)
    expect(c.dy).toBeCloseTo((61 - 511) * 0.25, 6)
  })

  it('no `points.chimney` → null; no manifest → null; junk → null', () => {
    expect(chimneyOf([record(HEARTH, manifest())], HEARTH, 2, 2)).toBeNull()
    expect(chimneyOf([record(HEARTH, null)], HEARTH, 2, 2)).toBeNull()
    expect(chimneyOf([record(HEARTH, manifest({ chimney: { x: 'no' } }))], HEARTH, 2, 2)).toBeNull()
    expect(
      chimneyOf([{ ...record(HEARTH, manifest()), meta: '{not json' }], HEARTH, 2, 2),
    ).toBeNull()
    expect(chimneyOf([], HEARTH, 2, 2)).toBeNull()
  })

  it('a turned building reads its own facing cell, and falls back to the bare kind', () => {
    const sw = record(HEARTH, manifest({ chimney: { x: 100, y: 61 } }), 'sw')
    const se = record(`${HEARTH}:se`, manifest({ chimney: { x: 400, y: 61 } }), 'se')
    expect(chimneyOf([sw, se], HEARTH, 2, 2, 'se')!.dx).toBeCloseTo((400 - 256) * 0.25, 6)
    expect(chimneyOf([sw, se], HEARTH, 2, 2, 'sw')!.dx).toBeCloseTo((100 - 256) * 0.25, 6)
    expect(chimneyOf([sw], HEARTH, 2, 2, 'se')!.dx).toBeCloseTo((100 - 256) * 0.25, 6)
  })
})

// ── the layer, driven ───────────────────────────────────────────────────────────────────

function fixture(motion = true) {
  const overhead = new Container()
  let made = 0
  const scene = {
    app: {
      renderer: {
        generateTexture: () => {
          made++
          return new Texture()
        },
      },
    },
    wantsMotion: () => motion,
    layers: { overhead },
    viewRect: () => view,
  } as unknown as Scene
  let view = { x: -2000, y: -2000, w: 4000, h: 4000 }
  const structures: Record<string, unknown> = {}
  let state = { structures }
  let seq = 1
  let records = [record(HEARTH, manifest({ chimney: { x: 344, y: 61 } }))]
  const store = {
    getState: () => state,
    assetRecords: () => records,
    assetsSeq: () => seq,
  }
  const layer = createSmoke(scene, store as never)
  return {
    layer,
    overhead,
    textures: () => made,
    setView: (v: typeof view) => {
      view = v
    },
    build: (id: string, x: number, y: number) => {
      structures[id] = { id, kind: HEARTH, x, y, w: 2, h: 2, stage: 'complete' }
      state = { structures: { ...structures } }
    },
    raze: (id: string) => {
      Reflect.deleteProperty(structures, id)
      state = { structures: { ...structures } }
    },
    setRecords: (next: AssetRecord[]) => {
      records = next
      seq++
    },
  }
}

const puffs = (overhead: Container): Sprite[] => overhead.children as Sprite[]

describe('★ U8 — the smoke layer', () => {
  it('one texture per diameter, authored once; five puffs per hearth in `overhead`', () => {
    const f = fixture()
    expect(f.textures()).toBe(PUFF_DIAMETERS.length)
    f.build('a', 4, 4)
    f.layer.tick(16)
    expect(puffs(f.overhead)).toHaveLength(SMOKE_PUFFS)
    expect(f.textures()).toBe(PUFF_DIAMETERS.length)
  })

  it('★ the lifecycle: puffs stand at the chimney, on whole pixels, spread over the loop', () => {
    const f = fixture()
    f.build('a', 4, 4)
    f.layer.tick(16)
    const feet = feetOf(4, 4, 2, 2)
    const chimney = { sx: feet.sx + (344 - 256) * 0.25, sy: feet.sy + (61 - 511) * 0.25 }
    const alphas = new Set<number>()
    for (const p of puffs(f.overhead)) {
      expect(Number.isInteger(p.position.x)).toBe(true)
      expect(Number.isInteger(p.position.y)).toBe(true)
      expect(Math.abs(p.position.x - chimney.sx)).toBeLessThanOrEqual(11)
      expect(p.position.y).toBeLessThanOrEqual(Math.round(chimney.sy) + 1)
      expect(p.position.y).toBeGreaterThanOrEqual(Math.round(chimney.sy - SMOKE_RISE_PX) - 1)
      expect(p.alpha).toBeGreaterThanOrEqual(0)
      expect(p.alpha).toBeLessThanOrEqual(SMOKE_MAX_ALPHA)
      alphas.add(Math.round(p.alpha * 100))
    }
    expect(alphas.size).toBeGreaterThan(1) // the five are at different points of their lives
    // a puff never pops: over a whole loop no frame jumps to full alpha from nothing
    let prev = puffs(f.overhead).map((p) => p.alpha)
    for (let ms = 0; ms < SMOKE_LOOP_MS; ms += 16) {
      f.layer.tick(16)
      const now = puffs(f.overhead).map((p) => p.alpha)
      for (let i = 0; i < now.length; i++) expect(Math.abs(now[i]! - prev[i]!)).toBeLessThan(0.1)
      prev = now
    }
  })

  it('is on the wind: the same puff at the same age lands elsewhere when the wind turns', () => {
    const f = fixture()
    f.build('a', 4, 4)
    f.layer.tick(16)
    const before = puffs(f.overhead).map((p) => p.position.x)
    advanceWind(4000) // a different wind, the same director clock
    f.layer.tick(0)
    const after = puffs(f.overhead).map((p) => p.position.x)
    expect(after).not.toEqual(before)
  })

  it('pools: a razed hearth gives its sprites back, and the next one takes them', () => {
    const f = fixture()
    f.build('a', 4, 4)
    f.layer.tick(16)
    const first = new Set(puffs(f.overhead))
    f.raze('a')
    f.layer.tick(16)
    expect(puffs(f.overhead)).toHaveLength(0)
    f.build('b', 10, 10)
    f.layer.tick(16)
    for (const p of puffs(f.overhead)) expect(first.has(p)).toBe(true)
  })

  it('D21: a hearth off screen costs nothing but the counter', () => {
    const f = fixture()
    f.build('a', 4, 4)
    f.layer.tick(16)
    expect(f.layer.counts()).toEqual({ drawn: SMOKE_PUFFS, culled: 0 })
    f.setView({ x: 5000, y: 5000, w: 100, h: 100 })
    f.layer.tick(16)
    expect(f.layer.counts()).toEqual({ drawn: 0, culled: SMOKE_PUFFS })
    for (const p of puffs(f.overhead)) expect(p.visible).toBe(false)
  })

  it('under reduced motion the plume stands still', () => {
    const f = fixture(false)
    f.build('a', 4, 4)
    f.layer.tick(16)
    const at = puffs(f.overhead).map((p) => [p.position.x, p.position.y, p.alpha])
    for (let i = 0; i < 30; i++) f.layer.tick(50)
    expect(puffs(f.overhead).map((p) => [p.position.x, p.position.y, p.alpha])).toEqual(at)
  })

  it('a codex without the chimney point draws no smoke, and learns it when the codex changes', () => {
    const f = fixture()
    f.setRecords([record(HEARTH, manifest())])
    f.build('a', 4, 4)
    f.layer.tick(16)
    expect(puffs(f.overhead)).toHaveLength(0)
    f.setRecords([record(HEARTH, manifest({ chimney: { x: 344, y: 61 } }))])
    f.layer.tick(16)
    expect(puffs(f.overhead)).toHaveLength(SMOKE_PUFFS)
  })
})
