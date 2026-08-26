import { describe, expect, it } from 'vitest'
import { CITY_HEARTH_KIND, cityStructures } from '@sj/shared'
import {
  GLOW_BASE_ALPHA,
  GLOW_SWING,
  HEARTH_KINDS,
  SMOKE_COLOR,
  SMOKE_MAX_ALPHA,
} from './ambient.js'

describe('HEARTH_KINDS', () => {
  it('is read off the C13 template, not hand-listed', () => {
    const furnished = cityStructures()
      .filter((c) => c.furnishings.some((f) => f.kind === CITY_HEARTH_KIND))
      .map((c) => c.kind)
    expect(furnished.length).toBeGreaterThan(0)
    for (const kind of furnished) expect(HEARTH_KINDS).toContain(kind)
  })

  it('smokes and glows from a house and an open fire, and from nothing else', () => {
    expect(HEARTH_KINDS).toContain('house')
    expect(HEARTH_KINDS).toContain('fire_pit')
    // the kinds the controller actually saw pale squares on
    for (const kind of ['wagon', 'shed', 'storehouse', 'well', 'standing_stone', 'scaffolding']) {
      expect(HEARTH_KINDS.has(kind), `${kind} has no chimney`).toBe(false)
    }
  })
})

describe('the ambient effects stay quiet', () => {
  it('smoke is warm grey, never cream — cream read as white glass', () => {
    expect(SMOKE_COLOR).toBe(0xcfc6bc)
    expect(SMOKE_MAX_ALPHA).toBeLessThan(0.5)
  })

  it('the additive night glow cannot reach full brightness', () => {
    expect(GLOW_BASE_ALPHA + GLOW_SWING).toBeLessThanOrEqual(0.5)
  })
})
