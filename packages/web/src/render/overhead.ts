import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { hasCondition, statusOf, type AgentView, type Condition, type State } from '../ui/status.js'
import type { EmoteKind } from './charAnim.js'
import { SPEECH_FILL, SPEECH_INK } from './textFaces.js'

// ★ ONE SLOT, ONE GLYPH, ONE PLACE — and a track that wraps the same slot exactly while a job
// runs. Three systems used to live over a person's head: a collapsed speech bubble, a nameplate
// sixty pixels under their feet, and a work chip ten pixels below the shoes. This is the one
// address, and the priority table below is the whole of its spec.

/** What the slot is saying, and whether it is the kind of news that takes the ember plate. */
export type OverheadRow = { id: State | Condition; glyph: EmoteKind; urgent: boolean }

/**
 * FIRST MATCH WINS. A condition outranks a state because a person who is hurt is the news — the
 * cost 7A could not pay is that "hurt while working" then reads as hurt and nothing else, and
 * the TRACK is what pays it: the glyph and the arc are separate channels.
 *
 * `working` has no row. There is no hammer in the emote atlas, and it needs none: while a job
 * runs the track IS the mark, so a working person with nothing wrong shows the arc alone.
 * `walking` and `idle` have no row either — "Between things" is not news.
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
 * `working` needs no glyph — while a job runs the track IS the mark. `walking` and `idle` are
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

// ── the slot, and the track that wraps it ────────────────────────────────────────────────

/** 7A's plate: one 20px slab, eight pixels above the head. */
export const SLOT_PX = 20
export const SLOT_ABOVE_HEAD_PX = 8
export const GLYPH_PX = 16

/** Seven blocks: progress is a COUNT and a POSITION before it is ever a hue, which survives the
 *  night tint, a mono print and a viewer who cannot separate honey from ember. */
export const TRACK_BLOCKS = 7
export const BLOCK_PX = 5
/**
 * ★ THE ARCH, AND ITS SIZE. The arc spans OVER the glyph and the glyph sits under its curve —
 * not a ring crowding it and not an arc beside it. Measured, not chosen: at r=26 across 120° the
 * lowest block's underside is 13.7px above the slot's centre and the plate's top is 10px above
 * it, so every block clears the plate by 3.7px; the arc runs 20.3px each side, twice the plate's
 * own width, and its crown stands 28.5px up. The slot is world art and scales with the camera,
 * so that ratio holds at every zoom stop the indicators show at.
 */
export const TRACK_R = 26
export const TRACK_SPAN_DEG = 120

/** Whole blocks only, and it never shows seven: the track goes when the act does, so a full arc
 *  is never a thing a viewer is left waiting to see. */
export function trackFilled(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction))
  return Math.min(TRACK_BLOCKS - 1, Math.floor(f * TRACK_BLOCKS))
}

/** The seven block centres, in world pixels around the slot's own centre. A pure function of
 *  the two constants above, so it is called once for the whole product. */
export function blockCentres(): { x: number; y: number }[] {
  const from = 180 + (180 - TRACK_SPAN_DEG) / 2
  const step = TRACK_SPAN_DEG / TRACK_BLOCKS
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < TRACK_BLOCKS; i++) {
    const rad = ((from + (i + 0.5) * step) * Math.PI) / 180
    out.push({ x: TRACK_R * Math.cos(rad), y: TRACK_R * Math.sin(rad) })
  }
  return out
}

const TRACK_CENTRES = blockCentres()

const PLATE_INK = SPEECH_INK
const PLATE_PAPER = SPEECH_FILL
const PLATE_URGENT = 0xe8785a // --ember
const BLOCK_DONE = 0xf2c879 // --honey
const BLOCK_LEFT = 0xc4b8ae // --cream-quiet: 8.28:1 on the deep casing under it

export type Overhead = {
  node: Container
  /** the atlas cell the character layer hands in for this row's glyph */
  glyph: Sprite
  /** null puts the whole slot away; a row shows the plate and its one mark */
  setRow(row: OverheadRow | null): void
  /** null takes the track off — 7M-B: chrome only while there is something to report */
  setTrack(fraction: number | null): void
  destroy(): void
}

export function createOverhead(parent: Container): Overhead {
  const node = new Container()
  node.visible = false
  node.eventMode = 'none' // a mark never takes a click from the body under it
  const plate = new Graphics()
  const track = new Graphics()
  const glyph = new Sprite()
  glyph.anchor.set(0.5, 0.5)
  glyph.width = GLYPH_PX
  glyph.height = GLYPH_PX
  node.addChild(track, plate, glyph)
  parent.addChild(node)

  let drawnUrgent: boolean | null = null
  let drawnFilled = -1

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
    setTrack(fraction) {
      if (fraction === null) {
        // The drawn blocks survive the toggle, so nothing is reset: a job stopping and starting
        // again at the same count must not repaint what is already there.
        track.visible = false
        return
      }
      track.visible = true
      const filled = trackFilled(fraction)
      if (filled === drawnFilled) return
      drawnFilled = filled
      // No mask, and one Graphics for all seven: a mask per chip over every person in the
      // viewport is a render target per person.
      track.clear()
      const half = BLOCK_PX / 2
      TRACK_CENTRES.forEach((c, i) => {
        track.rect(c.x - half - 1, c.y - half - 1, BLOCK_PX + 2, BLOCK_PX + 2).fill(PLATE_INK)
        if (i < filled) {
          track.rect(c.x - half, c.y - half, BLOCK_PX, BLOCK_PX).fill(BLOCK_DONE)
          return
        }
        // Hollow, not dimmed: done against remaining is a SHAPE before it is a colour.
        track.rect(c.x - half, c.y - half, BLOCK_PX, BLOCK_PX).fill(BLOCK_LEFT)
        track.rect(c.x - half + 1.5, c.y - half + 1.5, BLOCK_PX - 3, BLOCK_PX - 3).fill(PLATE_INK)
      })
    },
    destroy() {
      node.destroy({ children: true })
    },
  }
}
