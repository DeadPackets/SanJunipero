import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { hasCondition, statusOf, type AgentView, type Condition, type State } from '../ui/status.js'
import type { EmoteKind } from './charAnim.js'
import { CARET_LAP_MS } from '../ui/motion.js'
import { SPEECH_FILL, SPEECH_INK } from './textFaces.js'

// ★ ONE SLOT, ONE GLYPH, ONE PLACE. Three systems used to live over a person's head: a collapsed
// speech bubble, a nameplate sixty pixels under their feet, and a work chip ten pixels below the
// shoes. This is the one address, and the priority table below is the whole of its spec.

/** What the slot is saying, and whether it is the kind of news that takes the ember plate. */
export type OverheadRow = { id: State | Condition; glyph: EmoteKind; urgent: boolean }

/**
 * FIRST MATCH WINS. A condition outranks a state because a person who is hurt is the news, and
 * the cost is that "hurt while working" reads as hurt and nothing else — which the act chip
 * under their feet pays: the glyph and the word are separate channels.
 *
 * `working` has no row. There is no hammer in the emote atlas, and it needs none: the chip under
 * the feet carries the word and its own bar. `walking` and `idle` have no row either —
 * "Between things" is not news.
 */
export const OVERHEAD_PRIORITY: readonly OverheadRow[] = [
  { id: 'collapsed', glyph: 'exclaim', urgent: true },
  { id: 'hurt', glyph: 'hurt', urgent: true },
  { id: 'unwell', glyph: 'exclaim', urgent: true },
  { id: 'asleep', glyph: 'sleep', urgent: false },
  { id: 'talking', glyph: 'talk', urgent: false },
  { id: 'hungry', glyph: 'hunger', urgent: false },
  { id: 'cold', glyph: 'cold', urgent: false },
  { id: 'eating', glyph: 'hunger', urgent: false },
]

/**
 * The words that deliberately wear NOTHING, so a future one cannot slip through unclassified.
 * `working` needs no glyph — the chip under the feet IS the mark. `walking` and `idle` are
 * legible from the body itself, and "Between things" is not news. `gone` is the renderer's tone.
 * `thirsty` and `spent` are real conditions a viewer reads on the roster and the plate, but they
 * are the slowest news a person carries and would sit over a head for hours.
 */
export const NO_OVERHEAD: readonly (State | Condition)[] = [
  'gone',
  'working',
  'walking',
  'idle',
  'thirsty',
  'spent',
]

/** The one glyph this person wears, or none at all. Death is the renderer's tone, never a mark.
 *  Allocation-free: this runs for every visible person every frame, and `conditionsOf` would
 *  build an array and a Set to answer eight membership questions. */
export function overheadRow(a: AgentView, nowTick?: number): OverheadRow | null {
  if (!a.alive) return null
  const state = statusOf(a, nowTick)
  for (const row of OVERHEAD_PRIORITY) {
    if (row.id === state) return row
    if (hasCondition(a, row.id)) return row
  }
  return null
}

// ── the slot ─────────────────────────────────────────────────────────────────────────────

/** 7A's plate: one 20px slab, eight pixels above the head. */
export const SLOT_PX = 20
export const SLOT_ABOVE_HEAD_PX = 8
export const GLYPH_PX = 16

// No progress over the head: an arch read as broken on any job past a minute and crowded the one
// address this slot is. `acts.ts` carries it, under the word it is about.

const PLATE_INK = SPEECH_INK
const PLATE_PAPER = SPEECH_FILL
const PLATE_URGENT = 0xe8785a // --ember

// ── the caret ────────────────────────────────────────────────────────────────────────────

/** ★ A PROVIDER CALL IN FLIGHT, and only over somebody the shot is about. Twelve of these lit
 *  at once read as twelve loading spinners, so the caller decides who wears one. */
export const CARET_SQUARES = 3
const CARET_PX = 2
const CARET_GAP = 2
const CARET_INK = 0x3e6786 // --sky
const CARET_W = CARET_SQUARES * CARET_PX + (CARET_SQUARES - 1) * CARET_GAP
const CARET_SLAB_W = CARET_W + 6
const CARET_SLAB_H = CARET_PX + 6
/** Clear of the plate's own box, so a body wearing a glyph wears both. */
const CARET_Y = -SLOT_PX / 2 - CARET_SLAB_H / 2 - 2

/** How many of the three are lit. A viewer who asked for stillness gets all three, steady. */
export function caretLit(sinceMs: number, nowMs: number, wantsMotion: boolean): number {
  if (!wantsMotion) return CARET_SQUARES
  const lap = (((nowMs - sinceMs) % CARET_LAP_MS) + CARET_LAP_MS) % CARET_LAP_MS
  return Math.floor((lap * CARET_SQUARES) / CARET_LAP_MS) + 1
}

export type Overhead = {
  node: Container
  /** the atlas cell the character layer hands in for this row's glyph */
  glyph: Sprite
  /** null puts the whole slot away; a row shows the plate and its one mark */
  setRow(row: OverheadRow | null): void
  /** How many of the caret's squares are lit, 0 for no caret at all. */
  setCaret(lit: number): void
  destroy(): void
}

export function createOverhead(parent: Container): Overhead {
  const node = new Container()
  node.visible = false
  node.eventMode = 'none' // a mark never takes a click from the body under it
  const plate = new Graphics()
  const caret = new Graphics()
  caret.visible = false
  const glyph = new Sprite()
  glyph.anchor.set(0.5, 0.5)
  glyph.width = GLYPH_PX
  glyph.height = GLYPH_PX
  node.addChild(plate, glyph, caret)
  parent.addChild(node)

  let drawnUrgent: boolean | null = null
  let drawnLit = 0

  return {
    node,
    glyph,
    setRow(row) {
      if (row === null) {
        glyph.visible = false
        plate.visible = false
        return
      }
      glyph.visible = glyph.texture !== Texture.EMPTY
      plate.visible = true
      if (drawnUrgent === row.urgent) return
      drawnUrgent = row.urgent
      // The mark brings its own ground: a 2px ink ring on a stepped ledge, the sheet's own slab.
      plate.clear()
      plate.rect(-SLOT_PX / 2 + 2, -SLOT_PX / 2 + 2, SLOT_PX, SLOT_PX).fill(PLATE_INK)
      plate.rect(-SLOT_PX / 2, -SLOT_PX / 2, SLOT_PX, SLOT_PX)
      plate.fill(row.urgent ? PLATE_URGENT : PLATE_PAPER)
      plate.stroke({ width: 2, color: PLATE_INK, alignment: 1 })
    },
    setCaret(lit) {
      if (lit === drawnLit) return
      drawnLit = lit
      caret.visible = lit > 0
      if (lit <= 0) return
      // The mark brings its own ground, the same slab the plate does: --sky is 5.58:1 on the
      // paper and 2.27:1 over the night the town is drawn on.
      caret.clear()
      caret.rect(-CARET_SLAB_W / 2, CARET_Y - CARET_SLAB_H / 2, CARET_SLAB_W, CARET_SLAB_H)
      caret.fill(PLATE_PAPER)
      caret.stroke({ width: 2, color: PLATE_INK, alignment: 1 })
      for (let i = 0; i < lit; i++)
        caret.rect(
          -CARET_W / 2 + i * (CARET_PX + CARET_GAP),
          CARET_Y - CARET_PX / 2,
          CARET_PX,
          CARET_PX,
        )
      caret.fill(CARET_INK)
    },
    destroy() {
      node.destroy({ children: true })
    },
  }
}
