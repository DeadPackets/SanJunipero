import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, MINUTES_PER_DAY } from '@sj/shared'

// THREE FACTS ABOUT THE TUNING, PINNED SO THEY CANNOT DRIFT QUIETLY.
//
// All three are reachable only through `packages/shared/src/config.ts`, which is frozen: the
// forge pin `stateHash(DEFAULT_CONFIG)` moves the moment any of them is touched. Under the
// batch-11 absolute they are REPORTED with exact numbers and NOT fixed. These rows exist so
// the numbers in cleanup/c11-batch11-report.md stay true, and so a later authorized regen has
// something to measure itself against. Nothing here asks for a change.

const C = DEFAULT_CONFIG
const perDay = (perTick: number): number => perTick * MINUTES_PER_DAY

describe('C11 finding 1 — the energy budget spends more than a day holds', () => {
  it('a body awake all day spends 134 of the 100 it has', () => {
    expect(C.needs.energyDecayAwakePerTick).toBe(0.093)
    expect(perDay(C.needs.energyDecayAwakePerTick)).toBeCloseTo(133.92, 2)
    // Which is 17.9 waking hours from full. There is no schedule with more in it than that.
    expect(100 / (C.needs.energyDecayAwakePerTick * 60)).toBeCloseTo(17.92, 2)
  })

  it('the eight-hour night is not a preference, it is the only schedule that closes', () => {
    const spent = C.needs.energyDecayAwakePerTick * 16 * 60
    const restored = C.needs.energyRegenAsleepPerTick * 8 * 60
    expect(spent).toBeCloseTo(89.28, 2)
    expect(restored).toBe(120)
    // It closes with 30 to spare — and only because the night is a full eight hours long.
    expect(restored - spent).toBeGreaterThan(0)
    // Seven hours does not: 6.7 of sleep buys the 89 back, and every hour awake past sixteen
    // costs 5.6 more. An elder pays 1.2x and runs out after 14.9 hours.
    expect(100 / (C.needs.energyRegenAsleepPerTick * 60)).toBeCloseTo(6.67, 2)
    expect(100 / (C.needs.energyDecayAwakePerTick * C.aging.elderEnergyDecayMultiplier * 60))
      .toBeCloseTo(14.93, 2)
  })

  it('nothing code-side can close it: every term is a frozen dial', () => {
    // The four numbers the shortfall is made of, and all four live in the frozen schema.
    for (const n of [
      C.needs.energyDecayAwakePerTick, C.needs.energyRegenAsleepPerTick,
      C.aging.elderEnergyDecayMultiplier, C.needs.collapseThreshold,
    ]) expect(typeof n).toBe('number')
    expect(C.needs.collapseThreshold).toBe(5)
    expect(C.needs.debuffThreshold).toBe(30)
  })
})

describe('C11 finding 2 — the garment flips no winter threshold', () => {
  // `isExposed` is a threshold on `ambient + insulation >= comfortBand`, and the only band a
  // coat decides is an autumn dusk. The winter rungs close because four walls are an absolute
  // shield, not because of the coat — so the whole clothing line is decorative in the season
  // it exists for. Escalated by batch 10; the numbers are here.
  const flips = (ambient: number): boolean =>
    (ambient >= C.warmth.comfortBand) !== (ambient + C.warmth.insulation.garment >= C.warmth.comfortBand)

  it('one band in twelve, and it is not in winter', () => {
    expect(C.warmth.comfortBand).toBe(8)
    expect(C.warmth.insulation.garment).toBe(2)
    const deciding: string[] = []
    for (const [season, phases] of Object.entries(C.warmth.ambient)) {
      for (const [phase, ambient] of Object.entries(phases as Record<string, number>)) {
        if (flips(ambient)) deciding.push(`${season} ${phase}`)
      }
    }
    expect(deciding).toEqual(['autumn dusk'])
  })

  it('at every winter hour a coated body is exactly as exposed as a bare one', () => {
    for (const ambient of Object.values(C.warmth.ambient.winter)) {
      expect(ambient + C.warmth.insulation.garment).toBeLessThan(C.warmth.comfortBand)
    }
    // The gap the coat would have to close at the mildest winter hour is twelve; it closes two.
    expect(C.warmth.comfortBand - C.warmth.ambient.winter.day).toBe(12)
  })
})

describe('C11 finding 3 — an untended wound is a clock', () => {
  // A consequence of the `slain` fix, which mints an `injury` affliction at the wound's tier.
  // Correct by the affliction model; never reviewed as tuning. This is the survival curve.
  const hpAfterBlow = (kind: 'minor' | 'serious' | 'grave'): number => C.health.maxHp - C.health.injuryDamage[kind]
  const drainPerDay = (severity: number): number => perDay(C.mortality.drainPerTick.injury * severity)
  // The best case a body can give itself: fed, and asleep when the dawn payment lands.
  const selfHealPerDay = C.health.recoveryHpPerDay * C.mortality.sleepRegenMultiplier
  const daysToDeath = (kind: 'minor' | 'serious' | 'grave', severity: number): number =>
    hpAfterBlow(kind) / (drainPerDay(severity) - selfHealPerDay)

  it('a scuffle nobody treats kills inside two sim-days, and a bad one inside four hours', () => {
    expect(selfHealPerDay).toBe(15)
    expect(drainPerDay(1)).toBeCloseTo(72, 6)
    expect(daysToDeath('minor', 1)).toBeCloseTo(1.58, 2)
    expect(daysToDeath('serious', 2)).toBeCloseTo(0.54, 2)
    expect(daysToDeath('grave', 3)).toBeCloseTo(0.2, 2)
  })

  it('a hungry body does not mend at all, and then a bruise is a day and a quarter', () => {
    // `recoveryDelta` pays nothing to a body under the fed threshold unless somebody tends it.
    expect(C.mortality.fedThreshold).toBe(40)
    expect(hpAfterBlow('minor') / drainPerDay(1)).toBeCloseTo(1.25, 2)
  })

  it('the only thing that stops the clock is a herb in somebody else’s hand', () => {
    // Tending with a leaf lifts two rungs, which clears a minor or a serious outright.
    expect(C.mortality.herbRelief * 2).toBe(2)
    // Tending without one buys hp and nothing else: the drain outruns it for every tier.
    const tendedPerDay = C.health.tendedRecoveryHpPerDay * C.mortality.tendMultiplier
    expect(tendedPerDay).toBe(30)
    expect(drainPerDay(1)).toBeGreaterThan(tendedPerDay)
    // Asleep at dawn and tended, a minor wound is survivable and nothing worse is.
    const tendedAsleep = tendedPerDay * C.mortality.sleepRegenMultiplier
    expect(tendedAsleep).toBeGreaterThan(drainPerDay(1))
    expect(tendedAsleep).toBeLessThan(drainPerDay(2))
  })
})
