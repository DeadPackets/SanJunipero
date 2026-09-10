import { Container } from 'pixi.js'
import { cullByBox, type ViewRect } from './cull.js'
import { OVERLAP_RANK, depthOrder, type DepthBox } from './depth.js'

export const LAYERS = [
  'ground', // the baked terrain field
  'groundDecal', // patch outlines, furrows, overlay tints, water shimmer, tree canopies
  'shadow', // every contact shadow, for every body and every structure
  'entities', // THE ONLY depth-sorted layer: bodies, structures, items, crops
  'overhead', // smoke, hearth glow, fire, birds — drawn over the thing they belong to
  'worldText', // name tags, hover tags, emotes, landmark labels
  'bubbles', // speech and thought
  'overlay', // selection rings and reading aids that answer to no pointer
] as const
export type LayerName = (typeof LAYERS)[number]
export type LayerSet = Readonly<Record<LayerName, Container>>

/** The one layer that sorts its children by depth. Everything else is arrival order. */
export const SORTED_LAYER: LayerName = 'entities'

/** The PICTURE, `ground` through `overhead`. Words and reading aids sit outside it, so speech
 *  is never graded under the 4.5:1 floor. */
export const GRADED_LAYERS: readonly LayerName[] = LAYERS.slice(0, LAYERS.indexOf('worldText'))

/** Only `entities` sorts; every other layer is event-inert, so a decoration can never take a
 *  click from the world beneath it. The graded layers share the one node the filter goes on. */
export function createLayers(world: Container): { layers: LayerSet; graded: Container } {
  const graded = new Container()
  world.addChild(graded)
  const out = {} as Record<LayerName, Container>
  for (const name of LAYERS) {
    const c = new Container()
    if (name === SORTED_LAYER) c.sortableChildren = true
    else c.eventMode = 'none'
    ;(GRADED_LAYERS.includes(name) ? graded : world).addChild(c)
    out[name] = c
  }
  return { layers: out, graded }
}

/** In paint order over `world`. `lights` mirrors the world's transform and is the ONLY place
 *  an additive light may live: under the night multiply the grade darkens it. */
export const SCREEN_LAYERS = [
  'flash', // lightning — under the night quad, so a strike at 2 a.m. is a night strike (D8)
  'weather', // rain, snow: screen-space particles, under the quad so the night reaches them
  'night', // the deep-blue multiply quad
  'lights', // pools, blooms, window glow, fire, the sky gradient — additive, world transform
] as const
type ScreenLayerName = (typeof SCREEN_LAYERS)[number]
export type ScreenLayerSet = Readonly<Record<ScreenLayerName, Container>>

/** Every screen layer is event-inert: a full-screen quad that took a click would end panning. */
export function createScreenLayers(stage: Container): ScreenLayerSet {
  const out = {} as Record<ScreenLayerName, Container>
  for (const name of SCREEN_LAYERS) {
    const c = new Container()
    c.eventMode = 'none'
    stage.addChild(c)
    out[name] = c
  }
  return out
}

// ── the depth sort's one writer ──────────────────────────────────────────────────────────

/** A drawable inside `entities`, and the ground it stands on. */
export type DepthEntry = {
  box: DepthBox
  node: Container
  /** the slot over a body's crown while it is wearing a mark: that rides in a layer which does
   *  not sort, so a roof has to give way to it as well */
  overhead?: Container
}

/** What one frame cost, and what it did not. Read by the FPS overlay and asserted by tests —
 *  a cull nobody can count is a claim, not a measurement. */
export type DepthCounts = { drawn: number; culled: number }

// Reused across frames: one array per drawable and a fresh Map, sixty times a second, was the
// sort's own allocation bill. Nothing here outlives the call.
const boxes: DepthBox[] = []
const index = new Map<string, number>()

/** Everything the sort reads, flattened, against what it read last time. Every value is
 *  compared exactly — a hash collision here is a silently wrong painter's order. */
export function createDepthGate(): (entries: readonly DepthEntry[], view: ViewRect) => boolean {
  const seen: unknown[] = []
  return (entries, view) => {
    let i = 0
    let moved = seen.length !== entries.length * 11 + 4
    const put = (v: unknown): void => {
      if (seen[i] !== v) moved = true
      seen[i++] = v
    }
    put(view.x)
    put(view.y)
    put(view.w)
    put(view.h)
    // A relief in flight, or one the dwell is holding back, still owes the frame a write.
    if (reliefPending > 0) moved = true
    for (const e of entries) {
      const b = e.box
      put(e.node)
      put(b.id)
      put(b.rank)
      put(b.x0)
      put(b.y0)
      put(b.x1)
      put(b.y1)
      put(b.sx0)
      put(b.sy0)
      put(b.sx1)
      put(b.sy1)
    }
    seen.length = i
    return moved
  }
}

/** The only place a depth is written and a drawable is hidden. The cull runs BEFORE the sort
 *  because `depthOrder` is O(n²) and degrades to seed order above `DEPTH_BUDGET`. */
export function applyDepthOrder(
  entries: readonly DepthEntry[],
  view: ViewRect,
  now = performance.now(),
): DepthCounts {
  const { drawn, hidden } = cullByBox(entries, view)
  for (const e of hidden) e.node.visible = false
  boxes.length = 0
  for (const e of drawn) boxes.push(e.box)
  const order = depthOrder(boxes)
  index.clear()
  for (let i = 0; i < order.length; i++) index.set(order[i]!, i)
  for (const e of drawn) {
    e.node.visible = true
    e.node.zIndex = index.get(e.box.id) ?? 0
  }
  applyRelief(drawn, now)
  return { drawn: drawn.length, culled: hidden.length }
}

// ── occlusion relief ─────────────────────────────────────────────────────────────────────

// The sort is right to bury a body under a roof and the eye still calls it a bug: art is fitted
// (w + h) · 32 px over the feet line while one tile of ground recession is 8 px.
const RELIEF_ALPHA = 0.4
const RELIEF_ENTER_MS = 180
const RELIEF_EXIT_MS = 260
/** The enter ramp and a 600 ms hold, rounded up to one change a second: a body walking a wall
 *  edge crosses into cover and out again every few frames, and the roof would strobe. */
const RELIEF_DWELL_MS = 1000
/** The glyph slot over a crown, `SLOT_ABOVE_HEAD_PX + SLOT_PX` in overhead.ts. It is claimed
 *  only by a body wearing a mark, because an empty slot hides nobody. */
const RELIEF_HEADROOM_PX = 28

type Relief = { on: boolean; at: number; k: number }
const relief = new WeakMap<Container, Relief>()
const bodies: DepthEntry[] = []
const structures: DepthEntry[] = []
/** How many structures are mid-ramp or waiting out the dwell. The depth gate reads it. */
let reliefPending = 0

/** Is the body, plus whatever headroom it has claimed, under this structure's art? */
function coversColumn(s: DepthBox, b: DepthBox, headroom: number): boolean {
  return s.sx0 < b.sx1 && b.sx0 < s.sx1 && s.sy0 < b.sy1 && b.sy0 - headroom < s.sy1
}

/** A structure painted over a body goes part translucent, so the picture never loses the person
 *  it is about. Read off the order the sort just wrote: whoever paints later is the one hiding. */
function applyRelief(drawn: readonly DepthEntry[], now: number): void {
  bodies.length = 0
  structures.length = 0
  for (const e of drawn) {
    if (e.box.rank === OVERLAP_RANK.body) bodies.push(e)
    else if (e.box.rank === OVERLAP_RANK.structure) structures.push(e)
  }
  reliefPending = 0
  for (const e of structures) {
    const z = index.get(e.box.id) ?? 0
    let want = false
    for (const b of bodies) {
      if ((index.get(b.box.id) ?? 0) > z) continue
      const headroom = b.overhead?.visible === true ? RELIEF_HEADROOM_PX : 0
      if (!coversColumn(e.box, b.box, headroom)) continue
      want = true
      break
    }
    let s = relief.get(e.node)
    if (s === undefined) {
      s = { on: false, at: now - RELIEF_DWELL_MS, k: 0 }
      relief.set(e.node, s)
    }
    if (s.on !== want && now - s.at >= RELIEF_DWELL_MS) {
      s.on = want
      s.at = now
    }
    const p = Math.min(1, (now - s.at) / (s.on ? RELIEF_ENTER_MS : RELIEF_EXIT_MS))
    const k = s.on ? p : 1 - p
    if (k !== s.k) {
      e.node.alpha = 1 - k * (1 - RELIEF_ALPHA)
      s.k = k
    }
    if (p < 1 || s.on !== want) reliefPending++
  }
}

// ── P16's mechanical guard ───────────────────────────────────────────────────────────────

/** An assignment, not a read and not a comparison — `=` but never `==`. */
const Z_ASSIGN = /\.zIndex\s*=(?!=)/

/** The only two files allowed to write a zIndex: `layers.ts` owns the town stack, and
 *  `interiorScene.ts` owns a separate scene graph that never competes with it. */
export const Z_AUTHORISED: readonly string[] = ['render/layers.ts', 'render/interiorScene.ts']

function authorised(path: string): boolean {
  const p = path.split('\\').join('/')
  return Z_AUTHORISED.some((a) => p.endsWith(a))
}

/** Every line that assigns a zIndex from a file that has no business doing so, as
 *  `path:line — text`. A regression names its own call site. */
export function literalZIndexOffenders(
  files: readonly { path: string; source: string }[],
): string[] {
  const out: string[] = []
  for (const f of files) {
    if (authorised(f.path)) continue
    f.source.split('\n').forEach((line, i) => {
      const code = line.trim()
      if (code.startsWith('//') || code.startsWith('*')) return // a comment may say the old number
      if (Z_ASSIGN.test(code)) out.push(`${f.path}:${i + 1} — ${code}`)
    })
  }
  return out
}
