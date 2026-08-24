import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { interiorPieceKind, materialKind, type AssetRecord } from '@sj/shared'
import { INTERIOR_TILE, ROOM_TILES, WALL_H_PX, roomMapOf } from './interiorMap.js'
import {
  FURNISHING_WALL_PIECE, WALL_SHEAR_X, WALL_SKEW_Y, WALL_STRIP_TILES, WALL_STRIP_W,
  flagstoneRegions, hasInteriorTileset, resolveInteriorMaterial, resolveInteriorPiece,
  wallCourses, wallStripAt, wallStripWidth, wallTransform,
} from './interiorTileset.js'

const rec = (kind: string, seq: number, over: Partial<AssetRecord> = {}): AssetRecord => ({
  id: `asset_${kind}_${seq}`, seq, class: 'terrain', desc: kind, kind, meta: null,
  footprint: { w: 1, h: 1 }, widthPx: 256, heightPx: 160, status: 'ready',
  score: null, attempts: 1, costUsd: 0, createdAt: '2026-08-24T00:00:00.000Z', ...over,
})

const FULL: AssetRecord[] = [
  rec(materialKind('interior-floor'), 1),
  rec(materialKind('interior-flagstone'), 2),
  ...['wall-plain', 'wall-window', 'wall-door', 'wall-chimney', 'wall-dresser']
    .map((id, i) => rec(interiorPieceKind(id), 3 + i)),
]

describe('interiorTileset — the shear that puts a flat elevation on a dimetric wall', () => {
  it('★ the art is never stretched ALONG the wall — the run stays exactly 1:1', () => {
    expect(WALL_SHEAR_X * Math.cos(WALL_SKEW_Y)).toBeCloseTo(1, 12)
    // and the rise is exactly half the run, which is the town's own 2:1
    expect(WALL_SHEAR_X * Math.sin(WALL_SKEW_Y)).toBeCloseTo(INTERIOR_TILE.h / INTERIOR_TILE.w, 12)
    expect(Math.tan(WALL_SKEW_Y)).toBeCloseTo(0.5, 12)
  })

  it('the two walls run opposite ways across the screen, and the left one is mirrored', () => {
    const right = wallTransform('back-right'), left = wallTransform('back-left')
    expect(right.scaleX).toBeGreaterThan(0)
    expect(left.scaleX).toBeLessThan(0)
    expect(left.skewY).toBe(-right.skewY)
    // both still land the same rise per run, in their own direction
    expect(right.scaleX * Math.sin(right.skewY)).toBeCloseTo(0.5, 12)
    expect(left.scaleX * Math.sin(left.skewY)).toBeCloseTo(0.5, 12)
  })

  it('a strip starts on its wall base and rises the wall\'s own authored height', () => {
    expect(wallStripAt('back-right', 0)).toEqual({ sx: 0, sy: -WALL_H_PX })
    expect(wallStripAt('back-left', 0)).toEqual({ sx: -0, sy: -WALL_H_PX })
    const four = wallStripAt('back-right', WALL_STRIP_TILES)
    expect(four.sx).toBe(WALL_STRIP_W)
    expect(four.sy).toBe(WALL_STRIP_W / 2 - WALL_H_PX)
    // and the left wall runs the other way for the same distance
    expect(wallStripAt('back-left', WALL_STRIP_TILES).sx).toBe(-WALL_STRIP_W)
  })

  it('★ a strip that would overrun its wall is CROPPED, never squeezed', () => {
    expect(wallStripWidth('back-right', 0)).toBe(WALL_STRIP_W)
    expect(wallStripWidth('back-right', 8)).toBe(WALL_STRIP_W)      // 12 tiles = three strips
    expect(wallStripWidth('back-right', 12)).toBe(0)                // past the corner
    // the short wall is 6 tiles: one whole strip and half of another
    expect(wallStripWidth('back-left', 0)).toBe(WALL_STRIP_W)
    expect(wallStripWidth('back-left', 4)).toBe(WALL_STRIP_W / 2)
    expect(wallStripWidth('back-left', 6)).toBe(0)
  })
})

describe('interiorTileset — what goes on the wall', () => {
  const hut = roomMapOf([
    { kind: 'bed', slot: { x: 2, y: 1 }, size: { w: 1, h: 2 } },
    { kind: 'hearth', slot: { x: 0, y: 2 }, placement: 'wall' },
    { kind: 'table', slot: { x: 1, y: 2 } },
  ])
  const hearth = hut.pieces.find((p) => p.kind === 'hearth')!
  const features = [{ kind: 'hearth', wall: 'back-left' as const, atTiles: hearth.tile.y }]

  it('lays every wall plain end to end first, so a wall can never have a gap', () => {
    const plain = wallCourses([]).filter((c) => c.piece === 'wall-plain')
    const right = plain.filter((c) => c.wall === 'back-right').map((c) => c.atTiles)
    const left = plain.filter((c) => c.wall === 'back-left').map((c) => c.atTiles)
    expect(right).toEqual([0, 4, 8])          // 12 tiles
    expect(left).toEqual([0, 4])              // 6 tiles, the second one cropped
    // and between them they cover every tile of both walls
    expect(Math.max(...right) + WALL_STRIP_TILES).toBeGreaterThanOrEqual(ROOM_TILES.w)
    expect(Math.max(...left) + WALL_STRIP_TILES).toBeGreaterThanOrEqual(ROOM_TILES.h)
  })

  it('a room has a window and a door, and they are at opposite ends of the long wall', () => {
    const c = wallCourses([])
    const window = c.find((x) => x.piece === 'wall-window')!
    const door = c.find((x) => x.piece === 'wall-door')!
    expect(window.wall).toBe('back-right')
    expect(door.wall).toBe('back-right')
    expect(door.atTiles).toBeGreaterThan(window.atTiles)
  })

  it('★ THE HEARTH IS THE CHIMNEY BREAST — one piece, on the wall its tile is against', () => {
    const c = wallCourses(features)
    const chimney = c.filter((x) => x.piece === 'wall-chimney')
    expect(chimney).toHaveLength(1)
    expect(chimney[0]!.wall).toBe('back-left')
    expect(FURNISHING_WALL_PIECE['hearth']).toBe('wall-chimney')
    // it stays inside its own wall — a strip pushed off the end is a strip nobody sees
    expect(wallStripWidth('back-left', chimney[0]!.atTiles)).toBeGreaterThan(0)
  })

  it('a furnishing with no elevation of its own puts nothing on the wall', () => {
    expect(FURNISHING_WALL_PIECE['lantern']).toBeUndefined()
    const c = wallCourses([{ kind: 'lantern', wall: 'back-left', atTiles: 2 }])
    expect(c.filter((x) => x.piece !== 'wall-plain').map((x) => x.piece).sort())
      .toEqual(['wall-door', 'wall-window'])
  })
})

describe('interiorTileset — art independence', () => {
  it('★ an empty codex resolves nothing, and the painted shell stands', () => {
    expect(hasInteriorTileset([])).toBe(false)
    expect(resolveInteriorPiece([], 'wall-plain')).toBeNull()
    expect(resolveInteriorMaterial([], 'interior-floor')).toBeNull()
  })

  it('a full codex resolves every piece the room asks for', () => {
    expect(hasInteriorTileset(FULL)).toBe(true)
    for (const c of wallCourses([{ kind: 'hearth', wall: 'back-left', atTiles: 4 }])) {
      expect(resolveInteriorPiece(FULL, c.piece), c.piece).not.toBeNull()
    }
    expect(resolveInteriorMaterial(FULL, 'interior-floor')).not.toBeNull()
    expect(resolveInteriorMaterial(FULL, 'interior-flagstone')).not.toBeNull()
  })

  it('the newest ready record wins, and a placeholder never does', () => {
    const older = rec(interiorPieceKind('wall-plain'), 1)
    const newer = rec(interiorPieceKind('wall-plain'), 9)
    expect(resolveInteriorPiece([newer, older], 'wall-plain')).toBe(`/assets/${newer.id}.png`)
    expect(resolveInteriorPiece([{ ...newer, status: 'placeholder' }], 'wall-plain')).toBeNull()
    expect(resolveInteriorPiece([{ ...newer, class: 'item' }], 'wall-plain')).toBeNull()
  })

  // ★ TASK 84 §2, AS A SOURCE ASSERTION. The mock drew the hearth twice — once as the authored
  // chimney breast on the wall, once as a freestanding sprite standing in front of it — because
  // its compositor declared `placement` and never read it. The scene now skips any furnishing
  // the wall itself draws.
  it('★ a furnishing the wall draws is not ALSO drawn as an object', () => {
    const src = readFileSync(new URL('./interiorScene.ts', import.meta.url), 'utf8')
    expect(src).toContain('if (asElevation.has(piece.kind)) return')
    expect(src).toContain('elevationKinds')
  })
})

describe('interiorTileset — the floor is two materials, not one', () => {
  it('stone goes under the hearth and inside the door, and boards everywhere else', () => {
    const regions = flagstoneRegions([{ x: 0, y: 4 }])
    expect(regions).toHaveLength(2)
    for (const r of regions) {
      expect(r.x0).toBeGreaterThanOrEqual(0)
      expect(r.y0).toBeGreaterThanOrEqual(0)
      expect(r.x1).toBeLessThanOrEqual(ROOM_TILES.w)
      expect(r.y1).toBeLessThanOrEqual(ROOM_TILES.h)
      expect(r.x1).toBeGreaterThan(r.x0)
      expect(r.y1).toBeGreaterThan(r.y0)
    }
    // and they cover far less than the room: a floor of nothing but flagstone is not a floor
    const stone = regions.reduce((n, r) => n + (r.x1 - r.x0) * (r.y1 - r.y0), 0)
    expect(stone).toBeLessThan((ROOM_TILES.w * ROOM_TILES.h) / 2)
  })

  it('a room with no fire still has stone at its threshold', () => {
    expect(flagstoneRegions([])).toHaveLength(1)
  })
})
