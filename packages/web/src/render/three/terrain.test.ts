import type { WorldState } from '@sj/engine/state'
import type { AssetRecord } from '@sj/shared'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createTerrain } from './terrain.js'

function world(width: number, height: number): WorldState {
  return {
    tick: 0,
    terrain: Array.from({ length: height }, () => Array.from({ length: width }, () => 0)),
    structures: {},
    agents: {},
    items: {},
    crops: {},
    weather: { kind: 'clear', temperatureC: 20 },
    wildlife: { fish: 0, deer: 0 },
    counters: { nextEntityId: 0 },
  }
}

describe('Three terrain', () => {
  it('composites aligned linear maps with neutral defaults and refreshes only ground textures', () => {
    const images: FakeImage[] = []
    class FakeImage {
      src = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        images.push(this)
      }
    }
    const ids = [1, 2, 3, 4].map(
      (n) =>
        `asset_${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`,
    )
    const maps = {
      baseColor: { assetId: ids[1], colorSpace: 'srgb' },
      normal: { assetId: ids[2], colorSpace: 'linear', convention: 'opengl' },
      roughness: { assetId: ids[3], colorSpace: 'linear', channel: 'g' },
    }
    const manifest = {
      version: 'v1-material-set',
      kind: 'grass',
      widthPx: 192,
      heightPx: 192,
      maps,
    }
    const records = ids.map((id, i) => ({
      id,
      seq: i + 1,
      class: i === 0 ? 'terrain' : 'item',
      kind: i === 0 ? 'material:grass' : null,
      status: 'ready',
      meta: i === 0 ? JSON.stringify(manifest) : null,
    })) as AssetRecord[]
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('document', {
      createElement: () => {
        let source = ''
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: (image: FakeImage) => {
              source = image.src
            },
            getImageData: () => {
              const pixel = source.includes(ids[2]!)
                ? [180, 128, 240, 255]
                : source.includes(ids[3]!)
                  ? [64, 64, 64, 255]
                  : [100, 110, 120, 255]
              const data = new Uint8ClampedArray(192 * 192 * 4)
              for (let i = 0; i < data.length; i += 4) data.set(pixel, i)
              return { data }
            },
          }),
        }
      },
    })
    const state = world(2, 1),
      scene = new THREE.Scene(),
      terrain = createTerrain(scene)
    state.terrain[0]![1] = 1
    try {
      terrain.sync(state, records)
      const root = scene.children[0]
      const ground = root!.children.find(
        (child) => child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh),
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      expect(ground.material.normalMap).toBeNull()
      expect(ground.material.roughnessMap).toBeNull()
      expect(images).toHaveLength(3)
      for (const image of images) image.onload?.()
      expect(scene.children[0]).toBe(root)
      const normal = ground.material.normalMap as THREE.DataTexture
      const roughness = ground.material.roughnessMap as THREE.DataTexture
      expect(normal.colorSpace).toBe(THREE.NoColorSpace)
      expect(roughness.colorSpace).toBe(THREE.NoColorSpace)
      expect(ground.material.normalScale.x).toBe(0.32)
      const offset = (12 * 48 + 12) * 4,
        fallback = (12 * 48 + 36) * 4
      if (!normal.image.data || !roughness.image.data) throw new Error('Missing map pixels')
      expect(Array.from(normal.image.data.slice(offset, offset + 3))).toEqual([180, 128, 240])
      expect(Array.from(normal.image.data.slice(fallback, fallback + 3))).toEqual([128, 128, 255])
      expect(roughness.image.data[offset + 1]).toBe(64)
      expect(roughness.image.data[fallback + 1]).toBe(255)
      let disposed = 0
      normal.addEventListener('dispose', () => {
        disposed++
      })
      roughness.addEventListener('dispose', () => {
        disposed++
      })
      records[0]!.meta = JSON.stringify({ ...manifest, maps: { baseColor: maps.baseColor } })
      terrain.sync(state, records)
      expect(scene.children[0]).toBe(root)
      expect(ground.material.normalMap).toBeNull()
      expect(ground.material.roughnessMap).toBeNull()
      expect(disposed).toBe(2)
    } finally {
      terrain.destroy()
      vi.unstubAllGlobals()
    }
  })

  it('reuses unchanged chunks, rebuilds the adjoining edge, and follows map growth', () => {
    const state = world(32, 16),
      scene = new THREE.Scene(),
      terrain = createTerrain(scene)
    terrain.sync(state, [])
    const initial = [...scene.children]
    terrain.sync(state, [])
    expect(scene.children).toEqual(initial)
    state.terrain[4]![15] = 7
    terrain.sync(state, [])
    expect(scene.children.every((child) => !initial.includes(child))).toBe(true)
    for (const row of state.terrain) row.push(...Array.from({ length: 16 }, () => 0 as const))
    terrain.sync(state, [])
    expect(scene.children).toHaveLength(3)
    for (const root of scene.children) {
      const mesh = root.children.find(
        (child) => child instanceof THREE.Mesh && !(child instanceof THREE.InstancedMesh),
      ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      const image = (mesh.material.map as THREE.DataTexture).image
      expect(image.width).toBeLessThanOrEqual(512)
      expect(image.height).toBeLessThanOrEqual(512)
    }
    terrain.destroy()
    expect(scene.children).toHaveLength(0)
  })

  it('keeps every canopy inside its own blocked tile and excludes occupied ground', () => {
    const state = world(4, 4),
      scene = new THREE.Scene(),
      terrain = createTerrain(scene)
    state.terrain[1]![1] = 3
    state.terrain[2]![2] = 9
    terrain.sync(state, [])
    expect(terrain.occluders()).toHaveLength(1)
    const canopy = terrain.occluders()[0]!.getObjectByName('Canopies') as THREE.InstancedMesh
    const matrix = new THREE.Matrix4(),
      bounds = new THREE.Box3()
    canopy.geometry.computeBoundingBox()
    for (let i = 0; i < canopy.count; i++) {
      canopy.getMatrixAt(i, matrix)
      bounds.copy(canopy.geometry.boundingBox!).applyMatrix4(matrix)
      const tile = i < 12 ? 1 : 2
      expect(bounds.min.x).toBeGreaterThan(tile + 0.04)
      expect(bounds.max.x).toBeLessThan(tile + 0.96)
      expect(bounds.min.z).toBeGreaterThan(tile + 0.04)
      expect(bounds.max.z).toBeLessThan(tile + 0.96)
    }
    state.structures.house = {
      id: 'house',
      kind: 'house',
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      hp: 100,
      maxHp: 100,
      flammable: false,
      stage: 'construction',
      progressTicks: 0,
      builtBy: null,
      burning: false,
      burnTicks: 0,
    }
    terrain.sync(state, [])
    expect(terrain.occluders()).toHaveLength(0)
    expect(scene.getObjectByName('Grass')).toBeUndefined()
    terrain.destroy()
  })

  it('lowers water without changing state and does not rebuild during weather or wind ticks', () => {
    const state = world(2, 2),
      scene = new THREE.Scene(),
      terrain = createTerrain(scene)
    state.terrain[0]![0] = 2
    state.terrain[1]![0] = 10
    state.terrain[0]![1] = 7
    state.terrain[1]![1] = 8
    const before = JSON.stringify(state)
    terrain.sync(state, [])
    expect(scene.getObjectByName('Grass')).toBeUndefined()
    const root = scene.children[0]!
    const ground = root.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh
    ground.geometry.computeBoundingBox()
    expect(ground.geometry.boundingBox!.min.y).toBeCloseTo(-0.065)
    terrain.tick(3, true, true)
    terrain.tick(4, false, false)
    expect(scene.children[0]).toBe(root)
    expect(JSON.stringify(state)).toBe(before)
    terrain.destroy()
  })
})
