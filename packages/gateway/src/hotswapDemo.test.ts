import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AssetRecordSchema } from '@sj/shared'
import { decodePng, openForgeDb } from '@sj/forge'
import { HOUSE_PX, drawHouse, registerDemoHouse } from './hotswapDemo.js'

let dir: string | null = null
afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('hotswap demo house', () => {
  it('draws a deterministic 64x64 opaque house from the master palette', () => {
    const img = drawHouse()
    expect(img.width).toBe(HOUSE_PX)
    expect(img.height).toBe(HOUSE_PX)
    expect(drawHouse()).toEqual(img)
    expect(img.data[3]).toBe(255)
  })

  it('registers a ready building the renderer resolves by kind, png round-tripping', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sj-hotswap-'))
    const db = openForgeDb(join(dir, 'forge.db'))
    const rec = await registerDemoHouse(db)
    expect(() => AssetRecordSchema.parse(rec)).not.toThrow()
    expect(rec.class).toBe('building')
    expect(rec.status).toBe('ready')
    expect(rec.kind).toBe('house') // the exact key resolveAssetId matches on
    expect(rec.footprint).toEqual({ w: 2, h: 2 })

    const row = db.prepare('SELECT png FROM assets WHERE id = ?').get(rec.id) as { png: Buffer }
    const back = await decodePng(row.png)
    expect({ width: back.width, height: back.height }).toEqual({ width: HOUSE_PX, height: HOUSE_PX })
    expect(Array.from(back.data)).toEqual(Array.from(drawHouse().data))
    db.close()
  })
})
