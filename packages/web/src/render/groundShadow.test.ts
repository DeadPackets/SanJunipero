import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import { footprintDiamond } from './builtForm.js'
import { shadowCast } from '../ui/skyModel.js'
import { AO_ALPHA, AO_SPREAD, CAST_ALPHA, contactAo, sunCast } from './groundShadow.js'
import { TILE_W } from './iso.js'

const xsOf = (poly: readonly number[]): number[] => poly.filter((_, i) => i % 2 === 0)
const spanX = (poly: readonly number[]): number => Math.max(...xsOf(poly)) - Math.min(...xsOf(poly))
const midX = (poly: readonly number[]): number =>
  (Math.max(...xsOf(poly)) + Math.min(...xsOf(poly))) / 2

/** Every ten minutes of one day — dawn, noon, both golden bands and the whole night. */
const DAY = Array.from({ length: MINUTES_PER_DAY / 10 }, (_, i) => i * 10)

describe('the baked ring — occlusion, which no hour changes', () => {
  it('is the same shape at every minute of the day', () => {
    const stands = footprintDiamond(2, 2)
    const noon = contactAo(stands)
    for (const t of DAY) {
      // the argument does not exist to take: a tick cannot reach this shape
      expect(contactAo(stands), `tick ${String(t)}`).toEqual(noon)
    }
  })

  it('reaches past the shape it edges, so a form meets the ground instead of sitting on it', () => {
    for (const [w, h] of [
      [1, 1],
      [2, 2],
      [4, 2],
    ] as const) {
      const stands = footprintDiamond(w, h)
      const ao = contactAo(stands)
      expect(spanX(ao.poly), `${String(w)}x${String(h)}`).toBeCloseTo(
        spanX(stands) * (1 + AO_SPREAD),
      )
      expect(midX(ao.poly)).toBeCloseTo(midX(stands))
      expect(ao.alpha).toBe(AO_ALPHA)
    }
  })
})

describe('the cast — the mark the sun lays out of a standing thing', () => {
  const stands = footprintDiamond(2, 2)
  const HOUSE_PX = 28.8

  it('lies under the caster at noon and through the night, so nothing casts in the dark', () => {
    for (const minute of [12 * 60, 0, 3 * 60, 23 * 60]) {
      const cast = sunCast(stands, HOUSE_PX, shadowCast(minute))
      expect(cast.poly, `minute ${String(minute)}`).toEqual(stands)
      expect(cast.alpha, 'and it is worth no ink at all').toBe(0)
    }
  })

  it('★ lays away from the sun, the two ends of the day opposite ways, and moves all day', () => {
    const dawn = sunCast(stands, HOUSE_PX, shadowCast(6 * 60))
    const dusk = sunCast(stands, HOUSE_PX, shadowCast(20 * 60 + 30))
    const dawnDx = midX(dawn.poly) - midX(stands)
    const duskDx = midX(dusk.poly) - midX(stands)
    expect(dawnDx * duskDx, 'the sun rises one side and sets the other').toBeLessThan(0)
    expect(spanX(dawn.poly)).toBeGreaterThan(spanX(stands))
    const seen = new Set(DAY.map((t) => midX(sunCast(stands, HOUSE_PX, shadowCast(t)).poly)))
    expect(seen.size, 'a shadow that never moves is a sticker').toBeGreaterThan(10)
  })

  it('reaches further the taller the thing is, by its own height in tiles', () => {
    const sun = shadowCast(20 * 60 + 30)
    const tip = (heightPx: number): number => Math.min(...xsOf(sunCast(stands, heightPx, sun).poly))
    expect(tip(TILE_W) - tip(TILE_W * 3)).toBeCloseTo(2 * Math.abs(sun.dx), 9)
    expect(tip(TILE_W)).toBeLessThan(Math.min(...xsOf(stands)))
  })

  it('★ never reaches over the LIT side of the thing that casts it, at any minute', () => {
    let lit = 0
    let worst = { over: -Infinity, minute: -1 }
    for (const t of DAY) {
      const sun = shadowCast(t)
      if (sun.dx === 0) continue
      lit++
      const cast = sunCast(stands, HOUSE_PX, sun)
      const over =
        sun.dx < 0
          ? Math.max(...xsOf(cast.poly)) - Math.max(...xsOf(stands))
          : Math.min(...xsOf(stands)) - Math.min(...xsOf(cast.poly))
      if (over > worst.over) worst = { over, minute: t }
    }
    expect(lit, 'not vacuous: the sun really was low for part of the day').toBeGreaterThan(20)
    expect(
      worst.over,
      `minute ${String(worst.minute)} lays px of shadow on ground the sun still reaches`,
    ).toBeLessThan(1e-9)
  })

  // ★ The ink used to be CAST_ALPHA x sun.alpha, which is HIGHEST as the cast collapses back
  // to the footprint, so the mark was deleted at 0.25 ink and every arted building stepped on
  // its own lawn twice a sim-day.
  it('★ the ink goes with the stretch, so no cast is ever deleted at full ink', () => {
    const alphaAt = (m: number): number => sunCast(stands, HOUSE_PX, shadowCast(m)).alpha
    const longest = alphaAt(20 * 60 + 30)
    expect(longest).toBeLessThan(CAST_ALPHA)
    expect(longest, 'and still darker than the ring it lies on').toBeGreaterThan(AO_ALPHA)
    expect(alphaAt(20 * 60 + 30)).toBeGreaterThan(alphaAt(21 * 60 - 5))
    let edges = 0
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      if (shadowCast(m).dx === 0 || shadowCast(m + 1).dx !== 0) continue
      edges++
      expect(alphaAt(m), `the last casting minute ${String(m)}`).toBeLessThan(0.01)
    }
    expect(edges, 'the day really does put the cast out twice').toBe(2)
  })
})
