import { describe, it, expect } from 'vitest'
import { SimConfigSchema, type SimConfig } from './config.js'
import { MINUTES_PER_DAY } from './time.js'
import {
  glowRadiusFor, isDark, LIGHT_GLOW_RADIUS, lightBandAt, lightLevelAt, visionRadiusAt, type LitWorld,
} from './light.js'

const CFG: SimConfig = SimConfigSchema.parse({})
const DARK: SimConfig = SimConfigSchema.parse({ nightWitness: { enabled: false } })
const NO_LIGHT_LAW: SimConfig = SimConfigSchema.parse({ light: { enabled: false } })

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
    expect(LIGHT_GLOW_RADIUS).toEqual({ torch: 3, lantern: 5, hearth: 3, fire_pit: 4, lamp_post: 4 })
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

describe('visionRadiusAt: the light that matters is the light on the thing seen', () => {
  const eye = { x: 0, y: 0 }
  const SIGHT = CFG.movement.sightRadius

  it('is full sight by day and scales by the darkness factor at night', () => {
    expect(visionRadiusAt(world(), eye, 30, 30, NOON, CFG)).toBe(SIGHT)
    expect(visionRadiusAt(world(), eye, 30, 30, MIDNIGHT, CFG)).toBe(Math.round(SIGHT * CFG.nightWitness.nightFactor))
    expect(visionRadiusAt(world(), eye, 30, 30, DUSK, CFG)).toBe(Math.round(SIGHT * CFG.nightWitness.duskFactor))
  })

  it('a torch at the target restores full sight; the same torch at the eye does not', () => {
    const atTarget = torchAt(30, 30, MIDNIGHT + 10)
    expect(visionRadiusAt(atTarget, eye, 30, 30, MIDNIGHT, CFG)).toBe(SIGHT)
    const atEye = torchAt(0, 0, MIDNIGHT + 10)
    expect(visionRadiusAt(atEye, eye, 30, 30, MIDNIGHT, CFG))
      .toBe(Math.round(SIGHT * CFG.nightWitness.nightFactor))
  })

  it('with the law off the night sees as far as the day', () => {
    expect(visionRadiusAt(world(), eye, 30, 30, MIDNIGHT, DARK)).toBe(SIGHT)
  })
})

describe('lightBandAt: three words, never a number', () => {
  it('names the day bright, the dusk dim and the deep night dark', () => {
    expect(lightBandAt(world(), 0, 0, NOON, CFG)).toBe('bright')
    expect(lightBandAt(world(), 0, 0, DUSK, CFG)).toBe('dim')
    expect(lightBandAt(world(), 0, 0, MIDNIGHT, CFG)).toBe('dark')
    expect(lightBandAt(torchAt(0, 0, MIDNIGHT + 1), 0, 0, MIDNIGHT, CFG)).toBe('bright')
    for (const tick of [NOON, DUSK, MIDNIGHT]) {
      expect(['bright', 'dim', 'dark']).toContain(lightBandAt(world(), 0, 0, tick, CFG))
    }
  })

  // ★ TWO LAWS, TWO QUESTIONS. The band used to be read off `lightLevelAt`, which answers the
  // witness dial — so a world with `nightWitness` off read "bright" at midnight while the same
  // midnight still charged 1.5x for the work. The dark belongs to the light law.
  it('is still dark at midnight with the WITNESS law off, and bright with the LIGHT law off', () => {
    expect(lightBandAt(world(), 0, 0, MIDNIGHT, DARK)).toBe('dark')
    expect(lightBandAt(world(), 0, 0, DUSK, DARK)).toBe('dim')
    expect(lightBandAt(world(), 0, 0, MIDNIGHT, NO_LIGHT_LAW)).toBe('bright')
  })

  // The walk of the world behind this is kept against the world's identity, so one object asked
  // twice must still answer the tick and the config in hand.
  it('answers the tick and the config it was handed, not the pair it answered last', () => {
    const w = torchAt(10, 10, MIDNIGHT + 1)
    expect(lightBandAt(w, 12, 10, MIDNIGHT, CFG)).toBe('bright')
    expect(lightBandAt(w, 12, 10, MIDNIGHT + 2, CFG)).toBe('dark')
    const stub = SimConfigSchema.parse({ light: { glowRadius: { torch: 1 } } })
    expect(lightBandAt(w, 12, 10, MIDNIGHT, stub)).toBe('dark')
    expect(lightBandAt(w, 10, 10, MIDNIGHT, stub)).toBe('bright')
  })

  it('does not turn dusk into deep night when the two factors are set equal', () => {
    const flat = SimConfigSchema.parse({ nightWitness: { duskFactor: 0.35, nightFactor: 0.35 } })
    expect(lightBandAt(world(), 0, 0, DUSK, flat)).toBe('dim')
    expect(lightBandAt(world(), 0, 0, MIDNIGHT, flat)).toBe('dark')
  })
})

describe('isDark: the one answer to "is it dark here"', () => {
  // ★ NOT VACUOUS. Every assertion below is paired: one place that IS dark and one that is NOT,
  // in the SAME world at the SAME tick. A build that lit the whole map, or one that darkened it,
  // fails this — a single-sided assertion would pass either.
  it('tells a lamp-lit tile from the street beside it, at one instant in one world', () => {
    const lit = torchAt(10, 10, MIDNIGHT + 100)
    expect(isDark(lit, 13, 10, MIDNIGHT, CFG)).toBe(false)  // inside the glow
    expect(isDark(lit, 14, 10, MIDNIGHT, CFG)).toBe(true)   // one tile past it
  })

  it('is false all day and true all night on the same unlit tile', () => {
    expect(isDark(world(), 0, 0, NOON, CFG)).toBe(false)
    expect(isDark(world(), 0, 0, MIDNIGHT, CFG)).toBe(true)
  })

  it('calls dusk not-dark, because the dark is what the work penalty charges for', () => {
    expect(isDark(world(), 0, 0, DUSK, CFG)).toBe(false)
    expect(lightBandAt(world(), 0, 0, DUSK, CFG)).toBe('dim')
  })

  it('is exactly the band saying "dark" — one derivation, not a second threshold', () => {
    const lit = torchAt(10, 10, MIDNIGHT + 100)
    for (const tick of [NOON, DUSK, MIDNIGHT]) {
      for (const [x, y] of [[10, 10], [13, 10], [14, 10], [40, 40]] as const) {
        expect([tick, x, y, isDark(lit, x, y, tick, CFG)])
          .toEqual([tick, x, y, lightBandAt(lit, x, y, tick, CFG) === 'dark'])
      }
    }
  })
})
