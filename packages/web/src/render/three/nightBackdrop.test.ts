import { expect, it } from 'vitest'
import { Scene } from 'three'
import { createNightBackdrop } from './nightBackdrop.js'

it('fades cloud cover and resolves time jumps without leaving stars in daylight', () => {
  const scene = new Scene()
  const backdrop = createNightBackdrop(scene)
  const mesh = scene.children[0]!
  backdrop.update(1380, 0, 'clear', 1 / 60, true, 2)
  expect(mesh.visible).toBe(true)
  backdrop.update(1380, 0, 'storm', 1 / 60, true, 2)
  expect(mesh.visible).toBe(true)
  for (let i = 0; i < 600; i++) backdrop.update(1380, 0, 'storm', 1 / 30, true, 2)
  expect(mesh.visible).toBe(false)
  backdrop.update(720, 1, 'clear', 1 / 60, true, 2)
  expect(mesh.visible).toBe(false)
  backdrop.update(0, 0, 'clear', 1 / 60, false, 2)
  expect(mesh.visible).toBe(true)
  backdrop.destroy()
  expect(scene.children).toHaveLength(0)
})
