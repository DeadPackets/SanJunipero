import { BitmapText, Container, Graphics } from 'pixi.js'
import { BUBBLE_FILL, BUBBLE_INK } from './bubbles.js'
import { EMOTE_ABOVE_HEAD_PX } from './characters.js'
import type { Scene } from './scene.js'

export const TAG_FONT_PX = 9
export const TAG_LINE_H = 11
export const TAG_PAD_X = 5
export const TAG_PAD_Y = 3
export const TAG_MAX_CHARS = 48
// Under the speech bubbles (1e9) and over every world sprite: a tag never hides a line.
export const TAG_Z = 1e9 - 1

export type NameTagLayer = {
  show(text: string, sx: number, sy: number): void
  hide(): void
  destroy(): void
}

// ONE tag for the whole scene — the pointer is in one place, so only one thing is ever named.
// Structures, items and crops share it; characters keep their own per-sprite tag (C6 T13).
export function createNameTagLayer(scene: Scene): NameTagLayer {
  const node = new Container()
  node.visible = false
  node.eventMode = 'none' // the tag must never eat the click on the thing it names
  node.zIndex = TAG_Z
  const slab = new Graphics()
  const label = new BitmapText({
    text: '',
    style: { fontFamily: 'monospace', fontSize: TAG_FONT_PX, fill: BUBBLE_INK, lineHeight: TAG_LINE_H },
  })
  label.anchor.set(0.5, 1)
  node.addChild(slab, label)
  scene.entities.addChild(node)

  return {
    show(text, sx, sy) {
      const next = text.length > TAG_MAX_CHARS ? `${text.slice(0, TAG_MAX_CHARS - 1)}…` : text
      if (label.text !== next) {
        label.text = next
        slab.clear()
        slab.roundRect(
          -label.width / 2 - TAG_PAD_X, -label.height - TAG_PAD_Y,
          label.width + TAG_PAD_X * 2, label.height + TAG_PAD_Y * 2, 2,
        )
        slab.fill(BUBBLE_FILL)
        slab.stroke({ width: 1, color: BUBBLE_INK })
      }
      node.position.set(Math.round(sx), Math.round(sy - EMOTE_ABOVE_HEAD_PX))
      node.visible = true
    },
    hide() {
      node.visible = false
    },
    destroy() {
      node.destroy({ children: true })
    },
  }
}
