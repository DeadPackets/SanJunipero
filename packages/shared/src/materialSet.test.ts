import { describe, expect, it } from 'vitest'
import { parseMaterialSetManifest } from './materialSet.js'

const assetId = 'asset_01234567-89ab-4cde-8fab-0123456789ab'
const valid = {
  version: 'v1-material-set',
  kind: 'wood',
  widthPx: 16,
  heightPx: 32,
  maps: {
    baseColor: { assetId, colorSpace: 'srgb' },
    normal: { assetId, colorSpace: 'linear', convention: 'opengl' },
    roughness: { assetId, colorSpace: 'linear', channel: 'g' },
    emissive: { assetId, colorSpace: 'srgb' },
  },
}
const parse = (value: unknown) => parseMaterialSetManifest(JSON.stringify(value))

describe('material set manifest', () => {
  it('accepts aligned material maps with explicit sampling semantics', () => {
    expect(parse(valid)).toEqual(valid)
    expect(parse({ ...valid, maps: { baseColor: valid.maps.baseColor } })).not.toBeNull()
  })

  it.each([null, '', 'not JSON', '{}', '{"version":"v2-terrain-material","kind":"grass"}'])(
    'preserves legacy metadata as no material set: %s',
    (meta) => {
      expect(parseMaterialSetManifest(meta)).toBeNull()
    },
  )

  it('rejects unsupported versions and missing base color', () => {
    expect(parse({ ...valid, version: 'v2-material-set' })).toBeNull()
    expect(parse({ ...valid, maps: { normal: valid.maps.normal } })).toBeNull()
  })

  it.each([0, -1, 1.5])('rejects invalid image size %s', (widthPx) => {
    expect(parse({ ...valid, widthPx })).toBeNull()
  })

  it('rejects unknown keys at every depth and path references', () => {
    expect(parse({ ...valid, extra: true })).toBeNull()
    expect(parse({ ...valid, maps: { ...valid.maps, metallic: {} } })).toBeNull()
    expect(
      parse({ ...valid, maps: { baseColor: { ...valid.maps.baseColor, path: 'a.png' } } }),
    ).toBeNull()
    expect(
      parse({ ...valid, maps: { baseColor: { assetId: '/a.png', colorSpace: 'srgb' } } }),
    ).toBeNull()
  })

  it('rejects incorrect color spaces and normal or roughness conventions', () => {
    for (const [channel, changes] of [
      ['baseColor', { colorSpace: 'linear' }],
      ['normal', { convention: 'directx' }],
      ['roughness', { channel: 'r' }],
      ['emissive', { colorSpace: 'linear' }],
    ] as const) {
      expect(
        parse({
          ...valid,
          maps: { ...valid.maps, [channel]: { ...valid.maps[channel], ...changes } },
        }),
      ).toBeNull()
    }
  })
})
