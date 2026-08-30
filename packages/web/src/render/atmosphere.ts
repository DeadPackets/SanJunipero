import { ColorMatrixFilter, Graphics, Sprite, Texture } from 'pixi.js'
import { MINUTES_PER_DAY } from '@sj/shared'
import type { TileId, WorldState } from '@sj/engine/state'
import { cameraBoundsOf } from './camera.js'
import { tileToScreen } from './iso.js'
import { bakeTexture } from './textures.js'
import type { Scene } from './scene.js'
import { clockTint, gradingMatrix, skyLevel } from './tints.js'
import { crossTint } from '../ui/sceneTransition.js'
import { progress } from '../ui/motion.js'

export type Atmosphere = { update(state: WorldState): void; destroy(): void }

/** The ceiling, reached at dawn and dusk when sky and ground differ most. */
export const SKY_MAX_ALPHA = 0.16
export const SKY_TEX_H = 64

export function skyAlpha(sky: number): number {
  return SKY_MAX_ALPHA * (0.35 + 0.65 * (1 - Math.abs(0.5 - sky) * 2))
}

/** A 1×64 vertical ramp, white at the top and clear at the bottom. The ONE texture in the
 *  renderer sampled linearly: a 64-step ramp stretched over a town would band at NEAREST. */
function skyTexture(scene: Scene): Texture {
  const tex = bakeTexture(scene, (g) => {
    for (let i = 0; i < SKY_TEX_H; i++)
      g.rect(0, i, 1, 1).fill({ color: 0xffffff, alpha: 1 - i / (SKY_TEX_H - 1) })
  })
  tex.source.scaleMode = 'linear'
  return tex
}

/** Cross-fades the day tint: `clockTint` steps once a sim minute, which arrives every 2.5 real
 *  seconds and reads as a jump. */
export function createAtmosphere(scene: Scene): Atmosphere {
  // the deep-blue night IS this multiply quad over the whole screen
  const quad = new Sprite(Texture.WHITE)
  quad.blendMode = 'multiply'
  quad.eventMode = 'none' // full-screen overlay must never swallow stage hit-tests
  scene.screen.night.addChild(quad)

  // Screened so the roofs catch it while the bases keep the ground's colour. Masked to the
  // map's own diamond: an unmasked box lightens the void and leaves a hard edge on it.
  const sky = new Sprite(skyTexture(scene))
  sky.blendMode = 'screen'
  sky.eventMode = 'none'
  sky.autoGarbageCollect = false
  const skyMask = new Graphics()
  sky.mask = skyMask
  scene.screen.lights.addChild(skyMask, sky)
  let maskedTerrain: TileId[][] | null = null
  const fitSky = (terrain: TileId[][]): void => {
    maskedTerrain = terrain
    const h = terrain.length
    const w = terrain[0]?.length ?? 0
    const corner = (x: number, y: number): number[] => {
      const { sx, sy } = tileToScreen(x, y)
      return [sx, sy]
    }
    skyMask.clear()
    skyMask
      .poly([...corner(0, 0), ...corner(w, 0), ...corner(w, h), ...corner(0, h)])
      .fill(0xffffff)
    const b = cameraBoundsOf(terrain)
    sky.position.set(b.minX, b.minY)
    sky.width = b.maxX - b.minX
    sky.height = b.maxY - b.minY
  }

  const filter = new ColorMatrixFilter()
  let filtered = false

  let fromTint = -1,
    toTint = -1,
    crossStartedMs = 0

  return {
    update(state) {
      quad.width = scene.app.screen.width
      quad.height = scene.app.screen.height
      const nowMs = scene.app.ticker.lastTime
      const minute = state.tick % MINUTES_PER_DAY
      const next = clockTint(minute)
      if (next !== toTint) {
        // leave from where the quad IS, so a tick arriving mid-cross continues rather than jumps
        fromTint =
          fromTint < 0
            ? next
            : crossTint(fromTint, toTint, progress('ambient', crossStartedMs, nowMs))
        toTint = next
        crossStartedMs = nowMs
      }
      quad.tint = crossTint(fromTint, toTint, progress('ambient', crossStartedMs, nowMs))

      if (state.terrain !== maskedTerrain) fitSky(state.terrain)
      sky.tint = quad.tint
      sky.alpha = skyAlpha(skyLevel(minute))

      const m = gradingMatrix(state.weather.kind)
      if (m !== null) {
        filter.matrix = Array.from(m) as ColorMatrixFilter['matrix']
        if (!filtered) {
          scene.graded.filters = [filter]
          filtered = true
        }
      } else if (filtered) {
        scene.graded.filters = []
        filtered = false
      }
    },
    destroy() {
      quad.destroy()
      skyMask.destroy()
      sky.destroy(true)
    },
  }
}
