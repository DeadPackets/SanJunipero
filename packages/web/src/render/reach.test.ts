import { describe, expect, it } from 'vitest'
import type { TileId } from '@sj/engine/state'
import { TILE_H, TILE_W } from './iso.js'
import {
  REACH_MARGIN_PX, cameraBoundsOf, clampCamera, drawnBoundsOf, reachableBoundsOf,
} from './camera.js'
import { bigTown } from './bigTown.js'

const terrainOf = (w: number, h: number): TileId[][] =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => 0 as TileId))

const STAGE = { w: 1728, h: 824 }

// ── ★ A TOWN THAT OUTGREW ITS OWN MAP ─────────────────────────────────────────────────────

describe('reachableBoundsOf', () => {
  const terrain = terrainOf(48, 48)

  it('is the terrain box when nothing has been built on it', () => {
    expect(reachableBoundsOf(terrain, [])).toEqual(cameraBoundsOf(terrain))
  })

  it('★ grows to hold a building standing past the end of the tile array', () => {
    const far = [{ x: 300, y: 300, w: 4, h: 2 }]
    const b = reachableBoundsOf(terrain, far)
    const drawn = drawnBoundsOf(far)
    expect(b.maxY).toBeGreaterThanOrEqual(drawn.maxY)
    expect(b.maxX).toBeGreaterThanOrEqual(drawn.maxX)
    expect(b.maxY).toBeGreaterThan(cameraBoundsOf(terrain).maxY)
  })

  it('grows in the negative direction too — the grammar plats both ways from the square', () => {
    // sx is (x - y) * 16, so a building must be off-diagonal to move minX at all
    const b = reachableBoundsOf(terrain, [{ x: -300, y: 0, w: 2, h: 2 }])
    expect(b.minX).toBeLessThan(cameraBoundsOf(terrain).minX)
    expect(b.minY).toBeLessThan(cameraBoundsOf(terrain).minY)
  })

  it('never shrinks below the ground that exists — a field is walkable even with no house on it', () => {
    const t = cameraBoundsOf(terrain)
    const b = reachableBoundsOf(terrain, [{ x: 20, y: 20, w: 1, h: 1 }])
    expect(b.minX).toBeLessThanOrEqual(t.minX)
    expect(b.maxX).toBeGreaterThanOrEqual(t.maxX)
    expect(b.minY).toBeLessThanOrEqual(t.minY)
    expect(b.maxY).toBeGreaterThanOrEqual(t.maxY)
  })

  it('keeps a margin past the outermost roof, so the edge of town is not the edge of the view', () => {
    // a 4x2 roof reaches 192 px above its own ground, so its drawn minY is negative here and
    // the town wins the min side too; a 1x1 terrain cannot outvote it on any axis
    const one = [{ x: 300, y: 300, w: 4, h: 2 }]
    const b = reachableBoundsOf(terrainOf(1, 1), one)
    const drawn = drawnBoundsOf(one)
    expect(b.maxX - drawn.maxX).toBe(REACH_MARGIN_PX)
    expect(b.maxY - drawn.maxY).toBe(REACH_MARGIN_PX)
  })

  it('assumes no map size: three ring counts, three boxes, each holding its own town', () => {
    let last = 0
    for (const rings of [1, 2, 3]) {
      const town = bigTown(rings)
      const b = reachableBoundsOf(terrainOf(1, 1), town)
      const drawn = drawnBoundsOf(town)
      expect(b.minX).toBeLessThanOrEqual(drawn.minX)
      expect(b.maxX).toBeGreaterThanOrEqual(drawn.maxX)
      expect(b.maxX - b.minX).toBeGreaterThan(last)
      last = b.maxX - b.minX
    }
  })
})

describe('the clamp, against the reachable box', () => {
  // Reachable means one thing only: after the clamp has had its say, the building's painted
  // rectangle is on the screen. Both boxes are asked to centre on it; only one can.
  const seesIt = (pos: { x: number; y: number }, box: ReturnType<typeof drawnBoundsOf>): boolean =>
    box.maxX * 1 + pos.x > 0 && box.minX * 1 + pos.x < STAGE.w
    && box.maxY * 1 + pos.y > 0 && box.minY * 1 + pos.y < STAGE.h

  it('★ lets the camera reach a building the tile array does not contain', () => {
    const terrain = terrainOf(48, 48)
    const town = [...bigTown(1), { x: 300, y: 40, w: 4, h: 2 }]
    const far = [town[town.length - 1]!]
    const target = drawnBoundsOf(far)
    const want = {
      x: STAGE.w / 2 - (target.minX + target.maxX) / 2,
      y: STAGE.h / 2 - (target.minY + target.maxY) / 2,
    }
    const onArray = clampCamera(want, 1, cameraBoundsOf(terrain), STAGE)
    const onReach = clampCamera(want, 1, reachableBoundsOf(terrain, town), STAGE)
    expect(seesIt(onArray, target), 'the landed clamp could already reach it').toBe(false)
    expect(seesIt(onReach, target), 'the reachable clamp cannot reach it').toBe(true)
  })

  it('still refuses to leave the world entirely', () => {
    const terrain = terrainOf(48, 48)
    const b = reachableBoundsOf(terrain, [{ x: 20, y: 20, w: 2, h: 2 }])
    const far = clampCamera({ x: 99999, y: 99999 }, 2, b, STAGE)
    expect(far.x).toBeLessThanOrEqual(-b.minX * 2 + 1)
    expect(far.y).toBeLessThanOrEqual(-b.minY * 2 + 1)
  })
})

describe('nothing in the renderer assumes a fixed map size', () => {
  it('the same terrain at four sizes yields four boxes, each the size of its own array', () => {
    for (const n of [8, 48, 128, 512]) {
      const b = cameraBoundsOf(terrainOf(n, n))
      expect(b.maxX - b.minX).toBe(2 * n * (TILE_W / 2))
      expect(b.maxY - b.minY).toBe(2 * n * (TILE_H / 2))
    }
  })
})

// ── ★ GOING SOMEWHERE, ON A TOWN THAT DOES NOT FIT ────────────────────────────────────────

const centreOn = (
  sx: number, sy: number, scale: number, bounds: ReturnType<typeof reachableBoundsOf>,
): { x: number; y: number } =>
  clampCamera(
    { x: STAGE.w / 2 - sx * scale, y: STAGE.h / 2 - sy * scale }, scale, bounds, STAGE,
  )

/** Is this world point inside the stage at this camera position? */
const onScreen = (sx: number, sy: number, scale: number, pos: { x: number; y: number }): boolean => {
  const x = sx * scale + pos.x, y = sy * scale + pos.y
  return x >= 0 && x <= STAGE.w && y >= 0 && y <= STAGE.h
}

describe('every place in the town can be got to', () => {
  const terrain = terrainOf(48, 48)
  const town = bigTown(3)
  const bounds = reachableBoundsOf(terrain, town)

  for (const scale of [0.25, 1, 4] as const) {
    it(`${scale}x: all ${town.length} buildings land on the stage when the camera is sent to them`, () => {
      const unreachable: string[] = []
      for (const b of town) {
        const c = drawnBoundsOf([b])
        const sx = (c.minX + c.maxX) / 2, sy = (c.minY + c.maxY) / 2
        if (!onScreen(sx, sy, scale, centreOn(sx, sy, scale, bounds))) unreachable.push(b.id)
      }
      expect(unreachable.slice(0, 5), `${unreachable.length} of ${town.length} out of reach`).toEqual([])
    })
  }

  it('★ and so does a body that has walked past the end of the tile array', () => {
    const { sx, sy } = { sx: (400 - 12) * 16, sy: (400 + 12) * 8 }   // tileToScreen(400, 12)
    const withBody = reachableBoundsOf(terrain, [...town, { x: 400, y: 12, w: 1, h: 1 }])
    expect(onScreen(sx, sy, 1, centreOn(sx, sy, 1, withBody))).toBe(true)
  })

  it('the landed clamp could not do it — this is the difference, not a restatement', () => {
    const far = { x: 400, y: 12, w: 1, h: 1 }
    const { sx, sy } = { sx: (400 - 12) * 16, sy: (400 + 12) * 8 }
    expect(onScreen(sx, sy, 1, centreOn(sx, sy, 1, cameraBoundsOf(terrain)))).toBe(false)
    expect(onScreen(sx, sy, 1, centreOn(sx, sy, 1, reachableBoundsOf(terrain, [far])))).toBe(true)
  })
})
