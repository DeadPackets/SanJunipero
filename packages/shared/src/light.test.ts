import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig } from './config.js'
import { MINUTES_PER_DAY } from './time.js'
import { glowRadiusFor, LIGHT_GLOW_RADIUS, lightLevelAt, type LitWorld } from './light.js'

const CFG: SimConfig = SimConfigSchema.parse({})
const DARK: SimConfig = SimConfigSchema.parse({ nightWitness: { enabled: false } })

const NOON = 12 * 60
const DUSK = 19 * 60 + 30
const MIDNIGHT = 0

const world = (over: Partial<LitWorld> = {}): LitWorld =>
  ({ agents: {}, items: {}, structures: {}, ...over })

const torchAt = (x: number, y: number, litUntilTick: number): LitWorld => world({
  items: { item_1: { kind: 'torch', litUntilTick, loc: { t: 'tile', x, y } } },
})

const pit = (x: number, y: number, w: number, h: number, fueledUntilTick?: number): LitWorld => world({
  structures: {
    structure_1: {
      kind: 'fire_pit', x, y, w, h, stage: 'complete',
      ...(fueledUntilTick === undefined ? {} : { fueledUntilTick }),
    },
  },
})

describe('the glow table is the config, read in one place', () => {
  it('names a radius for each source the world knows, and nothing else', () => {
    expect(LIGHT_GLOW_RADIUS).toEqual({ torch: 3, lantern: 5, hearth: 3, fire_pit: 4 })
    for (const [kind, radius] of Object.entries(LIGHT_GLOW_RADIUS)) {
      expect([kind, glowRadiusFor(CFG, kind)]).toEqual([kind, radius])
    }
    expect(glowRadiusFor(CFG, 'wood')).toBeUndefined()
  })
})

describe('lightLevelAt: the day is free, the night is not', () => {
  it('is full daylight everywhere at noon, lit or unlit', () => {
    expect(lightLevelAt(world(), 0, 0, NOON, CFG)).toBe(1)
    expect(lightLevelAt(world(), 40, 40, NOON, CFG)).toBe(1)
  })

  it('falls to the phase factor on unlit ground at dusk and at midnight', () => {
    expect(lightLevelAt(world(), 0, 0, DUSK, CFG)).toBe(CFG.nightWitness.duskFactor)
    expect(lightLevelAt(world(), 0, 0, MIDNIGHT, CFG)).toBe(CFG.nightWitness.nightFactor)
  })

  it('a lit torch makes its own daylight out to its radius, and not one tile further', () => {
    const lit = torchAt(10, 10, MIDNIGHT + 100)
    expect(lightLevelAt(lit, 13, 10, MIDNIGHT, CFG)).toBe(1)
    expect(lightLevelAt(lit, 13, 13, MIDNIGHT, CFG)).toBe(1)
    expect(lightLevelAt(lit, 14, 10, MIDNIGHT, CFG)).toBe(CFG.nightWitness.nightFactor)
  })

  it('a torch whose fuel ran out is a stick', () => {
    expect(lightLevelAt(torchAt(10, 10, MIDNIGHT - 1), 10, 10, MIDNIGHT, CFG)).toBe(CFG.nightWitness.nightFactor)
    expect(lightLevelAt(world({ items: { item_1: { kind: 'torch', loc: { t: 'tile', x: 10, y: 10 } } } }), 10, 10, MIDNIGHT, CFG))
      .toBe(CFG.nightWitness.nightFactor)
  })

  it('a carried torch lights the tile the carrier stands on', () => {
    const carried = world({
      agents: { a1: { x: 20, y: 20 } },
      items: { item_1: { kind: 'torch', litUntilTick: MIDNIGHT + 10, loc: { t: 'agent', id: 'a1' } } },
    })
    expect(lightLevelAt(carried, 20, 20, MIDNIGHT, CFG)).toBe(1)
    expect(lightLevelAt(carried, 24, 20, MIDNIGHT, CFG)).toBe(CFG.nightWitness.nightFactor)
  })

  it('a fire_pit measures from the footprint edge, never from the anchor', () => {
    // A 3x1 pit anchored at (10,10): its far end is (12,10), and the glow reaches 4 past that.
    const long = pit(10, 10, 3, 1, MIDNIGHT + 10)
    expect(lightLevelAt(long, 16, 10, MIDNIGHT, CFG)).toBe(1)
    expect(lightLevelAt(long, 17, 10, MIDNIGHT, CFG)).toBe(CFG.nightWitness.nightFactor)
    // The same reach from the anchor alone would have stopped at 14.
    expect(glowRadiusFor(CFG, 'fire_pit')).toBe(4)
  })

  it('an unfed pit and one still under construction throw no light at all', () => {
    expect(lightLevelAt(pit(10, 10, 1, 1), 10, 10, MIDNIGHT, CFG)).toBe(CFG.nightWitness.nightFactor)
    const raising = world({
      structures: { structure_1: { kind: 'fire_pit', x: 10, y: 10, w: 1, h: 1, stage: 'construction', fueledUntilTick: 9e9 } },
    })
    expect(lightLevelAt(raising, 10, 10, MIDNIGHT, CFG)).toBe(CFG.nightWitness.nightFactor)
  })

  it('with the night-witness law off the world is bright at midnight', () => {
    expect(lightLevelAt(world(), 0, 0, MIDNIGHT, DARK)).toBe(1)
    expect(lightLevelAt(world(), 0, 0, 3 * MINUTES_PER_DAY + MIDNIGHT, DARK)).toBe(1)
  })
})
