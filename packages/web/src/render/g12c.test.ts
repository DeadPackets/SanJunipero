import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CITY_FURNISHING_KINDS, makeCityTemplate, danglingRoadEnds, frontages } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'

// GATE G12c — THE CANVAS HALF. Split by package for the D-41 reason: `@sj/web` is private,
// DOM-typed and bundler-resolved, so a gateway test cannot import its modules without
// breaking `tsc -b`. The other two files are:
//   packages/web/src/ui/g12c.test.ts        — the chrome half (U12–U17, U20–U24, P22)
//   packages/gateway/src/g12c.test.ts       — the town, U25, and the read-only proof
//
// EVERY LINE IS A GATE CRITERION, NOT A SUGGESTION, and each names its U-id so a failure is
// reported in the user's own vocabulary.

import {
  ZOOM_SETTLE_MS, ZOOM_STOPS, WHEEL_GESTURE_GAP_MS, fitStop, initialZoom, nearestStop, stageFill, stageFillFloor,
  zoomRelease,
  zoomScaleAt, zoomTo, zoomWheel,
} from './camera.js'
import { landmarkAlpha, landmarksOf, placeLandmarks } from './landmarks.js'
import { AA_RATIO, LANDMARK_INK, LANDMARK_PLATE, WORLD_TEXT_PAIRS, bandRatios, worldTextOffenders } from './legibility.js'
import { ROAD_GROUND_LUMA_DELTA_MIN, LATTICE_PEAK_MAX, latticePeak, luma, roadReadsAt } from './groundField.js'
import { TILE_COLORS } from './ground.js'
import { patchOutline } from './patches.js'
import { FURNITURE_OCCUPANCY, INTERIOR_LAYOUTS, occupancyOf, roomFurnishings } from './interiors.js'
import { ROOM_SLOTS, SLOT_TILES, WALL_H_TILES, wallPolys } from './roomShell.js'
import {
  OVERLAP_RANK, bodyDepthBox, depthOrder, structureDepthBox, tileDepthBox, type DepthBox,
} from './depth.js'
import { doorTileOf } from './entities.js'
import {
  HIT_MIN_PX, HIT_TIGHTNESS_MAX, bodyHitPolygon, doorLocalRect, hitTightness,
} from './hitShapes.js'
import { placeTag } from './tooltip.js'
import { SPEECH_FILL, SPEECH_INK, THOUGHT_FILL, THOUGHT_INK, nineSlice, worldTextScale } from './textFaces.js'
import { literalZIndexOffenders, LAYERS, SORTED_LAYER } from './layers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SRC = join(HERE, '..')
const src = (rel: string): string => readFileSync(join(WEB_SRC, rel), 'utf8')

function sources(dir = WEB_SRC): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue
    out.push({ path: p.slice(WEB_SRC.length + 1), source: readFileSync(p, 'utf8') })
  }
  return out
}

const ANCHOR = { x: 0, y: 9 }
const TEMPLATE = makeCityTemplate(ANCHOR)

// ── U3 · the town is a PLACE, not chaos ───────────────────────────────────────────────────

describe('U3 — "it just looks like chaos… no genuine structure"', () => {
  it('stands eleven buildings, not the four the screenshot showed', () => {
    expect(TEMPLATE.structures).toHaveLength(11)
  })

  it('puts every door on a road, so a path leads somewhere', () => {
    const orphans = frontages(TEMPLATE).filter((f) => f.onto === null)
    expect(orphans.map((o) => `${o.kind} at ${o.door.dx},${o.door.dy}`)).toEqual([])
  })

  it('leaves no road running off into nothing', () => {
    expect(danglingRoadEnds(TEMPLATE)).toEqual([])
  })

  it('fills the stage on the first frame rather than showing a speck', () => {
    // the drawn extent of the eleven-structure town, in the space `tileToScreen` returns
    const drawn = { minX: -520, maxX: 520, minY: -300, maxY: 300 }
    const stage = { w: 1280, h: 720 }
    const fit = fitStop(drawn, stage)
    expect(stageFill(drawn, fit, stage)).toBeGreaterThanOrEqual(stageFillFloor(drawn, stage))
  })

  it('names a rank-1 centre a viewer can navigate by', () => {
    const state = {
      structures: Object.fromEntries(TEMPLATE.structures.map((s, i) => [
        `s${i}`, { id: `s${i}`, kind: s.kind, x: ANCHOR.x + s.dx, y: ANCHOR.y + s.dy, w: s.w, h: s.h, stage: 'complete' },
      ])),
    } as unknown as WorldState
    const marks = landmarksOf(state)
    expect(marks.filter((m) => m.rank === 1)).toHaveLength(1)
    expect(marks.length).toBeGreaterThan(3)
  })
})

// ── U4 · interiors — REPORTED OPEN, and the gate says why ─────────────────────────────────

describe('U4 — "interiors are way too low quality, way too under detailed" — OPEN', () => {
  it('has the room shell the code-painted polygon can draw', () => {
    const polys = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    expect(Object.keys(polys).length).toBeGreaterThanOrEqual(2)
    for (const [kind, poly] of Object.entries(polys)) {
      expect(poly.length, kind).toBeGreaterThanOrEqual(6)
      expect(new Set(poly).size, `${kind} is degenerate`).toBeGreaterThan(2)
    }
  })

  it('is total over every furnishing kind the template can place', () => {
    for (const kind of CITY_FURNISHING_KINDS) {
      expect(FURNITURE_OCCUPANCY[kind], kind).toBeDefined()
      expect(['in', 'at', 'beside']).toContain(occupancyOf(kind))
    }
  })

  it('orders a sleeping body BETWEEN a bed\'s two halves', () => {
    const bed = INTERIOR_LAYOUTS.house.find((f) => f.kind === 'bed')!
    expect(occupancyOf(bed.kind)).toBe('in')
    expect(roomFurnishings('house').some((f) => f.kind === 'bed')).toBe(true)
  })

  // ★ THE HONEST LINE. Everything above is the code-painted polygon working as designed. The
  // user reopened U4 after it was accepted once, and what they are asking for — real mapped
  // rooms — needs a RENDERER THAT DOES NOT EXIST (C12b owns it), which is also why the forge
  // cannot make an interior tileset class: there is nothing for it to generate for.
  it('is a POLYGON, not a tileset, and that is why U4 stays open', () => {
    expect(src('render/roomShell.ts')).toMatch(/Graphics|poly/)
    const anyInteriorTileset = sources().some((f) => /interior-tileset|interiorTileset/.test(f.source))
    expect(anyInteriorTileset, 'if this is true, U4 can be reassessed').toBe(false)
  })
})

// ── U5 · roads that carry at 1x ───────────────────────────────────────────────────────────

describe('U5 — "roads read ghost-faint at 1x"', () => {
  it('carries a hard edge against the ground it runs through', () => {
    const dark = luma(0x9c6b47), light = luma(0xe8d5bc), grass = luma(TILE_COLORS[0]!)
    expect(roadReadsAt(light, grass) || roadReadsAt(dark, grass)).toBe(true)
    expect(Math.abs(light - dark)).toBeGreaterThanOrEqual(ROAD_GROUND_LUMA_DELTA_MIN)
  })

  it('would still fail on the single shoulder tone it replaced, so the check is not vacuous', () => {
    expect(roadReadsAt(luma(0xb89d7e), luma(TILE_COLORS[0]!))).toBe(false)
  })
})

// ── U6 · a ground with no visible repeat ──────────────────────────────────────────────────

describe('U6 — "grass repeat is visible to the eye on a regular grid"', () => {
  const W = 64, H = 64
  it('reads a field with no repeat as no lattice', () => {
    const noise = new Uint8ClampedArray(W * H * 4)
    let seed = 3
    for (let i = 0; i < W * H; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const v = seed % 256
      noise[i * 4] = v; noise[i * 4 + 1] = v; noise[i * 4 + 2] = v; noise[i * 4 + 3] = 255
    }
    expect(latticePeak(noise, W, H, 16)).toBeLessThan(LATTICE_PEAK_MAX)
  })

  it('catches a hard 16px repeat, so the measure is not vacuous', () => {
    const grid = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = (x % 16 === 0 || y % 16 === 0) ? 255 : 0
        const i = (y * W + x) * 4
        grid[i] = v; grid[i + 1] = v; grid[i + 2] = v; grid[i + 3] = 255
      }
    }
    expect(latticePeak(grid, W, H, 16)).toBeGreaterThan(LATTICE_PEAK_MAX)
  })
})

// ── U7 · a patch with an edge ─────────────────────────────────────────────────────────────

describe('U7 — "farmland/plaza reads as an amorphous blob"', () => {
  it('gives a solid patch ONE outline and no interior segments', () => {
    const tiles = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
    const rings = patchOutline(tiles)
    expect(rings).toHaveLength(1)
    const ring = rings[0]!
    expect(ring.length % 2, 'a ring is flat x,y pairs').toBe(0)
    // a 2x2 block of diamonds has exactly eight outer edges; an outline that kept the four
    // interior edges would carry twelve. This is the "blob" line, measured.
    expect(ring.length / 2).toBe(8)
  })

  it('finds a hole rather than smoothing it away, so the outline is not vacuous', () => {
    const donut = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 }, { x: 2, y: 1 },
      { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ]
    expect(patchOutline(donut).length).toBeGreaterThan(1)
  })
})

// ── U8 · the layering, reviewed ───────────────────────────────────────────────────────────

const townBoxes = (): DepthBox[] => TEMPLATE.structures.map((s, i) =>
  structureDepthBox(`s${i}`, { x: ANCHOR.x + s.dx, y: ANCHOR.y + s.dy, w: s.w, h: s.h }))

describe('U8 — "characters walk behind buildings and the layering makes no sense"', () => {
  it('puts a body standing in front of a door IN FRONT of the building, for all eleven', () => {
    const disagreements: string[] = []
    TEMPLATE.structures.forEach((s, i) => {
      const at = { x: ANCHOR.x + s.dx, y: ANCHOR.y + s.dy, w: s.w, h: s.h }
      const d = doorTileOf(at)
      // the tile directly IN FRONT of the door — one step south of the frontage row
      const body = bodyDepthBox('body', d.x, d.y + 1)
      const order = depthOrder([structureDepthBox(`s${i}`, at), body])
      if (order.indexOf('body') < order.indexOf(`s${i}`)) disagreements.push(`${s.kind} hides a body in its own doorway`)
    })
    expect(disagreements).toEqual([])
  })

  it('is deterministic over twenty shuffles of the same town', () => {
    const boxes = townBoxes()
    const want = depthOrder(boxes)
    for (let n = 0; n < 20; n++) {
      const shuffled = [...boxes]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = (i * 7 + n * 13) % (i + 1)
        ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
      }
      expect(depthOrder(shuffled)).toEqual(want)
    }
  })

  it('has ONE writer of a depth index in the whole bundle', () => {
    expect(literalZIndexOffenders(sources())).toEqual([])
    expect(LAYERS).toHaveLength(8)
    expect(SORTED_LAYER).toBe('entities')
  })

  it('does not throw on a pinwheel, and the overlap rank is the only cycle source', () => {
    const ring: DepthBox[] = [
      tileDepthBox('a', 0, 0), tileDepthBox('b', 1, 0), tileDepthBox('c', 1, 1), tileDepthBox('d', 0, 1),
    ]
    expect(() => depthOrder(ring)).not.toThrow()
    expect(depthOrder(ring)).toHaveLength(4)
    expect(OVERLAP_RANK.body).toBeGreaterThan(OVERLAP_RANK.structure)
  })
})

// ── U9 · hit shapes that match what is drawn ──────────────────────────────────────────────

describe('U9 — "the borders of the characters aren\'t 100% accurate"', () => {
  it('holds the capsule inside the tightness ceiling at every art scale', () => {
    for (const scale of [1, 1.5, 2, 3]) {
      const t = hitTightness(bodyHitPolygon(32, scale), 24, 32, scale)
      expect(t, `scale ${scale}`).toBeLessThanOrEqual(HIT_TIGHTNESS_MAX)
    }
  })
})

// ── U10 · tooltips that land where they point ─────────────────────────────────────────────

describe('U10 — "tooltips are out of place"', () => {
  const view = { x: 0, y: 0, w: 1280, h: 720 }
  const size = { w: 120, h: 24 }

  it('keeps every one of forty sampled anchors inside the viewport', () => {
    for (let i = 0; i < 40; i++) {
      const a = { sx: (i * 137) % 1400 - 60, sy: (i * 71) % 800 - 40, halfW: 20, topY: (i * 71) % 800 - 70 }
      const at = placeTag(a, size, view)
      expect(at.sx - size.w / 2, `sample ${i}`).toBeGreaterThanOrEqual(view.x)
      expect(at.sx + size.w / 2, `sample ${i}`).toBeLessThanOrEqual(view.x + view.w)
      expect(at.sy, `sample ${i}`).toBeGreaterThanOrEqual(view.y)
      expect(at.sy + size.h, `sample ${i}`).toBeLessThanOrEqual(view.y + view.h)
    }
  })

  it('never lands two owners on the same box', () => {
    const first = placeTag({ sx: 640, sy: 360, halfW: 20, topY: 330 }, size, view)
    const taken = [{ x: first.sx - size.w / 2, y: first.sy, w: size.w, h: size.h }]
    const second = placeTag({ sx: 640, sy: 360, halfW: 20, topY: 330 }, size, view, taken)
    expect(Math.abs(second.sy - first.sy)).toBeGreaterThan(0)
  })

  it('places the world\'s OWN words clear of each other too (carry-in A4.2)', () => {
    const marks = [0, 1, 2, 3].map((i) => ({
      id: `m${i}`, sx: 640, sy: 360, size, of: [{ x: 624, y: 328, w: 32, h: 40 }],
    }))
    const placed = placeLandmarks(marks, view)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const [a, b] = [placed[i]!.rect, placed[j]!.rect]
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
      }
    }
  })
})

// ── U11 · the door is part of the building ────────────────────────────────────────────────

describe('U11 — "door hotspots render as dark rectangular artifacts"', () => {
  it('clears the 24px hit floor in both axes at every zoom stop', () => {
    for (const zoom of ZOOM_STOPS) {
      const r = doorLocalRect({ w: 1, h: 1 }, 1, zoom)
      expect(r.w * zoom, `zoom ${zoom} width`).toBeGreaterThanOrEqual(HIT_MIN_PX)
      expect(r.h * zoom, `zoom ${zoom} height`).toBeGreaterThanOrEqual(HIT_MIN_PX)
    }
  })

  it('gives the door no depth of its own — it is a child of its building', () => {
    expect(src('render/entities.ts')).not.toContain('doorZIndex')
    expect(src('render/entities.ts')).toContain('entry.sprite.addChild(door)')
  })
})

// ── U18 · text boxes with a voice ─────────────────────────────────────────────────────────

describe('U18 — "text boxes are not vibrant, not stylized, not clear enough"', () => {
  it('asks no world-text module for the browser\'s default mono', () => {
    for (const f of ['render/bubbles.ts', 'render/characters.ts', 'render/tooltip.ts', 'render/landmarks.ts', 'render/worldLabel.ts']) {
      expect(src(f), f).not.toContain("fontFamily: 'monospace'")
      expect(src(f), f).not.toContain("'monospace'")
    }
  })

  it('clears AA on every world-text pair IN BOTH LIGHT BANDS, which is the viewer\'s ratio', () => {
    expect(worldTextOffenders(WORLD_TEXT_PAIRS)).toEqual([])
    for (const [ink, paper] of [[SPEECH_INK, SPEECH_FILL], [THOUGHT_INK, THOUGHT_FILL], [LANDMARK_INK, LANDMARK_PLATE]] as const) {
      expect(bandRatios(ink, paper).day).toBeGreaterThanOrEqual(AA_RATIO)
      expect(bandRatios(ink, paper).night).toBeGreaterThanOrEqual(AA_RATIO)
    }
  })

  it('de-emphasises a thought by MATERIAL, never by alpha', () => {
    const text = src('render/bubbles.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(text).not.toMatch(/alpha:\s*0\.\d/)
    expect(THOUGHT_FILL).not.toBe(SPEECH_FILL)
  })

  it('tiles a nine-slice exactly, at any length', () => {
    for (const w of [30, 47, 120, 301]) {
      const s = nineSlice(w, 60, 10)
      expect(s).toHaveLength(9)
      const row = s.slice(0, 3)
      expect(row[2]!.dx + row[2]!.dw, `w ${w}`).toBe(Math.max(20, Math.round(w)))
    }
  })
})

// ── U19 · smooth, damped, bounded zoom ────────────────────────────────────────────────────

// The gate's own reading of U19 is unchanged — a flick may not cross the range by accident —
// but the gesture now RELEASES, so what the gate reads is the resting stop after the hand has
// lifted. That is the whole of the motion lane's amendment: the camera is continuous under a
// hand and exact the moment it is let go.
describe('U19 — "I zoom way too much by accident and I can\'t control my zoom at all"', () => {
  it('advances exactly one stop under thirty trackpad events', () => {
    let z = initialZoom(1)
    let now = 0
    for (let i = 0; i < 30; i++) { now += 8; z = zoomWheel(z, -4, now) }
    expect(zoomRelease(z, now + WHEEL_GESTURE_GAP_MS + 1).stop).toBe(2)
  })

  it('always settles on a member of the stop set, over a 500-event random walk', () => {
    let z = initialZoom(1)
    let now = 0
    let seed = 7
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      now += (seed % 300)
      z = zoomWheel(z, ((seed >> 8) % 2 === 0 ? -1 : 1) * (20 + (seed % 200)), now)
      if (now - z.lastWheelMs > WHEEL_GESTURE_GAP_MS) z = zoomRelease(z, now)
      expect(ZOOM_STOPS as readonly number[]).toContain(z.stop)
    }
    z = zoomRelease(z, now + WHEEL_GESTURE_GAP_MS + 1)
    expect(zoomScaleAt(z, now + WHEEL_GESTURE_GAP_MS + 1 + ZOOM_SETTLE_MS)).toBe(z.stop)
  })

  it('lands on a stop from any arbitrary scale, and eases rather than jumping', () => {
    for (const s of [0.3, 0.9, 1.4, 2.6, 9]) expect(ZOOM_STOPS as readonly number[]).toContain(nearestStop(s))
    const z = zoomTo(initialZoom(1), 3, 1000)
    expect(zoomScaleAt(z, 1000)).toBe(1)
    expect(zoomScaleAt(z, 1000 + ZOOM_SETTLE_MS / 2)).toBeGreaterThan(1)
    expect(zoomScaleAt(z, 1000 + ZOOM_SETTLE_MS / 2)).toBeLessThan(3)
    expect(zoomScaleAt(z, 1000 + ZOOM_SETTLE_MS)).toBe(3)
  })

  it('holds a world label at the reader\'s size at every stop', () => {
    for (const stop of ZOOM_STOPS) expect(worldTextScale(stop) * stop).toBeCloseTo(1, 9)
  })

  it('keeps a place name fully opaque or absent at every RESTING stop', () => {
    for (const stop of ZOOM_STOPS) {
      const a = landmarkAlpha(stop)
      expect(a === 0 || a === 1, `stop ${stop} at alpha ${a}`).toBe(true)
    }
  })
})
