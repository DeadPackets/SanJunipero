import { describe, expect, it } from 'vitest'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import {
  DOORWAY_POOL_ALPHA, HEARTH_POOL_ALPHA, ROOM_SHELL_INK, ROOM_SHELL_PAINT, ROOM_SLOTS,
  SLOT_TILES, WALL_H_TILES, WALL_KINDS, WALL_MOUNT_H_TILES,
  drawFloorBase, drawFloorLight, drawFloorTop, drawWalls, floorBoards, floorPolyOf, floorPools,
  roomBox, roomMaskPoly, roomOriginY, skirtingPolys, slotCentreScreen, thresholdPoly,
  wallCourses, wallMount, wallPolys, type ShellPainter,
} from './roomShell.js'

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
    const w = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    expect(Object.keys(w).sort()).toEqual([...WALL_KINDS].sort())
    for (const kind of WALL_KINDS) {
      expect(w[kind], kind).toHaveLength(8)          // four points, closed by construction
      expect(new Set(pts(w[kind]).map((p) => p.join(','))).size, kind).toBe(4)
    }
  })

  it('the pair shares exactly one edge — the room’s far vertical column', () => {
    const w = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    const shared = edges(w['back-left']).filter((e) => edges(w['back-right']).includes(e))
    expect(shared).toHaveLength(1)
    // the far vertex (0,0) rising by WALL_H_TILES tiles of height
    expect(shared[0]).toBe(edgeKey([0, -WALL_H_TILES * TILE_W], [0, 0]))
  })

  it('neither wall covers the floor — the floor’s centroid is outside both', () => {
    const w = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    const floor = pts(floorPolyOf(ROOM_SLOTS, SLOT_TILES))
    const cx = floor.reduce((s, p) => s + p[0], 0) / floor.length
    const cy = floor.reduce((s, p) => s + p[1], 0) / floor.length
    expect([cx, cy]).toEqual([0, (ROOM_SLOTS * SLOT_TILES * TILE_H) / 2])
    for (const kind of WALL_KINDS) expect(pointInPoly(w[kind], cx, cy), kind).toBe(false)
  })

  it('the walls rise BEHIND the floor: every wall point is at or above the floor’s far edges', () => {
    const w = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    const near = tileToScreen(ROOM_SLOTS * SLOT_TILES, ROOM_SLOTS * SLOT_TILES)
    for (const kind of WALL_KINDS) {
      for (const [, y] of pts(w[kind])) expect(y, kind).toBeLessThan(near.sy)
    }
  })

  it('courses and skirting are cut from the wall they belong to', () => {
    const w = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    const courses = wallCourses(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    const skirt = skirtingPolys(ROOM_SLOTS, SLOT_TILES)
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

describe('roomShell — where a wall piece hangs', () => {
  it('the far-left slots hang on back-left and the far-right slots on back-right', () => {
    expect(wallMount({ x: 0, y: 0 }, ROOM_SLOTS).wall).toBe('back-left')
    expect(wallMount({ x: 0, y: 2 }, ROOM_SLOTS).wall).toBe('back-left')
    expect(wallMount({ x: 2, y: 0 }, ROOM_SLOTS).wall).toBe('back-right')
    expect(wallMount({ x: 1, y: 0 }, ROOM_SLOTS).wall).toBe('back-right')
  })

  it('a mount is at eye height ABOVE the floor’s far edge, and on its own wall plane', () => {
    const w = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    for (const slot of [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 1, y: 1 }]) {
      const m = wallMount(slot, ROOM_SLOTS)
      const base = m.wall === 'back-right'
        ? tileToScreen((slot.x + 0.5) * SLOT_TILES, 0)
        : tileToScreen(0, (slot.y + 0.5) * SLOT_TILES)
      expect(m.sx).toBeCloseTo(base.sx, 6)
      expect(m.sy).toBeCloseTo(base.sy - WALL_MOUNT_H_TILES * TILE_W, 6)
      expect(m.sy).toBeLessThan(base.sy)                      // above the far edge
      expect(pointInPoly(w[m.wall], m.sx, m.sy)).toBe(true)   // on the plane it hangs from
    }
  })

  it('is pure: two calls agree', () => {
    expect(wallMount({ x: 1, y: 2 }, ROOM_SLOTS)).toEqual(wallMount({ x: 1, y: 2 }, ROOM_SLOTS))
  })
})

describe('roomShell — the threshold', () => {
  it('sits on the NEAR face, centred on the floor’s near vertex', () => {
    const t = thresholdPoly(ROOM_SLOTS, SLOT_TILES)
    const near = tileToScreen(ROOM_SLOTS * SLOT_TILES, ROOM_SLOTS * SLOT_TILES)
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
    const w = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    for (const [x, y] of pts(thresholdPoly(ROOM_SLOTS, SLOT_TILES))) {
      for (const kind of WALL_KINDS) expect(pointInPoly(w[kind], x, y), kind).toBe(false)
    }
  })
})

describe('roomShell — light on the floor', () => {
  const lit = [
    { slot: { x: 0, y: 2 }, light: true },
    { slot: { x: 1, y: 2 }, light: false },
    { slot: { x: 2, y: 1 }, light: true },
  ]

  it('one pool per light source, plus exactly one doorway pool', () => {
    expect(floorPools(lit, ROOM_SLOTS)).toHaveLength(3)
    const dark = floorPools([{ slot: { x: 1, y: 1 }, light: false }], ROOM_SLOTS)
    expect(dark).toHaveLength(1)                                  // the doorway, and nothing else
    expect(dark[0]!.alpha).toBe(DOORWAY_POOL_ALPHA)
    expect(floorPools([], ROOM_SLOTS)).toHaveLength(1)
  })

  it('the doorway pool is at the near vertex; a hearth pool is at its own slot', () => {
    const pools = floorPools(lit, ROOM_SLOTS)
    const near = tileToScreen(ROOM_SLOTS * SLOT_TILES, ROOM_SLOTS * SLOT_TILES)
    expect([pools[0]!.sx, pools[0]!.sy]).toEqual([near.sx, near.sy])
    const hearth = slotCentreScreen(0, 2)
    expect([pools[1]!.sx, pools[1]!.sy]).toEqual([hearth.sx, hearth.sy])
    expect(pools[1]!.alpha).toBe(HEARTH_POOL_ALPHA)
  })

  it('no pool is brighter than a hearth, and every radius is positive', () => {
    for (const p of floorPools(lit, ROOM_SLOTS)) {
      expect(p.alpha).toBeLessThanOrEqual(HEARTH_POOL_ALPHA)
      expect(p.alpha).toBeGreaterThan(0)
      expect(p.radius).toBeGreaterThan(0)
    }
  })

  it('is pure and deterministic', () => {
    expect(floorPools(lit, ROOM_SLOTS)).toEqual(floorPools(lit, ROOM_SLOTS))
  })
})

describe('roomShell — the floor is a surface, not a card', () => {
  it('board seams run the length of the floor and stay inside it', () => {
    const floor = floorPolyOf(ROOM_SLOTS, SLOT_TILES)
    const boards = floorBoards(ROOM_SLOTS, SLOT_TILES)
    expect(boards.length).toBeGreaterThanOrEqual(ROOM_SLOTS * SLOT_TILES - 1)
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
    drawWalls(g, ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
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
    const pools = floorPools([{ slot: { x: 0, y: 2 }, light: true }], ROOM_SLOTS)
    drawFloorLight(g, pools, ROOM_SLOTS, SLOT_TILES)
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

  // WHAT THE BROWSER CAUGHT: unmasked, the doorway pool painted a pale ellipse across the town
  // and the threshold hung below the floor like a tab. Both straddle the near vertex BY
  // CONSTRUCTION, which is why one masked node holds them — and why that is now an assertion.
  it('both the doorway pool and the threshold overflow the floor, so both must be masked', () => {
    const floor = floorPolyOf(ROOM_SLOTS, SLOT_TILES)
    const p = floorPools([], ROOM_SLOTS)[0]!
    expect(pointInPoly(floor, p.sx, p.sy + p.radius / 2)).toBe(false)
    expect(p.radius).toBeGreaterThan((ROOM_SLOTS * SLOT_TILES * TILE_W) / 4)
    const t = pts(thresholdPoly(ROOM_SLOTS, SLOT_TILES))
    expect(t.some(([x, y]) => !pointInPoly(floor, x, y))).toBe(true)
  })

  it('drawFloorBase with a material under it skips its own fill and nothing else', () => {
    const flat = recorder(), material = recorder()
    drawFloorBase(flat.g, ROOM_SLOTS, SLOT_TILES)
    drawFloorBase(material.g, ROOM_SLOTS, SLOT_TILES, null)
    expect(flat.ops.length - material.ops.length).toBe(2)   // one poly, one fill
    expect(flat.ops.filter((o) => o.op === 'fill').map((o) => o.arg))
      .toContain(ROOM_SHELL_PAINT.floor)
    expect(material.ops.filter((o) => o.op === 'fill').map((o) => o.arg))
      .not.toContain(ROOM_SHELL_PAINT.floor)
  })

  it('drawFloorTop closes the plane in ink and nothing else', () => {
    const { ops, g } = recorder()
    drawFloorTop(g, ROOM_SLOTS, SLOT_TILES)
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
  const mask = roomMaskPoly(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)

  it('is the union of both walls and the floor, and holds every point of all three', () => {
    expect(mask).toHaveLength(12)              // a hexagon
    const walls = wallPolys(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    const inside = (x: number, y: number): boolean =>
      pointInPoly(mask, x, y) || pts(mask).some(([mx, my]) => mx === x && my === y)
    for (const kind of WALL_KINDS) {
      for (const [x, y] of pts(walls[kind])) expect(inside(x, y), `${kind} ${x},${y}`).toBe(true)
    }
    for (const [x, y] of pts(floorPolyOf(ROOM_SLOTS, SLOT_TILES))) expect(inside(x, y)).toBe(true)
  })

  it('excludes the space a spilling light would reach', () => {
    const near = tileToScreen(ROOM_SLOTS * SLOT_TILES, ROOM_SLOTS * SLOT_TILES)
    expect(pointInPoly(mask, 0, near.sy + 200)).toBe(false)
    expect(pointInPoly(mask, -600, 0)).toBe(false)
    expect(pointInPoly(mask, 0, -WALL_H_TILES * TILE_W - 50)).toBe(false)
  })
})

// WHAT THE BROWSER CAUGHT: the landed camera centred the FLOOR. Walls doubled the height of
// the drawn box, so the top of the room was cut off by the top of the stage.
describe('roomShell — the room fits the stage', () => {
  const STAGE_H = 737, ZOOM = 3, OFFSET = 40

  it('the box is the walls plus the floor, not the floor alone', () => {
    const box = roomBox(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    expect(box.top).toBe(-WALL_H_TILES * TILE_W)
    expect(box.bottom).toBe(ROOM_SLOTS * SLOT_TILES * TILE_H)
    expect(box.height).toBe(WALL_H_TILES * TILE_W + ROOM_SLOTS * SLOT_TILES * TILE_H)
  })

  it('centring the whole box keeps every wall point on the stage', () => {
    const y = roomOriginY(STAGE_H, OFFSET, ZOOM, ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    const box = roomBox(ROOM_SLOTS, SLOT_TILES, WALL_H_TILES)
    expect(y + box.top * ZOOM).toBeGreaterThan(0)
    expect(y + box.bottom * ZOOM).toBeLessThan(STAGE_H)
    // the landed rule centred the floor only, and put the wall top off the top of the stage
    const landed = STAGE_H / 2 - OFFSET - ((ROOM_SLOTS * SLOT_TILES * TILE_H) / 2) * ZOOM
    expect(landed + box.top * ZOOM).toBeLessThan(0)
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
