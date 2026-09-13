import { Material, Mesh, Object3D, Texture } from 'three'

export function disposeGroup(group: Object3D): void {
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  group.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const mesh = object as Mesh
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      materials.add(material)
  })
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof Texture && value.userData.shared !== true) textures.add(value as Texture)
    material.dispose()
  }
  for (const texture of textures) texture.dispose()
  group.removeFromParent()
}
