import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import {
  type CellPoint,
  DEFAULT_CONFIG,
  type Flame,
  flamesAt,
  MINUTES_PER_DAY,
  type BuildingPoints,
} from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { hash32 } from './charAnim.js'
import { rectInView } from './cull.js'
import { entitySpriteOf } from './entities.js'
import { tileToScreen, TILE_W, TILE_H } from './iso.js'
import type { Scene } from './scene.js'
import { buildingArt } from './textures.js'
import { skyLevel } from './tints.js'

/**
 * Every light in the town, painted from `flamesAt` — the same walk `isDark` makes, so the
 * rendered dark and the queried dark cannot drift. All of it lives in `screen.lights`, ABOVE
 * the night multiply: a light drawn under the grade is darkened by the very thing it exists to
 * fight, and `#F7A66B` reached the glass as (115, 115, 160) — blue.
 *
 * Light comes only from a source the art shows lit (owner ruling 21): the pool on the ground,
 * a bloom on the painted lamp head or flame, a glow on a window painted lit. Never a door.
 */

export const POOL_COLOR = 0xf7a66b // MASTER_PALETTE: the one warm-light token
export const GLOW_COLOR = 0xf4e289
export const POOL_TEX_R = 64 // the radial texture's own radius, in texture px

/** Additive over a darkened ground is exactly when a pale shape shows most, so the pool lifts
 *  the ground back toward its day value and stops well short of white. */
export const POOL_MAX_ALPHA = 0.44
export const GLOW_BASE_ALPHA = 0.3
export const BLOOM_ALPHA = 0.5
export const FIRE_ALPHA = 0.62
/** world px: a lamp head's halo, and the halo of a lit window */
export const BLOOM_R = 22
export const WINDOW_R = 16

/** The breath the critique wrote for the fire; the pools and the glow take it rescaled to
 *  their own base, so the swing is proportionate at each light. */
export const BREATH_AMP = 0.06 + 0.035

/** Two incommensurate sines, phased by the light's own id: no two lamps agree, and none of
 *  them strobes. Bounded by `BREATH_AMP`; flat under reduced motion (the caller passes t = 0). */
export function breath(id: string, tSec: number): number {
  const p = ((hash32(id) % 1000) / 1000) * Math.PI * 2
  return (
    0.06 * Math.sin(2 * Math.PI * 1.7 * tSec + p) +
    0.035 * Math.sin(2 * Math.PI * 2.9 * tSec + 1.7 * p)
  )
}

export type LightPools = { tick(dtMs: number): void; destroy(): void; count(): number }

/** How much of a light to paint at this hour: the inverse of the ONE day clock the sky reads,
 *  so a lamp brightens as the sky darkens and never steps on an hour of its own. */
export function poolStrengthAt(tick: number): number {
  return 1 - skyLevel(tick % MINUTES_PER_DAY)
}

/** A chebyshev radius of `r` tiles is a square in tile space, which the 2:1 projection maps to
 *  a diamond; the ellipse inscribes it, which is what a pool of light does anyway. */
export function poolRadiusPx(radius: number): { rx: number; ry: number } {
  return { rx: (radius + 0.5) * TILE_W, ry: (radius + 0.5) * TILE_H }
}

/** The centre of a flame's footprint, in screen space. A long hearth pools from its middle. */
export function poolCentre(f: Flame): { sx: number; sy: number } {
  const { sx, sy } = tileToScreen(f.x + (f.w - 1) / 2, f.y + (f.h - 1) / 2)
  return { sx, sy: sy + TILE_H / 2 }
}

/** A manifest cell point, in the space the sprite stands in: read off the sprite the entity
 *  layer placed, so whatever anchor convention that layer applies, the light lands on the art.
 *  `null` until the art itself has landed — `Texture.EMPTY` is one pixel wide. */
export function cellPointOf(
  sprite: Pick<Sprite, 'x' | 'y' | 'anchor' | 'scale' | 'texture'>,
  pt: CellPoint,
): { sx: number; sy: number } | null {
  const { width, height } = sprite.texture
  if (width <= 1) return null
  return {
    sx: sprite.x + (pt.x - sprite.anchor.x * width) * sprite.scale.x,
    sy: sprite.y + (pt.y - sprite.anchor.y * height) * sprite.scale.y,
  }
}

/** A soft radial disc, authored ONCE and stretched per light. Rings rather than a gradient fill
 *  because pixi's `Graphics` has no radial stop; white, so one texture serves every hue. */
function poolTexture(scene: Scene): Texture {
  const g = new Graphics()
  const RINGS = 24
  for (let i = RINGS; i >= 1; i--) {
    const t = i / RINGS
    // squared falloff: bright core, long tail — an inverse-square flame, not a spotlight
    g.circle(POOL_TEX_R, POOL_TEX_R, POOL_TEX_R * t).fill({
      color: 0xffffff,
      alpha: ((1 - t) ** 2 / RINGS) * 6,
    })
  }
  return pin(scene.app.renderer.generateTexture({ target: g, resolution: 1 }), g)
}

/** Three stacked cells at the painted flame: a tongue, not a card. Drawn about the flame
 *  point, which sits in the middle cell. */
export const FLAME_CELLS: readonly [number, number, number, number][] = [
  [-3, 4, 6, 4],
  [-4, 0, 8, 5],
  [-3, -4, 6, 4],
]
function flameTexture(scene: Scene): Texture {
  const g = new Graphics()
  for (const [x, y, w, h] of FLAME_CELLS) g.rect(x + 4, y + 4, w, h)
  g.fill(POOL_COLOR)
  return pin(scene.app.renderer.generateTexture({ target: g, resolution: 1 }), g)
}

/** Pixi's `GCSystem` calls `unload()` on any resource with `autoGarbageCollect` that goes
 *  `maxUnusedTime` untouched, and an unloaded source is a null one that takes the stage down. */
function pin(tex: Texture, g: Graphics): Texture {
  tex.source.autoGarbageCollect = false
  g.destroy()
  return tex
}

type Lit = { pool: Sprite; bloom: Sprite | null; glow: Sprite | null }

export function createLightPools(scene: Scene, store: WorldStore): LightPools {
  const root = new Container()
  root.eventMode = 'none'
  scene.screen.lights.addChild(root)
  const tex = poolTexture(scene)
  const fireTex = flameTexture(scene)
  const lights = new Map<string, Lit>()
  const fires = new Map<string, Sprite>()
  /** the manifest points of every structure with art — rewritten when the world changes */
  const points = new Map<string, BuildingPoints>()
  const burning = new Set<string>()
  let synced: WorldState | null = null
  let syncedRecords: unknown = null
  const still = !scene.wantsMotion()
  let t = 0
  let drawn = 0

  const light = (tint: number, anchorY = 0.5): Sprite => {
    const s = new Sprite(tex)
    s.anchor.set(0.5, anchorY)
    s.tint = tint
    s.blendMode = 'add'
    s.eventMode = 'none'
    // `ViewContainer.autoGarbageCollect` defaults TRUE, and pixi's `GCSystem` unloads a
    // renderable not drawn for `gcMaxUnusedTime` — a pool hidden all day is exactly that.
    s.autoGarbageCollect = false
    root.addChild(s)
    return s
  }
  const drop = (s: Sprite | null): void => s?.destroy({ texture: false, textureSource: false })

  const sync = (state: WorldState): void => {
    const records = store.assetRecords()
    points.clear()
    burning.clear()
    for (const s of Object.values(state.structures)) {
      if (s.burning) burning.add(s.id)
      const p = buildingArt(records, s.kind, s.w, s.h, s.facing).points
      if (p !== null) points.set(s.id, p)
    }
    for (const id of burning) {
      if (fires.has(id)) continue
      const f = new Sprite(fireTex)
      f.anchor.set(0.5, 0.5)
      f.blendMode = 'add'
      f.eventMode = 'none'
      f.autoGarbageCollect = false
      root.addChild(f)
      fires.set(id, f)
    }
    for (const [id, f] of fires) {
      if (burning.has(id)) continue
      drop(f)
      fires.delete(id)
    }
  }

  /** Place a light on a cell point, or hide it while the art has not landed. */
  const place = (
    s: Sprite,
    sprite: Sprite | null,
    pt: CellPoint | undefined,
    r: number,
    alpha: number,
    view: ReturnType<Scene['viewRect']>,
  ): boolean => {
    const at = sprite === null || pt === undefined ? null : cellPointOf(sprite, pt)
    const seen =
      at !== null && alpha > 0 && rectInView(at.sx - r, at.sy - r, at.sx + r, at.sy + r, view)
    s.visible = seen
    if (!seen) return false
    s.position.set(at.sx, at.sy)
    s.width = r * 2
    s.height = r * 2
    s.alpha = alpha
    return true
  }

  return {
    tick(dtMs) {
      const state = store.getState()
      if (state === null) return
      if (!still) t += dtMs
      const records = store.assetRecords()
      if (state !== synced || records !== syncedRecords) {
        synced = state
        syncedRecords = records
        sync(state)
      }
      const tick = store.getTick()
      const strength = poolStrengthAt(tick)
      // `flamesAt` is asked every frame, INCLUDING by day: short-circuiting on `strength === 0`
      // destroyed every pool at sunrise and rebuilt it at dusk, which fed the texture GC.
      const flames = flamesAt(state, tick, store.getConfig() ?? DEFAULT_CONFIG)
      const view = scene.viewRect()
      const live = new Set<string>()
      const tSec = still ? 0 : t / 1000
      drawn = 0
      for (const f of flames) {
        live.add(f.id)
        let l = lights.get(f.id)
        if (l === undefined) {
          l = { pool: light(POOL_COLOR), bloom: null, glow: null }
          lights.set(f.id, l)
        }
        const b = still ? 0 : breath(f.id, tSec)
        const { rx, ry } = poolRadiusPx(f.radius)
        const { sx, sy } = poolCentre(f)
        // The pool is outside `applyDepthOrder` and cannot reorder anything — but it must still
        // not be drawn where nobody is looking.
        const seen = strength > 0 && rectInView(sx - rx, sy - ry, sx + rx, sy + ry, view)
        l.pool.visible = seen
        if (seen) {
          l.pool.position.set(sx, sy)
          l.pool.width = rx * 2
          l.pool.height = ry * 2
          l.pool.alpha = Math.max(
            0,
            Math.min(
              POOL_MAX_ALPHA,
              (POOL_MAX_ALPHA + (b * POOL_MAX_ALPHA) / FIRE_ALPHA) * strength,
            ),
          )
          drawn++
        }
        const pts = f.source === 'structure' ? points.get(f.id) : undefined
        if (pts === undefined) continue
        const sprite = entitySpriteOf(scene, 'structure', f.id)
        if (pts.flame !== undefined) {
          l.bloom ??= light(POOL_COLOR)
          if (place(l.bloom, sprite, pts.flame, BLOOM_R, (BLOOM_ALPHA + b) * strength, view))
            drawn++
        }
        if (pts.window !== undefined) {
          l.glow ??= light(GLOW_COLOR)
          if (
            place(l.glow, sprite, pts.window, WINDOW_R, (GLOW_BASE_ALPHA + 2 * b) * strength, view)
          )
            drawn++
        }
      }
      // Only a flame that has left the WORLD takes its light with it — a torch burnt to ash, a
      // lamp knocked down. Never one that merely went off screen or out of season.
      for (const [id, l] of lights) {
        if (live.has(id)) continue
        drop(l.pool)
        drop(l.bloom)
        drop(l.glow)
        lights.delete(id)
      }
      // A structure on fire burns by day too, on its painted flame or ten px over its feet.
      for (const [id, f] of fires) {
        const sprite = entitySpriteOf(scene, 'structure', id)
        const pt = points.get(id)?.flame
        const at =
          sprite === null
            ? null
            : ((pt === undefined ? null : cellPointOf(sprite, pt)) ?? {
                sx: sprite.x,
                sy: sprite.y - 10,
              })
        f.visible = at !== null && rectInView(at.sx - 4, at.sy - 8, at.sx + 4, at.sy + 8, view)
        if (!f.visible || at === null) continue
        f.position.set(at.sx, at.sy)
        f.alpha = FIRE_ALPHA + (still ? 0 : breath(id, tSec))
        drawn++
      }
    },
    count() {
      return drawn
    },
    destroy() {
      for (const l of lights.values()) {
        drop(l.pool)
        drop(l.bloom)
        drop(l.glow)
      }
      for (const f of fires.values()) drop(f)
      lights.clear()
      fires.clear()
      root.destroy()
      tex.destroy(true)
      fireTex.destroy(true)
    },
  }
}
