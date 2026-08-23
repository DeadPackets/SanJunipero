import { Container } from 'pixi.js'
import { cullByBox, type ViewRect } from './cull.js'
import { depthOrder, type DepthBox } from './depth.js'

// ONE TABLE, ONE AUTHORITY (U8, plan task 69).
//
// The scene used to hold a SINGLE `sortableChildren` container for everything. Shadows,
// bodies, buildings, doors, items, crops, emotes, per-body name tags, the shared hover tag
// and speech bubbles all competed in one integer space, and they settled their conflicts with
// magic numbers written at call sites that could not see each other: 1e9 for a bubble,
// 1e9 − 1 for a tag, 1e8 for a particle, `structureZIndex + 1` for a door, `zIndex ± 1` for a
// shadow. Every one of those numbers was a guess about what somebody else had chosen.
//
// Now the stack is a list, in one place, and a module's only decision is WHICH LAYER it
// belongs to. Inside a layer, order is arrival order — except `entities`, the one layer that
// is depth-sorted, where depth.ts decides.

export const LAYERS = [
  'ground',        // the baked terrain field
  'groundDecal',   // patch outlines, furrows, overlay tints, water shimmer, tree canopies
  'shadow',        // every contact shadow, for every body and every structure
  'entities',      // THE ONLY depth-sorted layer: bodies, structures, items, crops
  'overhead',      // smoke, hearth glow, fire, birds — drawn over the thing they belong to
  'worldText',     // name tags, hover tags, emotes, landmark labels
  'bubbles',       // speech and thought
  'overlay',       // selection rings and reading aids that answer to no pointer
] as const
export type LayerName = (typeof LAYERS)[number]
export type LayerSet = Readonly<Record<LayerName, Container>>

/** The one layer that sorts its children by depth. Everything else is arrival order. */
export const SORTED_LAYER: LayerName = 'entities'

/**
 * Creates the eight containers as children of `world` in LAYERS order, sets
 * `sortableChildren` on `entities` and nowhere else, and makes every other layer
 * event-inert so a decoration can never take a click from the world beneath it.
 */
export function createLayers(world: Container): LayerSet {
  const out = {} as Record<LayerName, Container>
  for (const name of LAYERS) {
    const c = new Container()
    if (name === SORTED_LAYER) c.sortableChildren = true
    else c.eventMode = 'none'
    world.addChild(c)
    out[name] = c
  }
  return out
}

// ── the depth sort's one writer ──────────────────────────────────────────────────────────

/** A drawable inside `entities`, and the ground it stands on. */
export type DepthEntry = { box: DepthBox; node: Container }

/** What one frame cost, and what it did not. Read by the FPS overlay and asserted by tests —
 *  a cull nobody can count is a claim, not a measurement. */
export type DepthCounts = { drawn: number; culled: number }

/**
 * THE ONLY PLACE A DEPTH IS WRITTEN, AND THE ONLY PLACE A DRAWABLE IS HIDDEN. Every drawable
 * in `entities` publishes a DepthBox each frame; what the viewport cannot reach is switched
 * off, and depth.ts turns the rest into a painter's order whose index IS the zIndex.
 *
 * The cull belongs HERE and not at the call sites because the pairwise sort is what a large
 * town actually costs: `depthOrder` is O(n²) in the boxes it is handed and degrades to seed
 * order above `DEPTH_BUDGET`. Culling first is what keeps the town it sorts a viewport's
 * worth rather than a settlement's, so the order stays correct as the town grows.
 *
 * A hidden node keeps the zIndex it had. It is not being drawn, so its depth is not a
 * question, and re-numbering it would only churn `sortableChildren`.
 */
export function applyDepthOrder(entries: readonly DepthEntry[], view: ViewRect): DepthCounts {
  const { drawn, hidden } = cullByBox(entries, view)
  for (const e of hidden) e.node.visible = false
  const order = depthOrder(drawn.map((e) => e.box))
  const index = new Map(order.map((id, i) => [id, i]))
  for (const e of drawn) {
    e.node.visible = true
    e.node.zIndex = index.get(e.box.id) ?? 0
  }
  return { drawn: drawn.length, culled: hidden.length }
}

// ── P16's mechanical guard ───────────────────────────────────────────────────────────────

/** An assignment, not a read and not a comparison — `=` but never `==`. */
export const Z_ASSIGN = /\.zIndex\s*=(?!=)/

/** The only two files allowed to write a zIndex:
 *  - `layers.ts` owns the stack AND `applyDepthOrder`, the one writer of a town depth;
 *  - `interiorScene.ts` owns a SEPARATE scene graph — a room with its own sorted container,
 *    which never competes with the town's layers.
 *  Nothing else. entities.ts and characters.ts publish a DepthBox and take what they are
 *  given; the door is a CHILD of its building and has no depth to write. */
export const Z_AUTHORISED: readonly string[] = ['render/layers.ts', 'render/interiorScene.ts']

function authorised(path: string): boolean {
  const p = path.split('\\').join('/')
  return Z_AUTHORISED.some((a) => p.endsWith(a))
}

/** Every line that assigns a zIndex from a file that has no business doing so, as
 *  `path:line — text`. A regression names its own call site. */
export function literalZIndexOffenders(files: ReadonlyArray<{ path: string; source: string }>): string[] {
  const out: string[] = []
  for (const f of files) {
    if (authorised(f.path)) continue
    f.source.split('\n').forEach((line, i) => {
      const code = line.trim()
      if (code.startsWith('//') || code.startsWith('*')) return   // a comment may say the old number
      if (Z_ASSIGN.test(code)) out.push(`${f.path}:${i + 1} — ${code}`)
    })
  }
  return out
}
