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
import { over } from './legibility.js'
import { bubbleShown, nearestSpeakers, onLeash, placeBubbles } from './bubbles.js'
import { tileToScreen } from './iso.js'
import { fadeArtIn } from './textures.js'
import { stateWord, statusOf, type AgentView } from '../ui/status.js'
import type { Rect } from './tooltip.js'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'

/**
 * ★ WHAT A MIND IS DOING, ON THE PERSON DOING IT.
 *
 * `charAnim` is a walk bob, so Yusuf chopping a tree read as Yusuf standing beside a tree. The
 * act is already in the world state — `activity.verb` and `activity.ticksRemaining`, folded
 * from the same deltas every other surface reads — so this DRAWS a fact the client already
 * had. Nothing was added to the wire for it.
 *
 * It is a thing in the town, never chrome: the same paper, ink, radius and stroke the speech
 * bubble is made of, one register quieter. Two things keep it from being read as speech — it
 * sits UNDER the body rather than over the head, and its paper takes up ink as the work goes.
 */

/** One tick is 2.5s of flicker, not a caption: an act has to last to be worth a word. */
export const ACT_MIN_TICKS = 2

/**
 * ★ THE CEILING IS ON THE FILL, NOT ON THE CHIP — and getting that the wrong way round was the
 * first thing the town corrected. A tick is about a minute. `chop` a tree is 30 and `tend` is
 * 3, acts a viewer can watch happen; a house is `houseTicks: 2880`, two town-days, and a fill
 * that creeps 0.03% a tick is a progress bar that reads as broken while telling the truth.
 *
 * The first cut answered that by hiding the chip above the ceiling, which threw away the half
 * that was still true: the WORD is worth having at any length — "Building" over a person tells
 * a viewer exactly what they are looking at. It is only the promise that you can watch it
 * finish that a long act cannot keep. So a long act keeps its word and goes without its fill.
 */
export const ACT_FILL_MAX_TICKS = 60

/** The same three the bubbles keep, measured the same way, so one rule covers the stage. */
export const ACT_NEAREST = 3
/**
 * How much ink the worked part of the chip has taken up — and the ceiling is MEASURED, not
 * chosen. The word sits on this paper, and cream only clears the night multiply at 5.19:1 to
 * begin with: 0.14 read well on a desk and fell to 4.17:1 after dark. 0.08 holds 4.58:1 with a
 * margin, and `acts.test.ts` fails the build if a later hand pushes it back up.
 */
const ACT_WASH = 0.08
export const ACT_FILL: number = over(SPEECH_INK, SPEECH_FILL, ACT_WASH)
/** Clear of the feet, and clear of the contact shadow under them. */
const ACT_DROP_PX = 10

/** What we know about the act one person is in the middle of. */
export type ActRun = { verb: string; total: number; left: number }

/**
 * The denominator, remembered per person. `action_started` carries the exact `duration` — the
 * night-work penalty already in it — so a viewer who watched the act begin gets the true one.
 * A viewer who joined halfway takes the largest `ticksRemaining` the run has shown them, which
 * is exact from that moment on and can never run backwards. `build` drops its clock by the
 * number of builders rather than by one, and the same `max` absorbs that too.
 */
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

/**
 * Whose act is worth a chip. `statusOf` already sorts the town into states and only `working`
 * is an act with a job in it: walking, eating, talking and sleeping are all legible from the
 * body itself, and captioning them would put a word over every person in the town.
 */
export function actShown(a: AgentView, run: ActRun | null, nowTick?: number): boolean {
  if (run === null || a.activity === null) return false
  if (run.total < ACT_MIN_TICKS) return false
  return statusOf(a, nowTick) === 'working'
}

/** Whether the work is short enough that a fill can promise you will see it finish. */
export function actFillShown(run: ActRun): boolean {
  return run.total <= ACT_FILL_MAX_TICKS
}

export type ActLayer = {
  /** the exact duration, from `action_started`; everything else is read off the world state */
  noteStart(agentId: string, verb: string, duration: number): void
  tick(): void
  destroy(): void
}

type Chip = {
  node: Container
  wash: Graphics
  w: number
  h: number
  word: string
  /** the filled width last drawn, so the paper is redrawn only when the work has moved */
  drawnPx: number
}

export function createActLayer(scene: Scene, store: WorldStore): ActLayer {
  const chips = new Map<string, Chip>()
  const runs = new Map<string, ActRun>()
  const starts = new Map<string, { verb: string; duration: number }>()

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

    const paper = new Graphics()
    paper.roundRect(0, 0, w, h, BUBBLE_RADIUS)
    paper.fill(SPEECH_FILL)
    paper.stroke({ width: BUBBLE_STROKE, color: BUBBLE_EDGE, alignment: 1 })

    // THE FILL IS THE PAPER TAKING UP INK, not a bar laid on top of one. It is masked by the
    // chip's own rounded shape, so the wash cannot square off the corners it runs into.
    const wash = new Graphics()
    const shape = new Graphics()
    shape.roundRect(0, 0, w, h, BUBBLE_RADIUS)
    shape.fill(0xffffff)
    wash.mask = shape

    const box = new Container()
    box.addChild(paper, wash, shape, label)
    label.position.set(BUBBLE_PAD, BUBBLE_PAD)
    box.position.set(-Math.round(w / 2), 0)
    node.addChild(box)
    return { node, wash, w, h, word, drawnPx: -1 }
  }

  const drawWash = (chip: Chip, frac: number): void => {
    // Whole pixels only: the world is a pixel grid and the act advances one tick at a time, so
    // the wash steps as the work does. Nothing is interpolated between ticks — a smooth crawl
    // would be the one thing on this chip that is not a fact.
    const px = Math.round(chip.w * frac)
    if (px === chip.drawnPx) return
    chip.drawnPx = px
    chip.wash.clear()
    if (px <= 0) return
    chip.wash.rect(0, 0, px, chip.h)
    chip.wash.fill(ACT_FILL)
    // THE WATERLINE. A wash light enough to keep the word legible is, by construction, a wash
    // too light to see at a glance — so the thing a viewer actually reads is the hard ink edge
    // it is pushing along, not the fill level behind it. One pixel, and it costs the word
    // nothing because it is a line rather than a field.
    if (px >= chip.w) return
    chip.wash.rect(px - 1, 0, 1, chip.h)
    chip.wash.fill(BUBBLE_EDGE)
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
          // The STATE is what ends a chip, never an event: `action_completed` and all four
          // reasons an act can be interrupted land here as one fact, and `action_interrupted`
          // does not even carry the verb it stopped.
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
      const near = nearestSpeakers(
        at,
        { x: view.x + view.w / 2, y: view.y + view.h / 2 },
        ACT_NEAREST,
      )

      const want: { id: string; sx: number; sy: number; size: { w: number; h: number } }[] = []
      for (const p of at) {
        // A person eight pixels tall cannot wear a word, and the bubbles already know it.
        if (!bubbleShown(zoom, near.has(p.id))) {
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
        const run = runs.get(p.id)!
        drawWash(chip, actFillShown(run) ? actFraction(run) : 0)
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
