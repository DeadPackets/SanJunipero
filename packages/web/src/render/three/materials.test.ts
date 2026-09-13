import { afterEach, expect, it, vi } from 'vitest'
import {
  Group,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import type { AssetRecord } from '@sj/shared'
import { createMaterialLibrary } from './materials.js'

const id = 'asset_01234567-89ab-4cde-8fab-0123456789ab'
const record = (meta: string | null, seq = 1): AssetRecord => ({
  id,
  seq,
  class: 'building',
  desc: 'wood',
  kind: 'material:wood',
  meta,
  footprint: { w: 1, h: 1 },
  widthPx: 2,
  heightPx: 2,
  status: 'ready',
  score: null,
  attempts: 1,
  costUsd: 0,
  createdAt: '',
})
afterEach(() => vi.restoreAllMocks())
it('separates color spaces, enables authored emission, and clears removed optional maps', () => {
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(() => new Texture())
  const library = createMaterialLibrary()
  const group = new Group()
  const material = new MeshStandardMaterial()
  const mesh = new Mesh(undefined, material)
  mesh.userData.materialSlot = 'wood'
  group.add(mesh)
  const manifest = {
    version: 'v1-material-set',
    kind: 'wood',
    widthPx: 2,
    heightPx: 2,
    maps: {
      baseColor: { assetId: id, colorSpace: 'srgb' },
      roughness: { assetId: id, colorSpace: 'linear', channel: 'g' },
      emissive: { assetId: id, colorSpace: 'srgb' },
    },
  }
  library.apply(group, 'house', [record(JSON.stringify(manifest))])
  expect(material.map?.colorSpace).toBe(SRGBColorSpace)
  expect(material.roughnessMap?.colorSpace).toBe(NoColorSpace)
  expect(material.map).not.toBe(material.roughnessMap)
  expect(material.emissive.getHex()).toBe(0xffffff)
  expect(group.userData.windows).toContain(material)
  library.apply(group, 'house', [
    record(JSON.stringify(manifest)),
    record(JSON.stringify({ ...manifest, maps: { baseColor: manifest.maps.baseColor } }), 2),
  ])
  expect(material.roughnessMap).toBeNull()
  expect(material.emissiveMap).toBeNull()
  expect(group.userData.windows).not.toContain(material)
  library.destroy()
})
