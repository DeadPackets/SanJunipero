import { expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState } from '@sj/engine/state'
import { PointLight, Scene, Vector3 } from 'three'
import { createEnvironment } from './environment.js'

it('extinguishes expired lights and keeps a fixed local-light budget', () => {
  const state = genesisState(DEFAULT_CONFIG)
  state.tick = 1300
  state.structures.lamp = {
    id: 'lamp',
    kind: 'lamp_post',
    x: 4,
    y: 4,
    w: 1,
    h: 1,
    hp: 100,
    maxHp: 100,
    flammable: false,
    stage: 'complete',
    progressTicks: 0,
    builtBy: null,
    burning: false,
    burnTicks: 0,
  }
  const scene = new Scene()
  const environment = createEnvironment(scene)
  const center = new Vector3(4, 0, 4)
  const lights = scene.children.filter((c) => c instanceof PointLight)
  expect(lights).toHaveLength(8)
  const update = () => environment.update(state, DEFAULT_CONFIG, center, 25, 0, 0.1, () => 2)
  expect(update().active.size).toBe(0)
  expect(lights.every((l) => l.intensity === 0)).toBe(true)
  state.structures.lamp.fueledUntilTick = 1400
  state.tick++
  expect(update().active.has('lamp')).toBe(true)
  expect(lights.some((l) => l.intensity > 0)).toBe(true)
  state.tick = 1401
  for (let i = 0; i < 30; i++) update()
  expect(lights.every((l) => l.intensity < 0.01)).toBe(true)
  environment.destroy()
  expect(scene.children).toHaveLength(0)
})
