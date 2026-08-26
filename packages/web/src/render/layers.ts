import { Container } from 'pixi.js'
import { cullByBox, type ViewRect } from './cull.js'
import { depthOrder, type DepthBox } from './depth.js'

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

/** Creates the layer containers under `world`. Only `entities` sorts; every other layer is
 *  event-inert so a decoration can never take a click from the world beneath it. */
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

/** The only place a depth is written and a drawable is hidden. The cull runs BEFORE the sort
 *  because `depthOrder` is O(n²) and degrades to seed order above `DEPTH_BUDGET`. */
export function applyDepthOrder(entries: readonly DepthEntry[], view: ViewRect): DepthCounts {
  const { drawn, hidden } = cullByBox(entries, view)
  for (const e of hidden) e.node.visible = false
  const order = depthOrder(drawn.map((e) => e.box))
  const index = new Map<string, number>()
  for (let i = 0; i < order.length; i++) index.set(order[i]!, i)
  for (const e of drawn) {
    e.node.visible = true
    e.node.zIndex = index.get(e.box.id) ?? 0
  }
  return { drawn: drawn.length, culled: hidden.length }
}

// ── P16's mechanical guard ───────────────────────────────────────────────────────────────

/** An assignment, not a read and not a comparison — `=` but never `==`. */
export const Z_ASSIGN = /\.zIndex\s*=(?!=)/

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
  files: ReadonlyArray<{ path: string; source: string }>,
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
