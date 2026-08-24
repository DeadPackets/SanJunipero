import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { DEFAULT_CONFIG, dayPhaseFromTick, flamesAt, type Flame } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { rectInView } from './cull.js'
import { tileToScreen, TILE_W, TILE_H } from './iso.js'
import type { Scene } from './scene.js'

/**
 * ★ THE RENDERED DARK AND THE QUERIED DARK ARE NOW ONE ANSWER.
 *
 * `shared/light.ts` opens by saying it exists "so the engine's witness radius and C12's render
 * read the same function and can never disagree about what a night looks like". The render
 * never called it. Night was `atmosphere.ts` — one multiply quad over the whole screen, tinted
 * by the clock and knowing nothing about fire — while `isDark` walked the flames. A lit torch
 * changed a mind's world and changed nothing a viewer could see, and this project has a name
 * for two answers to one question: the plat ground calling a dry sand ford "water".
 *
 * This pass is the second consumer of `flamesAt`. Whatever `isDark` says is unlit is under the
 * quad; wherever it says a flame reaches, a pool of that flame's own radius is painted back.
 * The two cannot drift, because neither owns the fact.
 */

/**
 * A round pool of light, drawn on the ground — never a card stuck to a wall.
 *
 * ★ THE HUE IS A MEASUREMENT, NOT A TASTE, AND THE OBVIOUS CHOICE WAS WRONG. `atmosphere.ts`
 * lays a full-screen MULTIPLY quad over the whole stage, and at deep night its tint is
 * (0.45, 0.52, 0.95) — it keeps almost all of blue and less than half of red. So every colour
 * in the world is judged after that, this pool included, and honey `#F2C879` comes out
 * (109, 104, 115): BLUE-dominant. A lamp that reads cold is not relief. Measured across the
 * warm end of MASTER_PALETTE, `#F7A66B` survives it best — (111, 86, 102), the brightest of the
 * candidates and warm rather than cold — and it is already `FIRE_COLOR`, so the town has one
 * warm-light token rather than two. `lightPools.test.ts` pins the arithmetic.
 */
export const POOL_COLOR = 0xf7a66b        // MASTER_PALETTE, and `ambient.FIRE_COLOR`
export const POOL_TEX_R = 64              // the radial texture's own radius, in texture px

/**
 * ★ ADDITIVE OVER A DARKENED GROUND IS EXACTLY WHEN A PALE SHAPE SHOWS MOST — the same defect
 * `ambient.test.ts` pins for the window glow. The pool lifts the ground back toward its day
 * value and stops well short of white, so a lamp reads as relief and not as a hole in the map.
 */
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

/**
 * A flame's reach as an ellipse on the iso ground. A chebyshev radius of `r` tiles is a square
 * in tile space; `sx = (dx-dy)*16, sy = (dx+dy)*8` maps that square onto a diamond whose
 * half-width is `2r` steps of `TILE_W/2` and whose half-height is `2r` steps of `TILE_H/2`.
 * The ellipse inscribes it, which is what a pool of light does anyway — it has no corners.
 */
export function poolRadiusPx(radius: number): { rx: number; ry: number } {
  return { rx: (radius + 0.5) * TILE_W, ry: (radius + 0.5) * TILE_H }
}

/** The centre of a flame's footprint, in screen space. A long hearth pools from its middle. */
export function poolCentre(f: Flame): { sx: number; sy: number } {
  return tileToScreen(f.x + (f.w - 1) / 2, f.y + (f.h - 1) / 2)
}

/**
 * A soft radial disc, authored ONCE and stretched per flame. Rings rather than a gradient fill
 * because pixi's Graphics has no radial stop and a hard-edged disc reads as a plate.
 *
 * ★ ONE TEXTURE, NOT A GRAPHICS PER FRAME, AND THE MARGIN GROWS WITH THE TOWN. 128×128 RGBA is
 * 64 KB uploaded once for the life of the scene, whatever the town does; redrawing 24 rings per
 * flame every frame re-uploads geometry for every lamp standing, which at ring three is the
 * wrong side of the trade and gets worse as the lattice grows. Neither touches the ground bake:
 * that is the CHUNKED terrain field on `layers.ground`, where `MAX_TEXTURE_SIZE` 2048 is the
 * ceiling that fails between ring one and ring two. This is a 128 px sprite on `groundDecal`
 * and is not in that allocation — `lightPools.test.ts` pins that it never reaches for it.
 */
function poolTexture(scene: Scene): Texture {
  const g = new Graphics()
  const RINGS = 24
  for (let i = RINGS; i >= 1; i--) {
    const t = i / RINGS
    // squared falloff: bright core, long tail — an inverse-square flame, not a spotlight
    g.circle(POOL_TEX_R, POOL_TEX_R, POOL_TEX_R * t).fill({ color: POOL_COLOR, alpha: (1 - t) ** 2 / RINGS * 6 })
  }
  const tex = scene.app.renderer.generateTexture({ target: g, resolution: 1 })
  // ★ AND IT MUST NOT BE COLLECTED. Pixi's `GCSystem` calls `unload()` on any resource with
  // `autoGarbageCollect` that goes `maxUnusedTime` without being touched, and an unloaded source
  // is a null one: the whole stage went black with
  // `Cannot read properties of null (reading 'alphaMode')` out of `_buildInstructions`, the
  // first night a lamp stood. A texture this pass owns for the life of the scene is not the
  // GC's business — `TexturePool` sets the same flag on its own render textures for the same
  // reason. The sprite lifecycle below is the other half of the fix.
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
      // `flamesAt` is the one walk of the world that answers "what is alight" — the same call
      // `lightLevelAt` makes. The render has no config in its hands, which is the reason
      // `LIGHT_GLOW_RADIUS` exists next door; world defaults are the same authority.
      //
      // ★ ASKED EVERY FRAME, INCLUDING BY DAY. Short-circuiting on `strength === 0` looked free
      // and was the churn that fed the texture GC: every sunrise destroyed the whole pool and
      // every dusk built it again. A flame that is still burning keeps its sprite around the
      // clock and merely stops being visible, so nothing is created or destroyed on a clock
      // boundary and the GC has nothing to collect.
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
          // ★ AND THE SPRITE IS NOT THE GC'S BUSINESS EITHER, FOR THE SAME REASON THE TEXTURE
          // IS NOT. `ViewContainer.autoGarbageCollect` defaults TRUE, and pixi's `GCSystem`
          // unloads a RENDERABLE that goes `gcMaxUnusedTime` without being drawn — a pool
          // sitting at `visible = false` through a whole day is exactly that. It came back at
          // dusk with its GPU data unloaded and took the entire stage down with it. This pass
          // owns when a pool is created and when it dies, so nothing else may decide.
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
