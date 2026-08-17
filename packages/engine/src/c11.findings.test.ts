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

describe('C11 finding 2 — the garment decides a winter hour, and only the mildest one', () => {
  // `isExposed` is a threshold on `ambient + insulation >= comfortBand`. At 2 the only band a
  // coat decided was an autumn dusk: the winter rungs closed because four walls are an
  // absolute shield, not because of the coat, so the whole clothing line was decorative in the
  // season it exists for. T37b step 2b closes exactly the gap the finding named and no more.
  const flips = (ambient: number): boolean =>
    (ambient >= C.warmth.comfortBand) !== (ambient + C.warmth.insulation.garment >= C.warmth.comfortBand)

  it('the coat is worth the gap the finding measured: twelve, not two', () => {
    expect(C.warmth.comfortBand).toBe(8)
    // The gap at the mildest winter hour was twelve and the coat closed two. It closes twelve.
    expect(C.warmth.comfortBand - C.warmth.ambient.winter.day).toBe(12)
    expect(C.warmth.insulation.garment).toBe(12)
  })

  it('four bands in twelve now, and one of them is in winter', () => {
    const deciding: string[] = []
    for (const [season, phases] of Object.entries(C.warmth.ambient)) {
      for (const [phase, ambient] of Object.entries(phases as Record<string, number>)) {
        if (flips(ambient)) deciding.push(`${season} ${phase}`)
      }
    }
    expect(deciding).toEqual(['spring night', 'autumn dusk', 'autumn night', 'winter day'])
  })

  it('and no further: dusk, night and any weather in winter still want a roof or a fire', () => {
    for (const phase of ['dusk', 'night'] as const) {
      expect(C.warmth.ambient.winter[phase] + C.warmth.insulation.garment).toBeLessThan(C.warmth.comfortBand)
    }
    // Twelve is the LEAST that reaches winter at all, and it reaches no hour past the mildest:
    // eleven decides nothing there, and thirteen decides nothing more.
    expect(C.warmth.ambient.winter.day + 11).toBeLessThan(C.warmth.comfortBand)
    expect(C.warmth.ambient.winter.dusk + 13).toBeLessThan(C.warmth.comfortBand)
    // A coat holds a clear winter day. It does not hold a winter day it is snowing on.
    const snowing = C.warmth.ambient.winter.day + C.warmth.weatherDelta.snow
    expect(snowing + C.warmth.insulation.garment).toBeLessThan(C.warmth.comfortBand)
  })
})

describe('C11 finding 3 — an untended wound is a clock, and the clock now waits to be noticed', () => {
  // A consequence of the `slain` fix, which mints an `injury` affliction at the wound's tier.
  // Correct by the affliction model and never reviewed as tuning until T37b step 2c. A wound
  // has to outlast the walk of whoever might tend it, or the designed social overlap — one
  // body sees another is hurt and crosses the town — cannot physically happen.
  const hpAfterBlow = (kind: 'minor' | 'serious' | 'grave'): number => C.health.maxHp - C.health.injuryDamage[kind]
  const drainPerDay = (severity: number): number => perDay(C.mortality.drainPerTick.injury * severity)
  // The best case a body can give itself: fed, and asleep when the dawn payment lands.
  const selfHealPerDay = C.health.recoveryHpPerDay * C.mortality.sleepRegenMultiplier
  const daysToDeath = (kind: 'minor' | 'serious' | 'grave', severity: number): number =>
    hpAfterBlow(kind) / (drainPerDay(severity) - selfHealPerDay)

  it('every tier now outlasts the walk of whoever might notice it', () => {
    expect(C.mortality.drainPerTick.injury).toBe(0.025)
    expect(selfHealPerDay).toBe(15)
    expect(drainPerDay(1)).toBeCloseTo(36, 6)
    // Was 1.58 / 0.54 / 0.20 — a bad wound killed inside five hours, which is less than the
    // time it takes to be seen from across a meadow and walked to.
    expect(daysToDeath('minor', 1)).toBeCloseTo(4.29, 2)
    expect(daysToDeath('serious', 2)).toBeCloseTo(1.23, 2)
    expect(daysToDeath('grave', 3)).toBeCloseTo(0.43, 2)
    // The worst of them is still urgent — ten waking hours — and no longer hopeless.
    expect(daysToDeath('grave', 3) * 24).toBeGreaterThan(10)
  })

  it('a hungry body still does not mend, and even then a bruise is two and a half days', () => {
    // `recoveryDelta` pays nothing to a body under the fed threshold unless somebody tends it.
    // The threshold is left where it is: hunger should cost a wounded body its own recovery,
    // and at this drain it still leaves a window somebody else can reach.
    expect(C.mortality.fedThreshold).toBe(40)
    expect(hpAfterBlow('minor') / drainPerDay(1)).toBeCloseTo(2.5, 2)
    expect(hpAfterBlow('grave') / drainPerDay(3) * 24).toBeGreaterThan(8)
  })

  it('a herb in somebody else’s hand is still the only answer to the worst of them', () => {
    // Tending with a leaf lifts two rungs, which clears a minor or a serious outright.
    expect(C.mortality.herbRelief * 2).toBe(2)
    // Tending without one still buys hp and nothing else while the body is awake.
    const tendedPerDay = C.health.tendedRecoveryHpPerDay * C.mortality.tendMultiplier
    expect(tendedPerDay).toBe(30)
    expect(drainPerDay(1)).toBeGreaterThan(tendedPerDay)
    // Tended and asleep, a minor and a serious wound are both survivable — which is the point
    // of the change: care is worth giving. A GRAVE one is not, and the leaf is still what
    // decides it. Medicine stays load-bearing at exactly the tier that should need it.
    const tendedAsleep = tendedPerDay * C.mortality.sleepRegenMultiplier
    expect(tendedAsleep).toBeGreaterThan(drainPerDay(2))
    expect(tendedAsleep).toBeLessThan(drainPerDay(3))
  })
})
