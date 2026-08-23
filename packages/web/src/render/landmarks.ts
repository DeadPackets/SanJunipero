import { Container, Graphics } from 'pixi.js'
// the deep path, never the package root: @sj/engine's index reaches db.ts and therefore
// better-sqlite3, which the browser graph guard forbids
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { tileToScreen } from './iso.js'
import { drawnBoundsOf, type CameraBounds } from './camera.js'
import type { Scene } from './scene.js'
import { createWorldLabel, type WorldLabel } from './worldLabel.js'
import { FACE_SIZES, THOUGHT_FILL, faceFor, worldTextScale } from './textFaces.js'
import { placeTag, type Rect } from './tooltip.js'
import { LANDMARK_EDGE, LANDMARK_INK, LANDMARK_PLATE } from './legibility.js'

// A good plan is not a legible picture. At the default zoom the viewer sees roofs and roads
// and cannot tell the square from a wide street. These are the reading aids a real town has:
// a named centre, names for the parts you can point at, and a silhouette hierarchy so the eye
// finds the civic buildings before the houses.
//
// Every name is DERIVED from what is standing. Nothing here is authored twice, and nothing
// here is machine vocabulary — a person reads "the square", never "structure_well_17_21".

export type Footprint = { x: number; y: number; w: number; h: number }

export type Landmark = {
  id: string; name: string; x: number; y: number; rank: 1 | 2 | 3
  /** ★ WHAT THIS NAME IS FOR — every footprint it speaks about, so the layer can keep the
   *  plate off them. A district's name belongs to all its members; a single building's to
   *  itself. A name that does not know what it names cannot be kept from hiding it. */
  of: readonly Footprint[]
}

/** Every kind the town can stand, dev fixture included. A new kind with no rank is a type error. */
export const TOWN_KINDS = [
  'house', 'cottage', 'farmhouse', 'cabin',
  'storehouse', 'shed', 'well', 'fire_pit', 'wagon', 'standing_stone', 'scaffolding',
] as const
export type TownKind = (typeof TOWN_KINDS)[number]

/** A building's visual weight: 1 reads heaviest. Public buildings outrank dwellings, so the
 *  eye lands on the civic centre first. Applied as a rim and a ledge, never as a tint (P11). */
export const SILHOUETTE_RANK: Record<TownKind, 1 | 2 | 3> = {
  fire_pit: 1, well: 1, storehouse: 1, standing_stone: 1,
  // The farmhouse is the biggest roof outside the square and the anchor of its own district,
  // so it reads a rung above the houses without joining the civic centre.
  farmhouse: 2, shed: 2, wagon: 2,
  house: 3, cottage: 3, cabin: 3, scaffolding: 3,
}

// Which part of town a kind belongs to. The viewer does not know the template's anchor, so a
// district is read from what is standing rather than from a rectangle in template space.
const DISTRICT_OF_KIND: Partial<Record<TownKind, string>> = {
  house: 'houses', cottage: 'houses', cabin: 'houses',
  well: 'square', fire_pit: 'square', storehouse: 'square',
  farmhouse: 'fields', shed: 'fields', wagon: 'landing',
}
const DISTRICT_NAME: Record<string, string> = {
  houses: 'the houses', square: 'the square', fields: 'the fields', landing: 'the landing',
}
const DISTRICT_ORDER = ['houses', 'square', 'fields', 'landing']

// A notable single building gets its own name; a house does not, because five of them do not
// each deserve a label at map scale.
const SINGLE_NAME: Partial<Record<TownKind, string>> = {
  fire_pit: 'the fire pit', well: 'the well', storehouse: 'the storehouse',
}

/**
 * Labels are a map legend for the wide view and clutter on the way in, so the whole layer
 * fades out at both ends. Every threshold is chosen so that at EVERY resting `ZOOM_STOP` the
 * layer is 1 or 0 and never between: a plate drawn at 0.5 has a contrast ratio nobody can
 * state, which is the de-emphasis-by-transparency habit this batch measured out of the
 * bubbles. Both fades happen during the transit between stops, which is motion, not a state a
 * viewer reads in.
 *
 * ★ THE BOTTOM END IS NOT HERE ANY MORE, AND THAT IS THE POINT. It used to be a second pair of
 * hard-coded scales — full at 0.5, gone at 0.25 — added when 0.25 joined the ladder and the
 * legend covered the eleven-building showcase. Two lanes then looked at 0.5 in a browser and
 * saw four plates stacked on the town centre with that fix live and green: the ramp had cured
 * one stop of one town and named neither the relationship nor the other stop. Alpha was being
 * asked to solve a layout problem, which is the habit this project has now unlearned three
 * times. `legendFits` and `placeLandmarks` own the wide end, on geometry; this function is only
 * the fade on the way IN, where a name is clutter over art a viewer can already read.
 */
export const LANDMARK_SHOW_BELOW_SCALE = 1
const LANDMARK_FULL_BELOW_SCALE = 0.75

/** The chrome type floor is 12px and a world label is chrome. */
export const LANDMARK_LABEL_PX = faceFor('label').size

export function landmarkAlpha(scale: number): number {
  const inward = (LANDMARK_SHOW_BELOW_SCALE - scale) / (LANDMARK_SHOW_BELOW_SCALE - LANDMARK_FULL_BELOW_SCALE)
  return Math.min(1, Math.max(0, inward))
}

type Standing = { id: string; kind: string; x: number; y: number; w: number; h: number }

const centreOf = (s: Standing): { x: number; y: number } =>
  ({ x: s.x + ((s.w - 1) >> 1), y: s.y + ((s.h - 1) >> 1) })

/** The settlement as it stands, in one order. The legend and its size rule read the same list,
 *  so the names and the map they are measured against can never be two different towns. */
export function standingOf(state: WorldState | null): Standing[] {
  return Object.values(state?.structures ?? {})
    .filter((s) => s.stage === 'complete')
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** A `CameraBounds` as the `Rect` every placement rule in the product speaks. */
export const rectOfBounds = (b: CameraBounds): Rect =>
  ({ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY })

/** Derived from what is standing, never authored twice. rank 1 = the centre, 2 = a district
 *  anchor, 3 = a notable single building. Sorted by rank then id, so two calls agree. */
export function landmarksOf(state: WorldState): Landmark[] {
  const standing = standingOf(state)

  const out: Landmark[] = []

  const boxOf = (s: Standing): Footprint => ({ x: s.x, y: s.y, w: s.w, h: s.h })

  for (const s of standing) {
    const kind = s.kind as TownKind
    // The fire pit is the one thing a town gathers around, so it is the centre and the only
    // rank 1. The other named singles are landmarks you navigate by, not the middle.
    if (kind === 'fire_pit') out.push({ id: s.id, name: SINGLE_NAME[kind]!, x: s.x, y: s.y, rank: 1, of: [boxOf(s)] })
    else if (SINGLE_NAME[kind] !== undefined)
      out.push({ id: s.id, name: SINGLE_NAME[kind]!, x: s.x, y: s.y, rank: 3, of: [boxOf(s)] })
  }

  for (const district of DISTRICT_ORDER) {
    const members = standing.filter((s) => DISTRICT_OF_KIND[s.kind as TownKind] === district)
    if (members.length === 0) continue
    const cs = members.map(centreOf)
    out.push({
      id: `district_${district}`,
      name: DISTRICT_NAME[district]!,
      x: Math.round(cs.reduce((n, c) => n + c.x, 0) / cs.length),
      y: Math.round(cs.reduce((n, c) => n + c.y, 0) / cs.length),
      rank: 2,
      of: members.map(boxOf),
    })
  }

  return out.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------- drawing the names

/**
 * ★ A LABEL WITH NO GROUND UNDER IT IS NOT A LABEL.
 *
 * `#5D5751` painted straight on the terrain measured **1.26–4.98:1 by day and 1.11–2.85:1 at
 * night** depending on which tile it fell across — worst over forest, and never once clearing
 * AA after dark. It also had no rule about the other names, so at the overview stop "the
 * storehouse", "the well", "the houses" and "the fire pit" composited into one smear.
 *
 * A place name gets a PLATE, the same cream paper every other floating slab in the town wears,
 * and `--deep` ink on it: **15.02:1 by day and 5.19:1 at night**, against a night ceiling of
 * 6.37:1. Not the material's ratio — the viewer's, through the multiply quad (legibility.ts).
 */
// `export { X }` for an X that arrived through an `import` is dropped by a per-file transpile
// — tsc, vitest and the bundler all accepted it and the dev ESM graph threw
// "Export 'LANDMARK_EDGE' is not defined in module", which blanked every place name on screen.
// A re-export names its source.
export { LANDMARK_EDGE, LANDMARK_INK, LANDMARK_PLATE } from './legibility.js'
export const LANDMARK_PAD_X = 5, LANDMARK_PAD_Y = 3

/**
 * WHICH NAME MATTERS, SAID IN SIZE AND PAPER RATHER THAN IN TRANSPARENCY. The centre is set a
 * rung larger on the same 8px em, and a notable single building sits on parchment instead of
 * cream — two channels a viewer can see and a test can measure. Both papers clear AA under the
 * night multiply (legibility.ts); an alpha would clear nothing knowable.
 */
export function landmarkStyle(rank: 1 | 2 | 3): { size: number; plate: number } {
  if (rank === 1) return { size: FACE_SIZES[2], plate: LANDMARK_PLATE }
  if (rank === 2) return { size: FACE_SIZES[1], plate: LANDMARK_PLATE }
  return { size: FACE_SIZES[1], plate: THOUGHT_FILL }
}

export type LandmarkLayer = { sync(): void; destroy(): void }

/**
 * How far past the edge of the view a place may be and still be named. One plate's width, so a
 * name whose anchor has just left the screen fades out with its subject rather than blinking.
 */
export const LANDMARK_CULL_MARGIN_PX = 120

/** The one predicate two rects touch. `tooltip.ts` keeps its own copy private; a legend that
 *  must not cover the map cannot ask a module that does not export the question. */
const hits = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export type PlaceableMark = {
  id: string
  sx: number
  sy: number
  size: { w: number; h: number }
  /** The DRAWN box of every place this name is for, in the same space as `sx`/`sy`. Required,
   *  not optional: a caller that does not say what a name names cannot be told to keep off it,
   *  and that omission is precisely how the legend came to cover the map.
   *
   *  ONE BOX PER BUILDING, never the bounding box of a district. The square's three buildings
   *  stand around a plaza, and the paving between them is where its caption belongs; a union
   *  box swallows the plaza, the town centre becomes keep-out and THE FIRE PIT — the one rank-1
   *  name in the product — is the first thing dropped. */
  of: readonly Rect[]
}

/** The extent of what a name is for. Its leash is measured from here, so a district's caption
 *  may sit anywhere along the district and a single building's may not wander. */
const extentOf = (of: readonly Rect[]): Rect => {
  const x = Math.min(...of.map((r) => r.x)), y = Math.min(...of.map((r) => r.y))
  return {
    x, y,
    w: Math.max(...of.map((r) => r.x + r.w)) - x,
    h: Math.max(...of.map((r) => r.y + r.h)) - y,
  }
}

/**
 * Where each plate goes, in rank order, so the centre keeps its place and the districts move
 * around it. `placeTag` is the product's one placement rule (task 74) and it already knows how
 * to step clear of something already there — the same audit-M8 mechanism the tags use.
 *
 * ★ IT IS ONLY ASKED ABOUT PLACES THAT ARE ON SCREEN. `placeTag` CLAMPS a plate into the
 * visible rect and then steps it clear of its neighbours, which is right for a subject the
 * viewer can see and catastrophic for one they cannot: handed every name in a town larger than
 * the viewport it drags all of them into view and stacks them into a wall, hiding the few
 * places that are actually there. It is O(n²) in that wall, and under the ring grammar n has
 * no bound. A name belongs to a place; if the place is off screen, so is the name.
 *
 * ★★ AND EVERY NAMED PLACE IS GROUND A PLATE MAY NOT TAKE. The plates already stepped clear of
 * EACH OTHER and of nothing else, so at the wide stops they stepped clear of one another into
 * a tidy stack sitting on the square, the well, the fire pit and the storehouse — the four
 * things the legend was there to point at. A caption over its own subject is not a caption.
 * The places of names that will NOT be drawn count too: hiding a place is the defect, and
 * whether that place's own plate survived has nothing to do with it.
 *
 * `placeTag` clamps into the view and gives up after `MAX_STACK_STEPS`, so its answer is a best
 * effort and never a promise. A plate that still lands on a place or on another name is not
 * drawn: a missing name costs a viewer one word, a covered place costs them the map.
 *
 * ★★★ AND A NAME IS ON A LEASH. Making the places keep-out turns a stack into a MARCH: each
 * plate steps away from the pile and the next one steps past it, until the four names of the
 * town centre are a block of type over the river with nothing under them they describe. That
 * is the same defect wearing a different hat. A caption that has walked further than its own
 * size from what it captions is no longer that thing's caption, so it is not drawn — and the
 * leash is the plate's own size, which scales with the plate and is not a number anybody chose.
 *
 * Only the ids it returns are drawn. The caller hides the rest.
 */
export const leashOf = (of: readonly Rect[], size: { w: number; h: number }): Rect => {
  const e = extentOf(of)
  return { x: e.x - size.w, y: e.y - size.h, w: e.w + size.w * 2, h: e.h + size.h * 2 }
}

export function placeLandmarks(
  marks: readonly PlaceableMark[],
  view: Rect,
): Array<{ id: string; sx: number; sy: number; rect: Rect }> {
  const m0 = LANDMARK_CULL_MARGIN_PX
  const places = marks.flatMap((m) => m.of)
  const taken: Rect[] = []
  const out: Array<{ id: string; sx: number; sy: number; rect: Rect }> = []
  for (const m of marks) {
    if (m.sx < view.x - m0 || m.sx > view.x + view.w + m0) continue
    if (m.sy < view.y - m0 || m.sy > view.y + view.h + m0) continue
    const at = placeTag({ sx: m.sx, sy: m.sy, halfW: m.size.w / 2, topY: m.sy }, m.size, view, [...places, ...taken])
    const rect = { x: at.sx - m.size.w / 2, y: at.sy, w: m.size.w, h: m.size.h }
    if (places.some((p) => hits(rect, p)) || taken.some((t) => hits(rect, t))) continue
    if (!hits(rect, leashOf(m.of, m.size))) continue
    taken.push(rect)
    out.push({ id: m.id, sx: at.sx, sy: at.sy, rect })
  }
  return out
}

/**
 * ★ THE LEGEND MUST BE SMALLER THAN THE MAP IT EXPLAINS, AND THAT IS NOT A ZOOM NUMBER.
 *
 * The bottom end of `landmarkAlpha` used to be a pair of hard-coded scales — full at 0.5, gone
 * at 0.25. That is only ever true of ONE town: it says nothing about a settlement four rings
 * wide, which at 0.25 is 1056 px across and has ample room for its names, and it would say the
 * wrong thing again the moment the stop ladder grows a rung.
 *
 * The quantity that actually decides is scale-free and size-free. A plate holds a CONSTANT
 * screen size (worldTextScale counter-scales it) while the settlement shrinks with the camera,
 * so the legend's ink measured against the settlement's drawn area ON SCREEN is right for any
 * zoom, any stop ladder, any plate count and any town.
 *
 * MEASURED on the showcase town (drawn box 1136 × 520 world px, six plates, 18 912 px² of ink):
 *   1×    3.2 % — shown (and the inward fade has already taken it by then)
 *   0.5  12.8 % — shown; this is the picture the camera lane approved
 *   0.25 51.2 % — hidden; this is the picture merge train 2 photographed and called a defect
 * The two cases are four times apart. `1 / 6` sits between them with 30 % of headroom below
 * and a factor of three above, and it is the only number in this rule.
 */
export const LEGEND_INK_SHARE = 1 / 6

/** Both areas in SCREEN px². A settlement with no drawn area has no map to explain. */
export function legendFits(inkPx2: number, townPx2: number): boolean {
  return townPx2 > 0 && inkPx2 <= townPx2 * LEGEND_INK_SHARE
}

/**
 * Place names in the scene's overlay: above everything, hit-testable by nothing. The whole
 * layer fades with landmarkAlpha, and each label counter-scales so it stays LANDMARK_LABEL_PX
 * on screen at any zoom rather than growing into the art.
 */
export function createLandmarkLayer(scene: Scene, store: WorldStore): LandmarkLayer {
  const node = new Container()
  node.eventMode = 'none'
  scene.layers.overlay.addChild(node)
  type Plate = { node: Container; plate: Graphics; label: WorldLabel; drawn: string }
  const labels = new Map<string, Plate>()

  function sync(): void {
    const alpha = landmarkAlpha(scene.getZoom())
    node.visible = alpha > 0
    node.alpha = alpha
    if (!node.visible) return

    const state = store.getState()
    const marks = state === null ? [] : landmarksOf(state)
    const seen = new Set<string>()
    const z = scene.world.scale.x
    const inv = worldTextScale(z)

    // Build (or reuse) every plate first, THEN place them together: a name cannot know it is
    // landing on another name until every size is known.
    const wanted: PlaceableMark[] = []
    for (const m of marks) {
      seen.add(m.id)
      const style = landmarkStyle(m.rank)
      let t = labels.get(m.id)
      if (t === undefined) {
        const box = new Container()
        box.eventMode = 'none'
        const plate = new Graphics()
        // createWorldLabel, never `new BitmapText`: a bitmap glyph with no installed font
        // blanks the entire canvas, so the choice is made once from the font cache (ruling R3).
        const label = createWorldLabel(m.name, {
          fontFamily: faceFor('label').family, fontSize: style.size, fill: LANDMARK_INK,
        })
        label.anchor.set(0.5, 0)
        label.eventMode = 'none'
        box.addChild(plate, label)
        node.addChild(box)
        t = { node: box, plate, label, drawn: '' }
        labels.set(m.id, t)
      }
      if (t.label.text !== m.name) t.label.text = m.name
      if (t.drawn !== m.name) {
        t.drawn = m.name
        const w = t.label.width + LANDMARK_PAD_X * 2, h = t.label.height + LANDMARK_PAD_Y * 2
        t.plate.clear()
        t.plate.rect(-w / 2, -LANDMARK_PAD_Y, w, h)
        t.plate.fill(style.plate)
        t.plate.stroke({ width: 1, color: LANDMARK_EDGE })
      }
      t.node.scale.set(inv)
      const { sx, sy } = tileToScreen(m.x, m.y)
      wanted.push({
        id: m.id, sx, sy,
        size: { w: (t.label.width + LANDMARK_PAD_X * 2) * inv, h: (t.label.height + LANDMARK_PAD_Y * 2) * inv },
        // The same drawn box the camera fits and the cull tests, one per building, so the
        // legend and the picture cannot disagree about where a building is.
        of: m.of.map((f) => rectOfBounds(drawnBoundsOf([f]))),
      })
    }

    // ★ A LEGEND BIGGER THAN ITS MAP IS NOT A LEGEND. Ink and settlement are compared on
    // SCREEN, where the plate holds a constant size and the town does not.
    const town = rectOfBounds(drawnBoundsOf(standingOf(state)))
    const ink = wanted.reduce((n, w) => n + w.size.w * w.size.h, 0) * z * z
    const fits = legendFits(ink, town.w * z * (town.h * z))

    // Only what was placed is drawn. A plate left visible at its last position would be a name
    // sitting over a place that is no longer under it — and the sweep below still has to run,
    // so a legend that gave way must not take an early return out of it and leak its plates.
    const placed = new Set<string>()
    if (fits) {
      for (const at of placeLandmarks(wanted, scene.viewRect())) {
        const t = labels.get(at.id)
        if (t === undefined) continue
        placed.add(at.id)
        t.node.visible = true
        t.node.position.set(Math.round(at.sx), Math.round(at.sy + LANDMARK_PAD_Y * inv))
      }
    }
    for (const [id, t] of labels) if (!placed.has(id)) t.node.visible = false

    for (const [id, t] of labels) {
      if (seen.has(id)) continue
      t.node.destroy({ children: true })
      labels.delete(id)
    }
  }

  return {
    sync,
    destroy: () => {
      node.destroy({ children: true })
      labels.clear()
    },
  }
}
