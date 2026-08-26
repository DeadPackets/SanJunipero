import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { DEFAULT_CONFIG, dayPhaseFromTick, flamesAt, type Flame } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { rectInView } from './cull.js'
import { tileToScreen, TILE_W, TILE_H } from './iso.js'
import type { Scene } from './scene.js'

/**
 * Painted from `flamesAt`, the same walk `isDark` makes, so the rendered dark and the queried
 * dark cannot drift: neither owns the fact.
 */

/**
 * A round pool of light, drawn on the ground — never a card stuck to a wall. The hue is
 * measured: under the deep-night multiply (0.45, 0.52, 0.95) honey `#F2C879` comes out
 * BLUE-dominant, and `#F7A66B` — already `FIRE_COLOR` — is the warm end that survives it.
 */
export const POOL_COLOR = 0xf7a66b        // MASTER_PALETTE, and `ambient.FIRE_COLOR`
export const POOL_TEX_R = 64              // the radial texture's own radius, in texture px

/** Additive over a darkened ground is exactly when a pale shape shows most, so the pool lifts
 *  the ground back toward its day value and stops well short of white. */
export const POOL_MAX_ALPHA = 0.44
export const POOL_DUSK_SCALE = 0.45       // dusk is 'dim', not 'dark': half a pool, not none
/** A flame breathes. Under `prefers-reduced-motion` it does not, and the pool holds at base. */
export const POOL_SWING = 0.06
export const POOL_HZ = 0.45

export type LightPools = { tick(dtMs: number): void; destroy(): void; count(): number }

/** How much of a pool to paint at this hour. Read off `dayPhaseFromTick`, the SAME function
 *  `lightBandAt` reads, so the picture brightens on the tick the query changes its word. */
export function poolStrengthAt(tick: number): number {
  const phase = dayPhaseFromTick(tick)
  if (phase === 'day') return 0
  return phase === 'dusk' ? POOL_DUSK_SCALE : 1
}

/** A chebyshev radius of `r` tiles is a square in tile space, which the 2:1 projection maps to
 *  a diamond; the ellipse inscribes it, which is what a pool of light does anyway. */
export function poolRadiusPx(radius: number): { rx: number; ry: number } {
  return { rx: (radius + 0.5) * TILE_W, ry: (radius + 0.5) * TILE_H }
}

/** The centre of a flame's footprint, in screen space. A long hearth pools from its middle. */
export function poolCentre(f: Flame): { sx: number; sy: number } {
  return tileToScreen(f.x + (f.w - 1) / 2, f.y + (f.h - 1) / 2)
}

/** A soft radial disc, authored ONCE and stretched per flame. Rings rather than a gradient fill
 *  because pixi's `Graphics` has no radial stop; one uploaded texture rather than a `Graphics`
 *  per frame, which would re-upload geometry for every lamp standing. */
function poolTexture(scene: Scene): Texture {
  const g = new Graphics()
  const RINGS = 24
  for (let i = RINGS; i >= 1; i--) {
    const t = i / RINGS
    // squared falloff: bright core, long tail — an inverse-square flame, not a spotlight
    g.circle(POOL_TEX_R, POOL_TEX_R, POOL_TEX_R * t).fill({ color: POOL_COLOR, alpha: (1 - t) ** 2 / RINGS * 6 })
  }
  const tex = scene.app.renderer.generateTexture({ target: g, resolution: 1 })
  // Pixi's `GCSystem` calls `unload()` on any resource with `autoGarbageCollect` that goes
  // `maxUnusedTime` untouched, and an unloaded source is a null one that takes the stage down.
  tex.source.autoGarbageCollect = false
  g.destroy()
  return tex
}

export function createLightPools(scene: Scene, store: WorldStore): LightPools {
  const root = new Container()
  root.eventMode = 'none'
  scene.layers.groundDecal.addChild(root)
  const tex = poolTexture(scene)
  const pools = new Map<string, Sprite>()
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  let t = 0
  let drawn = 0

  return {
    tick(dtMs) {
      const state = store.getState()
      if (state === null) return
      if (!still) t += dtMs
      const tick = store.getTick()
      const strength = poolStrengthAt(tick)
      // `flamesAt` is asked every frame, INCLUDING by day: short-circuiting on `strength === 0`
      // destroyed every pool at sunrise and rebuilt it at dusk, which fed the texture GC.
      const flames = flamesAt(state, tick, DEFAULT_CONFIG)
      const view = scene.viewRect()
      const live = new Set<string>()
      drawn = 0
      const breath = still ? 0 : POOL_SWING * Math.sin(2 * Math.PI * POOL_HZ * (t / 1000))
      for (const f of flames) {
        live.add(f.id)
        let s = pools.get(f.id)
        if (s === undefined) {
          s = new Sprite(tex)
          s.anchor.set(0.5, 0.5)
          s.blendMode = 'add'
          s.eventMode = 'none'
          // `ViewContainer.autoGarbageCollect` defaults TRUE, and pixi's `GCSystem` unloads a
          // renderable not drawn for `gcMaxUnusedTime` — a pool hidden all day is exactly that.
          s.autoGarbageCollect = false
          root.addChild(s)
          pools.set(f.id, s)
        }
        const { rx, ry } = poolRadiusPx(f.radius)
        const { sx, sy } = poolCentre(f)
        // The pool is a decoration on `groundDecal`, so it is outside `applyDepthOrder` and
        // cannot reorder anything — but it must still not be drawn where nobody is looking.
        const seen = strength > 0 && rectInView(sx - rx, sy - ry, sx + rx, sy + ry, view)
        s.visible = seen
        if (!seen) continue
        s.position.set(sx, sy)
        s.width = rx * 2
        s.height = ry * 2
        s.alpha = Math.max(0, Math.min(POOL_MAX_ALPHA, (POOL_MAX_ALPHA + breath) * strength))
        drawn++
      }
      // Only a flame that has left the WORLD takes its pool with it — a torch burnt to ash, a
      // lamp knocked down. Never one that merely went off screen or out of season.
      for (const [id, s] of pools) {
        if (live.has(id)) continue
        s.destroy({ texture: false, textureSource: false })
        pools.delete(id)
      }
    },
    count() {
      return drawn
    },
    destroy() {
      for (const s of pools.values()) s.destroy({ texture: false, textureSource: false })
      pools.clear()
      root.destroy()
      tex.destroy(true)
    },
  }
}
