import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetRecordSchema } from '@sj/shared'
import { decodePng, openForgeDb } from '@sj/forge'
import { HUT_PX, drawHut, registerDemoHut } from './hotswapDemo.js'

let dir: string | null = null
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('hotswap demo hut', () => {
  it('draws a deterministic 64x64 opaque hut from the master palette', () => {
    const img = drawHut()
    expect(img.width).toBe(HUT_PX)
    expect(img.height).toBe(HUT_PX)
    expect(drawHut()).toEqual(img)
    expect(img.data[3]).toBe(255)
  })

  it('registers a ready building the renderer resolves by kind, png round-tripping', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sj-hotswap-'))
    const db = openForgeDb(join(dir, 'forge.db'))
    const rec = await registerDemoHut(db)
    expect(() => AssetRecordSchema.parse(rec)).not.toThrow()
    expect(rec.class).toBe('building')
    expect(rec.status).toBe('ready')
    expect(rec.kind).toBe('hut') // the exact key resolveAssetId matches on
    expect(rec.footprint).toEqual({ w: 2, h: 2 })

    const row = db.prepare('SELECT png FROM assets WHERE id = ?').get(rec.id) as { png: Buffer }
    const back = await decodePng(row.png)
    expect({ width: back.width, height: back.height }).toEqual({ width: HUT_PX, height: HUT_PX })
    expect(Array.from(back.data)).toEqual(Array.from(drawHut().data))
    db.close()
  })
})
