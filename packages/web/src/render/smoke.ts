import type { AssetRecord } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { Graphics, Sprite, type Texture } from 'pixi.js'
import type { WorldStore } from '../state/worldStore.js'
import { HEARTH_KINDS, SMOKE_COLOR, SMOKE_MAX_ALPHA } from './ambient.js'
import { rectInView } from './cull.js'
import { feetOf } from './iso.js'
import type { Scene } from './scene.js'
import { BUILDING_PX_PER_TILE, facingCellKind, resolveAssetId } from './textures.js'
import { windNow } from './wind.js'

// Puffs are NEAREST textures on the integer grid, one per diameter, so "growing" is a texture
// swap and never a resample.

export const SMOKE_PUFFS = 5
export const SMOKE_LOOP_MS = 2400
export const SMOKE_RISE_PX = 26
const SMOKE_DRIFT_PX = 10
/** `scale = 0.7 + 0.9·prog` over a 6 px puff spans 4.2–9.6 px: these are its whole-pixel rungs,
 *  one per quarter of the puff's life. */
export const PUFF_DIAMETERS = [4, 6, 8, 10] as const
const REACH_PX = SMOKE_DRIFT_PX + PUFF_DIAMETERS[PUFF_DIAMETERS.length - 1]!
type PuffDiameter = (typeof PUFF_DIAMETERS)[number]

export type Puff = {
  alpha: number
  rung: number
  diameter: PuffDiameter
  rise: number
  drift: number
}

/** One puff at `prog` ∈ [0, 1) of its life, on wind `w` ∈ [-1, 1]. Pure — the test reads it. */
export function puffAt(prog: number, w: number): Puff {
  const rung = Math.min(PUFF_DIAMETERS.length - 1, Math.floor(prog * PUFF_DIAMETERS.length))
  return {
    alpha: SMOKE_MAX_ALPHA * Math.sin(Math.PI * prog),
    rung,
    diameter: PUFF_DIAMETERS[rung]!,
    rise: prog * SMOKE_RISE_PX,
    drift: w * SMOKE_DRIFT_PX * prog,
  }
}

/** Relative to its feet, in world px, or null for "no smoke". Read leniently off the manifest's
 *  own JSON, so a codex without `points.chimney` draws nothing rather than guessing. */
export function chimneyOf(
  records: AssetRecord[],
  kind: string,
  w: number,
  h: number,
  facing?: 'sw' | 'se',
): { dx: number; dy: number } | null {
  const id =
    resolveAssetId(records, 'building', facingCellKind(kind, facing)) ??
    resolveAssetId(records, 'building', kind)
  const meta = records.find((r) => r.id === id)?.meta ?? null
  if (meta === null) return null
  let m: {
    cell?: { w?: unknown; h?: unknown; feetX?: unknown; feetY?: unknown }
    points?: { chimney?: { x?: unknown; y?: unknown } }
  }
  try {
    m = JSON.parse(meta) as typeof m
  } catch {
    return null
  }
  const c = m.points?.chimney,
    cell = m.cell
  if (
    typeof c?.x !== 'number' ||
    typeof c.y !== 'number' ||
    typeof cell?.w !== 'number' ||
    typeof cell.h !== 'number' ||
    typeof cell.feetX !== 'number' ||
    typeof cell.feetY !== 'number'
  )
    return null
  const target = (w + h) * BUILDING_PX_PER_TILE
  const scale = Math.min(target / cell.w, target / cell.h)
  return { dx: (c.x - cell.feetX) * scale, dy: (c.y - cell.feetY) * scale }
}

type Hearth = { sx: number; sy: number; phase: number; puffs: Sprite[] }

export type SmokeLayer = {
  tick(dtMs: number): void
  counts(): { drawn: number; culled: number }
  destroy(): void
}

export function createSmoke(scene: Scene, store: WorldStore): SmokeLayer {
  /** one texture per rung, indexed like `PUFF_DIAMETERS` */
  const textures: Texture[] = PUFF_DIAMETERS.map((d) => {
    const g = new Graphics()
    g.circle(d / 2, d / 2, d / 2).fill(SMOKE_COLOR)
    const tex = scene.app.renderer.generateTexture({ target: g, resolution: 1 })
    tex.source.autoGarbageCollect = false // pixi's GCSystem unloads an untouched source — see lightPools
    g.destroy()
    return tex
  })
  const motion = scene.wantsMotion()
  const hearths = new Map<string, Hearth>()
  const free: Sprite[] = []
  let t = 0
  let seen: WorldState['structures'] | null = null
  let lastAssetsSeq = -1
  const counts = { drawn: 0, culled: 0 }
  /** a chimney depends on the kind, its plan and the codex — not on the structure */
  const chimneys = new Map<string, { dx: number; dy: number } | null>()

  const take = (): Sprite => {
    const s = free.pop() ?? new Sprite(textures[0])
    s.anchor.set(0.5, 0.5)
    s.eventMode = 'none'
    s.visible = true
    scene.layers.overhead.addChild(s)
    return s
  }
  const give = (s: Sprite): void => {
    s.visible = false
    scene.layers.overhead.removeChild(s)
    free.push(s)
  }

  const sync = (state: WorldState): void => {
    const records = store.assetRecords()
    const live = new Set<string>()
    for (const s of Object.values(state.structures)) {
      if (s.stage !== 'complete' || !HEARTH_KINDS.has(s.kind)) continue
      const key = `${s.kind}|${s.facing ?? ''}|${s.w}x${s.h}`
      let chimney = chimneys.get(key)
      if (chimney === undefined) {
        chimney = chimneyOf(records, s.kind, s.w, s.h, s.facing)
        chimneys.set(key, chimney)
      }
      if (chimney === null) continue
      live.add(s.id)
      const feet = feetOf(s.x, s.y, s.w, s.h)
      const at = { sx: feet.sx + chimney.dx, sy: feet.sy + chimney.dy }
      const h = hearths.get(s.id)
      if (h === undefined) {
        hearths.set(s.id, {
          ...at,
          phase: ((s.x * 7 + s.y * 13) % 100) / 100, // two chimneys never puff in step
          puffs: Array.from({ length: SMOKE_PUFFS }, take),
        })
      } else {
        h.sx = at.sx
        h.sy = at.sy
      }
    }
    for (const [id, h] of hearths) {
      if (live.has(id)) continue
      h.puffs.forEach(give)
      hearths.delete(id)
    }
  }

  return {
    tick(dtMs) {
      const state = store.getState()
      if (state === null) return
      const seq = store.assetsSeq()
      if (seq !== lastAssetsSeq) chimneys.clear()
      // the store folds a new state on every tick; the structures table changes far less often
      if (state.structures !== seen || seq !== lastAssetsSeq) {
        seen = state.structures
        lastAssetsSeq = seq
        sync(state)
      }
      if (motion) t += dtMs
      const w = windNow()
      const view = scene.viewRect()
      counts.drawn = 0
      counts.culled = 0
      for (const h of hearths.values()) {
        const inView = rectInView(
          h.sx - REACH_PX,
          h.sy - SMOKE_RISE_PX - REACH_PX,
          h.sx + REACH_PX,
          h.sy + REACH_PX,
          view,
          0,
        )
        if (!inView) {
          counts.culled += h.puffs.length
          for (const p of h.puffs) p.visible = false
          continue
        }
        counts.drawn += h.puffs.length
        for (let i = 0; i < h.puffs.length; i++) {
          const p = h.puffs[i]!
          const prog = (t / SMOKE_LOOP_MS + i / SMOKE_PUFFS + h.phase) % 1
          const puff = puffAt(prog, w)
          p.texture = textures[puff.rung]!
          p.alpha = puff.alpha
          p.position.set(Math.round(h.sx + puff.drift), Math.round(h.sy - puff.rise))
          p.visible = true
        }
      }
    },
    counts: () => ({ ...counts }),
    destroy() {
      for (const h of hearths.values()) for (const p of h.puffs) p.destroy()
      for (const p of free) p.destroy()
      for (const tex of textures) tex.destroy(true)
    },
  }
}
