import { ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { MINUTES_PER_DAY } from '@sj/shared'
import type { TileId, WorldState } from '@sj/engine/state'
import { boundsCentre, cameraBoundsOf } from './camera.js'
import { tileToScreen } from './iso.js'
import { bakeTexture } from './textures.js'
import type { Scene } from './scene.js'
import { clockTint, gradingMatrix, skyLevel, sunTint, weatherTransmit } from './tints.js'
import { crossTint } from '../ui/sceneTransition.js'
import { moonAltitude, sunLight, type SunLight } from '../ui/skyModel.js'
import { progress } from '../ui/motion.js'

export type Atmosphere = {
  update(state: WorldState): void
  /** the chain's last rung: the warm ramp goes and the sky, the moon and the ground stay */
  setSun(on: boolean): void
  destroy(): void
}

/** The ceiling, reached at dawn and dusk when sky and ground differ most. */
export const SKY_MAX_ALPHA = 0.16
export const SKY_TEX_H = 64

/** ★ The moon, cool where every other light in the town is warm — it is the one thing after
 *  dark that is not a fire, and the roofs have to be able to say so. */
export const MOON_COLOR = 0xcdd8ff
/** Screened over the deep-blue multiply, 0.14 lifts a roof clear of its own wall and leaves
 *  the ground it stands on where the night put it. */
export const MOON_MAX_ALPHA = 0.14

/** ★ THE SUN: warm light ADDED, never blue taken away. What it adds overhead, and what the
 *  golden band adds on top. A sun louder than `SKY_MAX_ALPHA` reads as a lens flare. */
export const SUN_ALPHA = 0.1
export const SUN_GOLDEN_ALPHA = 0.12

export function skyAlpha(sky: number): number {
  return SKY_MAX_ALPHA * (0.35 + 0.65 * (1 - Math.abs(0.5 - sky) * 2))
}

/** 0 every hour of the night, and 0 at the minute the sun touches the horizon at either end. */
export function sunAlpha(sun: SunLight): number {
  return SUN_ALPHA * sun.elevation + SUN_GOLDEN_ALPHA * sun.golden
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
  const plane = new Container()
  plane.eventMode = 'none'
  const skyMask = new Graphics()
  // ★ ONE mask on the group, never one per ramp: measured 5 draw calls a frame for the three
  // ramps against 11 when each of them carried the same mask itself.
  plane.mask = skyMask
  const sky = new Sprite(skyTexture(scene))
  sky.blendMode = 'screen'
  sky.autoGarbageCollect = false
  // The moon rides the same ramp over the same ground: one traveller, one curve, and the arc
  // over the town cannot disagree with the light on it.
  const moon = new Sprite(sky.texture)
  moon.blendMode = 'screen'
  moon.autoGarbageCollect = false
  moon.tint = MOON_COLOR
  // The same ramp again, turned to face wherever the sun is. One sprite and no render target:
  // the additive path already exists and this rides it.
  const sun = new Sprite(sky.texture)
  sun.blendMode = 'screen'
  sun.autoGarbageCollect = false
  sun.anchor.set(0.5)
  plane.addChild(sky, moon, sun)
  scene.screen.lights.addChild(skyMask, plane)
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
    for (const s of [sky, moon]) {
      s.position.set(b.minX, b.minY)
      s.width = b.maxX - b.minX
      s.height = b.maxY - b.minY
    }
    // Square on the diagonal, so no angle of the sun uncovers a corner of the ground.
    const c = boundsCentre(b)
    sun.position.set(c.sx, c.sy)
    const d = Math.hypot(b.maxX - b.minX, b.maxY - b.minY)
    sun.width = d
    sun.height = d
  }

  const filter = new ColorMatrixFilter()
  let sunOn = true
  let filtered = false
  let gradedKind: string | null = null
  let transmit = 1

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

      // The matrix is a pure function of the kind, and assigning it re-uploads the filter's
      // uniforms — so it is written when the weather turns, not on every frame of it.
      if (state.weather.kind !== gradedKind) {
        gradedKind = state.weather.kind
        transmit = weatherTransmit(gradedKind)
        const m = gradingMatrix(gradedKind)
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
      }

      // The grade multiplies the GROUND by the cloud deck and every light here sits outside it,
      // so the deck comes off the sky's own light by hand or a storm at midnight burns clear.
      sky.tint = quad.tint
      sky.alpha = skyAlpha(skyLevel(minute)) * transmit
      moon.alpha = MOON_MAX_ALPHA * moonAltitude(minute) * transmit
      moon.visible = moon.alpha > 0

      const sunAt = sunLight(minute)
      sun.alpha = sunAlpha(sunAt) * transmit
      sun.visible = sunOn && sun.alpha > 0
      if (sun.visible) {
        sun.tint = sunTint(minute)
        // the ramp is bright along its own -y, so this turns that edge onto the sun
        sun.rotation = Math.atan2(sunAt.x, sunAt.elevation)
      }
    },
    setSun(on) {
      sunOn = on
      if (!on) sun.visible = false
    },
    destroy() {
      quad.destroy()
      skyMask.destroy()
      sun.destroy()
      moon.destroy()
      sky.destroy(true)
      plane.destroy()
    },
  }
}
