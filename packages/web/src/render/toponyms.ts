import { Container, Graphics } from 'pixi.js'
// the deep path, never the package root: @sj/engine's index reaches better-sqlite3
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { tileToScreen } from './iso.js'
import { LANDMARK_INK, LANDMARK_PLATE } from './legibility.js'
import type { Scene } from './scene.js'
import { faceFor, worldTextScale } from './textFaces.js'
import { placeTag, type Rect } from './tooltip.js'
import { createWorldLabel, type WorldLabel } from './worldLabel.js'

// The names the town coined for itself. A landmark name is the viewer's legend, derived from
// what is standing; a toponym is what somebody CARVED, kept verbatim, standing where they cut it.

export type Toponym = { id: string; name: string; x: number; y: number }

/** Every name cut into something that stands, in one order — so two calls agree. */
export function toponymsOf(state: WorldState | null): Toponym[] {
  const out: Toponym[] = []
  for (const s of Object.values(state?.structures ?? {})) {
    const text = s.inscription?.text.trim() ?? ''
    if (s.stage !== 'complete' || text === '') continue
    out.push({ id: s.id, name: text, x: s.x, y: s.y })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** A carved name is a thing you read when you are near it. It is whole at every stop from 0.5
 *  in and gone at the overview, so the layer is 1 or 0 at every resting `ZOOM_STOP` and never
 *  between — the same rule the place names are held to. */
const TOPONYM_FULL_SCALE = 0.5
const TOPONYM_GONE_SCALE = 0.25

export function toponymAlpha(scale: number): number {
  const out = (scale - TOPONYM_GONE_SCALE) / (TOPONYM_FULL_SCALE - TOPONYM_GONE_SCALE)
  return Math.min(1, Math.max(0, out))
}

/** The chrome type floor is 12px and a carved name is chrome. */
export const TOPONYM_LABEL_PX = faceFor('label').size

/** The ink the name is cut into, around the glyphs. */
export const TOPONYM_PAD_X = 4,
  TOPONYM_PAD_Y = 2

type Cut = { node: Container; plate: Graphics; face: WorldLabel; drawn: string; plateW: number }

/**
 * A cream name on a slab of ink — the landmark plate turned over, so a carved name reads as a
 * different kind of mark from a district's legend. It is a PLATE and not a glyph halo because
 * a halo is drawn in glyphs, and a glyph's own colour is the one channel this renderer is
 * measured to drop: see the open canvas-text defect in the stage 7 integration report.
 */
function cutName(text: string): Cut {
  const node = new Container()
  node.eventMode = 'none'
  const plate = new Graphics()
  plate.eventMode = 'none'
  const face = createWorldLabel(text, {
    fontFamily: faceFor('label').family,
    fontSize: TOPONYM_LABEL_PX,
    fill: LANDMARK_PLATE,
  })
  face.anchor.set(0.5, 0)
  face.eventMode = 'none'
  node.addChild(plate, face)
  return { node, plate, face, drawn: '', plateW: -1 }
}

/** The slab under one name, cut to what the glyphs actually measure. */
function drawPlate(cut: Cut): void {
  const w = cut.plateW,
    h = cut.face.height + TOPONYM_PAD_Y * 2
  cut.plate.clear()
  cut.plate.rect(-w / 2, -TOPONYM_PAD_Y, w, h)
  cut.plate.fill(LANDMARK_INK)
}

/** Do two boxes touch. */
const hits = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** How far a carved name may wander from the thing it is cut into: its own size. A name pinned
 *  to the edge of the screen by a subject that has left it is not a name of anywhere. */
const leashAt = (sx: number, sy: number, size: { w: number; h: number }): Rect => ({
  x: sx - size.w,
  y: sy - size.h,
  w: size.w * 2,
  h: size.h * 2,
})

export type ToponymLayer = { rebuild(): void; place(): void; destroy(): void }

/** `rebuild` reads the names off the world; `place` only fits them to the current camera. */
export function createToponymLayer(scene: Scene, store: WorldStore): ToponymLayer {
  const node = new Container()
  node.eventMode = 'none'
  scene.layers.overlay.addChild(node)
  const cuts = new Map<string, Cut>()
  /** One name as the last rebuild left it: unscaled size, and where it was carved. */
  type Built = { id: string; sx: number; sy: number; w: number; h: number }
  let built: Built[] = []

  function rebuild(): void {
    const seen = new Set<string>()
    built = []
    for (const m of toponymsOf(store.getState())) {
      seen.add(m.id)
      let cut = cuts.get(m.id)
      if (cut === undefined) {
        cut = cutName(m.name)
        node.addChild(cut.node)
        cuts.set(m.id, cut)
      }
      if (cut.drawn !== m.name) {
        cut.drawn = m.name
        cut.face.text = m.name
      }
      // A glyph measures 0 wide until its font atlas is up, so the slab is cut against the
      // MEASUREMENT and not against the words: the first frame's plate is not the last word.
      const w = cut.face.width + TOPONYM_PAD_X * 2
      if (cut.plateW !== w) {
        cut.plateW = w
        drawPlate(cut)
      }
      const at = tileToScreen(m.x, m.y)
      built.push({
        id: m.id,
        sx: at.sx,
        sy: at.sy,
        w,
        h: cut.face.height + TOPONYM_PAD_Y * 2,
      })
    }
    for (const [id, cut] of cuts) {
      if (seen.has(id)) continue
      cut.node.destroy({ children: true })
      cuts.delete(id)
    }
  }

  function place(): void {
    const alpha = toponymAlpha(scene.getZoom())
    node.visible = alpha > 0
    node.alpha = alpha
    if (!node.visible) {
      scene.tags.setOccupied('toponyms', [])
      return
    }
    // Each name holds a constant screen size while the town grows and shrinks under it.
    const inv = worldTextScale(scene.world.scale.x)
    const view = scene.viewRect()
    // Everybody else's boxes first, then this layer's own as they are put down.
    const avoid = scene.tags.occupied('toponyms')
    const mine: Rect[] = []
    for (const b of built) {
      const cut = cuts.get(b.id)
      if (cut === undefined) continue
      cut.node.scale.set(inv)
      const size = { w: b.w * inv, h: b.h * inv }
      const on =
        b.sx >= view.x - size.w &&
        b.sx <= view.x + view.w + size.w &&
        b.sy >= view.y - size.h &&
        b.sy <= view.y + view.h + size.h
      cut.node.visible = on
      if (!on) continue
      const at = placeTag({ sx: b.sx, sy: b.sy, halfW: size.w / 2, topY: b.sy }, size, view, [
        ...avoid,
        ...mine,
      ])
      const rect = { x: at.sx - size.w / 2, y: at.sy, w: size.w, h: size.h }
      // `placeTag` clamps into the view, so a name whose subject has left the screen would be
      // pinned to an edge with nothing under it. Off its leash, it is not drawn.
      if (!hits(rect, leashAt(b.sx, b.sy, size))) {
        cut.node.visible = false
        continue
      }
      cut.node.position.set(Math.round(at.sx), Math.round(at.sy + TOPONYM_PAD_Y * inv))
      mine.push(rect)
    }
    scene.tags.setOccupied('toponyms', mine)
  }

  return {
    rebuild,
    place,
    destroy: () => {
      scene.tags.setOccupied('toponyms', [])
      node.destroy({ children: true })
      cuts.clear()
    },
  }
}
