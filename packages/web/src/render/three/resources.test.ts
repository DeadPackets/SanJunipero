import { expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { genesisState } from '@sj/engine/state'
import { Scene } from 'three'
import { createResources } from './resources.js'

it('keeps fauna in the simulation without drawing it or adding pick targets', () => {
  const state = genesisState(DEFAULT_CONFIG)
  state.fauna = { deer: { kind: 'deer', x: 3, y: 4, alive: true } }
  const scene = new Scene()
  const resources = createResources(scene)
  resources.sync(state, [])
  expect(scene.children).toHaveLength(0)
  expect(resources.pickables()).toHaveLength(0)
  expect(state.fauna.deer).toEqual({ kind: 'deer', x: 3, y: 4, alive: true })
  resources.destroy()
})
