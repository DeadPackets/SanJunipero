import { describe, it, expect } from 'vitest'
import type { WorldState } from '@sj/engine'
import { GAMIFICATION_BAN } from '../ui/townStats.js'
import {
  LANDMARK_INK, LANDMARK_LABEL_PX, LANDMARK_PAD_X, LANDMARK_PAD_Y, LANDMARK_PLATE,
  LANDMARK_SHOW_BELOW_SCALE, LEGEND_INK_SHARE, SILHOUETTE_RANK,
  TOWN_KINDS, landmarkAlpha, landmarkStyle, landmarksOf, leashOf, legendFits, placeLandmarks,
  rectOfBounds, standingOf, type PlaceableMark,
} from './landmarks.js'
import { AA_RATIO, bandRatios } from './legibility.js'
import { ZOOM_STOPS, drawnBoundsOf } from './camera.js'
import { bigTown } from './bigTown.js'
import { anchorFor, makeCityTemplate } from '@sj/shared'
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

/** A placeable name whose subject is a small building standing where the name points. Every
 *  call site has to name a subject now: a plate that does not know what it labels cannot be
 *  kept off it, and that omission is exactly how the legend came to cover the map. */
const mk = (
  id: string, sx: number, sy: number, size: { w: number; h: number },
): PlaceableMark => ({ id, sx, sy, size, of: [{ x: sx - 16, y: sy - 32, w: 32, h: 40 }] })

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

  // This used to assert all four were placed. It cannot any more, and the reason is the fix:
  // four names pointing at ONE building, which is itself keep-out now and holds one plate's
  // worth of clear ground inside a leash of itself. The three that cannot be that building's
  // caption are dropped instead of marching off across the map. Separation is the law; the
  // count never was — and the count is exactly what the old picture's stack satisfied.
  it('separates the names that ask for the same point, and drops the ones with no room', () => {
    const size = { w: 120, h: 22 }
    const placed = placeLandmarks(
      ['a', 'b', 'c', 'd'].map((id) => mk(id, 400, 300, size)), VIEW,
    )
    expect(placed.length).toBeGreaterThanOrEqual(1)
    expect(placed.length, 'four captions for one building is not four captions').toBeLessThan(4)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i]!.rect, placed[j]!.rect), `${i} vs ${j}`).toBe(false)
      }
    }
  })

  it('keeps every plate inside the view, wherever the landmark is', () => {
    const size = { w: 140, h: 22 }
    const marks = [
      mk('nw', -50, -50, size), mk('ne', 900, 5, size),
      mk('sw', 4, 700, size), mk('se', 1200, 900, size),
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
      mk('a', 100, 100, { w: 90, h: 20 }),
      mk('b', 108, 104, { w: 90, h: 20 }),
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
// ── ★ A NAME FOR A PLACE THAT IS NOT ON SCREEN ────────────────────────────────────────────
//
// `placeTag` CLAMPS every plate into the visible rect and then steps it clear of the plates
// already there — which is right for a tag whose subject is on screen and catastrophic for one
// whose subject is not. Handed every landmark in a town that does not fit the viewport, it
// drags all of them into the view and stacks them into a column: a wall of names for places
// the viewer cannot see, hiding the few that are actually there. It is also O(n²) in a number
// that now grows without bound.
//
// A place name belongs to a place. If the place is off screen, so is its name.

describe('placeLandmarks culls to the view', () => {
  const VIEW = { x: 0, y: 0, w: 800, h: 600 }
  const size = { w: 90, h: 20 }

  it('places a name whose place is on screen', () => {
    const out = placeLandmarks([mk('here', 400, 300, size)], VIEW)
    expect(out.map((o) => o.id)).toEqual(['here'])
  })

  it('★ drops a name whose place is far outside the view instead of dragging it in', () => {
    const out = placeLandmarks([mk('far', 9000, 9000, size)], VIEW)
    expect(out).toEqual([])
  })

  it('keeps one just past the edge, so a name does not blink at the boundary', () => {
    const out = placeLandmarks([mk('edge', VIEW.w + 10, 300, size)], VIEW)
    expect(out.map((o) => o.id)).toEqual(['edge'])
  })

  it('★ the count it places follows the VIEW, not the size of the town', () => {
    const spread = (n: number): Parameters<typeof placeLandmarks>[0] =>
      Array.from({ length: n }, (_, i) => mk(`m${i}`, i * 400, (i % 7) * 300, size))
    const few = placeLandmarks(spread(10), VIEW).length
    const many = placeLandmarks(spread(400), VIEW).length
    expect(many).toBe(few)
    expect(many).toBeLessThan(10)
  })

  it('an off-screen name never takes a placement slot from an on-screen one', () => {
    const alone = placeLandmarks([mk('a', 400, 300, size)], VIEW)
    const crowded = placeLandmarks([
      ...Array.from({ length: 50 }, (_, i) => mk(`off${i}`, 5000 + i, 5000, size)),
      mk('a', 400, 300, size),
    ], VIEW)
    expect(crowded.find((o) => o.id === 'a')).toEqual(alone[0])
  })
})

// ★★ WHAT TWO MORE BROWSER SESSIONS CAUGHT, WITH THE PREVIOUS FIX LIVE AND THE SUITE GREEN.
//
// The camera lane answered the covered map with a bottom end on `landmarkAlpha`: gone at 0.25,
// full at 0.5. That is true of ONE town at ONE stop. At 0.5 the same eleven-building showcase
// still put THE WELL, THE HOUSES, THE SQUARE and THE FIRE PIT into a stepped stack over the
// square, the well and the fire pit — photographed by merge train 2 and again by this lane —
// because `placeTag` stepped each plate clear of the other PLATES and of nothing else. And in
// the other direction the ramp was wrong too: a four-ring town at 0.25 is 1056 px across and
// has ample room for its names, and the hard-coded 0.25 would have hidden them anyway.
//
// So neither end is a zoom number. Both are geometry:
//   1. a name is drawn only where it covers no named place and no other name;
//   2. the legend as a whole is drawn only while its ink is a small share of the settlement's
//      drawn area ON SCREEN — the one quantity that moves with the zoom AND with the town.
// The tests below assert those two relationships over ring counts and zoom stops, never a
// plate count and never a scale.

describe('★ the legend never covers the map it explains', () => {
  const VIEW = { x: -4000, y: -4000, w: 8000, h: 8000 }
  const overlaps = (a: Rect, b: Rect): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  /** THE TOWN A VIEWER OPENS — the grammar's own output at the showcase anchor, not a fixture
   *  written beside it. Its six names and its 1136 × 520 drawn box are the numbers in the two
   *  browser reports this rule answers. */
  const templateTown = (rings: number): S[] => {
    const a = anchorFor(rings)
    return makeCityTemplate(a, rings).structures.map((s, i) =>
      stand(`s${i}_${s.kind}`, s.kind, a.x + s.dx, a.y + s.dy, s.w, s.h))
  }

  /** Every name the town derives, with the drawn box of what it names and a plate sized off
   *  the face this product really sets it in. `size` is in WORLD units, as the layer computes
   *  it: a plate counter-scales, so it holds a constant SCREEN size and grows as you zoom out. */
  const legendOf = (list: S[], zoom: number): PlaceableMark[] =>
    landmarksOf(worldOf(list)).map((m) => {
      const style = landmarkStyle(m.rank)
      // monospace on an 8px em, the advance textFaces declares for the pixel face
      const w = m.name.length * 0.65 * style.size + LANDMARK_PAD_X * 2
      const h = style.size + LANDMARK_PAD_Y * 2
      const b = drawnBoundsOf(m.of)
      return {
        id: m.id, sx: (b.minX + b.maxX) / 2, sy: (b.minY + b.maxY) / 2,
        size: { w: w / zoom, h: h / zoom },
        of: m.of.map((f) => rectOfBounds(drawnBoundsOf([f]))),
      }
    })

  const inkAt = (list: S[], zoom: number): number =>
    legendOf(list, zoom).reduce((n, m) => n + m.size.w * m.size.h, 0) * zoom * zoom
  const townAt = (list: S[], zoom: number): number => {
    const b = rectOfBounds(drawnBoundsOf(standingOf(worldOf(list))))
    return b.w * zoom * (b.h * zoom)
  }

  // Three towns with nothing in common but the grammar: the one a viewer opens, the hand-built
  // fixture the older tests use, and the ruler with a building on every plot of every block.
  const TOWNS: Array<[string, S[]]> = [
    ['template ring 1', templateTown(1)],
    ['template ring 3', templateTown(3)],
    ['the task-59 town', TOWN],
    ['the ruler, 2 rings', bigTown(2).map((s) => stand(s.id, s.kind, s.x, s.y, s.w, s.h))],
  ]

  it('★ places no name over any named place, at any stop, in any town', () => {
    for (const [what, list] of TOWNS) {
      for (const zoom of ZOOM_STOPS) {
        const marks = legendOf(list, zoom)
        const places = marks.flatMap((m) => m.of)
        for (const p of placeLandmarks(marks, VIEW)) {
          for (const s of places) {
            expect(overlaps(p.rect, s), `${what} at ${zoom}: ${p.id} covers a place`).toBe(false)
          }
        }
      }
    }
  })

  it('★ places no name over another name either, over the same sweep', () => {
    for (const [what, list] of TOWNS) {
      for (const zoom of ZOOM_STOPS) {
        const out = placeLandmarks(legendOf(list, zoom), VIEW)
        for (let i = 0; i < out.length; i++) {
          for (let j = i + 1; j < out.length; j++) {
            expect(overlaps(out[i]!.rect, out[j]!.rect), `${what} at ${zoom}`).toBe(false)
          }
        }
      }
    }
  })

  it('★ never puts a name further from its place than the name is big', () => {
    for (const [what, list] of TOWNS) {
      for (const zoom of ZOOM_STOPS) {
        const marks = legendOf(list, zoom)
        const by = new Map(marks.map((m) => [m.id, m]))
        for (const p of placeLandmarks(marks, VIEW)) {
          const m = by.get(p.id)!
          expect(overlaps(p.rect, leashOf(m.of, m.size)), `${what} at ${zoom}: ${p.id} walked off its place`)
            .toBe(true)
        }
      }
    }
  })

  it('★ gives way at the stop where the legend outgrows the town, and not before', () => {
    const town = templateTown(1)
    // The two pictures on file: 12.8 % of the settlement at 0.5, which two lanes approved,
    // and 51.2 % at 0.25, which two lanes photographed and called a defect.
    expect(legendFits(inkAt(town, 0.5), townAt(town, 0.5)), 'the approved 0.5 picture').toBe(true)
    expect(legendFits(inkAt(town, 0.25), townAt(town, 0.25)), 'the covered 0.25 picture').toBe(false)
  })

  it('★ it is the RATIO, not the stop: hold the legend, grow the town, the names come back', () => {
    const town = templateTown(1)
    const ink = inkAt(town, 0.25), map = townAt(town, 0.25)
    expect(legendFits(ink, map)).toBe(false)
    // The same legend over a settlement four times the drawn area — two rings of growth — at
    // the same stop. Nothing about the camera changed; the map got big enough to caption.
    expect(legendFits(ink, map * 4), 'a grown town keeps its names at the widest stop').toBe(true)
  })

  it('the rule is monotone in the zoom: what gives way stays given way, going wider', () => {
    const town = templateTown(1)
    let gone = false
    for (const z of [...ZOOM_STOPS].sort((a, b) => b - a)) {
      const fits = legendFits(inkAt(town, z), townAt(town, z))
      if (fits && gone) expect.unreachable(`stop ${z} took the legend back after it gave way`)
      if (!fits) gone = true
    }
    expect(gone, 'no stop in the ladder is wide enough to lose the legend').toBe(true)
  })

  it('the share is the only number in the rule, and an empty town has no map to explain', () => {
    expect(LEGEND_INK_SHARE).toBeGreaterThan(0)
    expect(LEGEND_INK_SHARE).toBeLessThan(1)
    expect(legendFits(1, 0)).toBe(false)
  })
})

describe('landmarkAlpha is only the fade on the way IN now', () => {
  it('is full across every stop wide enough to want a legend', () => {
    expect(landmarkAlpha(0.25)).toBe(1)
    expect(landmarkAlpha(0.5)).toBe(1)
  })

  it('still disappears on the way in, exactly as it did', () => {
    expect(landmarkAlpha(1)).toBe(0)
    expect(landmarkAlpha(2)).toBe(0)
  })

  it('the fade sits strictly between two stops, so no rest stop is caught mid-band', () => {
    const mid = landmarkAlpha(0.875)
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
