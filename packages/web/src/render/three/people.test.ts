import { expect, it } from 'vitest'
import type { Sprite } from 'pixi.js'
import { Mesh, MeshStandardMaterial, Scene } from 'three'
import { createPeople } from './people.js'

it('casts the visible character cutout, not the invisible picking capsule', () => {
  const scene = new Scene()
  const people = createPeople(scene)
  const sprite = {
    texture: {
      width: 32,
      frame: { x: 0, y: 0, width: 32, height: 48 },
      source: { resource: {}, width: 128, height: 192 },
    },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 1 },
    x: 0,
    y: 0,
    tint: 0xffffff,
  } as unknown as Sprite
  people.sync(['amara'], () => sprite)
  const casters = scene.children.filter((object) => object.castShadow) as Mesh[]
  expect(casters).toHaveLength(1)
  const material = casters[0]!.material as MeshStandardMaterial
  expect(material).toBeInstanceOf(MeshStandardMaterial)
  expect(material.map).not.toBeNull()
  expect(material.alphaTest).toBeGreaterThan(0)
  expect(people.pickables().every((object) => !object.castShadow)).toBe(true)
  people.destroy()
  expect(scene.children).toHaveLength(0)
})
