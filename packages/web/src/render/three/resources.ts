import type { AssetRecord } from '@sj/shared'
import { resolveAsset } from '../textures.js'
import type { WorldState } from '@sj/engine/state'
import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
  TextureLoader,
  PlaneGeometry,
  DoubleSide,
  SRGBColorSpace,
  NearestFilter,
} from 'three'
import { disposeGroup } from './dispose.js'

export function createResources(scene: Scene) {
  const entries = new Map<string, { key: string; group: Group }>()
  function put(id: string, key: string, x: number, z: number, build: () => Group) {
    let entry = entries.get(id)
    if (entry?.key !== key) {
      if (entry) disposeGroup(entry.group)
      const group = build()
      scene.add(group)
      entry = { group, key }
      entries.set(id, entry)
    }
    entry.group.position.set(x + 0.5, 0, z + 0.5)
  }
  const material = (color: number) => new MeshStandardMaterial({ color, roughness: 0.92 })
  const box = (
    group: Group,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
  ) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), material(color))
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  return {
    sync(state: WorldState, records: AssetRecord[]) {
      const live = new Set<string>()
      for (const crop of Object.values(state.crops)) {
        const id = `crop:${crop.id}`
        live.add(id)
        put(id, `${crop.stage}:${crop.withered}`, crop.x, crop.y, () => {
          const group = new Group()
          group.userData.pick = { kind: 'crop', id: crop.id }
          for (let i = 0; i < 5; i++) {
            const plant = new Mesh(
              new ConeGeometry(0.1 + crop.stage * 0.025, 0.18 + crop.stage * 0.15, 5),
              material(crop.withered ? 0x857d75 : 0x6b8d44),
            )
            plant.position.set(
              ((i % 3) - 1) * 0.21,
              0.1 + crop.stage * 0.075,
              (Math.floor(i / 3) - 0.5) * 0.3,
            )
            plant.castShadow = true
            group.add(plant)
          }
          return group
        })
      }
      for (const item of Object.values(state.items)) {
        if (item.loc.t !== 'tile') continue
        const id = `item:${item.id}`
        live.add(id)
        const art = resolveAsset(records, 'item', item.kind)
        put(id, `${item.kind}:${art?.id ?? ''}`, item.loc.x, item.loc.y, () => {
          const group = new Group()
          group.userData.pick = { kind: 'item', id: item.id }
          const wood = /wood|log|plank/.test(item.kind)
          box(
            group,
            0,
            0.13,
            0,
            wood ? 0.55 : 0.28,
            0.24,
            0.26,
            wood ? 0xa66e38 : /stone|iron|ore/.test(item.kind) ? 0x8b8c89 : 0xd9b477,
          )
          box(group, 0, 0.27, 0, 0.04, 0.03, 0.28, 0x6e5844)
          if (art) {
            const fallback = [...group.children]
            const texture = new TextureLoader().load(
              `/assets/${art.id}.png`,
              () => {
                if (!group.parent) {
                  texture.dispose()
                  return
                }
                for (const object of fallback) object.visible = false
                picture.visible = true
              },
              undefined,
              () => undefined,
            )
            texture.colorSpace = SRGBColorSpace
            texture.magFilter = NearestFilter
            const height = 1.05
            const picture = new Mesh(
              new PlaneGeometry((height * art.widthPx) / art.heightPx, height),
              new MeshStandardMaterial({
                map: texture,
                alphaTest: 0.45,
                side: DoubleSide,
                roughness: 1,
              }),
            )
            picture.rotation.y = Math.PI / 4
            picture.position.y = height / 2 + 0.02
            picture.visible = false
            picture.castShadow = true
            group.add(picture)
          }
          return group
        })
      }
      for (const [key, animal] of Object.entries(state.fauna ?? {})) {
        if (!animal.alive) continue
        const id = `fauna:${key}`
        live.add(id)
        put(id, animal.kind, animal.x, animal.y, () => {
          const group = new Group()
          if (animal.kind === 'fish') {
            const fish = new Mesh(new SphereGeometry(0.12, 6, 4), material(0x8babad))
            fish.scale.set(1, 0.35, 2)
            fish.position.y = 0.01
            group.add(fish)
          } else {
            const deer = animal.kind === 'deer'
            box(
              group,
              0,
              deer ? 0.42 : 0.12,
              0,
              deer ? 0.25 : 0.17,
              deer ? 0.3 : 0.17,
              deer ? 0.55 : 0.24,
              0xa38a6b,
            )
            box(group, 0, deer ? 0.66 : 0.22, -0.24, 0.17, 0.23, 0.2, 0xb6a38e)
            for (const x of [-0.09, 0.09])
              for (const z of [-0.17, 0.17]) box(group, x, 0.16, z, 0.04, 0.28, 0.04, 0x786550)
          }
          return group
        })
      }
      for (const [key, resource] of Object.entries(state.forageables ?? {})) {
        if (resource.stock <= 0) continue
        const id = `forage:${key}`
        live.add(id)
        put(id, resource.kind, resource.x, resource.y, () => {
          const group = new Group()
          const stone = /stone|clay|ore|iron/.test(resource.kind)
          for (let i = 0; i < 3; i++) {
            const mesh = new Mesh(
              new SphereGeometry(0.17 + i * 0.035, 6, 4),
              material(stone ? 0xaba198 : 0x69844b),
            )
            mesh.position.set((i - 1) * 0.15, 0.14, (i % 2) * 0.15)
            mesh.castShadow = true
            group.add(mesh)
          }
          return group
        })
      }
      for (const [id, entry] of entries)
        if (!live.has(id)) {
          disposeGroup(entry.group)
          entries.delete(id)
        }
    },
    pickables: () => [...entries.values()].map((e) => e.group),
    destroy() {
      for (const entry of entries.values()) disposeGroup(entry.group)
      entries.clear()
    },
  }
}
