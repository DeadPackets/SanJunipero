import { ColorMatrixFilter, Sprite, Texture } from 'pixi.js'
import { MINUTES_PER_DAY, simTimeFromTick } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { Scene } from './scene.js'
import { clockTint, gradingMatrix } from './tints.js'
import { crossTint } from '../ui/sceneTransition.js'
import { progress } from '../ui/motion.js'

export type Atmosphere = { update(state: WorldState): void; destroy(): void }

/**
 * DAYBREAK AND NIGHTFALL CROSS; THEY DO NOT STEP (U23, Task 91). `clockTint` interpolates by
 * the MINUTE, and a minute arrives once every 2.5 real seconds — so dawn used to walk across
 * the town in visible jumps. The quad now eases from the tint it was showing to the tint the
 * clock has just named, over `MOTION.ambient`, on the ticker rather than on the tick. v1
 * Task 5 owns the ramp; this owns the CROSSING.
 */
export function createAtmosphere(scene: Scene): Atmosphere {
  // the deep-blue night IS this multiply quad over the whole screen
  const quad = new Sprite(Texture.WHITE)
  quad.blendMode = 'multiply'
  quad.eventMode = 'none' // full-screen overlay must never swallow stage hit-tests
  scene.app.stage.addChild(quad)
  const filter = new ColorMatrixFilter()
  let filtered = false

  let fromTint = -1, toTint = -1, crossStartedMs = 0
  const cross = (): void => {
    if (fromTint < 0) return
    quad.tint = crossTint(fromTint, toTint, progress('ambient', crossStartedMs, scene.app.ticker.lastTime))
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
        fromTint = fromTint < 0 ? next : crossTint(fromTint, toTint, progress('ambient', crossStartedMs, nowMs))
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
