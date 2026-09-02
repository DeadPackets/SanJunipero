import { Container, Graphics } from 'pixi.js'
import { dayPhaseFromTick } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { phaseOf } from './charAnim.js'
import { windNow } from './wind.js'
import type { Scene } from './scene.js'

// ★ A TOWN THAT NOBODY IS MOVING STILL MOVES. At the overview stop a swaying crown is twelve
// pixels and a bird is one, so an unattended frame held still for minutes at a time. A cloud
// shadow is the cheapest thing that changes a whole picture: no art, one multiply, and the
// ground it crosses is the widest surface the town has.

/** Few enough that the ground is still the ground. */
export const CLOUD_COUNT = 4
/** How dark the ground goes under one. Any deeper and it reads as terrain rather than weather. */
export const CLOUD_ALPHA = 0.1
export const CLOUD_TINT = 0x241f2b // --deep, multiplied
/** World px a blob travels a second at full wind. A shadow crosses a 30-tile town in a minute. */
export const CLOUD_DRIFT_PX_PER_S = 26
/** How much wider than tall, in world px: the ground is a 2:1 dimetric plane. */
export const CLOUD_W = 260
export const CLOUD_H = 130
/** Past this a blob is behind the town and comes round the other side. */
export const CLOUD_WRAP_PX = 1400

/** Where blob `i` of `n` has drifted to after `driftPx` of wind, on its own lane and its own
 *  offset — pure, so a test can walk the wind forward and read the positions off. */
export function cloudAt(i: number, n: number, driftPx: number): { x: number; y: number } {
  const lane = phaseOf(`cloud:${i}`)
  const start = (i / n) * CLOUD_WRAP_PX
  const x = (((start + driftPx) % CLOUD_WRAP_PX) + CLOUD_WRAP_PX) % CLOUD_WRAP_PX - CLOUD_WRAP_PX / 2
  // The lane spreads them across the ground; the same hash keeps them there between frames.
  return { x, y: (lane / (Math.PI * 2)) * CLOUD_WRAP_PX - CLOUD_WRAP_PX / 2 }
}

/** Whether the sun is up to cast one at all. At night the ground is a blue wash and a darker
 *  patch on it is a stain, not a cloud. */
export function cloudsShown(tick: number): boolean {
  return dayPhaseFromTick(tick) !== 'night'
}

export type CloudLayer = { tick(dtMs: number): void; destroy(): void }

export function createClouds(scene: Scene, store: WorldStore): CloudLayer {
  const node = new Container()
  node.eventMode = 'none'
  node.alpha = CLOUD_ALPHA
  node.blendMode = 'multiply'
  scene.layers.groundDecal.addChild(node)

  const blobs: Graphics[] = []
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const g = new Graphics()
    g.ellipse(0, 0, CLOUD_W / 2, CLOUD_H / 2)
    g.fill(CLOUD_TINT)
    node.addChild(g)
    blobs.push(g)
  }

  // A viewer who asked for stillness gets the shadows where they are and no drift at all.
  const still = !scene.wantsMotion()
  let driftPx = 0

  return {
    tick: (dtMs) => {
      node.visible = cloudsShown(store.getTick())
      if (!node.visible) return
      if (!still) driftPx += (windNow() * CLOUD_DRIFT_PX_PER_S * dtMs) / 1000
      blobs.forEach((g, i) => {
        const at = cloudAt(i, CLOUD_COUNT, driftPx)
        g.position.set(at.x, at.y)
      })
    },
    destroy: () => {
      node.destroy({ children: true })
      blobs.length = 0
    },
  }
}
