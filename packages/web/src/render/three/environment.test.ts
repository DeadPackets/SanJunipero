import { expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState } from '@sj/engine/state'
import { DirectionalLight, PointLight, Scene, Vector3 } from 'three'
import { createEnvironment } from './environment.js'

it('stops empty light shadow passes and resumes them as soon as a fire contributes', () => {
  const state = genesisState(DEFAULT_CONFIG)
  const scene = new Scene()
  const environment = createEnvironment(scene)
  const update = () => environment.update(state, DEFAULT_CONFIG, new Vector3(), 25, 0, 0.1, () => 2)
  update()
  const shadows = scene.children.filter(
    (light): light is PointLight => light instanceof PointLight && light.castShadow,
  )
  expect(shadows).toHaveLength(4)
  expect(shadows.every((light) => !light.shadow.autoUpdate)).toBe(true)
  expect(shadows.every((light) => light.shadow.needsUpdate)).toBe(true)
  state.structures.fire = {
    id: 'fire',
    kind: 'fire_pit',
    x: 1,
    y: 1,
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
    fueledUntilTick: 100,
  }
  state.tick++
  update()
  const fire = shadows.find((light) => light.intensity > 0)
  expect(fire).toBeDefined()
  expect(fire?.shadow.autoUpdate).toBe(true)
  delete state.structures.fire
  state.tick++
  update()
  expect(fire?.intensity).toBeGreaterThan(0)
  expect(fire?.shadow.autoUpdate).toBe(true)
  expect(shadows.filter((light) => light.shadow.autoUpdate)).toHaveLength(1)
  environment.destroy()
})

it('extinguishes expired street lamps without consuming the fixed local-light pool', () => {
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
  const streetLamp = scene.children.find(
    (light): light is PointLight => light instanceof PointLight && !lights.includes(light),
  )
  expect(streetLamp?.intensity).toBeGreaterThan(0)
  expect(lights.every((light) => light.intensity === 0)).toBe(true)
  for (let i = 0; i < 30; i++) update()
  const lamp = state.structures.lamp
  delete state.structures.lamp
  state.tick++
  environment.update(state, DEFAULT_CONFIG, center, 25, 0, 1 / 60, () => 2)
  expect(scene.children).not.toContain(streetLamp)
  expect(scene.children.filter((light) => light instanceof PointLight)).toEqual(lights)
  state.structures.lamp = lamp
  state.tick = 1401
  for (let i = 0; i < 30; i++) update()
  expect(
    scene.children.every((light) => !(light instanceof PointLight) || light.intensity < 0.01),
  ).toBe(true)
  environment.destroy()
  expect(scene.children).toHaveLength(0)
})

it('lights unlit streets with a cool, shadow-casting moon at midnight', () => {
  const state = genesisState(DEFAULT_CONFIG)
  state.tick = 0
  const scene = new Scene()
  const environment = createEnvironment(scene)
  environment.update(state, DEFAULT_CONFIG, new Vector3(20, 0, 20), 25, 0, 0.1, () => 2)
  const moon = scene.children.find(
    (light) => light instanceof DirectionalLight && light.intensity > 0 && light.castShadow,
  ) as DirectionalLight | undefined
  expect(moon).toBeDefined()
  expect(moon!.color.b).toBeGreaterThan(moon!.color.r)
  environment.destroy()
})

it('casts longer, warmer building shadows in the evening than at midday', () => {
  const state = genesisState(DEFAULT_CONFIG)
  state.weather.kind = 'clear'
  const scene = new Scene()
  const environment = createEnvironment(scene)
  const center = new Vector3(20, 0, 20)
  const direction = () => {
    const sun = scene.children.find((light) => light instanceof DirectionalLight)!
    const offset = sun.position.clone().sub(center)
    return { reach: Math.hypot(offset.x, offset.z) / offset.y, warm: sun.color.r / sun.color.b }
  }
  state.tick = 12 * 60
  environment.update(state, DEFAULT_CONFIG, center, 25, 0, 0.1, () => 2)
  const noon = direction()
  state.tick = 18 * 60 + 30
  environment.update(state, DEFAULT_CONFIG, center, 25, 0, 0.1, () => 2)
  const evening = direction()
  expect(evening.reach).toBeGreaterThan(noon.reach * 1.7)
  expect(evening.warm).toBeGreaterThan(noon.warm * 1.5)
  environment.destroy()
})

it('keeps a visible fire lit when eight closer lamps fill the light pool', () => {
  const state = genesisState(DEFAULT_CONFIG)
  state.tick = 0
  for (let i = 0; i < 9; i++) {
    const id = i === 8 ? 'fire' : `lamp-${i}`
    state.structures[id] = {
      id,
      kind: i === 8 ? 'fire_pit' : 'lamp_post',
      x: i === 8 ? 6 : Math.sin(i) * 2,
      y: i === 8 ? 0 : Math.cos(i) * 2,
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
      fueledUntilTick: 100,
    }
  }
  const scene = new Scene()
  const environment = createEnvironment(scene)
  environment.update(state, DEFAULT_CONFIG, new Vector3(), 25, 0, 0.1, () => 2)
  const fire = scene.children.find(
    (light) => light instanceof PointLight && light.position.x === 6.5 && light.intensity > 0,
  )
  expect(fire).toBeDefined()
  environment.destroy()
})
