import { Container, Graphics } from 'pixi.js'
import type { SceneKind } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { TILE_H, TILE_W } from './iso.js'

/** The rim ink per kind. Every one is a colour the town already paints with. */
const RING_INK: Readonly<Record<SceneKind, number>> = {
  talk: 0xaba198, // stone
  quarrel: 0xe8785a, // --ember
  council: 0x7fb0c9, // water
  gathering: 0xf2c879, // --honey
  telling: 0x93b573, // --sage
  invitation: 0xc47876, // --rose
}

const FADE_MS = 320
const FILL_ALPHA = 0.22

/** A tile of ground round the cast, on the ellipse that CIRCUMSCRIBES their box: the corner of
 *  a wide scene stands inside the floor instead of on its rim. */
const PAD_X = TILE_W
const PAD_Y = TILE_H

const easeOut = (t: number): number => 1 - (1 - t) ** 3

export type SceneRingBounds = {
  /** the scene the world holds this floor for, so a caller cannot dock against another one */
  sceneId: string
  sx: number
  sy: number
  rx: number
  ry: number
}

export type SceneRing = {
  tick(nowMs: number): void
  /** The floor the open scene stands on, in the space `tileToScreen` returns. It covers every
   *  member of the cast, and is null unless the map can place all of them. */
  bounds(): SceneRingBounds | null
  /** What the floor is painted at this frame, 0 through 0.22. */
  alpha(): number
  destroy(): void
}

/** What the ring asks of the scene handle. `Scene` satisfies it; a test does not need a canvas. */
type RingStage = {
  spatial?: boolean
  layers: { groundDecal: Container }
  pointOf: (kind: 'agent' | 'structure', id: string) => { sx: number; sy: number } | null
}

/** The floor under a conversation. It is drawn where the WORLD says a scene is open and nowhere
 *  else: two people standing close are not a scene, and the renderer never rules that they are. */
export function createSceneRing(stage: RingStage, store: Pick<WorldStore, 'shotScene'>): SceneRing {
  const g = new Graphics()
  g.eventMode = 'none'
  g.visible = false
  stage.layers.groundDecal.addChild(g)

  let held: { id: string; kind: SceneKind } | null = null
  let box: SceneRingBounds | null = null
  let drawn: { rx: number; ry: number; ink: number } | null = null
  let want = 0
  let from = 0
  let sinceMs = 0
  let k = 0

  const castBox = (id: string, cast: readonly string[]): SceneRingBounds | null => {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const who of cast) {
      const at = stage.pointOf('agent', who)
      // All of them or none: a floor round the one body the map can place says the opposite of
      // what a ring is for.
      if (at === null) return null
      minX = Math.min(minX, at.sx)
      maxX = Math.max(maxX, at.sx)
      minY = Math.min(minY, at.sy)
      maxY = Math.max(maxY, at.sy)
    }
    if (minX === Infinity) return null
    const hw = (maxX - minX) / 2
    const hh = (maxY - minY) / 2
    return {
      sceneId: id,
      sx: minX + hw,
      sy: minY + hh,
      rx: Math.round(hw * Math.SQRT2 + PAD_X),
      ry: Math.round(hh * Math.SQRT2 + PAD_Y),
    }
  }

  const paint = (b: SceneRingBounds, ink: number): void => {
    if (drawn?.rx !== b.rx || drawn.ry !== b.ry || drawn.ink !== ink) {
      g.clear()
      g.ellipse(0, 0, b.rx, b.ry)
      g.fill({ color: ink, alpha: FILL_ALPHA })
      g.stroke({ width: 1, color: ink })
      drawn = { rx: b.rx, ry: b.ry, ink }
    }
    g.position.set(b.sx, b.sy)
  }

  return {
    tick(nowMs) {
      const town = store.shotScene()
      const live = town?.open === true ? town : null
      if (live !== null) {
        if (held?.id !== live.id) {
          from = held === null ? k : 0
          sinceMs = nowMs
          want = 1
        }
        held = { id: live.id, kind: live.kind }
      } else if (want === 1) {
        from = k
        sinceMs = nowMs
        want = 0
      }
      k = from + (want - from) * easeOut(Math.min(1, (nowMs - sinceMs) / FADE_MS))
      if (held === null) return
      if (want === 0 && k <= 0) {
        held = null
        box = null
        g.visible = false
        return
      }
      if (live !== null) box = castBox(live.id, live.participants)
      if (box === null) {
        g.visible = false
        return
      }
      paint(box, RING_INK[held.kind])
      g.alpha = k
      g.visible = !stage.spatial
    },
    bounds: () => box,
    alpha: () => (g.visible ? k * FILL_ALPHA : 0),
    destroy() {
      g.removeFromParent()
      g.destroy()
    },
  }
}
