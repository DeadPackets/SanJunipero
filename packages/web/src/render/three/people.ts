import type { Sprite } from 'pixi.js'
import {
  CapsuleGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three'
import { WORLD_PX, CAMERA_ELEVATION } from './projection.js'
import { screenToTileF } from '../iso.js'
import { disposeGroup } from './dispose.js'

type Person = {
  mesh: Mesh<PlaneGeometry, MeshStandardMaterial>
  shadow: Mesh
  texture: Texture
  source: unknown
}
export function createPeople(scene: Scene) {
  const people = new Map<string, Person>()
  return {
    sync(ids: string[], spriteOf: (id: string) => Sprite | null) {
      const live = new Set(ids)
      const targets: Vector3[] = []
      for (const [id, person] of people)
        if (!live.has(id) || spriteOf(id) === null) {
          disposeGroup(person.mesh)
          disposeGroup(person.shadow)
          people.delete(id)
        }
      for (const id of ids) {
        const sprite = spriteOf(id)
        if (!sprite || sprite.texture.width <= 1) continue
        const resource: unknown = sprite.texture.source.resource
        if (!resource) continue
        let person = people.get(id)
        if (!person) {
          const texture = new Texture()
          texture.colorSpace = SRGBColorSpace
          texture.flipY = false
          texture.magFilter = NearestFilter
          const mesh = new Mesh(
            new PlaneGeometry(1, 1),
            new MeshStandardMaterial({
              map: texture,
              alphaTest: 0.45,
              side: DoubleSide,
              roughness: 1,
            }),
          )
          mesh.userData.pick = { kind: 'agent', id }
          mesh.rotation.y = Math.PI / 4
          const shadow = new Mesh(
            new CapsuleGeometry(0.2, 1.45, 4, 8),
            new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
          )
          shadow.castShadow = true
          shadow.userData.pick = { kind: 'agent', id }
          scene.add(mesh, shadow)
          person = { mesh, shadow, texture, source: null }
          people.set(id, person)
        }
        if (person.source !== resource) {
          person.texture.image = resource
          person.texture.needsUpdate = true
          person.source = resource
        }
        const frame = sprite.texture.frame
        const source = sprite.texture.source
        person.texture.repeat.set(frame.width / source.width, -frame.height / source.height)
        person.texture.offset.set(frame.x / source.width, (frame.y + frame.height) / source.height)
        const w = (frame.width * sprite.scale.x) / WORLD_PX
        const h = (frame.height * sprite.scale.y) / (WORLD_PX * Math.cos(CAMERA_ELEVATION))
        const ground = screenToTileF(sprite.x, sprite.y)
        const shift = ((0.5 - sprite.anchor.x) * w) / Math.SQRT2
        person.mesh.position.set(
          ground.x + shift,
          0.025 + (sprite.anchor.y - 0.5) * h,
          ground.y - shift,
        )
        person.mesh.scale.set(w, h, 1)
        person.mesh.material.color.setHex(sprite.tint)
        person.shadow.position.set(ground.x, 0.92, ground.y)
        person.mesh.updateMatrixWorld()
        targets.push(new Vector3(ground.x, 1.55, ground.y), new Vector3(ground.x, 0.85, ground.y))
      }
      return targets
    },
    pickables: () => [...people.values()].map((p) => p.shadow),
    destroy() {
      for (const p of people.values()) {
        disposeGroup(p.mesh)
        disposeGroup(p.shadow)
      }
      people.clear()
    },
  }
}
