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
  const cache = new Map<string, Promise<Texture | null>>()
  const textures = new Set<Texture>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const pendingLoads = new Set<() => void>()
  const requests = new WeakMap<MeshStandardMaterial, symbol>()
  const versions = new WeakMap<Object3D, symbol>()
  const loader = new TextureLoader()
  let disposed = false
  const load = (id: string, color: boolean): Promise<Texture | null> => {
    const key = `${id}:${color ? 'srgb' : 'linear'}`
    const hit = cache.get(key)
    if (hit) return hit
    const pending = new Promise<Texture | null>((resolve) => {
      const finish = (texture: Texture | null) => {
        pendingLoads.delete(cancel)
        resolve(texture)
      }
      const cancel = () => {
        finish(null)
      }
      pendingLoads.add(cancel)
      const attempt = (number: number) => {
        loader.load(
          `/assets/${id}.png`,
          (texture) => {
            if (disposed) {
              texture.dispose()
              finish(null)
              return
            }
            texture.colorSpace = color ? SRGBColorSpace : NoColorSpace
            texture.wrapS = texture.wrapT = RepeatWrapping
            texture.userData.shared = true
            textures.add(texture)
            finish(texture)
          },
          undefined,
          () => {
            if (disposed || number >= 2) {
              finish(null)
              return
            }
            const timer = setTimeout(
              () => {
                timers.delete(timer)
                attempt(number + 1)
              },
              number === 0 ? 1000 : 4000,
            )
            timers.add(timer)
          },
        )
      }
      attempt(0)
    }).then((texture) => {
      if (!texture) cache.delete(key)
      return texture
    })
    cache.set(key, pending)
    return pending
  }
  return {
    async apply(group: Object3D, kind: string, records: AssetRecord[]) {
      if (disposed) return
      const version = Symbol()
      versions.set(group, version)
      const ready = records.filter((r) => r.status === 'ready')
      const jobs: Promise<void>[] = []
      const seen = new Set<MeshStandardMaterial>()
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
          if (!(material instanceof MeshStandardMaterial) || seen.has(material)) continue
          seen.add(material)
          const request = Symbol()
          requests.set(material, request)
          const cancel = () => requests.delete(material)
          material.addEventListener('dispose', cancel)
          jobs.push(
            Promise.all([
              load(maps.baseColor.assetId, true),
              maps.normal ? load(maps.normal.assetId, false) : null,
              maps.roughness ? load(maps.roughness.assetId, false) : null,
              maps.emissive ? load(maps.emissive.assetId, true) : null,
            ])
              .then(([baseColor, normal, roughness, emissive]) => {
                if (
                  disposed ||
                  versions.get(group) !== version ||
                  requests.get(material) !== request ||
                  !baseColor ||
                  (maps.normal && !normal) ||
                  (maps.roughness && !roughness) ||
                  (maps.emissive && !emissive)
                )
                  return
                const previous = [
                  material.map,
                  material.normalMap,
                  material.roughnessMap,
                  material.emissiveMap,
                ]
                material.color.setHex(
                  (material.userData.baseColorTint as number | undefined) ?? 0xffffff,
                )
                material.normalScale.set(0.45, 0.45)
                material.map = baseColor
                material.normalMap = normal
                material.roughnessMap = roughness
                material.emissiveMap = emissive
                const windows = (group.userData.windows ??= []) as MeshStandardMaterial[]
                if (emissive) {
                  material.emissive.setHex(0xffffff)
                  if (!windows.includes(material)) windows.push(material)
                } else {
                  material.emissiveIntensity = 0
                  const index = windows.indexOf(material)
                  if (index >= 0) windows.splice(index, 1)
                }
                for (const texture of new Set(previous))
                  if (
                    texture &&
                    texture.userData.shared !== true &&
                    ![baseColor, normal, roughness, emissive, material.bumpMap].includes(texture)
                  )
                    texture.dispose()
                material.needsUpdate = true
              })
              .finally(() => {
                material.removeEventListener('dispose', cancel)
              }),
          )
        }
      })
      await Promise.all(jobs)
    },
    destroy() {
      disposed = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      for (const cancel of pendingLoads) cancel()
      pendingLoads.clear()
      for (const texture of textures) texture.dispose()
      textures.clear()
      cache.clear()
    },
  }
}
