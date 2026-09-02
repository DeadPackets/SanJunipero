import { Container, Graphics } from 'pixi.js'
import { createWorldLabel } from './worldLabel.js'
import {
  BUBBLE_EDGE,
  BUBBLE_PAD,
  BUBBLE_RADIUS,
  BUBBLE_STROKE,
  SPEECH_FILL,
  SPEECH_INK,
  faceFor,
  worldTextScale,
} from './textFaces.js'
import { GLYPH_ZOOM, inViewSpeakers, onLeash, placeBubbles } from './bubbles.js'
import { tileToScreen } from './iso.js'
import { fadeArtIn } from './textures.js'
import { stateWord, statusOf, type AgentView } from '../ui/status.js'
import type { Rect } from './tooltip.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'

// ★ WHAT A MIND IS DOING, ON THE PERSON DOING IT — drawn from `activity` already in the world
// state, nothing added to the wire; the speech bubble's own paper one register quieter, under
// the body and taking up ink as the work goes, so it is never read as speech.

/** One tick is 2.5s of flicker, not a caption: an act has to last to be worth a word. */
export const ACT_MIN_TICKS = 2

/** ★ THE CEILING IS ON THE BAR, NOT ON THE CHIP. `chop` is 30 ticks but a house is
 *  `houseTicks: 2880`: a bar creeping a pixel every hour of town time reads as broken while
 *  telling the truth, and the word is worth having at any length — a long act keeps its word
 *  and loses its bar. */
export const ACT_TRACK_MAX_TICKS = 60

/** The bar under the word: one drawn pixel of honey, as wide as the work is done. Under the
 *  slab rather than over the head — progress belongs to the word it is about. */
export const ACT_BAR_PX = 1
const ACT_BAR_FILL = 0xf2c879 // --honey

/** How much of a `w`-wide chip the bar covers. Whole pixels: a fractional edge on a 1px bar is
 *  a grey row, and a bar that reads as grey reads as broken. */
export function barWidth(w: number, fraction: number): number {
  return Math.round(w * Math.min(1, Math.max(0, fraction)))
}

/** ★ A chip has its own reason to be on screen, and it is not "a bubble would be": the two
 *  used to share `bubbleShown`, so changing who speaks silently changed who works. The stop is
 *  the same one — a person eight pixels tall cannot wear a word either. */
export function actChipShown(zoom: number, inView: boolean): boolean {
  return inView && zoom > GLYPH_ZOOM
}
/** Clear of the feet, and clear of the contact shadow under them. */
const ACT_DROP_PX = 10

/** What we know about the act one person is in the middle of. */
export type ActRun = { verb: string; total: number; left: number }

/** The denominator. `action_started` carries the exact `duration`, night penalty included; a
 *  viewer who joined halfway takes the largest `ticksRemaining` seen — exact from that moment,
 *  never backwards, and the same `max` absorbs `build` dropping its clock per builder. */
export function trackRun(
  prev: ActRun | null,
  verb: string,
  left: number,
  started?: number,
): ActRun {
  const fresh = prev?.verb !== verb
  const total = fresh ? (started ?? left) : Math.max(prev.total, left)
  return { verb, total: Math.max(1, total), left }
}

/** 0 while the first tick is being worked, and short of 1 on the last — the chip goes when the
 *  act does, so a full bar is never a thing a viewer is left waiting to see. */
export function actFraction(run: ActRun): number {
  return Math.min(1, Math.max(0, (run.total - run.left) / run.total))
}

/** Only `working` is an act with a job in it: walking, eating, talking and sleeping are legible
 *  from the body itself, and captioning them would put a word over every person in the town. */
export function actShown(a: AgentView, run: ActRun | null, nowTick?: number): boolean {
  if (run === null || a.activity === null) return false
  if (run.total < ACT_MIN_TICKS) return false
  return statusOf(a, nowTick) === 'working'
}

/** Whether the work is short enough that a bar can promise you will see it finish. */
export function actTrackShown(run: ActRun): boolean {
  return run.total <= ACT_TRACK_MAX_TICKS
}

export type ActLayer = {
  /** the exact duration, from `action_started`; everything else is read off the world state */
  noteStart(agentId: string, verb: string, duration: number): void
  /** ★ How far into their job this person is — 0..1 while a short act runs, and null the moment
   *  it stops. The chip's own bar reads it; nothing over the head does any more. */
  fractionOf(agentId: string): number | null
  tick(): void
  destroy(): void
}

type Chip = {
  node: Container
  bar: Graphics
  w: number
  h: number
  word: string
  /** the whole pixels the bar was last drawn at, so it is redrawn only when it moves */
  drawn: number
}

export function createActLayer(scene: Scene, store: WorldStore): ActLayer {
  const chips = new Map<string, Chip>()
  const runs = new Map<string, ActRun>()
  const starts = new Map<string, { verb: string; duration: number }>()
  /** ONE gate for one act: whoever the chip is willing to name is whoever the track may wrap.
   *  Read apart, a sleeper with a live `activity` wore a track and no word for it. */
  let atWork = new Set<string>()

  const build = (word: string): Chip => {
    const node = new Container()
    node.eventMode = 'none' // a caption never takes a click from the body under it
    const face = faceFor('label')
    const label = createWorldLabel(word, {
      fontFamily: face.family,
      fontSize: face.size,
      fill: SPEECH_INK,
      align: 'left',
    })
    const w = Math.ceil(label.width) + 2 * BUBBLE_PAD
    const h = Math.ceil(label.height) + 2 * BUBBLE_PAD

    // ★ NO MASK, and no wash under the word. The fill was a Graphics mask PER CHIP, which is a
    // render target per working person — and with the viewport rule that is every working person
    // on screen. The bar under the slab is a rectangle redrawn only when it moves a whole pixel.
    const paper = new Graphics()
    paper.roundRect(0, 0, w, h, BUBBLE_RADIUS)
    paper.fill(SPEECH_FILL)
    paper.stroke({ width: BUBBLE_STROKE, color: BUBBLE_EDGE, alignment: 1 })

    const bar = new Graphics()
    bar.position.set(0, h + 1)
    const box = new Container()
    box.addChild(paper, label, bar)
    label.position.set(BUBBLE_PAD, BUBBLE_PAD)
    box.position.set(-Math.round(w / 2), 0)
    node.addChild(box)
    return { node, bar, w, h, word, drawn: -1 }
  }

  const setBar = (chip: Chip, fraction: number | null): void => {
    const px = fraction === null ? 0 : barWidth(chip.w, fraction)
    if (px === chip.drawn) return
    chip.drawn = px
    chip.bar.clear()
    if (px > 0) chip.bar.rect(0, 0, px, ACT_BAR_PX).fill(ACT_BAR_FILL)
  }

  const drop = (agentId: string): void => {
    const chip = chips.get(agentId)
    if (chip === undefined) return
    chip.node.destroy({ children: true })
    chips.delete(agentId)
  }

  return {
    noteStart: (agentId, verb, duration) => {
      starts.set(agentId, { verb, duration })
    },

    fractionOf: (agentId) => {
      const run = runs.get(agentId)
      if (run === undefined || !atWork.has(agentId) || !actTrackShown(run)) return null
      return actFraction(run)
    },

    tick: () => {
      const state = store.getState()
      const zoom = scene.getZoom()
      const inv = worldTextScale(zoom) * scene.textScale
      const nowTick = store.getTick()

      // ── who is at work, and how far in ──────────────────────────────────────────────────
      const live = new Set<string>()
      for (const a of Object.values(state?.agents ?? {})) {
        const act = a.activity
        if (act === null) {
          // The STATE ends a chip, never an event: every way an act stops lands here as one
          // fact, and `action_interrupted` does not even carry the verb it stopped.
          runs.delete(a.id)
          starts.delete(a.id)
          continue
        }
        const seed = starts.get(a.id)
        const run = trackRun(
          runs.get(a.id) ?? null,
          act.verb,
          act.ticksRemaining,
          seed?.verb === act.verb ? seed.duration : undefined,
        )
        runs.set(a.id, run)
        if (actShown(a, run, nowTick)) live.add(a.id)
      }
      atWork = live
      for (const id of [...chips.keys()]) if (!live.has(id)) drop(id)
      if (live.size === 0) {
        scene.tags.setOccupied('acts', [])
        return
      }

      // ── where they are ──────────────────────────────────────────────────────────────────
      const at = [...live].sort().map((id) => {
        const a = state!.agents[id]!
        const anchor = scene.anchorOf?.(id) ?? null
        const { sx, sy } = anchor === null ? tileToScreen(a.x, a.y) : { sx: anchor.x, sy: anchor.y }
        return { id, sx, sy: sy + ACT_DROP_PX }
      })
      const view = scene.viewRect()
      const seen = inViewSpeakers(at, view)

      const want: { id: string; sx: number; sy: number; size: { w: number; h: number } }[] = []
      for (const p of at) {
        if (!actChipShown(zoom, seen.has(p.id))) {
          drop(p.id)
          continue
        }
        const word = stateWord(state!.agents[p.id]!, nowTick)
        let chip = chips.get(p.id)
        if (chip !== undefined && chip.word !== word) {
          drop(p.id) // they moved on to a different job without ever going idle
          chip = undefined
        }
        if (chip === undefined) {
          chip = build(word)
          scene.layers.worldText.addChild(chip.node)
          // NOTHING POPS IN — but a viewer who asked for stillness gets the chip, not the fade.
          if (scene.wantsMotion()) fadeArtIn(chip.node)
          chips.set(p.id, chip)
        }
        const run = runs.get(p.id)
        setBar(chip, run === undefined || !actTrackShown(run) ? null : actFraction(run))
        want.push({ ...p, size: { w: chip.w * inv, h: chip.h * inv } })
      }

      // ── placed against the bubbles, never over them ─────────────────────────────────────
      const boxes: Rect[] = []
      const sized = new Map(want.map((w) => [w.id, w]))
      for (const placed of placeBubbles(want, view, scene.tags.occupied('acts'))) {
        const chip = chips.get(placed.id)
        const p = sized.get(placed.id)
        if (chip === undefined || p === undefined) continue
        chip.node.scale.set(inv) // the chip is the reader's size, not the camera's
        chip.node.visible = onLeash(placed.rect, p.sx, p.sy, p.size)
        if (!chip.node.visible) continue
        chip.node.position.set(Math.round(placed.sx), Math.round(placed.rect.y))
        boxes.push(placed.rect)
      }
      scene.tags.setOccupied('acts', boxes)
    },

    destroy: () => {
      for (const chip of chips.values()) chip.node.destroy({ children: true })
      chips.clear()
      runs.clear()
      starts.clear()
    },
  }
}
