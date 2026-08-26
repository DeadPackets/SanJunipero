import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHAR_TARGET_PX } from './charAnim.js'
import { furnishingScale } from './interiors.js'
import { ZOOM_SCALE_MAX } from './camera.js'
import { TILE_W } from './iso.js'
import { WALL_STRIP_TILES } from './interiorTileset.js'
import {
  INTERIOR_BODY_PX, INTERIOR_PX_SCALE, INTERIOR_TILE, ROOM_TILES, WALL_FACING, WALL_H_PX,
  WALL_KINDS, interiorToScreen,
} from './interiorMap.js'
import {
  DOORWAY_POOL_ALPHA, HEARTH_POOL_ALPHA, ROOM_MARGIN_Y, ROOM_SHELL_INK, ROOM_SHELL_PAINT,
  ROOM_ZOOM, WALL_MOUNT_H_PX,
  BEAM_HALF_TILES, ceilingBeams,
  drawFloorBase, drawFloorLight, drawFloorTop, drawWalls, floorBoards, floorPolyOf, floorPools,
  roomBox, roomCrop, roomCropPx, roomMaskPoly, roomOriginX, roomOriginY, roomPanRange, roomPanTo,
  roomWidthPx, roomZoomFor, skirtingPolys,
  easePan, ROOM_PAN_HALF_LIFE_MS,
  tileCentreScreen,
  thresholdPoly, wallCourses, wallMount, wallPolys, type ShellPainter,
} from './roomShell.js'
import { DEFAULT_CONFIG, INTERIOR_KINDS, cityStructures } from '@sj/shared'
import { roomSizeOf } from './interiors.js'

// Every colour the room shell paints must be a MASTER_PALETTE member — the same law the
// built form answers to, so an interior cannot drift off the town's palette.
const MASTER_PALETTE = [
  0xfff6e9, 0xf6e8d5, 0xe8d5bc, 0xd4bc9e, 0xb89d7e, 0xf2c879, 0xe0a95e, 0xc68a48,
  0xa66e38, 0x7e512b, 0xdce8c8, 0xb9d19a, 0x93b573, 0x6f9455, 0x4f7040, 0xf2c6c2,
  0xe09e9b, 0xc47876, 0x9e5a5c, 0xd6eaf2, 0xa8cfe0, 0x7fb0c9, 0x5a8cab, 0x3e6786,
  0xe9e2da, 0xcfc6bc, 0xaba198, 0x857d75, 0x5d5751, 0x43394a, 0x322b38, 0x241f2b,
  0x171420, 0xf7a66b, 0xe8785a, 0x8a6fa8, 0xf4e289, 0xf5d3b3, 0xd9a876, 0x9c6b47,
]

const pts = (poly: number[]): Array<[number, number]> => {
  const out: Array<[number, number]> = []
  for (let i = 0; i < poly.length; i += 2) out.push([poly[i]!, poly[i + 1]!])
  return out
}

const pointInPoly = (poly: number[], x: number, y: number): boolean => {
  const p = pts(poly)
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!, [xj, yj] = p[j]!
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const edgeKey = (a: [number, number], b: [number, number]): string => {
  const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a]
  return `${p[0]},${p[1]}|${q[0]},${q[1]}`
}
const edges = (poly: number[]): string[] => {
  const p = pts(poly)
  return p.map((v, i) => edgeKey(v, p[(i + 1) % p.length]!))
}

// srgb luma, the same measure groundField uses to prove a road reads against grass
const luma = (rgb: number): number => {
  const ch = (s: number): number => {
    const c = ((rgb >> s) & 0xff) / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0)
}

describe('roomShell — the two back walls', () => {
  it('returns exactly two closed quads, one per WALL_KIND', () => {
    const w = wallPolys()
    expect(Object.keys(w).sort()).toEqual([...WALL_KINDS].sort())
    for (const kind of WALL_KINDS) {
      expect(w[kind], kind).toHaveLength(8)          // four points, closed by construction
      expect(new Set(pts(w[kind]).map((p) => p.join(','))).size, kind).toBe(4)
    }
  })

  it('the pair shares exactly one edge — the room’s far vertical column', () => {
    const w = wallPolys()
    const shared = edges(w['back-left']).filter((e) => edges(w['back-right']).includes(e))
    expect(shared).toHaveLength(1)
    // the far vertex (0,0) rising by the wall's own authored height, in interior px
    expect(shared[0]).toBe(edgeKey([0, -WALL_H_PX], [0, 0]))
  })

  it('neither wall covers the floor — the floor’s centroid is outside both', () => {
    const w = wallPolys()
    const floor = pts(floorPolyOf())
    const cx = floor.reduce((s, p) => s + p[0], 0) / floor.length
    const cy = floor.reduce((s, p) => s + p[1], 0) / floor.length
    // the centroid of the 12x6 diamond — off the origin's column, because the room is not square
    expect([cx, cy]).toEqual([
      ((ROOM_TILES.w - ROOM_TILES.h) * INTERIOR_TILE.w) / 4,
      ((ROOM_TILES.w + ROOM_TILES.h) * INTERIOR_TILE.h) / 4,
    ])
    for (const kind of WALL_KINDS) expect(pointInPoly(w[kind], cx, cy), kind).toBe(false)
  })

  it('the walls rise BEHIND the floor: every wall point is at or above the floor’s far edges', () => {
    const w = wallPolys()
    const near = interiorToScreen(ROOM_TILES.w, ROOM_TILES.h)
    for (const kind of WALL_KINDS) {
      for (const [, y] of pts(w[kind])) expect(y, kind).toBeLessThan(near.sy)
    }
  })

  it('courses and skirting are cut from the wall they belong to', () => {
    const w = wallPolys()
    const courses = wallCourses()
    const skirt = skirtingPolys()
    for (const kind of WALL_KINDS) {
      expect(courses[kind].length, kind).toBeGreaterThan(2)
      for (const [x0, y0, x1, y1] of courses[kind]) {
        // a course lies flat along the wall's own base direction, never vertical
        expect(Math.abs(x1 - x0), kind).toBeGreaterThan(Math.abs(y1 - y0))
      }
      expect(skirt[kind], kind).toHaveLength(8)
      // the skirting sits at the foot of the wall, inside its quad
      const s = pts(skirt[kind])
      const mx = s.reduce((a, p) => a + p[0], 0) / 4, my = s.reduce((a, p) => a + p[1], 0) / 4
      expect(pointInPoly(w[kind], mx, my), kind).toBe(true)
    }
  })
})

// ★ TASK 84 §2 — THE TWO FIREPLACES. A wall piece used to be sent to a wall by
// `slot.x > slot.y`, from a slot that need not touch a wall at all, with nothing saying which
// way the piece then faced. The wall is now the one the TILE is against, the facing is that
// wall's own, and a tile against no wall gets no mount instead of an arbitrary one.
describe('roomShell — where a wall piece hangs, and which way it then faces', () => {
  it('a tile on the x=0 column takes back-left; a tile on the y=0 row takes back-right', () => {
    expect(wallMount({ x: 0, y: 4 })!.wall).toBe('back-left')
    expect(wallMount({ x: 0, y: 2 })!.wall).toBe('back-left')
    expect(wallMount({ x: 9, y: 0 })!.wall).toBe('back-right')
    expect(wallMount({ x: 1, y: 0 })!.wall).toBe('back-right')
  })

  it('★ a tile against NO wall gets no mount — a placement error, not a guess', () => {
    expect(wallMount({ x: 5, y: 3 })).toBeNull()
    expect(wallMount({ x: 1, y: 1 })).toBeNull()
  })

  it('★ and the wall it lands on has exactly one facing, SW or SE, never NE or NW', () => {
    for (const tile of [{ x: 0, y: 4 }, { x: 9, y: 0 }]) {
      const m = wallMount(tile)!
      expect(['sw', 'se']).toContain(WALL_FACING[m.wall])
    }
    expect(WALL_FACING['back-left']).toBe('se')
    expect(WALL_FACING['back-right']).toBe('sw')
  })

  it('a mount is above the floor’s far edge, and on its own wall plane', () => {
    const w = wallPolys()
    for (const tile of [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 0, y: 4 }]) {
      const m = wallMount(tile)!
      const along = (m.wall === 'back-right' ? tile.x : tile.y) + 0.5
      const base = m.wall === 'back-right'
        ? interiorToScreen(along, 0)
        : interiorToScreen(0, along)
      expect(m.sx).toBeCloseTo(base.sx, 6)
      expect(m.sy).toBeCloseTo(base.sy - WALL_MOUNT_H_PX, 6)
      expect(m.sy).toBeLessThan(base.sy)                      // above the far edge
      expect(pointInPoly(w[m.wall], m.sx, m.sy)).toBe(true)   // on the plane it hangs from
    }
  })

  it('is pure: two calls agree', () => {
    expect(wallMount({ x: 0, y: 2 })).toEqual(wallMount({ x: 0, y: 2 }))
  })
})

describe('roomShell — the threshold', () => {
  it('sits on the NEAR face, centred on the floor’s near vertex', () => {
    const t = thresholdPoly()
    const near = interiorToScreen(ROOM_TILES.w, ROOM_TILES.h)
    const p = pts(t)
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length
    const cy = p.reduce((s, q) => s + q[1], 0) / p.length
    expect(cx).toBeCloseTo(near.sx, 6)
    expect(cy).toBeCloseTo(near.sy, 6)
    // it straddles the edge: part inside the room, part out, which is what a threshold is
    expect(Math.min(...p.map((q) => q[1]))).toBeLessThan(near.sy)
    expect(Math.max(...p.map((q) => q[1]))).toBeGreaterThan(near.sy)
  })

  it('is the only gap: it lies on the near half, never against a back wall', () => {
    const w = wallPolys()
    for (const [x, y] of pts(thresholdPoly())) {
      for (const kind of WALL_KINDS) expect(pointInPoly(w[kind], x, y), kind).toBe(false)
    }
  })
})

describe('roomShell — light on the floor', () => {
  const lit = [
    { tile: { x: 0, y: 4 }, light: true },
    { tile: { x: 5, y: 4 }, light: false },
    { tile: { x: 9, y: 2 }, light: true },
  ]

  it('one pool per light source, plus exactly one doorway pool', () => {
    expect(floorPools(lit)).toHaveLength(3)
    const dark = floorPools([{ tile: { x: 5, y: 2 }, light: false }])
    expect(dark).toHaveLength(1)                                  // the doorway, and nothing else
    expect(dark[0]!.alpha).toBe(DOORWAY_POOL_ALPHA)
    expect(floorPools([])).toHaveLength(1)
  })

  it('the doorway pool is at the near vertex; a hearth pool is at its own tile', () => {
    const pools = floorPools(lit)
    const near = interiorToScreen(ROOM_TILES.w, ROOM_TILES.h)
    expect([pools[0]!.sx, pools[0]!.sy]).toEqual([near.sx, near.sy])
    const hearth = tileCentreScreen(0, 4)
    expect([pools[1]!.sx, pools[1]!.sy]).toEqual([hearth.sx, hearth.sy])
    expect(pools[1]!.alpha).toBe(HEARTH_POOL_ALPHA)
  })

  it('no pool is brighter than a hearth, and every radius is positive', () => {
    for (const p of floorPools(lit)) {
      expect(p.alpha).toBeLessThanOrEqual(HEARTH_POOL_ALPHA)
      expect(p.alpha).toBeGreaterThan(0)
      expect(p.radius).toBeGreaterThan(0)
    }
  })

  it('is pure and deterministic', () => {
    expect(floorPools(lit)).toEqual(floorPools(lit))
  })
})

describe('roomShell — the floor is a surface, not a card', () => {
  it('board seams run the length of the floor and stay inside it', () => {
    const floor = floorPolyOf()
    const boards = floorBoards()
    expect(boards.length).toBeGreaterThanOrEqual(ROOM_TILES.h - 1)
    for (const [x0, y0, x1, y1] of boards) {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
      expect(pointInPoly(floor, mx, my)).toBe(true)
    }
  })
})

describe('roomShell — what the painter is asked to draw', () => {
  type Op = { op: string; arg: unknown }
  const recorder = (): { ops: Op[]; g: ShellPainter } => {
    const ops: Op[] = []
    const g: ShellPainter = {
      clear: () => ops.push({ op: 'clear', arg: null }),
      poly: (p) => ops.push({ op: 'poly', arg: p }),
      moveTo: (x, y) => ops.push({ op: 'moveTo', arg: [x, y] }),
      lineTo: (x, y) => ops.push({ op: 'lineTo', arg: [x, y] }),
      ellipse: (x, y, rx, ry) => ops.push({ op: 'ellipse', arg: [x, y, rx, ry] }),
      fill: (s) => ops.push({ op: 'fill', arg: s }),
      stroke: (s) => ops.push({ op: 'stroke', arg: s }),
    }
    return { ops, g }
  }

  it('drawWalls fills both planes, grains them and rims them in ink', () => {
    const { ops, g } = recorder()
    drawWalls(g)
    const fills = ops.filter((o) => o.op === 'fill').map((o) => o.arg)
    expect(fills).toContain(ROOM_SHELL_PAINT.wallLit)
    expect(fills).toContain(ROOM_SHELL_PAINT.wallShade)
    expect(fills.filter((f) => f === ROOM_SHELL_PAINT.skirting)).toHaveLength(2)
    expect(ops.filter((o) => o.op === 'lineTo').length).toBeGreaterThan(4)
    const inkStrokes = ops.filter((o) => o.op === 'stroke' && (o.arg as { color: number }).color === ROOM_SHELL_INK)
    expect(inkStrokes).toHaveLength(2)
  })

  it('drawFloorLight draws one ellipse per pool, then the threshold over them', () => {
    const { ops, g } = recorder()
    const pools = floorPools([{ tile: { x: 0, y: 4 }, light: true }])
    drawFloorLight(g, pools)
    const ellipses = ops.filter((o) => o.op === 'ellipse')
    expect(ellipses).toHaveLength(2)
    for (const e of ellipses) {
      const [, , rx, ry] = e.arg as number[]
      expect(rx! / ry!).toBeCloseTo(2, 6)
    }
    const light = ops.findIndex((o) => o.op === 'ellipse')
    const sill = ops.findIndex(
      (o) => o.op === 'fill' && (o.arg as { color?: number }).color === ROOM_SHELL_PAINT.threshold,
    )
    expect(light).toBeLessThan(sill)
  })

  // ★ THE CEILING, THE ONLY WAY A DIMETRIC CAMERA CAN SEE IT. The mock the user approved has
  // three joists across the floor; the product had none, and a 72-tile floor with nothing on
  // it is most of what "nowhere near as nice as expected" is looking at. The spacing is the
  // WALL BAY, so the ceiling and the walls are the same building rather than two guesses.
  it('★ a joist over every wall bay, under the light and inside the floor', () => {
    const beams = ceilingBeams(WALL_STRIP_TILES)
    expect(beams).toHaveLength(Math.ceil(ROOM_TILES.w / WALL_STRIP_TILES))
    for (const [i, b] of beams.entries()) {
      expect(b, `beam ${i} is a quad`).toHaveLength(8)
      const cx = (i + 0.5) * WALL_STRIP_TILES
      // it runs the room's full depth, from the far edge to the near one
      expect(b.slice(0, 2)).toEqual(Object.values(interiorToScreen(cx - BEAM_HALF_TILES, 0)))
      expect(b.slice(4, 6))
        .toEqual(Object.values(interiorToScreen(cx + BEAM_HALF_TILES, ROOM_TILES.h)))
    }
    // and it is PAINTED, in ink, before the light that falls over it
    const { ops, g } = recorder()
    drawFloorLight(g, floorPools([]), ROOM_TILES, beams)
    const inked = ops.filter(
      (o) => o.op === 'fill' && (o.arg as { color?: number }).color === ROOM_SHELL_INK)
    expect(inked).toHaveLength(beams.length)
    expect(ops.findIndex((o) => o.op === 'poly')).toBeLessThan(
      ops.findIndex((o) => o.op === 'ellipse'))
  })

  // WHAT THE BROWSER CAUGHT: unmasked, the doorway pool painted a pale ellipse across the town
  // and the threshold hung below the floor like a tab. Both straddle the near vertex BY
  // CONSTRUCTION, which is why one masked node holds them — and why that is now an assertion.
  it('both the doorway pool and the threshold overflow the floor, so both must be masked', () => {
    const floor = floorPolyOf()
    const p = floorPools([])[0]!
    expect(pointInPoly(floor, p.sx, p.sy + p.radius / 2)).toBe(false)
    expect(p.radius).toBeGreaterThan(INTERIOR_TILE.w)
    const t = pts(thresholdPoly())
    expect(t.some(([x, y]) => !pointInPoly(floor, x, y))).toBe(true)
  })

  it('drawFloorBase with a material under it skips its own fill and nothing else', () => {
    const flat = recorder(), material = recorder()
    drawFloorBase(flat.g)
    drawFloorBase(material.g, ROOM_TILES, null)
    expect(flat.ops.length - material.ops.length).toBe(2)   // one poly, one fill
    expect(flat.ops.filter((o) => o.op === 'fill').map((o) => o.arg))
      .toContain(ROOM_SHELL_PAINT.floor)
    expect(material.ops.filter((o) => o.op === 'fill').map((o) => o.arg))
      .not.toContain(ROOM_SHELL_PAINT.floor)
  })

  it('drawFloorTop closes the plane in ink and nothing else', () => {
    const { ops, g } = recorder()
    drawFloorTop(g)
    expect(ops.filter((o) => o.op === 'fill')).toHaveLength(0)
    const rim = ops.filter(
      (o) => o.op === 'stroke' && (o.arg as { color: number }).color === ROOM_SHELL_INK,
    )
    expect(rim).toHaveLength(1)
  })
})

// WHAT THE BROWSER CAUGHT: a hearth's glow is a child of its sprite, so it grew with the
// furniture scale and painted a pale disc across the town OUTSIDE the room.
describe('roomShell — the room is a closed box', () => {
  const mask = roomMaskPoly()

  it('is the union of both walls and the floor, and holds every point of all three', () => {
    expect(mask).toHaveLength(12)              // a hexagon
    const walls = wallPolys()
    const inside = (x: number, y: number): boolean =>
      pointInPoly(mask, x, y) || pts(mask).some(([mx, my]) => mx === x && my === y)
    for (const kind of WALL_KINDS) {
      for (const [x, y] of pts(walls[kind])) expect(inside(x, y), `${kind} ${x},${y}`).toBe(true)
    }
    for (const [x, y] of pts(floorPolyOf())) expect(inside(x, y)).toBe(true)
  })

  it('excludes the space a spilling light would reach', () => {
    const near = interiorToScreen(ROOM_TILES.w, ROOM_TILES.h)
    expect(pointInPoly(mask, 0, near.sy + 200)).toBe(false)
    expect(pointInPoly(mask, -2000, 0)).toBe(false)
    expect(pointInPoly(mask, 0, -WALL_H_PX - 50)).toBe(false)
  })
})

// WHAT THE BROWSER CAUGHT: the landed camera centred the FLOOR. Walls doubled the height of
// the drawn box, so the top of the room was cut off by the top of the stage.
describe('roomShell — the room fits the stage', () => {
  const OFFSET = 40

  it('the box is the walls plus the floor, not the floor alone', () => {
    const box = roomBox()
    expect(box.top).toBe(-WALL_H_PX)
    expect(box.bottom).toBe(((ROOM_TILES.w + ROOM_TILES.h) * INTERIOR_TILE.h) / 2)
    expect(box.height).toBe(WALL_H_PX + ((ROOM_TILES.w + ROOM_TILES.h) * INTERIOR_TILE.h) / 2)
    expect(box.height).toBe(736)   // 160 px of wall over an 18-half-tile floor
  })

  it('centring the whole box keeps every wall point on the stage', () => {
    const STAGE_H = 900
    const y = roomOriginY(STAGE_H, OFFSET, ROOM_ZOOM)
    const box = roomBox()
    expect(y + box.top * ROOM_ZOOM).toBeGreaterThan(0)
    expect(y + box.bottom * ROOM_ZOOM).toBeLessThan(STAGE_H)
    // the landed rule centred the floor only, and put the wall top off the top of the stage
    const landed = STAGE_H / 2 - OFFSET - (box.bottom / 2) * ROOM_ZOOM
    expect(landed + box.top * ROOM_ZOOM).toBeLessThan(0)
  })

  // ★ THE SAME INVARIANT, TOTALLY: over every stage a viewer could have. The landed test
  // asserted it at ONE pair of numbers, which is how a 40 px lift that spends more headroom
  // than a stage has could sit there unnoticed.
  it('★ the whole box is on the stage at every height that can hold it, 600 to 1600', () => {
    const box = roomBox()
    for (let h = 600; h <= 1600; h += 1) {
      const z = roomZoomFor(h)
      const y = roomOriginY(h, OFFSET, z)
      // A stage too short for the one zoom there is crops, and says by how much. The skip is
      // measured against `roomCropPx` and never against the zoom under test, or a zoom that
      // ignored the stage would excuse itself from this check (mutation M9).
      if (roomCropPx(h) > 0) continue
      // ★ TWO INVARIANTS, NOT ONE, because the margin is a courtesy and the box is not. The
      // whole box is on the stage the moment it fits at all; the margin is honoured the moment
      // there is slack to pay it out of. Stating only the second is what made a stage 2 px
      // short throw away 18 px of the near corner.
      expect(y + box.top * z, `wall top off the stage at ${h} px`).toBeGreaterThanOrEqual(0)
      expect(y + box.bottom * z, `floor off the stage at ${h} px`).toBeLessThanOrEqual(h)
      if (h < box.height * z + 2 * ROOM_MARGIN_Y) continue
      expect(y + box.top * z, `no top margin at ${h} px`).toBeGreaterThanOrEqual(ROOM_MARGIN_Y)
      expect(y + box.bottom * z, `no bottom margin at ${h} px`).toBeLessThanOrEqual(h - ROOM_MARGIN_Y)
    }
  })

  it('★ and it still lifts the full offset when the stage can afford it', () => {
    const tall = 1400
    const box = roomBox()
    const centred = tall / 2 - ((box.top + box.bottom) / 2) * ROOM_ZOOM
    expect(roomOriginY(tall, OFFSET, roomZoomFor(tall))).toBe(centred - OFFSET)
  })

  // ★ WHAT THE BROWSER CAUGHT, AGAIN: the origin is the room's FAR CORNER, and a 12x6 room does
  // not spread evenly around it. Dropping the origin on the middle of the stage hung the whole
  // room 192 px to the right of centre — visible the moment the room stopped being square.
  it('★ the room is centred by its own BOX across the stage, not by its origin', () => {
    const screenW = 1568
    const x = roomOriginX(screenW, ROOM_ZOOM)
    const west = x + interiorToScreen(0, ROOM_TILES.h).sx * ROOM_ZOOM
    const east = x + interiorToScreen(ROOM_TILES.w, 0).sx * ROOM_ZOOM
    expect((west + east) / 2).toBe(screenW / 2)
    expect(screenW / 2 - x).toBe(192)   // by how much the landed rule was off
    expect(west).toBeGreaterThan(0)
    expect(east).toBeLessThan(screenW)
  })

  it('★ a stage too short loses the near corner, never the wall top', () => {
    // MEASURED in the running app: 1728 x 823 window gives a canvas 678 CSS px tall, and the
    // box is 736. 58 px do not fit and every one of them comes off the bottom, because the
    // walls carry the window, the chimney breast and the beams.
    const short = 678
    expect(roomCropPx(short)).toBe(58)
    const box = roomBox()
    const y = roomOriginY(short, OFFSET, ROOM_ZOOM)
    // ★ THE MARGIN IS NOT PAID OUT OF THE PICTURE. It used to pin the wall top a full 8 px
    // down however short the stage was, which bought two strips of nothing with 16 px of room.
    expect(y + box.top * ROOM_ZOOM).toBe(0)                      // the wall top is kept, flush
    expect(y + box.bottom * ROOM_ZOOM).toBeGreaterThan(short)    // the near corner is what goes
    expect(y + box.bottom * ROOM_ZOOM - short).toBe(roomCropPx(short))   // and it is the measured number
  })

  it('★ the crop is measured, not asserted — and it is zero on the stage the app reports', () => {
    // MEASURED in the running app on this machine's window: 1728 x 879 gives
    // `app.screen.height` = 734, and the box is 736 — 2 px, where the counted-in margins made
    // it 18 and cost the threshold.
    expect(roomCropPx(855)).toBe(0)
    expect(roomCropPx(752)).toBe(0)
    expect(roomCropPx(736)).toBe(0)
    expect(roomCropPx(734)).toBe(2)
    expect(roomCropPx(700)).toBe(36)
    // and the zoom never drops below 1, because there is no integer under it
    expect(roomZoomFor(400)).toBe(ROOM_ZOOM)
    expect(roomZoomFor(2000)).toBe(ROOM_ZOOM)
  })
})

// ★★ A FARMHOUSE ROOM DOES NOT FIT A LAPTOP — AND THE CAMERA IS WHAT MAKES IT WHOLE.
//
// Rooms are as big as their buildings (12x6 / 18x6 / 24x6) and the factor is forced by the
// house's landed room, so a farmhouse's box is 1 120 px tall and 1 920 px WIDE. There is no
// integer scene zoom below 1 to fall back on, so what is off the glass cannot be zoomed back
// on: the only thing left to choose is WHICH part is showing, and that choice is a camera.
//
// The travel it is allowed IS `roomCrop`, in both axes. That is the whole design: a room that
// fits gets a range of zero and cannot move, so nothing that fits acquires a camera.
describe('★★ the camera inside a room, and its range IS the crop', () => {
  // ★ THE ENUMERATION IS THE UNION OF EVERY PLACE A ROOM KIND CAN COME FROM, never a hand-list.
  // `web-sync` found three rosters in this package and one of them was pinned to a
  // transcription of itself; a crop guard naming `cabin, cottage, farmhouse` would be the same
  // defect, passing forever and never seeing the fourth dwelling. A kind added to the recipe
  // table, to the town the template plants, or to the renderer's own room vocabulary is in this
  // law the day it lands, with nobody editing this test.
  const roomsOf = (): ReadonlyArray<{ kind: string; room: { w: number; h: number } }> => {
    const kinds = [...new Set([
      ...Object.keys(DEFAULT_CONFIG.structures.recipes),
      ...cityStructures().map((s) => s.kind),
      ...INTERIOR_KINDS,
    ])].sort()
    return kinds.map((kind) => ({ kind, room: roomSizeOf(kind as never) }))
  }

  // ★ THE SMALLEST STAGE THIS LAW IS HELD AT, AND WHERE THE NUMBER COMES FROM.
  //
  // It is a STAGE, not a window: `roomOriginY` is called with `app.screen.height`, and the
  // renderer's `resizeTo` is `#stage-root`, which sits under the app header and the status
  // strip and over the control bar. The one measured pair on record is a 1728 x 823 window
  // giving a 1478 x 678 canvas — so the chrome costs 250 px across and 145 px down.
  //
  // The smallest laptop worth supporting is a 1280 x 800 window, which by that measurement is a
  // 1030 x 655 stage. Rounded DOWN to 1024 x 640, so the law is held slightly tighter than the
  // hardware demands rather than slightly looser.
  const MIN_STAGE = { w: 1024, h: 640 } as const
  // …and the two the crop was measured at, so the reported table stays under test.
  const STAGES = [MIN_STAGE, { w: 1478, h: 678 }, { w: 1478, h: 900 }] as const

  it('★ the crop has TWO axes, and the width is the one that was never measured', () => {
    // `roomCropPx` takes a height and returns one number, so a room 1 920 px across on a
    // 1 478 px stage was overflowing by 442 px with nothing in the codebase able to say so.
    expect(roomWidthPx({ w: 12, h: 6 })).toBe(1152)
    expect(roomWidthPx({ w: 18, h: 6 })).toBe(1536)
    expect(roomWidthPx({ w: 24, h: 6 })).toBe(1920)
    // and it is a real overflow on a real stage, in the axis nothing was watching
    expect(roomCrop(1478, 900, { w: 24, h: 6 }).x).toBe(442)
    expect(roomCrop(1478, 900, { w: 12, h: 6 }).x).toBe(0)
    // the y axis is the landed number, unchanged — this widened the instrument, it did not
    // move it
    for (const h of [678, 700, 736, 900, 1200]) {
      expect(roomCrop(9999, h, { w: 24, h: 6 }).y).toBe(roomCropPx(h, { w: 24, h: 6 }))
    }
  })

  // ★ THE DELIVERABLE, AS A LAW. Not "the farmhouse pans" — every point of every room's box is
  // on the glass at SOME camera offset, at every stage size a laptop has.
  it('★★ a person on a laptop can see the whole of any room', () => {
    let anyCropped = false
    for (const { kind, room } of roomsOf()) {
      const box = roomBox(room, WALL_H_PX)
      const west = interiorToScreen(0, room.h).sx
      const east = interiorToScreen(room.w, 0).sx
      for (const stage of STAGES) {
        const range = roomPanRange(stage.w, stage.h, room, WALL_H_PX)
        const ox = roomOriginX(stage.w, ROOM_ZOOM, room)
        const oy = roomOriginY(stage.h, 0, ROOM_ZOOM, room, WALL_H_PX)
        const crop = roomCrop(stage.w, stage.h, room, WALL_H_PX)
        if (crop.x > 0 || crop.y > 0) anyCropped = true
        // the four extremes of the box, each at the offset that reaches hardest for it
        const at = (d: number, o: number, p: number): number => o + d + p * ROOM_ZOOM
        expect(at(range.maxX, ox, west), `${kind} @${stage.w}: west vertex unreachable`)
          .toBeGreaterThanOrEqual(0)
        expect(at(range.minX, ox, east), `${kind} @${stage.w}: east vertex unreachable`)
          .toBeLessThanOrEqual(stage.w)
        expect(at(range.maxY, oy, box.top), `${kind} @${stage.h}: wall top unreachable`)
          .toBeGreaterThanOrEqual(0)
        expect(at(range.minY, oy, box.bottom), `${kind} @${stage.h}: threshold unreachable`)
          .toBeLessThanOrEqual(stage.h)
      }
    }
    // ANTI-VACUITY: a range of zero everywhere satisfies the four above only if nothing was
    // ever cropped. Something must be, or this test is asserting that the defect does not
    // exist rather than that it is fixed.
    expect(anyCropped, 'nothing was cropped — this law proved nothing').toBe(true)
  })

  it('★ and the camera never shows stage the room does not fill', () => {
    // The other side of the same clamp. A camera free to travel is a camera that can park a
    // wall in the middle of the screen with the town showing beside it.
    for (const { kind, room } of roomsOf()) {
      const box = roomBox(room, WALL_H_PX)
      const west = interiorToScreen(0, room.h).sx
      const east = interiorToScreen(room.w, 0).sx
      for (const stage of STAGES) {
        const crop = roomCrop(stage.w, stage.h, room, WALL_H_PX)
        const ox = roomOriginX(stage.w, ROOM_ZOOM, room)
        const oy = roomOriginY(stage.h, 0, ROOM_ZOOM, room, WALL_H_PX)
        // ask for the middle of every tile in the room and a long way past every edge, so the
        // clamp is exercised from outside its own range as well as inside it
        for (const fx of [-4000, west, 0, east, 4000]) {
          for (const fy of [-4000, box.top, 0, box.bottom, 4000]) {
            const pan = roomPanTo({ sx: fx, sy: fy }, stage.w, stage.h, ROOM_ZOOM, room, WALL_H_PX)
            if (crop.x > 0) {
              expect(ox + pan.dx + west * ROOM_ZOOM, `${kind}: blank stage left`)
                .toBeLessThanOrEqual(0)
              expect(ox + pan.dx + east * ROOM_ZOOM, `${kind}: blank stage right`)
                .toBeGreaterThanOrEqual(stage.w)
            }
            if (crop.y > 0) {
              expect(oy + pan.dy + box.top * ROOM_ZOOM, `${kind}: blank stage above`)
                .toBeLessThanOrEqual(0)
              expect(oy + pan.dy + box.bottom * ROOM_ZOOM, `${kind}: blank stage below`)
                .toBeGreaterThanOrEqual(stage.h)
            }
          }
        }
      }
    }
  })

  // ★ THE NO-REGRESSION HALF, AND IT IS WHY THIS IS SAFE. A room that fits has no camera at
  // all — not a camera that happens to sit still, a range of literally zero.
  it('★ nothing that fits acquires a camera', () => {
    for (const { kind, room } of roomsOf()) {
      for (let h = 600; h <= 1600; h += 7) {
        for (const w of [1280, 1478, 1512, 1920, 2400]) {
          const crop = roomCrop(w, h, room, WALL_H_PX)
          const range = roomPanRange(w, h, room, WALL_H_PX)
          // zero TRAVEL, and zero at both ends of it — a range of [0, 0] is no camera
          if (crop.x === 0) {
            expect(range.maxX - range.minX, `${kind} @${w}x${h}`).toBe(0)
            expect(Math.abs(range.minX), `${kind} @${w}x${h}`).toBe(0)
          }
          if (crop.y === 0) {
            expect(range.maxY - range.minY, `${kind} @${w}x${h}`).toBe(0)
            expect(Math.abs(range.minY), `${kind} @${w}x${h}`).toBe(0)
          }
        }
      }
    }
    // and a house on a stage that holds it cannot be panned anywhere by any focus at all
    const house = roomSizeOf('house')
    for (const fx of [-2000, 0, 500, 2000]) {
      expect(roomPanTo({ sx: fx, sy: fx }, 1920, 1200, ROOM_ZOOM, house, WALL_H_PX))
        .toEqual({ dx: 0, dy: 0 })
    }
  })

  it('★ an empty room does not drift — no focus is the landed placement, to the pixel', () => {
    for (const { room } of roomsOf()) {
      for (const stage of STAGES) {
        expect(roomPanTo(null, stage.w, stage.h, ROOM_ZOOM, room, WALL_H_PX))
          .toEqual({ dx: 0, dy: 0 })
      }
    }
  })

  // ★ WHAT THE CAMERA IS FOR, restated as arithmetic: follow a body and the body is on screen.
  // The user chose Option C to watch NPCs walk about; a camera that crops the person you are
  // following is worse than one that crops a wall.
  it('★ following a body in a farmhouse puts that body on the glass, wherever it stands', () => {
    const room = roomSizeOf('farmhouse')
    const stage = { w: 1478, h: 678 }
    const ox = roomOriginX(stage.w, ROOM_ZOOM, room)
    const oy = roomOriginY(stage.h, 0, ROOM_ZOOM, room, WALL_H_PX)
    let offWithout = 0
    for (let x = 0; x < room.w; x++) {
      for (let y = 0; y < room.h; y++) {
        const f = tileCentreScreen(x, y)
        const pan = roomPanTo(f, stage.w, stage.h, ROOM_ZOOM, room, WALL_H_PX)
        const sx = ox + pan.dx + f.sx * ROOM_ZOOM
        const sy = oy + pan.dy + f.sy * ROOM_ZOOM
        expect(sx, `tile ${x},${y} off the stage horizontally`).toBeGreaterThanOrEqual(0)
        expect(sx).toBeLessThanOrEqual(stage.w)
        expect(sy, `tile ${x},${y} off the stage vertically`).toBeGreaterThanOrEqual(0)
        expect(sy).toBeLessThanOrEqual(stage.h)
        // and how many of those tiles are off the glass with the camera pinned, which is the
        // defect this lane was given, counted
        const px = ox + f.sx * ROOM_ZOOM, py = oy + f.sy * ROOM_ZOOM
        if (px < 0 || px > stage.w || py < 0 || py > stage.h) offWithout++
      }
    }
    // ANTI-VACUITY, and the size of the defect: a fifth of a farmhouse's floor was unreachable
    expect(offWithout, 'no tile was ever off the glass — nothing was fixed').toBeGreaterThan(20)
  })

  it('★ the pan eases rather than cuts, and at the same rate however fast the frames come', () => {
    // 260 ms to close half the distance — the same motion at 30 fps and at 120.
    expect(easePan(100, 100, 16)).toBe(100)
    expect(easePan(0, 100, 0)).toBe(0)                                  // no frame, no motion
    expect(easePan(0, 100, ROOM_PAN_HALF_LIFE_MS)).toBeCloseTo(50, 6)   // half, by definition
    // frame-rate independence: eight 8 ms frames land where two 32 ms frames land
    let fast = 0
    for (let i = 0; i < 8; i++) fast = easePan(fast, 100, 8)
    let slow = 0
    for (let i = 0; i < 2; i++) slow = easePan(slow, 100, 32)
    expect(fast).toBeCloseTo(slow, 6)
  })
})

// ★ WHAT THE SCALE IS FOR. Both of these are about the picture, not the geometry, and neither
// is visible to `drawScale.test.ts`, which measures WORLD size and leaves the zoom on top to
// the camera's own law.
describe('★ the room is drawn at the same pixel density as the town at its closest', () => {
  // ★ THIS TEST USED TO ASSERT THE DEFECT AS A LAW, and it was green while the user was
  // looking at a man taller than his own wall. It said "a body is exactly as tall indoors as
  // it is out of doors" and pinned `CHAR_TARGET_PX x INTERIOR_PX_SCALE x ROOM_ZOOM` at 208.
  //
  // The claim is false, and the reason is the whole of the scale defect: `INTERIOR_PX_SCALE`
  // is the PIXEL factor between the two views and the WORLD factor is a different number. An
  // interior tile is a metre of floor — the library authors a bed at 1x2 and a table at 1x1 —
  // where a town tile is a corner of a plot. Carrying a body across on the pixel factor alone
  // keeps the town's body-to-tile ratio in a room where a tile means something else.
  //
  // What IS true, and is what this pair of tests was for, is the PIXEL DENSITY: one interior
  // tile reaches the glass at exactly the size the town's deepest stop draws a town tile, so
  // nothing in the room is resampled. `interiorScale.test.ts` owns the body's own law.
  it('★ one interior tile is on the glass at the town\'s own deepest density', () => {
    expect(INTERIOR_PX_SCALE).toBe(ZOOM_SCALE_MAX)
    expect(INTERIOR_TILE.w * ROOM_ZOOM).toBe(TILE_W * ZOOM_SCALE_MAX)
    // and the body does NOT take that factor: it is the room's own height, and it is smaller
    expect(INTERIOR_BODY_PX).toBeLessThan(CHAR_TARGET_PX * INTERIOR_PX_SCALE * ROOM_ZOOM)
    expect(INTERIOR_BODY_PX).toBeLessThan(WALL_H_PX)
  })

  it('★ and a furnishing reaches the screen at exactly the pixels it was drawn on', () => {
    // `furnishingScale` is the world-space half; the zoom is the other half, and the COMPOSITE
    // is what the sampler sees. It was 0.5 x 4 = 2 — a clean doubling, but a DOUBLING, so half
    // the pixels on the glass were invented. Option C makes it 1 x 1.
    const composite = furnishingScale() * ROOM_ZOOM
    expect(Number.isInteger(composite), `composite is ${composite}`).toBe(true)
    expect(composite).toBe(1)
    // one interior tile is 128 px on the glass, exactly as it was at the old zoom of 4
    expect(INTERIOR_TILE.w * ROOM_ZOOM).toBe(128)
  })

  it('★ and the zoom the scene uses is the one the stage chose, never a bare constant', () => {
    const src = readFileSync(new URL('./interiorScene.ts', import.meta.url), 'utf8')
    expect(src, 'the room scales by a constant again').toContain('room.scale.set(zoom)')
    expect(src).toContain('roomZoomFor(app.screen.height)')
  })
})

describe('roomShell — the palette', () => {
  it('paints nothing that is not a MASTER_PALETTE member', () => {
    for (const [name, color] of Object.entries(ROOM_SHELL_PAINT)) {
      expect(MASTER_PALETTE, `${name} — 0x${color.toString(16)}`).toContain(color)
    }
    expect(MASTER_PALETTE).toContain(ROOM_SHELL_INK)
  })

  it('the two walls and the floor are three separable tones', () => {
    const { wallLit, wallShade, floor } = ROOM_SHELL_PAINT
    expect(wallLit).not.toBe(wallShade)
    // a room read as flat because every plane was one cream; each plane is now a step apart
    expect(Math.abs(luma(wallLit) - luma(wallShade))).toBeGreaterThan(0.05)
    expect(Math.abs(luma(floor) - luma(wallLit))).toBeGreaterThan(0.02)
    expect(Math.abs(luma(floor) - luma(wallShade))).toBeGreaterThan(0.05)
  })
})
