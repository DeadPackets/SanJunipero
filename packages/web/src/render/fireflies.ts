import { Container, Sprite, type Texture } from 'pixi.js'
import { MINUTES_PER_DAY, T_GRASS } from '@sj/shared'
import type { TileId } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { phaseOf } from './charAnim.js'
import { rectInView } from './cull.js'
import { feetOf } from './iso.js'
import type { Scene } from './scene.js'
import { bakeTexture } from './textures.js'
import { WEATHER_DIAG, skyLevel } from './tints.js'

// ★ THE ONE THING A CLEAR NIGHT HAS THAT A STORM DOES NOT. The town after dark was a blue wash
// with lamps in it; the grass between the houses said nothing about the weather at all.

export const FIREFLY_MAX = 90
const FIREFLY_COLOR = 0xf4e289 // the same warm token a lit window takes
export const FIREFLY_MAX_ALPHA = 0.7
const FIREFLY_PX = 2
/** world px of drift: a lantern's worth, so a firefly never leaves the tile it belongs to */
const DRIFT_RX = 11
const DRIFT_RY = 5
/** Two incommensurate blinks, both far under the 3 Hz photosensitive floor every other light
 *  in the renderer is held to. */
export const FIREFLY_BLINK_HZ: readonly [number, number] = [0.43, 0.61]
/** How far into the fall to night before the first one lifts. Dusk is a golden hour, not a
 *  meadow full of lights: at 0.5 the swarm arrives after the last of the sun has gone. */
export const FIREFLY_DUSK = 0.5

/** Clear is exactly the weather the picture is NOT graded for — one table, not a second list,
 *  so a kind added to the grade cannot forget to put the swarm away. */
export function isClearSky(weatherKind: string): boolean {
  return WEATHER_DIAG[weatherKind] === undefined
}

/** How much of the swarm is out: nothing by day, nothing under cloud, all of it at deep night. */
export function fireflyStrength(weatherKind: string, minuteOfDay: number): number {
  if (!isClearSky(weatherKind)) return 0
  const dark = 1 - skyLevel(minuteOfDay)
  return dark <= FIREFLY_DUSK ? 0 : (dark - FIREFLY_DUSK) / (1 - FIREFLY_DUSK)
}

export type FireflySeed = { x: number; y: number; phase: number }

/** The grass tiles the swarm hangs over, chosen by hash rather than by scan order — a scan that
 *  stops at the cap lights the north-west rows and leaves the southern meadow dark. */
export function fireflySeeds(terrain: TileId[][], cap: number): FireflySeed[] {
  const found: { x: number; y: number; h: number }[] = []
  for (let y = 0; y < terrain.length; y++)
    for (let x = 0; x < terrain[y]!.length; x++)
      if (terrain[y]![x] === T_GRASS)
        found.push({ x, y, h: (Math.imul(x, 2654435761) ^ Math.imul(y, 40503)) >>> 0 })
  found.sort((a, b) => a.h - b.h || a.y - b.y || a.x - b.x)
  return found.slice(0, cap).map(({ x, y }) => ({ x, y, phase: phaseOf(`${x},${y}`) }))
}

/** Where one firefly is, off the tile it belongs to. Two incommensurate sines per axis, so no
 *  two of them travel together and none of them runs a circle. */
export function fireflyDrift(phase: number, tSec: number): { dx: number; dy: number } {
  return {
    dx: DRIFT_RX * Math.sin(2 * Math.PI * 0.09 * tSec + phase),
    dy: DRIFT_RY * Math.sin(2 * Math.PI * 0.13 * tSec + 1.7 * phase),
  }
}

/** 0 to 1 and back, in the sharp pulse a firefly actually makes rather than a sine's long swell. */
export function fireflyBlink(phase: number, tSec: number): number {
  const [slow, fast] = FIREFLY_BLINK_HZ
  const a = Math.sin(2 * Math.PI * slow * tSec + phase)
  const b = Math.sin(2 * Math.PI * fast * tSec + 2.3 * phase)
  return Math.max(0, Math.max(a, b)) ** 3
}

export type FireflyLayer = { tick(dtMs: number): void; destroy(): void; count(): number }

const fireflyTexture = (scene: Scene): Texture =>
  bakeTexture(scene, (g) => {
    g.rect(0, 0, FIREFLY_PX, FIREFLY_PX).fill(0xffffff)
  })

export function createFireflies(scene: Scene, store: WorldStore): FireflyLayer {
  const root = new Container()
  root.eventMode = 'none'
  scene.screen.lights.addChild(root)
  const tex = fireflyTexture(scene)
  const still = !scene.wantsMotion()

  // The whole swarm, built once. Every frame after this only writes to these.
  const sprites: Sprite[] = []
  for (let i = 0; i < FIREFLY_MAX; i++) {
    const s = new Sprite(tex)
    s.anchor.set(0.5, 0.5)
    s.tint = FIREFLY_COLOR
    s.blendMode = 'add'
    s.eventMode = 'none'
    s.autoGarbageCollect = false
    s.visible = false
    root.addChild(s)
    sprites.push(s)
  }

  let seeds: FireflySeed[] = []
  let seeded: TileId[][] | null = null
  let t = 0
  let drawn = 0

  return {
    tick(dtMs) {
      const state = store.getState()
      if (state === null) return
      if (!still) t += dtMs
      if (state.terrain !== seeded) {
        seeded = state.terrain
        seeds = fireflySeeds(state.terrain, FIREFLY_MAX)
      }
      const strength = fireflyStrength(state.weather.kind, store.getTick() % MINUTES_PER_DAY)
      drawn = 0
      if (strength === 0) {
        for (const s of sprites) s.visible = false
        return
      }
      const view = scene.viewRect()
      const tSec = t / 1000
      for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i]!
        const seed = seeds[i]
        if (seed === undefined) {
          s.visible = false
          continue
        }
        const { sx, sy } = feetOf(seed.x, seed.y)
        const d = fireflyDrift(seed.phase, tSec)
        const x = sx + d.dx
        const y = sy + d.dy - DRIFT_RY * 2
        const seen = rectInView(
          x - FIREFLY_PX,
          y - FIREFLY_PX,
          x + FIREFLY_PX,
          y + FIREFLY_PX,
          view,
        )
        s.visible = seen
        if (!seen) continue
        s.position.set(x, y)
        s.alpha = FIREFLY_MAX_ALPHA * strength * fireflyBlink(seed.phase, tSec)
        drawn++
      }
    },
    count() {
      return drawn
    },
    destroy() {
      root.destroy({ children: true })
      tex.destroy(true)
    },
  }
}
