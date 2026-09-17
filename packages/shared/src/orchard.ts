import {
  cityStructures,
  TOWN_SQUARE,
  type CityStructure,
  type CityTemplate,
} from './cityTemplate.js'
import { doorFrontOf, type TownFacing } from './townGrammar.js'
import {
  T_EARTH,
  T_FARMLAND,
  T_FOREST,
  T_GRASS,
  T_PATH,
  T_ROAD,
  T_SAND,
  T_SAPLING,
  T_WATER,
} from './tiles.js'

export const ORCHARD_SIZE = 76
export const ORCHARD_SQUARE = { x: 34, y: 35 }
export const ORCHARD_ANCHOR = {
  x: TOWN_SQUARE.x - ORCHARD_SQUARE.x,
  y: TOWN_SQUARE.y - ORCHARD_SQUARE.y,
}
export type OrchardPoint = { x: number; y: number }
export type OrchardPlot = OrchardPoint & {
  facing: TownFacing
  w: number
  h: number
  court: { i: number; j: number }
  slot: string
}
export type OrchardRect = OrchardPoint & { w: number; h: number }

const HOMES: readonly (readonly [number, number, TownFacing])[] = [
  [24, 35, 'se'],
  [27, 23, 'se'],
  [34, 23, 'sw'],
  [41, 26, 'sw'],
  [27, 44, 'se'],
  [34, 45, 'se'],
  [42, 46, 'sw'],
  [46, 24, 'sw'],
  [53, 48, 'se'],
  [53, 39, 'se'],
  [45, 35, 'sw'],
  [36, 53, 'sw'],
]
const FUTURE = [
  [25, 15],
  [33, 15],
  [42, 16],
  [24, 55],
  [44, 55],
  [54, 60],
] as const
export const ORCHARD_GARDENS: readonly OrchardRect[] = [
  { x: 32, y: 30, w: 7, h: 4 },
  { x: 32, y: 43, w: 9, h: 2 },
  { x: 56, y: 46, w: 6, h: 2 },
  { x: 35, y: 35, w: 6, h: 2 },
  { x: 35, y: 42, w: 5, h: 1 },
]
const LAMPS = [
  [22, 37],
  [30, 36],
  [40, 34],
  [44, 41],
  [30, 30],
  [43, 31],
  [50, 34],
  [30, 48],
  [42, 51],
  [50, 46],
  [57, 43],
  [21, 41],
] as const
const ROADS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [3, 39],
    [21, 39],
    [38, 39],
    [49, 39],
    [58, 44],
    [60, 59],
  ],
  [
    [31, 39],
    [31, 29],
    [39, 29],
    [49, 30],
    [49, 39],
  ],
  [
    [31, 39],
    [31, 50],
    [40, 50],
    [49, 50],
    [49, 39],
  ],
]
export const orchardKey = (x: number, y: number): string => `${x},${y}`

export function stoneRoadTiles(terrain: readonly (readonly number[])[]): OrchardPoint[] {
  const out: OrchardPoint[] = []
  for (let y = 0; y < terrain.length; y++)
    for (let x = 0; x < terrain[y]!.length; x++) if (terrain[y]![x] === T_PATH) out.push({ x, y })
  return out
}
export const orchardContains = (r: OrchardRect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h
export const orchardOverlaps = (a: OrchardRect, b: OrchardRect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

export function orchardPlots(i = 0, j = 0): OrchardPlot[] {
  if (i === 0 && j === 0)
    return [
      ...HOMES.map(([x, y, facing], n) => ({
        x,
        y,
        facing,
        w: facing === 'se' ? 3 : 4,
        h: facing === 'se' ? 4 : 3,
        court: { i, j },
        slot: `home-${n}`,
      })),
      ...FUTURE.map(([x, y], n) => ({
        x,
        y,
        facing: 'sw' as const,
        w: 4,
        h: 3,
        court: { i, j },
        slot: `garden-${n}`,
      })),
    ]
  const cx = 38 + i * 24,
    cy = 39 + j * 24
  return [
    [cx - 8, cy - 7, 'sw'],
    [cx - 1, cy - 7, 'sw'],
    [cx - 8, cy + 3, 'sw'],
    [cx + 5, cy - 4, 'se'],
  ].map(([x, y, facing], n) => ({
    x: x as number,
    y: y as number,
    facing: facing as TownFacing,
    w: facing === 'se' ? 3 : 4,
    h: facing === 'se' ? 4 : 3,
    court: { i, j },
    slot: `court-${n}`,
  }))
}

export function orchardCourts(radius: number): { i: number; j: number }[] {
  const out = [{ i: 0, j: 0 }]
  for (let r = 2; r <= radius; r++)
    for (let j = -r; j <= r; j++)
      for (let i = 0; i <= r; i++) {
        if (Math.max(i, Math.abs(j)) === r) out.push({ i, j })
      }
  return out.sort((a, b) => a.i * a.i + a.j * a.j - b.i * b.i - b.j * b.j || a.j - b.j || a.i - b.i)
}

export function orchardCourtGarden(i: number, j: number): OrchardRect {
  return { x: 37 + i * 24, y: 41 + j * 24, w: 5, h: 5 }
}

export function orchardStreetTiles(i = 0, j = 0): OrchardPoint[] {
  const cx = 38 + i * 24,
    cy = 39 + j * 24
  const roads =
    i === 0 && j === 0
      ? ROADS
      : [
          [
            [cx - 4, cy],
            [cx + 10, cy],
            [cx + 10, cy + 10],
            [cx - 4, cy + 10],
            [cx - 4, cy],
          ],
        ]
  const points = new Map<string, OrchardPoint>()
  for (const road of roads)
    for (let n = 1; n < road.length; n++) {
      const [ax, ay] = road[n - 1]!,
        [bx, by] = road[n]!
      const steps = Math.max(Math.abs(bx! - ax!), Math.abs(by! - ay!)) * 3
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(ax! + ((bx! - ax!) * t) / steps),
          y = Math.round(ay! + ((by! - ay!) * t) / steps)
        for (const dy of [0, 1]) points.set(orchardKey(x, y + dy), { x, y: y + dy })
      }
    }
  return [...points.values()]
}

export function orchardRiverX(_y: number): number {
  return 18
}

export function orchardReserved(x: number, y: number): boolean {
  if (x >= 0 && x < ORCHARD_SIZE && y >= 0 && y < ORCHARD_SIZE) {
    if (Math.abs(x - orchardRiverX(y)) <= 3) return true
    if (ORCHARD_GARDENS.some((r) => orchardContains(r, x, y))) return true
    if (orchardContains({ x: 33, y: 34, w: 11, h: 10 }, x, y)) return true
    if (orchardContains({ x: 59, y: 49, w: 7, h: 9 }, x, y)) return true
    return CORE_STREETS.has(orchardKey(x, y))
  }
  return false
}
const CORE_STREETS = new Set(orchardStreetTiles().map((p) => orchardKey(p.x, p.y)))

export function orchardStructures(): CityStructure[] {
  const old = cityStructures()
  const roofs = old.filter((s) => !['well', 'fire_pit'].includes(s.kind))
  roofs.push({ ...roofs.find((s) => s.kind === 'house')!, owner: null, name: 'the garden house' })
  const out = roofs.map((s, i) => {
    const [dx, dy, facing] = HOMES[i]!
    return { ...s, dx, dy, facing }
  })
  const landmark = (
    kind: string,
    dx: number,
    dy: number,
    w: number,
    h: number,
    name: string,
  ): CityStructure => ({ kind, dx, dy, w, h, name, owner: null, facing: 'sw', furnishings: [] })
  out.push(
    landmark('well', 36, 37, 1, 1, 'the well'),
    landmark('fire_pit', 40, 41, 1, 1, 'the fire pit'),
  )
  out.push(landmark('bridge', 17, 39, 3, 1, 'the orchard bridge'))
  LAMPS.forEach(([x, y]) => {
    const { name: _, ...lamp } = landmark('lamp_post', x, y, 1, 1, '')
    out.push(lamp)
  })
  return out
}

export function makeOrchardTemplate(anchor: OrchardPoint = ORCHARD_ANCHOR): CityTemplate {
  const grid = Array.from({ length: ORCHARD_SIZE }, () => Array<number>(ORCHARD_SIZE).fill(T_GRASS))
  const structures = orchardStructures(),
    plots = orchardPlots()
  const set = (x: number, y: number, t: number) => {
    if (grid[y]?.[x] !== undefined) grid[y]![x] = t
  }
  const occupied = (x: number, y: number, gap = 0) =>
    structures.some((s) =>
      orchardContains({ x: s.dx - gap, y: s.dy - gap, w: s.w + gap * 2, h: s.h + gap * 2 }, x, y),
    )
  for (let y = 0; y < ORCHARD_SIZE; y++)
    for (let x = 0; x < ORCHARD_SIZE; x++) {
      const distance = Math.abs(x - orchardRiverX(y))
      if (distance <= 1) set(x, y, T_WATER)
      else if (distance === 2) set(x, y, T_SAND)
      else if (x >= 69 + Math.round(Math.sin(y * 0.31) * 2)) set(x, y, T_FOREST)
    }
  for (const p of orchardStreetTiles()) if (grid[p.y]?.[p.x] !== T_WATER) set(p.x, p.y, T_ROAD)
  for (let y = 35; y < 43; y++) for (let x = 34; x < 43; x++) set(x, y, T_PATH)
  for (const g of ORCHARD_GARDENS)
    for (let y = g.y; y < g.y + g.h; y++) for (let x = g.x; x < g.x + g.w; x++) set(x, y, T_GRASS)
  for (let y = 49; y < 58; y++) for (let x = 59; x < 66; x++) set(x, y, T_FARMLAND)
  for (const [ox, oy] of [
    [22, 18],
    [53, 19],
  ])
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) set(ox! + x * 2, oy! + y * 2, T_FOREST)
  for (const [gx, gy] of [
    [20, 27],
    [21, 49],
    [25, 62],
    [47, 63],
    [62, 30],
    [62, 37],
    [67, 51],
    [52, 10],
    [23, 10],
  ]) {
    for (const [dx, dy] of [
      [0, 0],
      [2, 0],
      [1, 2],
      [3, 3],
    ]) {
      const x = gx! + dx!,
        y = gy! + dy!
      if (
        !occupied(x, y, 2) &&
        !plots.some((p) =>
          orchardContains({ x: p.x - 1, y: p.y - 1, w: p.w + 2, h: p.h + 3 }, x, y),
        ) &&
        grid[y]?.[x] === T_GRASS
      )
        set(x, y, T_FOREST)
    }
  }
  for (const [x, y] of [
    [33, 31],
    [38, 32],
    [32, 43],
    [40, 43],
    [57, 46],
  ])
    if (!occupied(x!, y!, 1)) set(x!, y!, T_SAPLING)
  const blocked = new Set<string>()
  for (const p of plots)
    for (let y = p.y; y < p.y + p.h; y++)
      for (let x = p.x; x < p.x + p.w; x++) blocked.add(orchardKey(x, y))
  for (const s of structures)
    for (let y = s.dy; y < s.dy + s.h; y++)
      for (let x = s.dx; x < s.dx + s.w; x++) if (s.kind !== 'bridge') blocked.add(orchardKey(x, y))
  for (const s of structures.filter((s) => s.w > 1 && s.kind !== 'bridge')) {
    const door = doorFrontOf(s),
      queue = [{ x: door.dx, y: door.dy }],
      prev = new Map<string, string | null>([[orchardKey(door.dx, door.dy), null]])
    let end: string | null = null
    for (let n = 0; n < queue.length; n++) {
      const p = queue[n]!,
        k = orchardKey(p.x, p.y),
        tile = grid[p.y]?.[p.x]
      if (tile === T_PATH || tile === T_ROAD) {
        end = k
        break
      }
      for (const [dx, dy] of [
        [0, 1],
        [1, 0],
        [-1, 0],
        [0, -1],
      ]) {
        const x = p.x + dx!,
          y = p.y + dy!,
          next = orchardKey(x, y),
          t = grid[y]?.[x]
        if (
          t === undefined ||
          t === T_WATER ||
          blocked.has(next) ||
          prev.has(next) ||
          ORCHARD_GARDENS.some((g) => orchardContains(g, x, y))
        )
          continue
        prev.set(next, k)
        queue.push({ x, y })
      }
    }
    if (end === null) throw new Error(`No entrance path for ${s.name}`)
    while (end !== null) {
      const [x, y] = end.split(',').map(Number)
      if (grid[y!]?.[x!] !== T_ROAD) set(x!, y!, T_PATH)
      end = prev.get(end)!
    }
  }
  for (const s of structures)
    if (s.kind !== 'bridge')
      for (let y = s.dy; y < s.dy + s.h; y++)
        for (let x = s.dx; x < s.dx + s.w; x++) set(x, y, T_EARTH)
  const tiles = grid.flatMap((row, dy) => row.map((to, dx) => ({ dx, dy, to })))
  return { anchor, tiles, structures }
}
