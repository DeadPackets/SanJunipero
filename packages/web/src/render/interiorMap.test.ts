import { describe, expect, it } from 'vitest'
import { CITY_INTERIOR_SLOTS, cityStructures } from '@sj/shared'
import { TILE_H, TILE_W } from './iso.js'
import {
  INTERIOR_ACTS,
  INTERIOR_PX_SCALE,
  INTERIOR_TILE,
  ROOM_TILES,
  TILES_PER_SLOT,
  WALL_FACING,
  WALL_H_PX,
  WALL_KINDS,
  actFor,
  alongWall,
  interiorPath,
  interiorToScreen,
  isWalkable,
  roomMapOf,
  seatInBlock,
  slotToTile,
  standingTiles,
  tilesOf,
  walkableCount,
  wallOfTile,
  type PieceInput,
  type RoomMap,
  type Tile,
} from './interiorMap.js'

// The five pieces the city template gives every founder's house, with the footprints the C13
// library declares — the room the mock's treatment C composes, from the world's own data.
const HUT: PieceInput[] = [
  { kind: 'bed', slot: { x: 2, y: 1 }, size: { w: 1, h: 2 } },
  { kind: 'hearth', slot: { x: 0, y: 2 }, placement: 'wall' },
  { kind: 'table', slot: { x: 1, y: 2 } },
  { kind: 'chair', slot: { x: 1, y: 1 } },
  { kind: 'rug', slot: { x: 0, y: 0 }, size: { w: 1, h: 2 }, flat: true },
]

const at = (map: RoomMap, kind: string) => map.pieces.find((p) => p.kind === kind)!

describe('interiorMap — Option C, the numbers off the mock', () => {
  it('★ ships the stat strip treatment C published, not treatment A', () => {
    expect(INTERIOR_PX_SCALE).toBe(4)
    expect(INTERIOR_TILE).toEqual({ w: 128, h: 64 })
    expect(INTERIOR_TILE.w).toBe(TILE_W * INTERIOR_PX_SCALE)
    expect(INTERIOR_TILE.h).toBe(TILE_H * INTERIOR_PX_SCALE)
    expect(ROOM_TILES).toEqual({ w: 12, h: 6 })
    expect(ROOM_TILES.w * ROOM_TILES.h).toBe(72)
    expect(WALL_H_PX).toBe(160)
  })

  it("the room map is the template's own slot grid, four tiles by two", () => {
    expect(ROOM_TILES.w).toBe(CITY_INTERIOR_SLOTS.w * TILES_PER_SLOT.w)
    expect(ROOM_TILES.h).toBe(CITY_INTERIOR_SLOTS.h * TILES_PER_SLOT.h)
    // every slot the template can name lands inside the room
    for (let y = 0; y < CITY_INTERIOR_SLOTS.h; y++) {
      for (let x = 0; x < CITY_INTERIOR_SLOTS.w; x++) {
        const t = slotToTile({ x, y })
        expect(t.x, `slot ${x},${y}`).toBeLessThan(ROOM_TILES.w)
        expect(t.y, `slot ${x},${y}`).toBeLessThan(ROOM_TILES.h)
      }
    }
  })

  it("keeps the town's projection — the doorway is a push-in, not another world", () => {
    // sx = (x-y)*tileW/2, sy = (x+y)*tileH/2, exactly iso.ts with a bigger tile
    expect(interiorToScreen(1, 0)).toEqual({ sx: 64, sy: 32 })
    expect(interiorToScreen(0, 1)).toEqual({ sx: -64, sy: 32 })
    // 2:1 dimetric: one step along either axis moves twice as far across as it does down
    expect(interiorToScreen(1, 0).sx / interiorToScreen(1, 0).sy).toBe(2)
    expect(interiorToScreen(0, 1).sx / interiorToScreen(0, 1).sy).toBe(-2)
    // and it is the town's projection scaled, tile for tile
    const town = { sx: (3 - 1) * (TILE_W / 2), sy: (3 + 1) * (TILE_H / 2) }
    expect(interiorToScreen(3, 1)).toEqual({
      sx: town.sx * INTERIOR_PX_SCALE,
      sy: town.sy * INTERIOR_PX_SCALE,
    })
  })
})

describe('interiorMap — the room is a map a body can occupy', () => {
  it('★ 72 tiles exist and the furniture takes only what it stands on', () => {
    const map = roomMapOf(HUT)
    expect(map.w * map.h).toBe(72)
    // bed 1x2 = 2, table 1, chair 1, hearth 1 (on the wall) = 5 blocked; the rug blocks none
    expect(map.blocked.reduce<number>((n, b) => n + b, 0)).toBe(5)
    expect(walkableCount(map)).toBe(67)
  })

  it('a body cannot stand where the table stands, and can stand all round it', () => {
    const map = roomMapOf(HUT)
    const table = at(map, 'table')
    for (const t of tilesOf(table)) expect(isWalkable(map, t), `${t.x},${t.y}`).toBe(false)
    // THREE, not four — the fourth is the CHAIR. `seatInBlock` puts it on the side of its own
    // block the table is on, so the seat a body cannot stand on is a chair standing there.
    expect(standingTiles(map, table).length).toBe(3)
    expect(at(map, 'chair').tile).toEqual({ x: table.tile.x, y: table.tile.y - 1 })
  })

  it('★ seatInBlock groups what the template says belongs together, and moves nothing else', () => {
    // The chair's slot is adjacent to the table's and it was drawn TWO tiles away, because every
    // piece took the same corner of its own two-deep block. Derived from the slots, so it is
    // still world data.
    const map = roomMapOf(HUT)
    expect(seatInBlock({ x: 1, y: 1 }, [{ x: 1, y: 2 }])).toEqual({ x: 5, y: 3 }) // pulled near
    expect(seatInBlock({ x: 1, y: 2 }, [{ x: 1, y: 1 }])).toEqual({ x: 5, y: 4 }) // stays far
    expect(seatInBlock({ x: 1, y: 1 }, [])).toEqual(slotToTile({ x: 1, y: 1 })) // alone: unmoved
    // both sides pull equally, so nothing moves — a rule with no arbitrary tie-break
    expect(
      seatInBlock({ x: 1, y: 1 }, [
        { x: 1, y: 0 },
        { x: 1, y: 2 },
      ]),
    ).toEqual(slotToTile({ x: 1, y: 1 }))
    // a piece with no neighbour in its own column is exactly where it always was
    for (const kind of ['bed', 'rug']) {
      const p = at(map, kind)
      const src = HUT.find((h) => h.kind === kind)!
      expect(p.tile, kind).toEqual(slotToTile(src.slot))
    }
  })

  it('the rug is walked ON — a flat piece blocks nothing', () => {
    const map = roomMapOf(HUT)
    for (const t of tilesOf(at(map, 'rug'))) expect(isWalkable(map, t)).toBe(true)
  })

  it('every piece the world actually furnishes a house with lands inside the room', () => {
    const house = cityStructures().find((s) => s.kind === 'house')!
    expect(house.furnishings.length).toBeGreaterThan(0)
    const map = roomMapOf(house.furnishings.map((f) => ({ kind: f.kind, slot: f.slot })))
    for (const p of map.pieces) {
      for (const t of tilesOf(p)) {
        expect(t.x, `${p.kind} at ${t.x},${t.y}`).toBeLessThan(ROOM_TILES.w)
        expect(t.y, `${p.kind} at ${t.x},${t.y}`).toBeLessThan(ROOM_TILES.h)
      }
    }
  })
})

describe('interiorMap — a body walks it', () => {
  const map = roomMapOf(HUT)
  const table = at(map, 'table')
  // DIRECTLY across the table from each other: the straight line between these two tiles is two
  // steps and the middle one is the table, so a walk that is not a detour walks through the
  // furniture. Across the X axis, which has one blocker; the depth axis has two.
  const start: Tile = { x: table.tile.x - 1, y: table.tile.y }
  const goal: Tile = { x: table.tile.x + 1, y: table.tile.y }

  const walkIsLegal = (path: readonly Tile[], from: Tile): void => {
    let prev = from
    for (const step of path) {
      expect(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y), 'not a single step').toBe(1)
      expect(isWalkable(map, step), `stepped on a blocked tile ${step.x},${step.y}`).toBe(true)
      prev = step
    }
  }

  it('★ PROOF: a person crosses to the far side of the table by going AROUND it', () => {
    expect(isWalkable(map, start)).toBe(true)
    expect(isWalkable(map, goal)).toBe(true)
    expect(isWalkable(map, table.tile), 'the table does not block its own tile').toBe(false)

    const path = interiorPath(map, start, goal)
    expect(path, 'no walk exists across this room').not.toBeNull()
    expect(path!.at(-1)).toEqual(goal)
    walkIsLegal(path!, start)

    const taken = new Set(tilesOf(table).map((t) => `${t.x},${t.y}`))
    for (const step of path!) {
      expect(taken.has(`${step.x},${step.y}`), 'walked THROUGH the table').toBe(false)
    }
    // ★ THE DETOUR, MEASURED. Manhattan says 2; going round a 1x1 piece costs 4. A path of
    // length 2 is a path straight over the table.
    const straight = Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y)
    expect(straight).toBe(2)
    expect(path!.length, 'the walk did not detour').toBe(4)
  })

  it('and it crosses the whole room, corner to corner, past the bed as well', () => {
    const path = interiorPath(map, { x: 11, y: 5 }, { x: 0, y: 0 })
    expect(path).not.toBeNull()
    walkIsLegal(path!, { x: 11, y: 5 })
    expect(path!.at(-1)).toEqual({ x: 0, y: 0 })
  })

  it('★ VACUOUS GUARD: the same check FAILS when the room is not walkable', () => {
    // Fence the goal in on all four sides. If the walk above could pass over an unwalkable room
    // this would still find a path — a pathing test is the easiest one to write vacuously.
    const fenced: RoomMap = { ...map, blocked: new Uint8Array(map.blocked) }
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      const n = { x: goal.x + dx, y: goal.y + dy }
      if (n.x < 0 || n.y < 0 || n.x >= map.w || n.y >= map.h) continue
      fenced.blocked[n.y * map.w + n.x] = 1
    }
    expect(interiorPath(fenced, start, goal)).toBeNull()
    // walking to somewhere a body cannot stand is not a walk
    expect(interiorPath(map, start, table.tile)).toBeNull()
    // and neither is walking out of the room
    expect(interiorPath(map, start, { x: ROOM_TILES.w, y: 0 })).toBeNull()
  })

  it('the walk is deterministic — two viewers see the same body take the same route', () => {
    expect(interiorPath(map, start, goal)).toEqual(interiorPath(roomMapOf(HUT), start, goal))
  })
})

describe('interiorMap — two facings, and no third', () => {
  it('★ a wall presents exactly one facing, and it is SW or SE', () => {
    expect(Object.keys(WALL_FACING).sort()).toEqual([...WALL_KINDS].sort())
    expect(new Set(Object.values(WALL_FACING))).toEqual(new Set(['sw', 'se']))
    // NE and NW are unauthored. `TownFacing` has no member for them, so the line below cannot
    // be written without a cast — which is the point of the type.
    expect(Object.values(WALL_FACING)).not.toContain('ne')
    expect(Object.values(WALL_FACING)).not.toContain('nw')
  })

  it('the hearth is on the wall its slot touches, and faces the way that wall faces', () => {
    const map = roomMapOf(HUT)
    const hearth = at(map, 'hearth')
    expect(hearth.placement).toBe('wall')
    expect(wallOfTile(hearth.tile)).toBe('back-left')
    expect(hearth.facing).toBe(WALL_FACING['back-left'])
    expect(hearth.facing).toBe('se')
    // it is ON the wall, not standing a tile in front of it
    expect(hearth.tile.x).toBe(0)
    expect(alongWall('back-left', hearth.tile)).toBe(4)
  })

  it('a wall piece on the far row takes the other wall, and the other facing', () => {
    const map = roomMapOf([{ kind: 'shelf', slot: { x: 2, y: 0 }, placement: 'wall' }])
    const shelf = at(map, 'shelf')
    expect(shelf.tile.y).toBe(0)
    expect(wallOfTile(shelf.tile)).toBe('back-right')
    expect(shelf.facing).toBe('sw')
  })

  it('a tile in the middle of the floor is against no wall at all', () => {
    expect(wallOfTile({ x: 5, y: 3 })).toBeNull()
    expect(wallOfTile({ x: 0, y: 0 })).toBe('back-right')
  })
})

describe('interiorMap — what a body can do with each of the five pieces', () => {
  it('names all five, and no piece claims a verb the engine does not have', () => {
    expect(INTERIOR_ACTS.map((a) => a.kind)).toEqual(['bed', 'hearth', 'table', 'chair', 'rug'])
    for (const act of INTERIOR_ACTS) {
      if (act.verb === null) expect(act.via).toBe('none')
      else expect(act.via).not.toBe('none')
    }
  })

  it('★ every gap is written down — a piece with no engine reach says what it needs', () => {
    // The engine addresses structures and held items; it has no furnishing vocabulary at all,
    // so four of the five pieces are pictures until it grows one. That is stated, not hidden.
    const open = INTERIOR_ACTS.filter((a) => a.needs !== null)
    expect(open.map((a) => a.kind)).toEqual(['bed', 'hearth', 'table', 'chair'])
    for (const a of open) expect(a.needs!.length, a.kind).toBeGreaterThan(40)
    expect(actFor('rug')!.needs).toBeNull()
    expect(actFor('nothing-like-this')).toBeNull()
  })
})
