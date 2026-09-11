import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import { footprintDiamond } from './builtForm.js'
import { AO_ALPHA, AO_SPREAD, contactAo } from './groundShadow.js'

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
