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
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('separates color spaces, enables authored emission, and clears removed optional maps', async () => {
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, loaded) => {
    const texture = new Texture<HTMLImageElement>()
    loaded?.(texture)
    return texture
  })
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
  await library.apply(group, 'house', [record(JSON.stringify(manifest))])
  expect(material.map?.colorSpace).toBe(SRGBColorSpace)
  expect(material.roughnessMap?.colorSpace).toBe(NoColorSpace)
  expect(material.map).not.toBe(material.roughnessMap)
  expect(material.emissive.getHex()).toBe(0xffffff)
  expect(group.userData.windows).toContain(material)
  await library.apply(group, 'house', [
    record(JSON.stringify(manifest)),
    record(JSON.stringify({ ...manifest, maps: { baseColor: manifest.maps.baseColor } }), 2),
  ])
  expect(material.roughnessMap).toBeNull()
  expect(material.emissiveMap).toBeNull()
  expect(group.userData.windows).not.toContain(material)
  library.destroy()
})

it('keeps fallback through an incomplete or failed download and can retry', async () => {
  vi.useFakeTimers()
  const pending: { loaded: (texture: Texture<HTMLImageElement>) => void; failed: () => void }[] = []
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation(
    (_url, loaded, _progress, failed) => {
      pending.push({ loaded: loaded!, failed: () => failed?.(new Error('offline')) })
      return new Texture<HTMLImageElement>()
    },
  )
  const library = createMaterialLibrary()
  const fallback = new Texture<HTMLImageElement>()
  const material = new MeshStandardMaterial({ map: fallback })
  const mesh = new Mesh(undefined, material)
  mesh.userData.materialSlot = 'wood'
  const group = new Group().add(mesh)
  const records = [
    record(
      JSON.stringify({
        version: 'v1-material-set',
        kind: 'wood',
        widthPx: 2,
        heightPx: 2,
        maps: { baseColor: { assetId: id, colorSpace: 'srgb' } },
      }),
    ),
  ]
  const first = library.apply(group, 'house', records)
  expect(material.map).toBe(fallback)
  pending[0]!.failed()
  await vi.advanceTimersByTimeAsync(1000)
  pending[1]!.failed()
  await vi.advanceTimersByTimeAsync(4000)
  pending[2]!.failed()
  await first
  expect(material.map).toBe(fallback)
  const retry = library.apply(group, 'house', records)
  const replacement = new Texture<HTMLImageElement>()
  pending[3]!.loaded(replacement)
  await retry
  expect(material.map).toBe(replacement)
  library.destroy()
})

it('applies a complete set together and ignores late images after disposal', async () => {
  const pending: ((texture: Texture<HTMLImageElement>) => void)[] = []
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, loaded) => {
    pending.push(loaded!)
    return new Texture<HTMLImageElement>()
  })
  const library = createMaterialLibrary()
  const fallback = new Texture<HTMLImageElement>()
  const material = new MeshStandardMaterial({ map: fallback })
  const mesh = new Mesh(undefined, material)
  mesh.userData.materialSlot = 'wood'
  const group = new Group().add(mesh)
  const records = [
    record(
      JSON.stringify({
        version: 'v1-material-set',
        kind: 'wood',
        widthPx: 2,
        heightPx: 2,
        maps: {
          baseColor: { assetId: id, colorSpace: 'srgb' },
          roughness: { assetId: id, colorSpace: 'linear', channel: 'g' },
        },
      }),
    ),
  ]
  const applied = library.apply(group, 'house', records)
  pending[0]!(new Texture<HTMLImageElement>())
  await Promise.resolve()
  expect(material.map).toBe(fallback)
  material.dispose()
  pending[1]!(new Texture<HTMLImageElement>())
  await applied
  expect(material.map).toBe(fallback)
  expect(material.roughnessMap).toBeNull()
  library.destroy()
})

it('ignores a pending material set when a later snapshot removes it', async () => {
  let loaded: ((texture: Texture<HTMLImageElement>) => void) | undefined
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((_url, callback) => {
    loaded = callback
    return new Texture<HTMLImageElement>()
  })
  const library = createMaterialLibrary()
  const material = new MeshStandardMaterial()
  const mesh = new Mesh(undefined, material)
  mesh.userData.materialSlot = 'wood'
  const group = new Group().add(mesh)
  const applied = library.apply(group, 'house', [
    record(
      JSON.stringify({
        version: 'v1-material-set',
        kind: 'wood',
        widthPx: 2,
        heightPx: 2,
        maps: { baseColor: { assetId: id, colorSpace: 'srgb' } },
      }),
    ),
  ])
  await library.apply(group, 'house', [])
  loaded!(new Texture<HTMLImageElement>())
  await applied
  expect(material.map).toBeNull()
  library.destroy()
})
