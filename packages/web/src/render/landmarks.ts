import { Container, Graphics } from 'pixi.js'
// the deep path, never the package root: @sj/engine's index reaches db.ts and therefore
// better-sqlite3, which the browser graph guard forbids
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { tileToScreen } from './iso.js'
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

export type Landmark = { id: string; name: string; x: number; y: number; rank: 1 | 2 | 3 }

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
 * Labels are a map legend at the widest view and clutter on the way in, so the whole layer
 * fades out. The band is chosen so that at EVERY resting `ZOOM_STOP` the layer is 1 or 0 and
 * never between: a plate drawn at 0.5 has a contrast ratio nobody can state, which is the
 * de-emphasis-by-transparency habit this batch measured out of the bubbles. The fade happens
 * during the transit between stops, which is motion, not a state a viewer reads in.
 */
export const LANDMARK_SHOW_BELOW_SCALE = 1
const LANDMARK_FULL_BELOW_SCALE = 0.75

/** The chrome type floor is 12px and a world label is chrome. */
export const LANDMARK_LABEL_PX = faceFor('label').size

export function landmarkAlpha(scale: number): number {
  const span = LANDMARK_SHOW_BELOW_SCALE - LANDMARK_FULL_BELOW_SCALE
  const t = (LANDMARK_SHOW_BELOW_SCALE - scale) / span
  return Math.min(1, Math.max(0, t))
}

type Standing = { id: string; kind: string; x: number; y: number; w: number; h: number }

const centreOf = (s: Standing): { x: number; y: number } =>
  ({ x: s.x + ((s.w - 1) >> 1), y: s.y + ((s.h - 1) >> 1) })

/** Derived from what is standing, never authored twice. rank 1 = the centre, 2 = a district
 *  anchor, 3 = a notable single building. Sorted by rank then id, so two calls agree. */
export function landmarksOf(state: WorldState): Landmark[] {
  const standing: Standing[] = Object.values(state.structures ?? {})
    .filter((s) => s.stage === 'complete')
    .sort((a, b) => a.id.localeCompare(b.id))

  const out: Landmark[] = []

  for (const s of standing) {
    const kind = s.kind as TownKind
    // The fire pit is the one thing a town gathers around, so it is the centre and the only
    // rank 1. The other named singles are landmarks you navigate by, not the middle.
    if (kind === 'fire_pit') out.push({ id: s.id, name: SINGLE_NAME[kind]!, x: s.x, y: s.y, rank: 1 })
    else if (SINGLE_NAME[kind] !== undefined)
      out.push({ id: s.id, name: SINGLE_NAME[kind]!, x: s.x, y: s.y, rank: 3 })
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
 * Where each plate goes, in rank order, so the centre keeps its place and the districts move
 * around it. `placeTag` is the product's one placement rule (task 74) and it already knows how
 * to step clear of something already there — the same audit-M8 mechanism the tags use.
 */
export function placeLandmarks(
  marks: ReadonlyArray<{ id: string; sx: number; sy: number; size: { w: number; h: number } }>,
  view: Rect,
): Array<{ id: string; sx: number; sy: number; rect: Rect }> {
  const taken: Rect[] = []
  const out: Array<{ id: string; sx: number; sy: number; rect: Rect }> = []
  for (const m of marks) {
    const at = placeTag({ sx: m.sx, sy: m.sy, halfW: m.size.w / 2, topY: m.sy }, m.size, view, taken)
    const rect = { x: at.sx - m.size.w / 2, y: at.sy, w: m.size.w, h: m.size.h }
    taken.push(rect)
    out.push({ id: m.id, sx: at.sx, sy: at.sy, rect })
  }
  return out
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
    const inv = worldTextScale(scene.world.scale.x)

    // Build (or reuse) every plate first, THEN place them together: a name cannot know it is
    // landing on another name until every size is known.
    const wanted: Array<{ id: string; sx: number; sy: number; size: { w: number; h: number } }> = []
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
      })
    }

    for (const at of placeLandmarks(wanted, scene.viewRect())) {
      const t = labels.get(at.id)
      if (t === undefined) continue
      t.node.position.set(Math.round(at.sx), Math.round(at.sy + LANDMARK_PAD_Y * inv))
    }

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
