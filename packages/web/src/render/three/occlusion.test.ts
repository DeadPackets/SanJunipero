import { expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Vector3 } from 'three'
import { createOcclusionFader } from './occlusion.js'

it('holds occlusion and fades without changing depth writes or shader variants', () => {
  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const material = new MeshStandardMaterial()
  const group = new Group()
  group.add(new Mesh(new BoxGeometry(2, 2, 2), material))
  const fader = createOcclusionFader(camera)
  fader.sync([group])
  const version = material.version
  let before = 1
  for (let i = 0; i < 90; i++) {
    fader.update([new Vector3(0, 0, -2)], 1 / 60)
    expect(Math.abs(material.opacity - before)).toBeLessThan(0.04)
    expect(material.depthWrite).toBe(true)
    expect(material.transparent).toBe(true)
    expect(material.version).toBe(version)
    before = material.opacity
  }
  expect(material.opacity).toBeCloseTo(0.24)
  for (let i = 0; i < 20; i++) fader.update([], 1 / 60)
  expect(material.opacity).toBeCloseTo(0.24)
  for (let i = 0; i < 100; i++) fader.update([], 1 / 60)
  expect(material.opacity).toBe(1)
  fader.destroy()
})
