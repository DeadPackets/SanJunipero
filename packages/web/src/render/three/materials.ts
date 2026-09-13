import { parseMaterialSetManifest, type AssetRecord } from '@sj/shared'
import {
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'

export function createMaterialLibrary() {
  const cache = new Map<string, Texture>()
  const loader = new TextureLoader()
  let disposed = false
  const load = (id: string, color: boolean): Texture => {
    const key = `${id}:${color ? 'srgb' : 'linear'}`
    const hit = cache.get(key)
    if (hit) return hit
    const texture = loader.load(
      `/assets/${id}.png`,
      (ready) => {
        if (disposed) ready.dispose()
      },
      undefined,
      () => undefined,
    )
    texture.colorSpace = color ? SRGBColorSpace : NoColorSpace
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.userData.shared = true
    cache.set(key, texture)
    return texture
  }
  return {
    apply(group: Object3D, kind: string, records: AssetRecord[]) {
      const ready = records.filter((r) => r.status === 'ready')
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const slot = object.userData.materialSlot as string | undefined
        if (!slot) return
        const record =
          ready.filter((r) => r.kind === `material:${kind}:${slot}`).at(-1) ??
          ready.filter((r) => r.kind === `material:${slot}`).at(-1)
        const manifest = parseMaterialSetManifest(record?.meta ?? null)
        if (
          !manifest ||
          Object.values(manifest.maps).some((map) => !ready.some((r) => r.id === map?.assetId))
        )
          return
        const maps = manifest.maps
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (!(material instanceof MeshStandardMaterial)) continue
          material.map = load(maps.baseColor.assetId, true)
          material.normalMap = maps.normal ? load(maps.normal.assetId, false) : null
          material.roughnessMap = maps.roughness ? load(maps.roughness.assetId, false) : null
          const windows = (group.userData.windows ??= []) as MeshStandardMaterial[]
          if (maps.emissive) {
            material.emissiveMap = load(maps.emissive.assetId, true)
            material.emissive.setHex(0xffffff)
            if (!windows.includes(material)) windows.push(material)
          } else {
            material.emissiveMap = null
            material.emissiveIntensity = 0
            const index = windows.indexOf(material)
            if (index >= 0) windows.splice(index, 1)
          }
          material.needsUpdate = true
        }
      })
    },
    destroy() {
      disposed = true
      for (const texture of cache.values()) texture.dispose()
      cache.clear()
    },
  }
}
