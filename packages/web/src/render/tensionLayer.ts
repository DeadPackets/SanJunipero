import { Container, Graphics } from 'pixi.js'
import type { WorldStore } from '../state/worldStore.js'
import type { SceneRingBounds } from './sceneRing.js'
import {
  TENSION_BAR_H,
  TENSION_BAR_W,
  TENSION_CARET_PX,
  TENSION_SPENT,
  TENSION_WARM,
} from './tension.js'

/** Clear of the floor's rim, and clear of each other. */
const LIFT_PX = 6
const GAP_PX = 3
/** The lane the bar fills. A bar that has collapsed to nothing still says whose it was. */
const TRACK_ALPHA = 0.3
const JOKE_W = 4
const JOKE_H = 2

export type TensionLayer = {
  tick(nowMs: number): void
  destroy(): void
}

/** What the layer asks of the scene handle. `Scene` satisfies it; a test needs no canvas. */
type TensionStage = {
  layers: { overlay: Container }
  /** the floor the bars stand over, so they can only be drawn where a scene is */
  bounds: () => SceneRingBounds | null
}

/** Who is pushing and who is folding, over the floor they are doing it on. Every pixel here is
 *  a move the world recorded: the layer draws what `tension.ts` folded and decides nothing. */
export function createTensionLayer(
  stage: TensionStage,
  store: Pick<WorldStore, 'tension'>,
): TensionLayer {
  const rim = new Graphics()
  const bars = new Graphics()
  rim.eventMode = 'none'
  bars.eventMode = 'none'
  stage.layers.overlay.addChild(rim, bars)

  const hide = (): void => {
    rim.clear()
    bars.clear()
    rim.visible = false
    bars.visible = false
  }

  return {
    tick(nowMs) {
      const floor = stage.bounds()
      if (floor === null) {
        hide()
        return
      }
      const row = store.tension.bars(floor.sceneId, nowMs)
      bars.clear()
      const foot = floor.sy - floor.ry - LIFT_PX
      for (const [i, bar] of row.entries()) {
        const w = TENSION_BAR_W * bar.scale
        const h = TENSION_BAR_H * bar.scale
        const y = foot - (row.length - 1 - i) * (TENSION_BAR_H + GAP_PX) - h
        const x = floor.sx - w / 2 + bar.dx
        bars.rect(x, y, w, h)
        bars.fill({ color: TENSION_SPENT, alpha: TRACK_ALPHA })
        const filled = w * bar.level
        if (filled > 0) {
          bars.rect(x, y, filled, h)
          bars.fill({ color: bar.colour })
        }
        if (bar.caret) {
          bars.rect(x + filled, y - 1, TENSION_CARET_PX, h + 2)
          bars.fill({ color: bar.colour })
        }
        if (bar.tickAbove) {
          bars.rect(floor.sx - JOKE_W / 2, y - JOKE_H - 1, JOKE_W, JOKE_H)
          bars.fill({ color: TENSION_WARM })
        }
      }
      bars.visible = row.length > 0
      const flash = store.tension.rimFlash(floor.sceneId, nowMs)
      rim.clear()
      if (flash > 0) {
        rim.ellipse(floor.sx, floor.sy, floor.rx, floor.ry)
        rim.stroke({ width: 1, color: TENSION_WARM, alpha: flash })
      }
      rim.visible = flash > 0
    },
    destroy() {
      rim.removeFromParent()
      bars.removeFromParent()
      rim.destroy()
      bars.destroy()
    },
  }
}
