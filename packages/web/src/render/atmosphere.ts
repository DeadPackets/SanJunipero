import { ColorMatrixFilter, Sprite, Texture } from 'pixi.js'
import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { Scene } from './scene.js'
import { clockTint, gradingMatrix } from './tints.js'

export type Atmosphere = { update(state: WorldState): void; destroy(): void }

export function createAtmosphere(scene: Scene): Atmosphere {
  // the deep-blue night IS this multiply quad over the whole screen
  const quad = new Sprite(Texture.WHITE)
  quad.blendMode = 'multiply'
  quad.eventMode = 'none' // full-screen overlay must never swallow stage hit-tests
  scene.app.stage.addChild(quad)
  const filter = new ColorMatrixFilter()
  let filtered = false

  return {
    update(state) {
      quad.width = scene.app.screen.width
      quad.height = scene.app.screen.height
      quad.tint = clockTint(state.tick % MINUTES_PER_DAY)
      const m = gradingMatrix(state.weather.kind, simTimeFromTick(state.tick).season)
      if (m !== null) {
        filter.matrix = Array.from(m) as ColorMatrixFilter['matrix']
        if (!filtered) {
          scene.world.filters = [filter]
          filtered = true
        }
      } else if (filtered) {
        scene.world.filters = []
        filtered = false
      }
    },
    destroy() {
      quad.destroy()
    },
  }
}
