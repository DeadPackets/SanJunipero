import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { AssetCodex, EMOTE_KINDS, decodePng, encodePng, openForgeDb, paletteRgb, type RawImage } from '@sj/forge'
import { createGateway, type Gateway } from './server.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0 as TileId))
const CELL = 96

function crop(img: RawImage, x0: number, y0: number, w: number, h: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4)
  return { width: w, height: h, data }
}

function opaqueBbox(img: RawImage): { w: number; h: number } {
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3]! === 0) continue
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

describe('asset http routes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwassets-'))
  const dbPath = join(dir, 'world.db')
  let gw: Gateway
  let codex: AssetCodex
  let base: string

  // The character route only draws people the world HAS — an id nobody answers to is a sharp
  // png encode a stranger picked the key for (see assetsHttp.ts). So the fixture town is
  // populated by the four it is about to ask for sheets of.
  const CAST = ['farmer', 'idler', 'weaver', 'mason'] as const

  beforeAll(async () => {
    openForgeDb(dbPath).close()
    const db = openDb(dbPath)
    codex = new AssetCodex(db)
    const loop = new TickLoop({
      store: new EventStore(db), state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('assets-http'), snapshotEveryTicks: 5,
      onTick: ({ tick, emit }) => {
        if (tick !== 1) return
        CAST.forEach((id, i) => emit('agent_spawned', { id, name: id, x: i, y: 0, ageDays: 7300 }))
      },
    })
    loop.step()
    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves class placeholders at their pinned sizes', async () => {
    const res = await fetch(`${base}/assets/placeholder/building.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const img = await decodePng(Buffer.from(await res.arrayBuffer()))
    expect(img.width).toBe(64)
    expect(img.height).toBe(64)
    const border = paletteRgb()[31]!
    expect([img.data[0], img.data[1], img.data[2], img.data[3]]).toEqual([...border, 255])
  })

  it('404s an unknown placeholder class', async () => {
    expect((await fetch(`${base}/assets/placeholder/spaceship.png`)).status).toBe(404)
  })

  it('builds a v2-geometry placeholder character sheet', async () => {
    const res = await fetch(`${base}/assets/character/farmer.png`)
    expect(res.status).toBe(200)
    const img = await decodePng(Buffer.from(await res.arrayBuffer()))
    expect(img.width).toBe(384)
    expect(img.height).toBe(576)

    // sleep row (row 5): lying silhouette — opaque bbox wider than tall
    const sleep = opaqueBbox(crop(img, 0, 5 * CELL, CELL, CELL))
    expect(sleep.w).toBeGreaterThan(sleep.h)

    // contact-a (row 1) differs from contact-b (row 3): foot bar offset flips
    const ca = crop(img, 0, 1 * CELL, CELL, CELL)
    const cb = crop(img, 0, 3 * CELL, CELL, CELL)
    expect(Buffer.from(ca.data).equals(Buffer.from(cb.data))).toBe(false)

    // standing cells anchor feet at y=88: bottom body row is 87, row 88 transparent
    expect(ca.data[(87 * CELL + 48) * 4 + 3]).toBe(255)
    expect(ca.data[(88 * CELL + 48) * 4 + 3]).toBe(0)
  })

  it('placeholder sheets differ deterministically by agentId parity', async () => {
    const a = await decodePng(Buffer.from(await (await fetch(`${base}/assets/character/farmer.png`)).arrayBuffer()))
    const again = await decodePng(Buffer.from(await (await fetch(`${base}/assets/character/farmer.png`)).arrayBuffer()))
    expect(Buffer.from(a.data).equals(Buffer.from(again.data))).toBe(true) // deterministic
    // 'farmer' sums to 641 (odd), 'fisher' to 645 (odd), 'idler' to 528 (even) — pick an even/odd pair
    const even = await decodePng(Buffer.from(await (await fetch(`${base}/assets/character/idler.png`)).arrayBuffer()))
    expect(Buffer.from(a.data).equals(Buffer.from(even.data))).toBe(false)
  })

  it('serves a ready codex character sheet byte-identical instead of the placeholder', async () => {
    const png = await encodePng({ width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(200) })
    codex.register({
      class: 'rig-part', desc: 'character:weaver', kind: 'character:weaver', footprint: { w: 1, h: 1 },
      png, widthPx: 4, heightPx: 4, status: 'ready', score: 9, attempts: 1, costUsd: 0,
    })
    const res = await fetch(`${base}/assets/character/weaver.png`)
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
  })

  it('a placeholder-status codex row does NOT shadow the built sheet', async () => {
    const png = await encodePng({ width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4).fill(90) })
    codex.register({
      class: 'rig-part', desc: 'character:mason', kind: 'character:mason', footprint: { w: 1, h: 1 },
      png, widthPx: 4, heightPx: 4, status: 'placeholder', score: null, attempts: 1, costUsd: 0,
    })
    const res = await fetch(`${base}/assets/character/mason.png`)
    const img = await decodePng(Buffer.from(await res.arrayBuffer()))
    expect(img.width).toBe(384) // fell through to buildPlaceholderSheet
  })

  it('round-trips a codex png byte-identical with immutable caching', async () => {
    const png = await encodePng({ width: 6, height: 3, data: new Uint8ClampedArray(6 * 3 * 4).fill(37) })
    const rec = codex.register({
      class: 'item', desc: 'basket: woven reed', footprint: { w: 1, h: 1 },
      png, widthPx: 6, heightPx: 3, status: 'ready', score: 8, attempts: 1, costUsd: 0,
    })
    const res = await fetch(`${base}/assets/${rec.id}.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
  })

  it('404s an unknown codex id', async () => {
    expect((await fetch(`${base}/assets/asset_nope.png`)).status).toBe(404)
  })

  it('serves the emote atlas: 12 glyphs in one 192×16 row + a json manifest', async () => {
    const res = await fetch(`${base}/assets/emotes.png`)
    expect(res.status).toBe(200)
    const img = await decodePng(Buffer.from(await res.arrayBuffer()))
    expect(img.width).toBe(192)
    expect(img.height).toBe(16)
    const jres = await fetch(`${base}/assets/emotes.json`)
    expect(jres.headers.get('content-type')).toBe('application/json')
    expect(await jres.json()).toEqual({ size: 16, order: [...EMOTE_KINDS] })
  })
})
