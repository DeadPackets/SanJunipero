import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ZOOM_STOPS, clampCamera, fitsAt, reachableBoundsOf, tooBigToFit, type CameraBounds,
} from './camera.js'
import type { ViewRect } from './cull.js'
import { TILE_H, TILE_W, screenToTile, tileToScreen } from './iso.js'
import { TILE_COLORS } from './ground.js'
import { ROAD, WATER, bigTownPlaced, bigTownSide, bigTownTerrain } from './bigTown.js'
import {
  MARK_GROUNDS, MARK_HALO, MARK_MIN_CONTRAST, MARK_PERSON, MARK_VIEW, MARK_WATCHED,
  MINIMAP_H, MINIMAP_PAGE, MINIMAP_W, VIEW_MIN_PX,
  MINIMAP_LENSES, MINIMAP_ON_LENS,
  dotOps, mapToWorld, minimapActionFor, minimapFit, minimapPixels, minimapShown, minimapViewBox,
  overlayOps, pageTarget, peopleDots, travelTargetAt, viewHoldsTown, viewOps, worldToMap,
  type MinimapFit,
} from './minimap.js'
import { LENSES } from '../ui/route.js'

// ── THE MINIMAP, MEASURED ON A TOWN NOBODY WROTE A SIZE FOR ───────────────────────────────
//
// Every number here comes from a pure function over `bigTown`'s ring grammar. The measurement
// law binds: nothing in this file may come from a browser, and nothing in the minimap may
// assume a size the grammar is free to outgrow.

/** The stage the C12 audit measured, less the 56 px the control bar takes (task 77). */
const STAGE = { w: 1728, h: 880 - 56 }

const townOf = (rings: number): { bounds: CameraBounds; terrain: number[][]; town: ReturnType<typeof bigTownPlaced> } => {
  const terrain = bigTownTerrain(rings)
  const town = bigTownPlaced(rings)
  return { bounds: reachableBoundsOf(terrain, town), terrain, town }
}

/** The view a camera clamped to `bounds` actually shows when asked to centre on a point. */
function viewAfterTravel(target: { sx: number; sy: number }, b: CameraBounds, z: number): ViewRect {
  const p = clampCamera(
    { x: STAGE.w / 2 - target.sx * z, y: STAGE.h / 2 - target.sy * z }, z, b, STAGE,
  )
  return { x: -p.x / z, y: -p.y / z, w: STAGE.w / z, h: STAGE.h / z }
}

const rgbaAt = (px: Uint8ClampedArray, f: MinimapFit, mx: number, my: number): number => {
  const i = (my * f.w + mx) * 4
  return px[i + 3] === 0 ? -1 : (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!
}

// ── 1 · the scale is derived from the town; the widget never is ───────────────────────────

describe('the map is a fixed box at a scale the town sets', () => {
  it('is the SAME box at one ring and at ten — the chrome must not move as the town grows', () => {
    for (const rings of [1, 2, 3, 5, 10]) {
      const f = minimapFit(townOf(rings).bounds)
      expect(f.w, `${rings} rings wide`).toBe(MINIMAP_W)
      expect(f.h, `${rings} rings tall`).toBe(MINIMAP_H)
      // the town is drawn true inside it, so the letterbox is the only thing that varies
      expect(f.mw).toBeLessThanOrEqual(f.w + 0.001)
      expect(f.mh).toBeLessThanOrEqual(f.h + 0.001)
      expect(Math.min(f.ox, f.oy)).toBeGreaterThanOrEqual(-0.001)
    }
  })

  it('★ the ONLY thing a bigger town changes is the scale', () => {
    const scales = [1, 2, 3, 5, 10].map((r) => minimapFit(townOf(r).bounds).scale)
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]!, `ring ${i}`).toBeLessThan(scales[i - 1]!)
    }
    // a ten-ring town is ~7x the span of a one-ring town and gets ~1/7 the scale, in the
    // same widget — which is the whole claim
    expect(scales[0]! / scales[scales.length - 1]!).toBeGreaterThan(5)
  })

  it('holds the whole reachable box, corner to corner', () => {
    for (const rings of [1, 3, 10]) {
      const b = townOf(rings).bounds
      const f = minimapFit(b)
      for (const [sx, sy] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) {
        const p = worldToMap(sx!, sy!, f)
        expect(p.mx, `${rings} rings`).toBeGreaterThanOrEqual(-0.001)
        expect(p.my, `${rings} rings`).toBeGreaterThanOrEqual(-0.001)
        expect(p.mx).toBeLessThanOrEqual(f.w + 0.001)
        expect(p.my).toBeLessThanOrEqual(f.h + 0.001)
      }
    }
  })

  it('★ projects both ways EXACTLY — a map that rounds cannot be clicked', () => {
    const f = minimapFit(townOf(3).bounds)
    for (const sx of [-1234.5, 0, 77.25, 4000.125]) {
      for (const sy of [-88.75, 0, 512.5, 2001.0625]) {
        const p = worldToMap(sx, sy, f)
        const back = mapToWorld(p.mx, p.my, f)
        expect(back.sx, `${sx},${sy}`).toBeCloseTo(sx, 6)
        expect(back.sy, `${sx},${sy}`).toBeCloseTo(sy, 6)
      }
    }
  })
})

// ── 2 · the picture, and the feature a point sample loses ─────────────────────────────────

/**
 * The largest 8-connected run of one colour, and how many pieces the colour is in.
 *
 * EIGHT, not four: an iso street runs diagonally across the raster, so consecutive tiles land
 * on pixels that touch at a corner. Four-connectivity would call a perfectly drawn diagonal a
 * heap of dots, which is a bug in the ruler and not in the map.
 */
function shapeOf(px: Uint8ClampedArray, f: MinimapFit, color: number): { total: number; largest: number; pieces: number } {
  const hit = new Uint8Array(f.w * f.h)
  let total = 0
  for (let my = 0; my < f.h; my++) {
    for (let mx = 0; mx < f.w; mx++) {
      if (rgbaAt(px, f, mx, my) === color) { hit[my * f.w + mx] = 1; total++ }
    }
  }
  const seen = new Uint8Array(f.w * f.h)
  let largest = 0, pieces = 0
  for (let start = 0; start < hit.length; start++) {
    if (hit[start] === 0 || seen[start] === 1) continue
    pieces++
    let size = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const at = stack.pop()!
      size++
      const x = at % f.w, y = (at - (at % f.w)) / f.w
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue
          const j = ny * f.w + nx
          if (hit[j] === 1 && seen[j] === 0) { seen[j] = 1; stack.push(j) }
        }
      }
    }
    if (size > largest) largest = size
  }
  return { total, largest, pieces }
}

/**
 * THE NAIVE MAP, KEPT AS A CONTROL. One sample at the centre of every map pixel — the raster
 * anybody writes first, and the one whose failure this whole design is about. It stays in the
 * suite so the claim "a point sample loses the street grid" is re-proved on every run instead
 * of being remembered from a report.
 */
function pointSampled(terrain: readonly (readonly number[])[], f: MinimapFit): Uint8ClampedArray {
  const px = new Uint8ClampedArray(f.w * f.h * 4)
  for (let my = 0; my < f.h; my++) {
    for (let mx = 0; mx < f.w; mx++) {
      const p = mapToWorld(mx + 0.5, my + 0.5, f)
      const t = screenToTile(p.sx, p.sy - TILE_H / 2)
      const id = terrain[t.y]?.[t.x]
      if (id === undefined) continue
      const c = TILE_COLORS[id as 0]!
      const i = (my * f.w + mx) * 4
      px[i] = (c >> 16) & 0xff; px[i + 1] = (c >> 8) & 0xff; px[i + 2] = c & 0xff; px[i + 3] = 255
    }
  }
  return px
}

describe('the picture keeps the features that make a town legible', () => {
  it('draws the ground it was given, and nothing outside the world', () => {
    const { bounds, terrain, town } = townOf(1)
    const f = minimapFit(bounds)
    const px = minimapPixels(terrain, town, f)
    expect(px).toHaveLength(f.w * f.h * 4)
    let painted = 0, clear = 0
    for (let my = 0; my < f.h; my++) {
      for (let mx = 0; mx < f.w; mx++) (rgbaAt(px, f, mx, my) === -1 ? clear++ : painted++)
    }
    // the world is a diamond inside a rectangle, so both must be true at once
    expect(painted).toBeGreaterThan(f.w * f.h * 0.3)
    expect(clear).toBeGreaterThan(0)
  })

  // The ground ALONE: a building standing on a street corner genuinely covers it, and that is
  // the map telling the truth. What is measured here is whether the RASTER keeps the lattice.
  it('★ THE STREET GRID SURVIVES AT TEN RINGS — the thing a point sample dashes', () => {
    for (const rings of [1, 3, 10]) {
      const { bounds, terrain } = townOf(rings)
      const f = minimapFit(bounds)
      const road = shapeOf(minimapPixels(terrain, [], f), f, TILE_COLORS[ROAD]!)
      expect(road.total, `${rings} rings: no road at all`).toBeGreaterThan(f.w)
      // one lattice of streets is ONE shape
      expect(road.largest / road.total, `${rings} rings: ${road.total} px in ${road.pieces} pieces`)
        .toBeGreaterThan(0.9)
    }
  })

  it('★ and the control proves it: the same map, point-sampled, comes apart', () => {
    const { bounds, terrain } = townOf(10)
    const f = minimapFit(bounds)
    const ours = shapeOf(minimapPixels(terrain, [], f), f, TILE_COLORS[ROAD]!)
    const naive = shapeOf(pointSampled(terrain, f), f, TILE_COLORS[ROAD]!)
    console.log(
      `\n  ten rings, the street lattice: ours ${ours.total} px in ${ours.pieces} piece(s)`
      + ` · point-sampled ${naive.total} px in ${naive.pieces} piece(s)`,
    )
    expect(ours.pieces).toBeLessThan(naive.pieces / 4)
    expect(naive.largest / naive.total).toBeLessThan(0.5)
  })

  it('★ a one-tile channel is still a channel when a pixel is four tiles wide', () => {
    const { bounds, terrain } = townOf(10)
    const f = minimapFit(bounds)
    const water = shapeOf(minimapPixels(terrain, [], f), f, TILE_COLORS[WATER]!)
    expect(water.total).toBeGreaterThan(f.h / 4)
    expect(water.largest / water.total).toBeGreaterThan(0.9)
  })

  it('reads its colours from the ground the renderer already falls back to', () => {
    const { bounds, terrain, town } = townOf(2)
    const f = minimapFit(bounds)
    const px = minimapPixels(terrain, town, f)
    const seen = new Set<number>()
    for (let my = 0; my < f.h; my++) {
      for (let mx = 0; mx < f.w; mx++) { const c = rgbaAt(px, f, mx, my); if (c >= 0) seen.add(c) }
    }
    expect(seen.has(TILE_COLORS[ROAD]!)).toBe(true)
    expect(seen.has(TILE_COLORS[WATER]!)).toBe(true)
    expect(seen.has(TILE_COLORS[0]!)).toBe(true)
  })

  it('marks what is built, so the extent of the town is visible as such', () => {
    const { bounds, terrain, town } = townOf(2)
    const f = minimapFit(bounds)
    const bare = minimapPixels(terrain, [], f)
    const built = minimapPixels(terrain, town, f)
    let differ = 0
    for (let i = 0; i < bare.length; i += 4) if (bare[i] !== built[i] || bare[i + 1] !== built[i + 1]) differ++
    expect(differ, 'a town of 192 buildings must change the picture').toBeGreaterThan(80)
  })
})

// ── 3 · the viewport rectangle ────────────────────────────────────────────────────────────

describe('the rectangle that says where the camera is', () => {
  const { bounds } = townOf(3)
  const f = minimapFit(bounds)

  it('★ never shrinks out of existence, at any zoom stop', () => {
    for (const z of ZOOM_STOPS) {
      const v = viewAfterTravel({ sx: 0, sy: (bounds.minY + bounds.maxY) / 2 }, bounds, z)
      const box = minimapViewBox(v, f)
      expect(box.w, `zoom ${z}`).toBeGreaterThanOrEqual(Math.min(VIEW_MIN_PX, f.w))
      expect(box.h, `zoom ${z}`).toBeGreaterThanOrEqual(Math.min(VIEW_MIN_PX, f.h))
    }
  })

  it('★ never leaves the map it is drawn on', () => {
    for (const z of ZOOM_STOPS) {
      for (const corner of [
        { sx: bounds.minX, sy: bounds.minY }, { sx: bounds.maxX, sy: bounds.maxY },
        { sx: bounds.minX, sy: bounds.maxY }, { sx: bounds.maxX, sy: bounds.minY },
      ]) {
        const box = minimapViewBox(viewAfterTravel(corner, bounds, z), f)
        expect(box.x, `zoom ${z}`).toBeGreaterThanOrEqual(-0.001)
        expect(box.y, `zoom ${z}`).toBeGreaterThanOrEqual(-0.001)
        expect(box.x + box.w, `zoom ${z}`).toBeLessThanOrEqual(f.w + 0.001)
        expect(box.y + box.h, `zoom ${z}`).toBeLessThanOrEqual(f.h + 0.001)
      }
    }
  })

  it('says where the camera IS: the rectangle keeps the view’s own centre', () => {
    const v = viewAfterTravel({ sx: 0, sy: (bounds.minY + bounds.maxY) / 2 }, bounds, 2)
    const box = minimapViewBox(v, f)
    const want = worldToMap(v.x + v.w / 2, v.y + v.h / 2, f)
    expect(box.x + box.w / 2).toBeCloseTo(want.mx, 3)
    expect(box.y + box.h / 2).toBeCloseTo(want.my, 3)
  })

  it('covers the whole map when the whole town is on screen', () => {
    const one = townOf(1)
    const f1 = minimapFit(one.bounds)
    const v = viewAfterTravel(
      { sx: (one.bounds.minX + one.bounds.maxX) / 2, sy: (one.bounds.minY + one.bounds.maxY) / 2 },
      one.bounds, ZOOM_STOPS[0]!,
    )
    const box = minimapViewBox(v, f1)
    expect(box.w).toBeCloseTo(f1.w, 0)
    expect(box.h).toBeCloseTo(f1.h, 0)
  })
})

// ── 3b · the map leaves when the town is already all on screen ────────────────────────────
//
// ★ WHAT THE FOREGROUNDED BROWSER CAUGHT. At 0.25 on the showcase town the whole settlement was
// 370 x 190 px in the middle of the stage, and the map sat in the corner drawing the same thing
// smaller, under a rectangle that covered its whole self. This asserts the rule against CLAMPED
// views — the ones a real camera can actually be in — rather than against invented rectangles.

describe('the map is only there when the town is bigger than the view', () => {
  it('★ is away exactly when the town fits, at every stop and at every ring count', () => {
    for (const rings of [1, 3, 10]) {
      const { bounds } = townOf(rings)
      const f = minimapFit(bounds)
      const centre = { sx: (bounds.minX + bounds.maxX) / 2, sy: (bounds.minY + bounds.maxY) / 2 }
      for (const z of ZOOM_STOPS) {
        const fits = fitsAt(bounds, STAGE, z)
        const away = viewHoldsTown(viewAfterTravel(centre, bounds, z), f)
        expect(away, `${rings} rings at ${z}: fits=${fits} away=${away}`).toBe(fits)
      }
    }
  })

  it('★ a town too big for the widest stop never loses its map', () => {
    const { bounds } = townOf(10)
    const f = minimapFit(bounds)
    expect(tooBigToFit(bounds, STAGE)).toBe(true)
    for (const z of ZOOM_STOPS) {
      const centre = { sx: (bounds.minX + bounds.maxX) / 2, sy: (bounds.minY + bounds.maxY) / 2 }
      expect(viewHoldsTown(viewAfterTravel(centre, bounds, z), f), `zoom ${z}`).toBe(false)
    }
  })
})

// ── 4 · going there ───────────────────────────────────────────────────────────────────────

describe('a click is a promise that you will be looking at what you clicked', () => {
  it('★ every point on the map lands inside the view it produces, at every stop', () => {
    for (const rings of [1, 3, 10]) {
      const { bounds } = townOf(rings)
      const f = minimapFit(bounds)
      for (const z of ZOOM_STOPS) {
        for (let my = 0; my <= f.h; my += Math.max(1, Math.floor(f.h / 6))) {
          for (let mx = 0; mx <= f.w; mx += Math.max(1, Math.floor(f.w / 6))) {
            const t = travelTargetAt(mx, my, f)
            const v = viewAfterTravel(t, bounds, z)
            const inside = t.sx >= v.x - 1 && t.sx <= v.x + v.w + 1
              && t.sy >= v.y - 1 && t.sy <= v.y + v.h + 1
            expect(inside, `${rings} rings, zoom ${z}, map ${mx},${my}`).toBe(true)
          }
        }
      }
    }
  })

  it('a point off the edge of the map is pulled onto it, never followed off the world', () => {
    const { bounds } = townOf(2)
    const f = minimapFit(bounds)
    for (const [mx, my] of [[-50, -50], [f.w + 90, f.h + 90], [-1, f.h / 2]]) {
      const t = travelTargetAt(mx!, my!, f)
      expect(t.sx).toBeGreaterThanOrEqual(bounds.minX - 0.001)
      expect(t.sx).toBeLessThanOrEqual(bounds.maxX + 0.001)
      expect(t.sy).toBeGreaterThanOrEqual(bounds.minY - 0.001)
      expect(t.sy).toBeLessThanOrEqual(bounds.maxY + 0.001)
    }
  })
})

describe('the keyboard reaches the same places the pointer does', () => {
  it('names an action for every arrow and for the way home, and for nothing else', () => {
    expect(minimapActionFor('ArrowLeft')).toEqual({ kind: 'page', dx: -1, dy: 0 })
    expect(minimapActionFor('ArrowRight')).toEqual({ kind: 'page', dx: 1, dy: 0 })
    expect(minimapActionFor('ArrowUp')).toEqual({ kind: 'page', dx: 0, dy: -1 })
    expect(minimapActionFor('ArrowDown')).toEqual({ kind: 'page', dx: 0, dy: 1 })
    expect(minimapActionFor('Home')).toEqual({ kind: 'whole' })
    for (const k of ['a', 'Escape', 'Tab', '+', 'PageUp']) expect(minimapActionFor(k), k).toBeNull()
  })

  it('★ a page is a screenful that keeps a tenth of what you were looking at', () => {
    const v: ViewRect = { x: 1000, y: 500, w: 800, h: 400 }
    const right = pageTarget(v, 1, 0)
    expect(right.sx).toBeCloseTo(1400 + 800 * MINIMAP_PAGE, 6)
    expect(right.sy).toBeCloseTo(700, 6)
    expect(MINIMAP_PAGE).toBeLessThan(1)
    expect(MINIMAP_PAGE).toBeGreaterThan(0.5)
  })

  it('★ crosses a ten-ring town in a countable number of presses, at every stop', () => {
    const { bounds } = townOf(10)
    for (const z of ZOOM_STOPS) {
      let v = viewAfterTravel({ sx: bounds.minX, sy: bounds.minY }, bounds, z)
      let presses = 0
      while (v.x + v.w < bounds.maxX && presses < 200) {
        v = viewAfterTravel(pageTarget(v, 1, 0), bounds, z)
        presses++
      }
      expect(presses, `zoom ${z} took ${presses} presses`).toBeLessThanOrEqual(40)
      expect(v.x + v.w).toBeGreaterThanOrEqual(bounds.maxX - 1)
    }
  })
})

// ── 5 · people, and what a dot per person costs ───────────────────────────────────────────

describe('people on a map the size of a postcard', () => {
  const { bounds } = townOf(3)
  const f = minimapFit(bounds)
  const person = (id: string, x: number, y: number) => ({ id, x, y })

  it('puts each person where they stand', () => {
    const p = person('a', 40, 40)
    const dots = peopleDots([p], f, null)
    const s = tileToScreen(p.x, p.y)
    const want = worldToMap(s.sx, s.sy, f)
    expect(dots).toHaveLength(1)
    expect(dots[0]!.mx).toBe(Math.round(want.mx))
    expect(dots[0]!.my).toBe(Math.round(want.my))
  })

  it('★ a crowd on one pixel is ONE dot — crowding reads as a cluster, never as overdraw', () => {
    const crowd = Array.from({ length: 300 }, (_, i) => person(`p${i}`, 40, 40))
    expect(peopleDots(crowd, f, null)).toHaveLength(1)
    const spread = Array.from({ length: 300 }, (_, i) => person(`p${i}`, 20 + i * 3, 20 + i * 3))
    expect(peopleDots(spread, f, null).length).toBeLessThanOrEqual(spread.length)
    expect(peopleDots(spread, f, null).length).toBeGreaterThan(10)
  })

  // ★ WHAT THE FOREGROUNDED BROWSER CAUGHT AND NOTHING HERE COULD HAVE.
  //
  // A dead agent stays in `state.agents` with `alive: false`; the roster counts it as
  // "remembered". Every fixture above is `{ id, x, y }`, so the field that decides this was not
  // in the shape being tested — and the dev world showed five white dots standing in the square
  // under a status strip reading TOWNSFOLK 0.
  it('★ does not draw the dead, whose bodies are still in the state', () => {
    const alive = { id: 'a', x: 40, y: 40, alive: true }
    const dead = { id: 'b', x: 60, y: 60, alive: false }
    expect(peopleDots([alive, dead], f, null)).toHaveLength(1)
    expect(peopleDots([dead], f, 'b'), 'not even the one being watched').toHaveLength(0)
    // absent means alive, the way every optional field in this world's state means its default
    expect(peopleDots([{ id: 'c', x: 40, y: 40 }], f, null)).toHaveLength(1)
  })

  it('★ agrees with the town about who is standing in it — one rule, not two', () => {
    const src = readFileSync(new URL('./characters.ts', import.meta.url), 'utf8')
    const townRule = /export function rendersOnMap\([\s\S]*?\n\}/.exec(src)?.[0] ?? ''
    const flat = townRule.replace(/\s+/g, ' ')
    expect(flat, 'characters.ts no longer decides this the way the map does')
      .toContain('return a.alive && a.insideId === undefined')
    // and the map's own departure from it is exactly one clause, stated where it is made
    expect(peopleDots([{ id: 'in', x: 40, y: 40, alive: true, insideId: 's1' }], f, null))
      .toHaveLength(0)
    expect(peopleDots([{ id: 'in', x: 40, y: 40, alive: true, insideId: 's1' }], f, 'in'))
      .toHaveLength(1)
  })

  it('★ the person you are following is never the one that got deduplicated away', () => {
    const crowd = Array.from({ length: 40 }, (_, i) => person(`p${i}`, 40, 40))
    const dots = peopleDots([...crowd, person('her', 40, 40)], f, 'her')
    expect(dots.filter((d) => d.focus)).toHaveLength(1)
    // and she is drawn last, so nothing can be painted over her
    expect(dots[dots.length - 1]!.focus).toBe(true)
  })

  it('costs at most one dot per map pixel, whatever the town does', () => {
    const many = Array.from({ length: 4000 }, (_, i) => person(`p${i}`, i % 200, (i * 7) % 200))
    expect(peopleDots(many, f, null).length).toBeLessThanOrEqual(f.w * f.h)
  })
})

describe('what one frame of the overlay costs, counted', () => {
  const { bounds } = townOf(10)
  const f = minimapFit(bounds)
  const view = viewAfterTravel({ sx: 0, sy: 0 }, bounds, 2)

  it('★ is a bounded display list — no per-frame work grows with the town', () => {
    const few = overlayOps(view, peopleDots(
      Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, x: 50 + i * 9, y: 60 })), f, 'p3',
    ), f)
    const many = overlayOps(view, peopleDots(
      Array.from({ length: 4000 }, (_, i) => ({ id: `p${i}`, x: i % 300, y: (i * 3) % 300 })), f, 'p3',
    ), f)
    expect(few.length).toBeGreaterThan(4)
    expect(few.length).toBeLessThan(64)
    // ★ 4000 people cannot cost 4000 ops. Every mark is two rectangles — a dark halo under a
    // light core, because no single colour clears 3:1 on every ground this map draws — so the
    // ceiling is TWO PER MAP PIXEL, set by the widget and never by the population.
    expect(many.length).toBeLessThanOrEqual(2 * f.w * f.h + 16)
    expect(many.length).toBeLessThan(4000)
  })

  it('draws the rectangle whatever else is on the map, and never off it', () => {
    const ops = overlayOps(view, [], f)
    expect(ops.length).toBeGreaterThanOrEqual(4)
    for (const o of ops) {
      expect(o.x).toBeGreaterThanOrEqual(-2)
      expect(o.y).toBeGreaterThanOrEqual(-2)
      expect(o.x + o.w).toBeLessThanOrEqual(f.w + 2)
      expect(o.y + o.h).toBeLessThanOrEqual(f.h + 2)
      expect(o.w).toBeGreaterThan(0)
      expect(o.h).toBeGreaterThan(0)
    }
  })
})

// ── 5b · ★ EVERY MARK IS LEGIBLE ON EVERY GROUND, AND IT IS MEASURED ──────────────────────
//
// The chrome's mandate is that no single palette token clears AA in both bands, so per-band
// tokens are mandatory. The same is true one level down, on this canvas: the grounds run from
// `forest` #4F7040 to `sand` #E8D5BC and include the ink of the buildings, and NO ONE COLOUR
// clears 3:1 on all of them. So every mark is layered, and the law is: for each ground, at
// least one tone of the mark must clear 3:1 against it.
//
// This caught a real failure. The watched marker was two tones, and on `forest` the ember read
// 1.95 and its own `--deep` halo 2.85 — both under the floor, on the one mark a viewer is
// hunting for. It is three tones now. Opacity is not a contrast strategy and is not used here.

const channel = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const luminance = (c: number): number => {
  const [r, g, b] = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff].map((v) => channel(v / 255))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: number, b: number): number => {
  const [x, y] = [luminance(a), luminance(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

describe('the marks a viewer reads, against every ground under them', () => {
  const { bounds } = townOf(3)
  const f = minimapFit(bounds)
  const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

  /** The tones one mark is drawn in, outermost first — read off the display list itself, so a
   *  mark that changes shape cannot quietly leave this check behind. */
  const tonesOf = (dot: { mx: number; my: number; focus: boolean }): number[] =>
    dotOps([dot], f).map((o) => o.color)

  it('prints the table this rule is enforced from', () => {
    const marks: Array<[string, number[]]> = [
      ['the camera rectangle', [...new Set(viewOps({ x: 0, y: 0, w: 2000, h: 1000 }, f).map((o) => o.color))]],
      ['a person', tonesOf({ mx: 40, my: 40, focus: false })],
      ['the one you are watching', tonesOf({ mx: 40, my: 40, focus: true })],
    ]
    console.log(`\n  mark                     tones                          worst ground   best tone there`)
    for (const [name, tones] of marks) {
      let worst = Infinity, where = 0
      for (const g of MARK_GROUNDS) {
        const best = Math.max(...tones.map((t) => contrast(t, g)))
        if (best < worst) { worst = best; where = g }
      }
      console.log(
        `  ${name.padEnd(24)} ${tones.map(hex).join(' ').padEnd(30)} ${hex(where).padEnd(14)} ${worst.toFixed(2)}`,
      )
    }
    expect(MARK_GROUNDS.length).toBeGreaterThan(8)
  })

  it('★ every mark clears 3:1 on every ground the raster can draw', () => {
    const marks: Array<[string, number[]]> = [
      ['camera rectangle', [...new Set(viewOps({ x: 0, y: 0, w: 2000, h: 1000 }, f).map((o) => o.color))]],
      ['person', tonesOf({ mx: 40, my: 40, focus: false })],
      ['watched', tonesOf({ mx: 40, my: 40, focus: true })],
    ]
    for (const [name, tones] of marks) {
      expect(tones.length, `${name} is a single tone — no ground-independent colour exists`)
        .toBeGreaterThan(1)
      for (const g of MARK_GROUNDS) {
        const best = Math.max(...tones.map((t) => contrast(t, g)))
        expect(best, `${name} on ${hex(g)}: best tone is only ${best.toFixed(2)}`)
          .toBeGreaterThanOrEqual(MARK_MIN_CONTRAST)
      }
    }
  })

  it('records the pair it rejected, so two tones cannot come back for the watched marker', () => {
    const FOREST = 0x4f7040
    expect(contrast(MARK_WATCHED, FOREST)).toBeCloseTo(1.95, 2)
    expect(contrast(MARK_HALO, FOREST)).toBeCloseTo(2.85, 2)
    // and the ring that rescued it
    expect(contrast(MARK_PERSON, FOREST)).toBeGreaterThanOrEqual(MARK_MIN_CONTRAST)
  })

  it('★ no single palette colour would have done, which is why they are layered', () => {
    for (const tone of [MARK_HALO, MARK_VIEW, MARK_PERSON, MARK_WATCHED]) {
      const fails = MARK_GROUNDS.filter((g) => contrast(tone, g) < MARK_MIN_CONTRAST)
      expect(fails.length, `${hex(tone)} clears every ground alone — the layering could be dropped`)
        .toBeGreaterThan(0)
    }
  })
})

// ── 6 · getting out of the way ────────────────────────────────────────────────────────────

describe('a minimap that covers the town it explains is worse than none', () => {
  it('leaves when another surface owns the stage, and when the viewer is indoors', () => {
    expect(minimapShown('map', null, false)).toBe(true)
    expect(minimapShown('inspector', null, false)).toBe(true)
    expect(minimapShown('laws', null, false)).toBe(true)
    // the same right-hand slide-over as the inspector, and it was missing from the whitelist
    expect(minimapShown('discoveries', null, false)).toBe(true)
    // the society graph replaces the canvas; the film strip and the timeline own the bottom
    expect(minimapShown('society', null, false)).toBe(false)
    expect(minimapShown('director', null, false)).toBe(false)
    expect(minimapShown('chronicle', null, false)).toBe(false)
  })

  it('leaves when the viewer is inside a room, and when they put it away', () => {
    expect(minimapShown('map', 's_house_1', false)).toBe(false)
    expect(minimapShown('map', null, true)).toBe(false)
  })

  // ★ THE WHITELIST WAS THE BUG, NOT THE MISSING WORD IN IT.
  //
  // `MINIMAP_LENSES = ['map', 'inspector', 'laws']` was written before the Discovery Record
  // existed. `discoveries` then arrived, was never once mentioned in this module or in either
  // of its two test files, and got "no map" by silence — the SAME right-hand slide-over as
  // `inspector`, which is on the list. Nobody decided; a list defaulted.
  //
  // These two close it. The first says every lens the route can produce has an answer written
  // down, so a lens added later fails HERE rather than shipping a default. The second is the
  // same claim at compile time, and it is the stronger of the two: `Record<Lens, boolean>`
  // cannot be written at all without an entry per lens.
  it('★ every lens the route can reach has an explicit answer — no lens defaults', () => {
    for (const lens of LENSES) {
      expect(
        Object.prototype.hasOwnProperty.call(MINIMAP_ON_LENS, lens),
        `${lens} has no minimap decision: a new lens must choose, not inherit silence`,
      ).toBe(true)
      expect(typeof MINIMAP_ON_LENS[lens], lens).toBe('boolean')
    }
    // and no answer for a lens that does not exist, which is how a rename goes unnoticed
    expect(Object.keys(MINIMAP_ON_LENS).sort()).toEqual([...LENSES].sort())
  })

  it('the reader\'s list is derived from the table, never transcribed beside it', () => {
    expect([...MINIMAP_LENSES].sort())
      .toEqual(LENSES.filter((l) => MINIMAP_ON_LENS[l]).sort())
    expect(MINIMAP_LENSES.length).toBeGreaterThan(0)
    expect(MINIMAP_LENSES.length).toBeLessThan(LENSES.length)
  })
})

// ── 7 · the numbers this lane is accountable for ──────────────────────────────────────────

/** Median of `n` runs — a mean lets one GC pause set the number. */
function medianMs(n: number, fn: () => void): number {
  const runs: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    fn()
    runs.push(performance.now() - t0)
  }
  return runs.sort((a, b) => a - b)[Math.floor(n / 2)]!
}

describe('the minimap in one number per ring count', () => {
  it('prints what the map costs and what it shows, one ring to ten', () => {
    const rows = [1, 2, 3, 5, 10].map((rings) => {
      const { bounds, terrain, town } = townOf(rings)
      const f = minimapFit(bounds)
      const side = bigTownSide(rings)
      const people = Array.from({ length: 24 }, (_, i) => ({ id: `p${i}`, x: 20 + i * 5, y: 30 + i * 3 }))
      const view = viewAfterTravel({ sx: 0, sy: 0 }, bounds, 2)
      const dots = peopleDots(people, f, 'p7')
      return {
        rings,
        tiles: side * side,
        structures: town.length,
        span: `${Math.round(bounds.maxX - bounds.minX)} x ${Math.round(bounds.maxY - bounds.minY)}`,
        map: `${f.w} x ${f.h}`,
        worldPxPerMapPx: (1 / f.scale).toFixed(1),
        tilesPerMapPx: (1 / (f.scale * (TILE_H / 2))).toFixed(2),
        raster: minimapPixels(terrain, town, f).length / 4,
        rasterMs: medianMs(5, () => { minimapPixels(terrain, town, f) }),
        ops: overlayOps(view, dots, f).length,
        frameMs: medianMs(51, () => { overlayOps(view, dots, f) }),
      }
    })
    console.log(
      `\n  rings | tiles   | built | town span      | map      | world px/px | tiles/px`
      + ` | raster px | rebuild ms | frame ops | frame ms`,
    )
    for (const r of rows) {
      console.log(
        `  ${String(r.rings).padStart(5)} | ${String(r.tiles).padStart(7)} | ${String(r.structures).padStart(5)}`
        + ` | ${r.span.padStart(14)} | ${r.map.padStart(8)} | ${r.worldPxPerMapPx.padStart(11)}`
        + ` | ${r.tilesPerMapPx.padStart(8)} | ${String(r.raster).padStart(9)}`
        + ` | ${r.rasterMs.toFixed(2).padStart(10)} | ${String(r.ops).padStart(9)} | ${r.frameMs.toFixed(4).padStart(8)}`,
      )
    }
    // ★ THE CLAIM: the raster is the same size at ten rings as at one. Only the scale moved.
    expect(new Set(rows.map((r) => r.raster)).size).toBe(1)
    expect(rows[0]!.raster).toBe(MINIMAP_W * MINIMAP_H)
    // ★ AND THE ONE THAT MATTERS FOR A FRAME: what a camera MOVE costs is set by the crowd and
    // the widget, never by the town. Eight rectangles for the camera, two per person, and one
    // more for the third tone the watched marker needs to clear forest — and a ten-ring town
    // does not cost one op more than a three-ring one.
    const CEILING = 8 + 2 * 24 + 1
    for (const r of rows) expect(r.ops, `${r.rings} rings`).toBeLessThanOrEqual(CEILING)
    expect(rows[rows.length - 1]!.ops).toBeLessThanOrEqual(rows[2]!.ops)
    expect(TILE_W).toBe(32)
  })
})
