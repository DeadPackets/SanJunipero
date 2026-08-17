import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, SimConfigSchema } from './config.js'
import { fertilityAt, WATER_TILES } from './fertility.js'

// Row 0 is water, everything below it is grass: the distance to the bank is the row index.
const BANK = [
  [2, 2, 2],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
]

const MEADOW = Array.from({ length: 6 }, () => [0, 0, 0])

describe('fertilityAt', () => {
  it('decays with distance from the bank and is exactly 1 beyond the radius', () => {
    // 1 + waterBonus x (1 - d/(radius+1)): 1.375 one tile from the water, 1 at radius + 1.
    expect(fertilityAt(BANK, 1, 1, DEFAULT_CONFIG)).toBe(1.375)
    expect(fertilityAt(BANK, 1, 2, DEFAULT_CONFIG)).toBe(1.25)
    expect(fertilityAt(BANK, 1, 3, DEFAULT_CONFIG)).toBe(1.125)
    expect(fertilityAt(BANK, 1, 4, DEFAULT_CONFIG)).toBe(1)
    expect(fertilityAt(BANK, 1, 5, DEFAULT_CONFIG)).toBe(1)
  })

  it('never exceeds maxMultiplier however generous the bonus', () => {
    const rich = SimConfigSchema.parse({ fertility: { waterBonus: 3 } })
    expect(fertilityAt(BANK, 1, 1, rich)).toBe(rich.fertility.maxMultiplier)
  })

  it('is 1 everywhere in a meadow, and 1 everywhere when the law is off', () => {
    expect(fertilityAt(MEADOW, 1, 1, DEFAULT_CONFIG)).toBe(1)
    const off = SimConfigSchema.parse({ fertility: { enabled: false } })
    expect(fertilityAt(BANK, 1, 1, off)).toBe(1)
  })

  it('counts a dug channel as water', () => {
    const channel = MEADOW.map((row, y) => (y === 0 ? [10, 10, 10] : [...row]))
    expect(fertilityAt(channel, 1, 1, DEFAULT_CONFIG)).toBe(1.375)
    expect(WATER_TILES.has(10)).toBe(true)
    expect(WATER_TILES.has(2)).toBe(true)
  })
})
