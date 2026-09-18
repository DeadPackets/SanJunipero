import {
  Box3,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import type { Structure } from '@sj/engine/state'
import { disposeGroup } from './dispose.js'

export function syncBuildingFire(
  group: Group,
  structure: Structure,
  seconds: number,
): Group | undefined {
  let fire = group.userData.buildingFire as Group | undefined
  if (!structure.burning || structure.kind === 'fire_pit') {
    if (fire) {
      disposeGroup(fire)
      delete group.userData.buildingFire
    }
    return
  }
  const span = Math.min(structure.w, structure.h)
  const height = Math.min(2.1, Math.max(1, span * 0.56))
  if (!fire) {
    fire = new Group()
    fire.name = 'building-fire'
    group.updateWorldMatrix(true, true)
    const roof = new Box3()
    group.traverse((part) => {
      if (part.name === 'roof-slope') roof.union(new Box3().setFromObject(part))
    })
    if (roof.isEmpty()) roof.setFromObject(group)
    const top = group.worldToLocal(new Vector3(0, roof.max.y, 0)).y
    fire.position.set(structure.w / 2, Math.max(0.15, top - height * 0.25), structure.h / 2)
    const flameGeometry = new ConeGeometry(1, 1, 5, 4).translate(0, 0.5, 0)
    const vertices = flameGeometry.getAttribute('position')
    const colors = new Float32Array(vertices.count * 3)
    const gold = new Color(0xffd066)
    const orange = new Color(0xf86418)
    const tint = new Color()
    for (let i = 0; i < vertices.count; i++) {
      const y = vertices.getY(i)
      const width = (0.65 + Math.sin(y * Math.PI) * 1.35) * (1 - y)
      vertices.setXYZ(
        i,
        vertices.getX(i) * width + y * y * 0.65,
        y,
        vertices.getZ(i) * width + Math.sin(y * Math.PI) * 0.12,
      )
      tint.copy(gold).lerp(orange, y)
      tint.toArray(colors, i * 3)
    }
    flameGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    flameGeometry.computeVertexNormals()
    const flameMaterial = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    })
    for (let i = 0; i < 9; i++) {
      const flame = new Mesh(flameGeometry, flameMaterial)
      flame.name = 'flame'
      const angle = (i / 8) * Math.PI * 2
      flame.position.set(
        i === 8 ? 0 : Math.sin(angle) * structure.w * 0.32,
        i === 8 ? 0 : -height * (0.08 + (i % 3) * 0.08),
        i === 8 ? 0 : Math.cos(angle) * structure.h * 0.32,
      )
      flame.scale.set(span * 0.13, 1, span * 0.13)
      flame.rotation.y = i * 2.4
      fire.add(flame)
    }
    const smokeGeometry = new IcosahedronGeometry(1, 0)
    for (let i = 0; i < 5; i++) {
      const smoke = new Mesh(
        smokeGeometry,
        new MeshStandardMaterial({
          color: 0x756f68,
          roughness: 1,
          flatShading: true,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        }),
      )
      smoke.name = 'smoke'
      fire.add(smoke)
    }
    group.add(fire)
    group.userData.buildingFire = fire
  }
  fire.children.forEach((part, i) => {
    if (part.name === 'flame') {
      part.scale.y = height * (0.8 + (i % 3) * 0.12 + Math.sin(seconds * 7 + i * 2.4) * 0.12)
      part.rotation.z = Math.sin(seconds * 3 + i * 1.7) * 0.12
      part.rotation.x = Math.cos(seconds * 2.5 + i) * 0.08
    } else {
      const rise = (seconds * 0.2 + (i - 9) / 5 + 0.1) % 1
      part.position.set(
        Math.sin(i * 2.4) * span * 0.16 + rise * height * 0.4,
        height * (0.65 + rise * 1.65),
        Math.cos(i * 2.4) * span * 0.16 + rise * height * 0.15,
      )
      part.scale.setScalar(height * (0.18 + rise * 0.32))
      ;((part as Mesh).material as MeshStandardMaterial).opacity = 0.38 * Math.sin(rise * Math.PI)
    }
  })
  return fire
}
