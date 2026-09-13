import { afterEach, describe, expect, it } from 'vitest'
import { parseMaterialSetManifest } from '@sj/shared'
import { AssetCodex } from './codex.js'
import { openForgeDb } from './db.js'
import { registerMaterialSet } from './materialIngest.js'
import { encodePng } from './post/raw.js'

const databases: ReturnType<typeof openForgeDb>[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const codex = () => {
  const db = openForgeDb(':memory:')
  databases.push(db)
  return new AssetCodex(db)
}
async function png(color = [140, 120, 100, 255], width = 2, height = 2) {
  return encodePng({
    width,
    height,
    data: new Uint8ClampedArray(Array.from({ length: width * height }, () => color).flat()),
  })
}
const input = (baseColor: Buffer) => ({
  class: 'building' as const,
  kind: 'wood',
  maps: { baseColor },
})

describe('local material ingestion', () => {
  it('registers PNG maps before a material manifest through existing codex rows at zero cost', async () => {
    const c = codex()
    const baseColor = await png()
    const result = await registerMaterialSet(c, {
      ...input(baseColor),
      maps: {
        baseColor,
        normal: await png([128, 128, 255, 255]),
        roughness: await png([200, 200, 200, 255]),
        emissive: await png([255, 120, 0, 255]),
      },
    })
    const manifest = parseMaterialSetManifest(result.meta)!
    expect(manifest.kind).toBe('wood')
    expect(manifest.widthPx).toBe(2)
    expect(result.class).toBe('building')
    expect(result.kind).toBe('material:wood')
    expect(c.listSince(0)).toHaveLength(5)
    for (const map of Object.values(manifest.maps)) {
      const source = c.get(map!.assetId)!
      expect(source.record.seq).toBeLessThan(result.seq)
      expect(source.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(source.record.costUsd).toBe(0)
    }
    expect(c.get(manifest.maps.baseColor.assetId)!.png).toEqual(baseColor)
  })

  it('keeps old map bytes and ids immutable across later imports of the same kind', async () => {
    const c = codex()
    const firstPng = await png()
    const first = await registerMaterialSet(c, input(firstPng))
    const second = await registerMaterialSet(c, input(await png([0, 0, 0, 255])))
    const a = parseMaterialSetManifest(first.meta)!
    const b = parseMaterialSetManifest(second.meta)!
    expect(a.maps.baseColor.assetId).not.toBe(b.maps.baseColor.assetId)
    expect(c.get(a.maps.baseColor.assetId)!.png).toEqual(firstPng)
    expect(c.get(first.id)!.record).toEqual(first)
  })

  it('refuses mismatched sizes before registering any rows', async () => {
    const c = codex()
    await expect(
      registerMaterialSet(c, {
        ...input(await png()),
        maps: {
          baseColor: await png(),
          roughness: await png([200, 200, 200, 255], 1, 2),
        },
      }),
    ).rejects.toThrow(/dimensions/)
    expect(c.listSince(0)).toEqual([])
  })

  it('refuses missing maps, non-PNG bytes and unknown channels without rows', async () => {
    const c = codex()
    for (const maps of [
      {},
      { baseColor: Buffer.from('not a PNG') },
      { baseColor: await png(), metalness: await png() },
    ]) {
      await expect(
        registerMaterialSet(c, { class: 'building', kind: 'wood', maps } as Parameters<
          typeof registerMaterialSet
        >[1]),
      ).rejects.toThrow()
      expect(c.listSince(0)).toEqual([])
    }
  })

  it('refuses colored roughness and invalid tangent normals before registering', async () => {
    const c = codex()
    for (const extra of [
      { roughness: await png([200, 10, 100, 255]) },
      { normal: await png([128, 128, 128, 255]) },
      { normal: await png([128, 128, 0, 255]) },
      { normal: await png([128, 128, 255, 128]) },
    ]) {
      await expect(
        registerMaterialSet(c, {
          ...input(await png()),
          maps: { baseColor: await png(), ...extra },
        }),
      ).rejects.toThrow(/roughness|normal/)
      expect(c.listSince(0)).toEqual([])
    }
  })
})
