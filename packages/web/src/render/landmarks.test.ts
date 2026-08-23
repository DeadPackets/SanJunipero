import { describe, it, expect } from 'vitest'
import type { WorldState } from '@sj/engine'
import { GAMIFICATION_BAN } from '../ui/townStats.js'
import {
  LANDMARK_INK, LANDMARK_LABEL_PX, LANDMARK_PLATE, LANDMARK_SHOW_BELOW_SCALE, SILHOUETTE_RANK,
  TOWN_KINDS, landmarkAlpha, landmarkStyle, landmarksOf, placeLandmarks,
} from './landmarks.js'
import { AA_RATIO, bandRatios } from './legibility.js'
import { ZOOM_STOPS } from './camera.js'
import { FACE_DESIGN_PX } from './textFaces.js'
import { TEXT_MIN_PX } from '../textFloor.js'
import { readFileSync } from 'node:fs'
import type { Rect } from './tooltip.js'

type S = { id: string; kind: string; x: number; y: number; w: number; h: number; stage: string }

const stand = (id: string, kind: string, x: number, y: number, w = 1, h = 1): S =>
  ({ id, kind, x, y, w, h, stage: 'complete' })

// The Task-59 town, in world coordinates at the showcase anchor {x:0,y:9}.
const TOWN: S[] = [
  stand('structure_house_14_13', 'house', 14, 13, 2, 2),
  stand('structure_house_18_13', 'house', 18, 13, 2, 2),
  stand('structure_house_22_13', 'house', 22, 13, 2, 2),
  stand('structure_house_19_16', 'house', 19, 16, 2, 2),
  stand('structure_house_23_16', 'house', 23, 16, 2, 2),
  stand('structure_storehouse_13_21', 'storehouse', 13, 21, 2, 2),
  stand('structure_shed_18_26', 'shed', 18, 26),
  stand('structure_shed_27_30', 'shed', 27, 30),
  stand('structure_well_17_21', 'well', 17, 21),
  stand('structure_fire_pit_17_25', 'fire_pit', 17, 25),
  stand('structure_wagon_5_25', 'wagon', 5, 25, 1, 2),
]

const worldOf = (list: S[]): WorldState =>
  ({ structures: Object.fromEntries(list.map((s) => [s.id, s])) }) as unknown as WorldState

const town = landmarksOf(worldOf(TOWN))

describe('landmarksOf', () => {
  it('names the fire pit as the single centre of the town', () => {
    const first = town.filter((l) => l.rank === 1)
    expect(first).toHaveLength(1)
    expect(first[0]!.name).toBe('the fire pit')
    expect(first[0]!.x).toBe(17)
    expect(first[0]!.y).toBe(25)
  })

  it('anchors every district that has a building, and no district that does not', () => {
    const second = town.filter((l) => l.rank === 2)
    expect(second.map((l) => l.name).sort())
      .toEqual(['the fields', 'the houses', 'the landing', 'the square'])
    const noFarm = landmarksOf(worldOf(TOWN.filter((s) => s.kind !== 'shed')))
    expect(noFarm.some((l) => l.name === 'the fields')).toBe(false)
  })

  it('points out the notable single buildings', () => {
    const third = town.filter((l) => l.rank === 3).map((l) => l.name).sort()
    expect(third).toEqual(['the storehouse', 'the well'])
  })

  it('says nothing about an empty world', () => {
    expect(landmarksOf(worldOf([]))).toEqual([])
  })

  it('ignores a building that is not finished', () => {
    const half = TOWN.map((s) => s.kind === 'fire_pit' ? { ...s, stage: 'construction' } : s)
    expect(landmarksOf(worldOf(half)).some((l) => l.rank === 1)).toBe(false)
  })

  it('is deterministic and sorted by rank then id', () => {
    expect(landmarksOf(worldOf(TOWN))).toEqual(town)
    expect(landmarksOf(worldOf([...TOWN].reverse()))).toEqual(town)
    const order = town.map((l) => `${l.rank}|${l.id}`)
    expect(order).toEqual([...order].sort())
  })

  it('speaks like a person — no machine vocabulary and no game vocabulary', () => {
    for (const l of town) {
      expect(l.name, l.id).not.toMatch(GAMIFICATION_BAN)
      expect(l.name, l.id).not.toContain('structure_')
      expect(l.name, l.id).not.toContain('_')
      expect(l.name, l.id).toMatch(/^[a-z ]+$/)
    }
  })
})

describe('landmarkAlpha', () => {
  it('is a map legend at the widest view and gone on the way in', () => {
    expect(landmarkAlpha(0.5)).toBe(1)
    expect(landmarkAlpha(LANDMARK_SHOW_BELOW_SCALE)).toBe(0)
    expect(landmarkAlpha(4)).toBe(0)
  })

  it('never rises as you zoom in', () => {
    let prev = Infinity
    for (let s = 0.5; s <= 4; s += 0.05) {
      const a = landmarkAlpha(s)
      expect(a).toBeLessThanOrEqual(prev + 1e-9)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
      prev = a
    }
  })
})

describe('SILHOUETTE_RANK', () => {
  it('covers every kind the town can stand', () => {
    for (const k of TOWN_KINDS) expect(SILHOUETTE_RANK[k], k).toBeTypeOf('number')
    expect(new Set(TOWN_KINDS).size).toBe(TOWN_KINDS.length)
  })

  it('reads a public building heavier than a dwelling', () => {
    expect(SILHOUETTE_RANK['fire_pit']).toBeLessThan(SILHOUETTE_RANK['house'])
    expect(SILHOUETTE_RANK['storehouse']).toBeLessThan(SILHOUETTE_RANK['house'])
    expect(SILHOUETTE_RANK['well']).toBeLessThan(SILHOUETTE_RANK['house'])
  })
})

describe('the label type floor', () => {
  it('never draws a label below the 12px chrome floor', () => {
    expect(LANDMARK_LABEL_PX).toBeGreaterThanOrEqual(12)
  })
})

// ★ CARRY-IN FROM BATCH 5. At the overview stop "the storehouse", "the well", "the houses" and
// "the fire pit" all landed within a few pixels of each other and composited into one smear —
// the same audit-M8 fault that was fixed for tag-vs-bubble and never applied here. `placeTag`
// is the product's one placement rule and it already knows how to step clear.
describe('two place names never land on each other', () => {
  const VIEW = { x: 0, y: 0, w: 800, h: 600 }
  const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  it('separates four names asking for the same point', () => {
    const size = { w: 120, h: 22 }
    const placed = placeLandmarks(
      ['a', 'b', 'c', 'd'].map((id) => ({ id, sx: 400, sy: 300, size })), VIEW,
    )
    expect(placed).toHaveLength(4)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i]!.rect, placed[j]!.rect), `${i} vs ${j}`).toBe(false)
      }
    }
  })

  it('keeps every plate inside the view, wherever the landmark is', () => {
    const size = { w: 140, h: 22 }
    const marks = [
      { id: 'nw', sx: -50, sy: -50, size }, { id: 'ne', sx: 900, sy: 5, size },
      { id: 'sw', sx: 4, sy: 700, size }, { id: 'se', sx: 1200, sy: 900, size },
    ]
    for (const p of placeLandmarks(marks, VIEW)) {
      expect(p.rect.x, p.id).toBeGreaterThanOrEqual(VIEW.x)
      expect(p.rect.y, p.id).toBeGreaterThanOrEqual(VIEW.y)
      expect(p.rect.x + p.rect.w, p.id).toBeLessThanOrEqual(VIEW.x + VIEW.w)
      expect(p.rect.y + p.rect.h, p.id).toBeLessThanOrEqual(VIEW.y + VIEW.h)
    }
  })

  it('is deterministic — two calls with the same marks agree', () => {
    const marks = [
      { id: 'a', sx: 100, sy: 100, size: { w: 90, h: 20 } },
      { id: 'b', sx: 108, sy: 104, size: { w: 90, h: 20 } },
    ]
    expect(placeLandmarks(marks, VIEW)).toEqual(placeLandmarks(marks, VIEW))
  })
})

describe('a place name is legible over any ground, in both light bands', () => {
  it('is deep ink on a cream plate, and clears AA under the night multiply', () => {
    const r = bandRatios(LANDMARK_INK, LANDMARK_PLATE)
    expect(r.day).toBeGreaterThanOrEqual(AA_RATIO)
    expect(r.night).toBeGreaterThanOrEqual(AA_RATIO)
  })
})

// ★ WHAT THE BROWSER CAUGHT AND THE CONTRAST TEST DID NOT. The plate measured 15.02:1 as a
// MATERIAL and then the layer drew it at `RANK_ALPHA` 0.75 over grass, at a camera stop whose
// own `landmarkAlpha` was 0.5 — so the number the test proved was never the number on screen.
// It is the same fault as quoting a bubble's ratio without the night tint: a ratio belongs to
// a viewer, and alpha is a de-emphasis channel whose ratio is unknowable at the call site.
// ★ WHAT THE BROWSER CAUGHT AT THE NEW WIDEST STOP. The camera lane added 0.25, and there the
// eleven-building town is 320 px across while six counter-scaled plates are 140 px each — the
// legend covered the map it explains, stacked into a column taller than the settlement. A name
// is a legend for a view in which you can still see the place; below that the town is a shape.
describe('the legend gives way when it is bigger than the map', () => {
  it('is absent at the widest stop and full at the one above it', () => {
    expect(landmarkAlpha(0.25)).toBe(0)
    expect(landmarkAlpha(0.5)).toBe(1)
  })

  it('still disappears on the way in, exactly as it did', () => {
    expect(landmarkAlpha(1)).toBe(0)
    expect(landmarkAlpha(2)).toBe(0)
  })

  it('the fade sits strictly between the two stops, so no rest stop is caught mid-band', () => {
    const mid = landmarkAlpha(0.375)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
  })
})

describe('a place name is never de-emphasised by transparency', () => {
  it('is fully opaque or absent at every resting stop — never half there', () => {
    for (const stop of ZOOM_STOPS) {
      const a = landmarkAlpha(stop)
      expect(a === 0 || a === 1, `stop ${stop} draws the plate at alpha ${a}`).toBe(true)
    }
  })

  it('says which name matters by SIZE and PAPER, both of which are measurable', () => {
    const seen = new Set<string>()
    for (const rank of [1, 2, 3] as const) {
      const s = landmarkStyle(rank)
      expect(bandRatios(LANDMARK_INK, s.plate).night).toBeGreaterThanOrEqual(AA_RATIO)
      expect(s.size % FACE_DESIGN_PX, 'a size off the 8px em resamples the face').toBe(0)
      expect(s.size).toBeGreaterThanOrEqual(TEXT_MIN_PX)
      seen.add(`${s.size}:${s.plate}`)
    }
    expect(seen.size, 'three ranks that look the same are not a hierarchy').toBe(3)
  })

  it('leaves no alpha on a landmark node', () => {
    const text = readFileSync(new URL('./landmarks.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(text).not.toMatch(/RANK_ALPHA/)
    // the LAYER still fades with the camera; nothing inside it has an opacity of its own
    expect([...text.matchAll(/\.alpha\s*=/g)]).toHaveLength(1)
  })
})
