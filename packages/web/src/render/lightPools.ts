import { Container, Sprite, type Texture } from 'pixi.js'
import {
  type BuildingPoints,
  type CellPoint,
  DEFAULT_CONFIG,
  type Flame,
  flamesAt,
  MINUTES_PER_DAY,
} from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { phaseOf } from './charAnim.js'
import { rectInView, type ViewRect } from './cull.js'
import { entitySpriteOf } from './entities.js'
import { feetOf, TILE_W, TILE_H } from './iso.js'
import type { Scene } from './scene.js'
import { bakeTexture, buildingArt, cellPointOf } from './textures.js'
import { skyLevel } from './tints.js'

// Every light lives in `screen.lights`, ABOVE the night multiply: under the grade `#F7A66B`
// reached the glass as (115, 115, 160) — blue. Light only where the art is painted lit.

export const POOL_COLOR = 0xf7a66b // MASTER_PALETTE: the one warm-light token
export const GLOW_COLOR = 0xf4e289
export const POOL_TEX_R = 64 // the radial texture's own radius, in texture px

/** Measured: at 0.44 a pair of posts washed the cottage wall behind them to (255,255,255);
 *  0.32 keeps it under 0.9. */
export const POOL_MAX_ALPHA = 0.32
export const GLOW_BASE_ALPHA = 0.3
/** Two heads at full breath must still sum under 1 of POOL_COLOR: 2 · (0.22 + BREATH_AMP) · core. */
export const BLOOM_ALPHA = 0.22
export const FIRE_ALPHA = 0.62
/** world px: a lamp head's halo, and the halo of a lit window */
export const BLOOM_R = 22
export const WINDOW_R = 16

/** Two incommensurate sines: no two lamps agree, and none of them strobes. Written for the
 *  fire's alpha; the pool takes it rescaled to its own base and the window glow doubled. */
const BREATH_SLOW = 0.06
const BREATH_FAST = 0.035
export const BREATH_AMP = BREATH_SLOW + BREATH_FAST

export function breath(phase: number, tSec: number): number {
  return (
    BREATH_SLOW * Math.sin(2 * Math.PI * 1.7 * tSec + phase) +
    BREATH_FAST * Math.sin(2 * Math.PI * 2.9 * tSec + 1.7 * phase)
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

/** The footprint's south vertex, the one anchor law: a lamp's pool sits under its plinth and a
 *  hearth's under the house's front wall. */
export function poolCentre(f: Flame): { sx: number; sy: number } {
  return feetOf(f.x, f.y, f.w, f.h)
}

/** A soft radial disc, authored ONCE and stretched per light. Rings rather than a gradient fill
 *  because pixi's `Graphics` has no radial stop; white, so one texture serves every hue. */
const POOL_RINGS = 24
/** Quartic falloff: the disc is stretched to the flame's whole reach (4.5 tiles for a lamp), so
 *  the visible pool must die well inside it — 0.27 of the core at 1.5 tiles, 0.11 at 2. */
const poolRingAlpha = (t: number): number => ((1 - t) ** 4 / POOL_RINGS) * 10

/** How opaque the baked disc is at `u` of its radius: the rings stack under normal blend. */
export function poolDiscAlpha(u: number): number {
  let clear = 1
  for (let i = POOL_RINGS; i >= 1; i--) {
    const t = i / POOL_RINGS
    if (t >= u) clear *= 1 - poolRingAlpha(t)
  }
  return 1 - clear
}

function poolTexture(scene: Scene): Texture {
  return bakeTexture(scene, (g) => {
    for (let i = POOL_RINGS; i >= 1; i--) {
      const t = i / POOL_RINGS
      g.circle(POOL_TEX_R, POOL_TEX_R, POOL_TEX_R * t).fill({
        color: 0xffffff,
        alpha: poolRingAlpha(t),
      })
    }
  })
}

/** Drawn about the flame point, which sits in the middle cell. */
export const FLAME_CELLS: readonly [number, number, number, number][] = [
  [-3, 4, 6, 4],
  [-4, 0, 8, 5],
  [-3, -4, 6, 4],
]
const FLAME_W = 8,
  FLAME_H = 12
const flameTexture = (scene: Scene): Texture =>
  bakeTexture(scene, (g) => {
    for (const [x, y, w, h] of FLAME_CELLS) g.rect(x + 4, y + 4, w, h)
    g.fill(POOL_COLOR)
  })

type Light = {
  pool: Sprite
  bloom: Sprite | null
  glow: Sprite | null
  phase: number
  sprite: Sprite | null
}
type Fire = { sprite: Sprite; phase: number; entity: Sprite | null }

export function createLightPools(scene: Scene, store: WorldStore): LightPools {
  const root = new Container()
  root.eventMode = 'none'
  scene.screen.lights.addChild(root)
  const tex = poolTexture(scene)
  const fireTex = flameTexture(scene)
  const lights = new Map<string, Light>()
  const fires = new Map<string, Fire>()
  /** the manifest points of every structure with art, keyed by id and rewritten only when the
   *  asset set changes — a manifest is parsed once, not once a sim tick */
  const points = new Map<string, { kind: string; points: BuildingPoints | null }>()
  let synced: WorldState | null = null
  // The codex array is mutated in place, so its identity never changes — the seq is the signal.
  let syncedAssets = -1
  const still = !scene.wantsMotion()
  let t = 0
  let drawn = 0

  const light = (texture: Texture, tint: number): Sprite => {
    const s = new Sprite(texture)
    s.anchor.set(0.5, 0.5)
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

  const entityOf = (id: string, held: Sprite | null): Sprite | null =>
    held !== null && !held.destroyed ? held : entitySpriteOf(scene, 'structure', id)

  const sync = (state: WorldState): void => {
    const records = store.assetRecords()
    if (store.assetsSeq() !== syncedAssets) points.clear()
    syncedAssets = store.assetsSeq()
    for (const s of Object.values(state.structures)) {
      if (points.get(s.id)?.kind !== s.kind)
        points.set(s.id, {
          kind: s.kind,
          points: buildingArt(records, s.kind, s.w, s.h, s.facing).points,
        })
      if (s.burning && !fires.has(s.id))
        fires.set(s.id, { sprite: light(fireTex, 0xffffff), phase: phaseOf(s.id), entity: null })
    }
    for (const [id, f] of fires) {
      if (state.structures[id]?.burning === true) continue
      drop(f.sprite)
      fires.delete(id)
    }
    for (const id of points.keys()) if (state.structures[id] === undefined) points.delete(id)
  }

  /** Place a light, or hide it: `at` is null while the art has not landed. */
  const place = (
    s: Sprite,
    at: { sx: number; sy: number } | null,
    rx: number,
    ry: number,
    alpha: number,
    view: ViewRect,
  ): void => {
    const seen =
      at !== null && alpha > 0 && rectInView(at.sx - rx, at.sy - ry, at.sx + rx, at.sy + ry, view)
    s.visible = seen
    if (!seen) return
    s.position.set(at.sx, at.sy)
    s.width = rx * 2
    s.height = ry * 2
    s.alpha = alpha
    drawn++
  }
  const pointOn = (sprite: Sprite | null, pt: CellPoint | undefined) =>
    sprite === null || pt === undefined ? null : cellPointOf(sprite, pt)

  return {
    tick(dtMs) {
      const state = store.getState()
      if (state === null) return
      if (!still) t += dtMs
      if (state !== synced || store.assetsSeq() !== syncedAssets) {
        synced = state
        sync(state)
      }
      const tick = store.getTick()
      const strength = poolStrengthAt(tick)
      // `flamesAt` is asked every frame, INCLUDING by day: short-circuiting on `strength === 0`
      // destroyed every pool at sunrise and rebuilt it at dusk, which fed the texture GC.
      const flames = flamesAt(state, tick, store.getConfig() ?? DEFAULT_CONFIG)
      const view = scene.viewRect()
      const live = new Set<string>()
      const tSec = t / 1000
      drawn = 0
      for (const f of flames) {
        live.add(f.id)
        let l = lights.get(f.id)
        if (l === undefined) {
          l = {
            pool: light(tex, POOL_COLOR),
            bloom: null,
            glow: null,
            phase: phaseOf(f.id),
            sprite: null,
          }
          lights.set(f.id, l)
        }
        if (strength === 0) {
          l.pool.visible = false
          if (l.bloom !== null) l.bloom.visible = false
          if (l.glow !== null) l.glow.visible = false
          continue
        }
        const b = still ? 0 : breath(l.phase, tSec)
        const { rx, ry } = poolRadiusPx(f.radius)
        // The pool is outside `applyDepthOrder` and cannot reorder anything — but it must still
        // not be drawn where nobody is looking.
        const poolAlpha = Math.min(
          POOL_MAX_ALPHA,
          (POOL_MAX_ALPHA + (b * POOL_MAX_ALPHA) / FIRE_ALPHA) * strength,
        )
        place(l.pool, poolCentre(f), rx, ry, poolAlpha, view)
        const pts = f.source === 'structure' ? points.get(f.id)?.points : undefined
        if (pts === undefined || pts === null) continue
        l.sprite = entityOf(f.id, l.sprite)
        if (pts.flame !== undefined) {
          l.bloom ??= light(tex, POOL_COLOR)
          place(
            l.bloom,
            pointOn(l.sprite, pts.flame),
            BLOOM_R,
            BLOOM_R,
            (BLOOM_ALPHA + b) * strength,
            view,
          )
        }
        if (pts.window !== undefined) {
          l.glow ??= light(tex, GLOW_COLOR)
          place(
            l.glow,
            pointOn(l.sprite, pts.window),
            WINDOW_R,
            WINDOW_R,
            (GLOW_BASE_ALPHA + 2 * b) * strength,
            view,
          )
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
        f.entity = entityOf(id, f.entity)
        const at =
          f.entity === null
            ? null
            : (pointOn(f.entity, points.get(id)?.points?.flame) ?? {
                sx: f.entity.x,
                sy: f.entity.y - 10,
              })
        place(
          f.sprite,
          at,
          FLAME_W / 2,
          FLAME_H / 2,
          FIRE_ALPHA + (still ? 0 : breath(f.phase, tSec)),
          view,
        )
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
      for (const f of fires.values()) drop(f.sprite)
      lights.clear()
      fires.clear()
      root.destroy()
      tex.destroy(true)
      fireTex.destroy(true)
    },
  }
}
