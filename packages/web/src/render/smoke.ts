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

// U8: smoke that behaves like smoke. A puff is born faint at the chimney, swells as it rises,
// leans on the town's one wind and fades out — never a pop at full opacity (D13). Puffs are
// NEAREST textures on the integer grid, one per diameter, so "growing" is a texture swap and
// never a resample. Pooled, culled to the view (D21), still under reduced motion.

export const SMOKE_PUFFS = 5
export const SMOKE_LOOP_MS = 2400
export const SMOKE_RISE_PX = 26
const SMOKE_DRIFT_PX = 10
const PUFF_R = 3
/** `scale = 0.7 + 0.9·prog` over a 6 px puff spans 4.2–9.6 px: these are its whole-pixel rungs. */
export const PUFF_DIAMETERS = [4, 6, 8, 10] as const
type PuffDiameter = (typeof PUFF_DIAMETERS)[number]

export type Puff = { alpha: number; diameter: PuffDiameter; rise: number; drift: number }

/** One puff at `prog` ∈ [0, 1) of its life, on wind `w` ∈ [-1, 1]. Pure — the test reads it. */
export function puffAt(prog: number, w: number): Puff {
  const scale = 0.7 + 0.9 * prog
  const want = scale * PUFF_R * 2
  let diameter: PuffDiameter = PUFF_DIAMETERS[0]
  for (const d of PUFF_DIAMETERS) if (Math.abs(d - want) < Math.abs(diameter - want)) diameter = d
  return {
    alpha: SMOKE_MAX_ALPHA * Math.sin(Math.PI * prog),
    diameter,
    rise: prog * SMOKE_RISE_PX,
    drift: w * SMOKE_DRIFT_PX * prog,
  }
}

/** Where a kind's chimney is, relative to its feet, in world px — or null, which is "no
 *  smoke". Read leniently off the manifest's own JSON, so a codex without `points.chimney`
 *  (or one whose schema has not learned it yet) draws nothing rather than guessing. */
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
  /** how many puffs are drawn and how many the view let it skip — a cull nobody can count is a claim */
  counts(): { drawn: number; culled: number }
  destroy(): void
}

export function createSmoke(scene: Scene, store: WorldStore): SmokeLayer {
  const textures = new Map<PuffDiameter, Texture>()
  for (const d of PUFF_DIAMETERS) {
    const g = new Graphics()
    g.circle(d / 2, d / 2, d / 2).fill(SMOKE_COLOR)
    textures.set(d, scene.app.renderer.generateTexture({ target: g, resolution: 1 }))
    g.destroy()
  }
  const motion = scene.wantsMotion()
  const hearths = new Map<string, Hearth>()
  const free: Sprite[] = []
  let t = 0
  let seen: WorldState | null = null
  let lastAssetsSeq = -1
  let counts = { drawn: 0, culled: 0 }

  const take = (): Sprite => {
    const s = free.pop() ?? new Sprite(textures.get(PUFF_DIAMETERS[0]))
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
      const chimney = chimneyOf(records, s.kind, s.w, s.h, s.facing)
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
      if (state !== seen || seq !== lastAssetsSeq) {
        seen = state
        lastAssetsSeq = seq
        sync(state)
      }
      if (motion) t += dtMs
      const w = windNow()
      const view = scene.viewRect()
      counts = { drawn: 0, culled: 0 }
      for (const h of hearths.values()) {
        const reach = SMOKE_DRIFT_PX + PUFF_DIAMETERS[PUFF_DIAMETERS.length - 1]!
        const inView = rectInView(
          h.sx - reach,
          h.sy - SMOKE_RISE_PX - reach,
          h.sx + reach,
          h.sy + reach,
          view,
          0,
        )
        if (!inView) {
          counts.culled += h.puffs.length
          for (const p of h.puffs) p.visible = false
          continue
        }
        counts.drawn += h.puffs.length
        h.puffs.forEach((p, i) => {
          const prog = (t / SMOKE_LOOP_MS + i / SMOKE_PUFFS + h.phase) % 1
          const puff = puffAt(prog, w)
          p.texture = textures.get(puff.diameter)!
          p.alpha = puff.alpha
          p.position.set(Math.round(h.sx + puff.drift), Math.round(h.sy - puff.rise))
          p.visible = true
        })
      }
    },
    counts: () => counts,
    destroy() {
      for (const h of hearths.values()) for (const p of h.puffs) p.destroy()
      for (const p of free) p.destroy()
      for (const tex of textures.values()) tex.destroy(true)
    },
  }
}
