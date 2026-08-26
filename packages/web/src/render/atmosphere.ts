import { ColorMatrixFilter, Sprite, Texture } from 'pixi.js'
import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { Scene } from './scene.js'
import { clockTint, gradingMatrix } from './tints.js'
import { crossTint } from '../ui/sceneTransition.js'
import { progress } from '../ui/motion.js'

export type Atmosphere = { update(state: WorldState): void; destroy(): void }

/** Cross-fades the day tint on the ticker: `clockTint` steps once a sim minute, which arrives every 2.5 real seconds and reads as a jump. */
export function createAtmosphere(scene: Scene): Atmosphere {
  // the deep-blue night IS this multiply quad over the whole screen
  const quad = new Sprite(Texture.WHITE)
  quad.blendMode = 'multiply'
  quad.eventMode = 'none' // full-screen overlay must never swallow stage hit-tests
  scene.app.stage.addChild(quad)
  const filter = new ColorMatrixFilter()
  let filtered = false

  let fromTint = -1,
    toTint = -1,
    crossStartedMs = 0
  const cross = (): void => {
    if (fromTint < 0) return
    quad.tint = crossTint(
      fromTint,
      toTint,
      progress('ambient', crossStartedMs, scene.app.ticker.lastTime),
    )
  }
  scene.app.ticker.add(cross)

  return {
    update(state) {
      quad.width = scene.app.screen.width
      quad.height = scene.app.screen.height
      const next = clockTint(state.tick % MINUTES_PER_DAY)
      if (next !== toTint) {
        const nowMs = scene.app.ticker.lastTime
        // leave from where the quad IS, so a tick arriving mid-cross continues rather than jumps
        fromTint =
          fromTint < 0
            ? next
            : crossTint(fromTint, toTint, progress('ambient', crossStartedMs, nowMs))
        toTint = next
        crossStartedMs = nowMs
      }
      cross()
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
      scene.app.ticker.remove(cross)
      quad.destroy()
    },
  }
}
