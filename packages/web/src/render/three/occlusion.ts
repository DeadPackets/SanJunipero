import { Box3, Camera, Material, Mesh, Object3D, Raycaster, Vector2, Vector3 } from 'three'

type Fade = {
  group: Object3D
  materials: { material: Material; opacity: number }[]
  bounds: Box3
  opacity: number
  from: number
  target: number
  started: number
  blocked: number
}

export function createOcclusionFader(camera: Camera) {
  const entries = new Map<Object3D, Fade>()
  const ray = new Raycaster()
  const screen = new Vector3()
  const intersection = new Vector3()
  let time = 0
  let nextCheck = 0
  return {
    sync(groups: Object3D[]) {
      const live = new Set(groups)
      for (const [group, entry] of entries)
        if (!live.has(group)) {
          for (const m of entry.materials) m.material.opacity = m.opacity
          entries.delete(group)
        }
      for (const group of groups) {
        if (entries.has(group)) continue
        const materials = new Map<Material, number>()
        group.traverse((object) => {
          if (!(object instanceof Mesh)) return
          const mesh = object as Mesh
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (material.transparent && material.opacity < 0.95) continue
            material.transparent = true
            material.userData.solidOccluder = true
            materials.set(material, material.opacity)
          }
        })
        group.updateWorldMatrix(true, true)
        entries.set(group, {
          group,
          materials: [...materials].map(([material, opacity]) => ({ material, opacity })),
          bounds: new Box3().setFromObject(group),
          opacity: 1,
          from: 1,
          target: 1,
          started: 0,
          blocked: -10,
        })
      }
    },
    update(targets: Vector3[], dt: number) {
      time += Math.min(0.1, Math.max(0, dt))
      if (time >= nextCheck) {
        nextCheck = time + 0.075
        for (const target of targets) {
          screen.copy(target).project(camera)
          if (Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1 || Math.abs(screen.z) > 1) continue
          ray.setFromCamera(new Vector2(screen.x, screen.y), camera)
          ray.far = ray.ray.origin.distanceTo(target) - 0.025
          for (const entry of entries.values()) {
            if (entry.blocked === time || !entry.group.visible) continue
            const hit = ray.ray.intersectBox(entry.bounds, intersection)
            if (!hit || hit.distanceTo(ray.ray.origin) > ray.far) continue
            if (
              ray.intersectObject(entry.group, true).some((hit) => {
                for (let p: Object3D | null = hit.object; p; p = p.parent)
                  if (!p.visible) return false
                if (!(hit.object instanceof Mesh)) return false
                const mesh = hit.object as Mesh
                const material = Array.isArray(mesh.material)
                  ? mesh.material[hit.face?.materialIndex ?? 0]
                  : mesh.material
                return material?.visible && material.userData.solidOccluder === true
              })
            )
              entry.blocked = time
          }
        }
      }
      let faded = 0
      for (const entry of entries.values()) {
        const target = time - entry.blocked < 0.65 ? 0.24 : 1
        if (target !== entry.target) {
          entry.from = entry.opacity
          entry.target = target
          entry.started = time
        }
        const t = Math.min(1, (time - entry.started) / (target < 1 ? 0.6 : 0.8))
        entry.opacity = entry.from + (target - entry.from) * t * t * (3 - 2 * t)
        for (const m of entry.materials) m.material.opacity = m.opacity * entry.opacity
        if (entry.opacity < 0.99) faded++
      }
      return faded
    },
    destroy() {
      for (const entry of entries.values())
        for (const m of entry.materials) m.material.opacity = m.opacity
      entries.clear()
    },
  }
}
