import { Container, Graphics } from 'pixi.js'
import { WORLD_TEXT_LINE_H, WORLD_TEXT_PX } from '../textFloor.js'
import { WORLD_FONT_FAMILY, createWorldLabel } from './worldLabel.js'
import { tileToScreen } from './iso.js'
import { CHAR_TARGET_PX } from './charAnim.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'

export const SPEECH_MS_BASE = 2500
export const SPEECH_MS_PER_CHAR = 40
export const SPEECH_MAX_CHARS = 140
export const THOUGHT_ALPHA = 0.55 // wisps are dimmer — the dramatic-irony channel
export const WRAP_CHARS = 24
export const THOUGHT_DRIFT_PX = 2

export const BUBBLE_FILL = 0xfff6e9
export const BUBBLE_INK = 0x43394a
export const BUBBLE_FONT_PX = WORLD_TEXT_PX
export const BUBBLE_LINE_H = WORLD_TEXT_LINE_H

export function bubbleLife(text: string): number {
  return SPEECH_MS_BASE + SPEECH_MS_PER_CHAR * Math.min(text.length, SPEECH_MAX_CHARS)
}

export function wrapBubble(text: string, maxChars = WRAP_CHARS): string[] {
  const lines: string[] = []
  let line = ''
  for (const rawWord of text.split(/\s+/).filter((w) => w.length > 0)) {
    let word = rawWord
    while (word.length > maxChars) {
      if (line.length > 0) {
        lines.push(line)
        line = ''
      }
      lines.push(word.slice(0, maxChars))
      word = word.slice(maxChars)
    }
    if (word.length === 0) continue
    if (line.length === 0) line = word
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

export type BubbleLayer = {
  spawnSpeech(agentId: string, text: string): void
  spawnThought(agentId: string, text: string): void
  setSuppressed(v: boolean): void
  tick(nowMs: number): void
  destroy(): void
}

type Bubble = { agentId: string; node: Container; bornMs: number; dieMs: number; isThought: boolean }

export function createBubbleLayer(scene: Scene, store: WorldStore): BubbleLayer {
  const bubbles: Bubble[] = []
  let suppressed = false

  const build = (text: string, isThought: boolean): Container => {
    const node = new Container()
    node.eventMode = 'none' // bubbles float over heads — never block a character click
    const lines = wrapBubble(text.slice(0, SPEECH_MAX_CHARS))
    const label = createWorldLabel(lines.join('\n'), {
      fontFamily: WORLD_FONT_FAMILY, fontSize: BUBBLE_FONT_PX, fill: BUBBLE_INK,
      lineHeight: BUBBLE_LINE_H, align: 'left',
    })
    const w = Math.ceil(label.width) + 10
    const h = Math.ceil(label.height) + 8
    const g = new Graphics()
    g.roundRect(-w / 2, -h, w, h, 4)
    g.fill(BUBBLE_FILL)
    if (!isThought) {
      g.stroke({ width: 1, color: BUBBLE_INK })
      g.poly([-3, 0, 3, 0, 0, 4]) // tail triangle toward the speaker
      g.fill(BUBBLE_FILL)
    }
    label.position.set(-w / 2 + 5, -h + 4)
    node.addChild(g, label)
    if (isThought) node.alpha = THOUGHT_ALPHA
    return node
  }

  const spawn = (agentId: string, text: string, isThought: boolean): void => {
    if (isThought && suppressed) return // thought wisps stop under grave tone; speech is world fact
    const state = store.getState()
    if (state === null || state.agents[agentId] === undefined) return // visible agents only
    const now = performance.now()
    const node = build(text, isThought)
    scene.layers.bubbles.addChild(node)
    bubbles.push({ agentId, node, bornMs: now, dieMs: now + bubbleLife(text), isThought })
  }

  return {
    spawnSpeech: (agentId, text) => spawn(agentId, text, false),
    spawnThought: (agentId, text) => spawn(agentId, text, true),
    setSuppressed: (v) => {
      suppressed = v
      if (v) {
        for (let i = bubbles.length - 1; i >= 0; i--) {
          if (bubbles[i]!.isThought) {
            bubbles[i]!.node.destroy({ children: true })
            bubbles.splice(i, 1)
          }
        }
      }
    },
    tick: (nowMs) => {
      const state = store.getState()
      const boxes: Array<{ x: number; y: number; w: number; h: number }> = []
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]!
        const a = state?.agents[b.agentId]
        if (nowMs >= b.dieMs || a === undefined) {
          b.node.destroy({ children: true })
          bubbles.splice(i, 1)
          continue
        }
        const { sx, sy } = tileToScreen(a.x, a.y)
        const drift = b.isThought ? (THOUGHT_DRIFT_PX * (nowMs - b.bornMs)) / (b.dieMs - b.bornMs) : 0
        b.node.position.set(sx, sy - CHAR_TARGET_PX - 18 - drift)
        // audit M8: a tag and a bubble used to composite into an unreadable pile
        const w = b.node.width, h = b.node.height
        boxes.push({ x: b.node.position.x - w / 2, y: b.node.position.y - h, w, h })
      }
      scene.tags.setOccupied(boxes)
    },
    destroy: () => {
      for (const b of bubbles) b.node.destroy({ children: true })
      bubbles.length = 0
    },
  }
}
