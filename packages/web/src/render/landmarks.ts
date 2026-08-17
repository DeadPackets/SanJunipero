import { Container } from 'pixi.js'
// the deep path, never the package root: @sj/engine's index reaches db.ts and therefore
// better-sqlite3, which the browser graph guard forbids
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { tileToScreen } from './iso.js'
import type { Scene } from './scene.js'
import { WORLD_FONT_FAMILY, createWorldLabel, type WorldLabel } from './worldLabel.js'

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
  'hut', 'storehouse', 'shed', 'well', 'fire_pit', 'wagon', 'standing_stone', 'scaffolding',
] as const
export type TownKind = (typeof TOWN_KINDS)[number]

/** A building's visual weight: 1 reads heaviest. Public buildings outrank dwellings, so the
 *  eye lands on the civic centre first. Applied as a rim and a ledge, never as a tint (P11). */
export const SILHOUETTE_RANK: Record<TownKind, 1 | 2 | 3> = {
  fire_pit: 1, well: 1, storehouse: 1, standing_stone: 1,
  shed: 2, wagon: 2,
  hut: 3, scaffolding: 3,
}

// Which part of town a kind belongs to. The viewer does not know the template's anchor, so a
// district is read from what is standing rather than from a rectangle in template space.
const DISTRICT_OF_KIND: Partial<Record<TownKind, string>> = {
  hut: 'houses', well: 'square', fire_pit: 'square', storehouse: 'square',
  shed: 'fields', wagon: 'landing',
}
const DISTRICT_NAME: Record<string, string> = {
  houses: 'the houses', square: 'the square', fields: 'the fields', landing: 'the landing',
}
const DISTRICT_ORDER = ['houses', 'square', 'fields', 'landing']

// A notable single building gets its own name; a hut does not, because five of them do not
// each deserve a label at map scale.
const SINGLE_NAME: Partial<Record<TownKind, string>> = {
  fire_pit: 'the fire pit', well: 'the well', storehouse: 'the storehouse',
}

/** Labels are a map legend at the widest view and clutter at 4x, so they fade out on the way in. */
export const LANDMARK_SHOW_BELOW_SCALE = 1.5
const LANDMARK_FULL_BELOW_SCALE = 0.5

/** The chrome type floor is 12px and a world label is chrome. */
export const LANDMARK_LABEL_PX = 12

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

/** Ink for a place name. --stone, so a label reads as chrome over the world, never as art. */
export const LANDMARK_INK = 0x5d5751
const RANK_ALPHA: Record<1 | 2 | 3, number> = { 1: 1, 2: 0.9, 3: 0.75 }

export type LandmarkLayer = { sync(): void; destroy(): void }

/**
 * Place names in the scene's overlay: above everything, hit-testable by nothing. The whole
 * layer fades with landmarkAlpha, and each label counter-scales so it stays LANDMARK_LABEL_PX
 * on screen at any zoom rather than growing into the art.
 */
export function createLandmarkLayer(scene: Scene, store: WorldStore): LandmarkLayer {
  const node = new Container()
  node.eventMode = 'none'
  scene.overlay.addChild(node)
  // createWorldLabel, never `new BitmapText`: a bitmap glyph with no installed font blanks the
  // entire canvas, so the choice is made once from the font cache (worldLabel.ts, ruling R3).
  const labels = new Map<string, WorldLabel>()

  function sync(): void {
    const alpha = landmarkAlpha(scene.getZoom())
    node.visible = alpha > 0
    node.alpha = alpha
    if (!node.visible) return

    const state = store.getState()
    const marks = state === null ? [] : landmarksOf(state)
    const seen = new Set<string>()
    const inv = 1 / (scene.world.scale.x || 1)

    for (const m of marks) {
      seen.add(m.id)
      let t = labels.get(m.id)
      if (t === undefined) {
        t = createWorldLabel(m.name, {
          fontFamily: WORLD_FONT_FAMILY, fontSize: LANDMARK_LABEL_PX, fill: LANDMARK_INK,
        })
        t.anchor.set(0.5, 1)
        t.eventMode = 'none'
        labels.set(m.id, t)
        node.addChild(t)
      }
      if (t.text !== m.name) t.text = m.name
      const { sx, sy } = tileToScreen(m.x, m.y)
      t.position.set(Math.round(sx), Math.round(sy))
      t.alpha = RANK_ALPHA[m.rank]
      t.scale.set(inv)
    }
    for (const [id, t] of labels) {
      if (seen.has(id)) continue
      t.destroy()
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
