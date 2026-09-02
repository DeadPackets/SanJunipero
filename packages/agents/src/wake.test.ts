import { describe, expect, it } from 'vitest'
import type { PerceptionPacket } from './prompt/prose.js'
import { quietMeadowPacket, conversationPacket } from './testutil/fixtures.js'
import {
  decideWake,
  disarmBodyAlarm,
  rearmBodyAlarm,
  wakeReasons,
  DEFAULT_MIND_CONFIG,
  type FloorState,
  type MindClock,
  type PlanState,
  type WakeReason,
} from './wake.js'

const cfg = DEFAULT_MIND_CONFIG

function pkt(overrides: Partial<PerceptionPacket> = {}): PerceptionPacket {
  return { ...quietMeadowPacket, ...overrides }
}

function withNeeds(hunger: number, energy: number, warmth: number): PerceptionPacket {
  const self = quietMeadowPacket.self
  return {
    ...quietMeadowPacket,
    self: {
      ...self,
      body: { ...self.body, needs: { ...self.body.needs, hunger, energy, warmth } },
    },
  }
}

function clk(overrides: Partial<MindClock> = {}): MindClock {
  return {
    lastTurnTick: 0,
    reconsiderAtTick: null,
    dozeUntilTick: 0,
    alarmArmed: { hunger: true, energy: true, warmth: true },
    morningWokeDay: null,
    wakeRetryAtTick: 0,
    prevVisibleIds: [],
    ...overrides,
  }
}

function pln(overrides: Partial<PlanState> = {}): PlanState {
  return { queue: [], lastResult: 'idle', ...overrides }
}

const HOLDS_FLOOR: FloorState = { inScene: true, holdsFloor: true }
const LISTENS: FloorState = { inScene: true, holdsFloor: false }

describe('decideWake — one case per reason', () => {
  // The sixth column is the reason that decides and always has; the seventh is every reason that
  // was true, deciding one first. Nothing reads the seventh but the ledger.
  const cases: [
    string,
    PerceptionPacket,
    MindClock,
    number,
    PlanState,
    WakeReason | null,
    WakeReason[],
    FloorState?,
  ][] = [
    ['body_alarm', withNeeds(14, 78, 71), clk(), 10, pln(), 'body_alarm', ['body_alarm']],
    [
      'salient_perception (rain felt, with a voice and a face under it)',
      conversationPacket,
      clk(),
      10,
      pln(),
      'salient_perception',
      ['salient_perception'],
    ],
    [
      'salient_perception (felt event only)',
      { ...quietMeadowPacket, feltEvents: ['rain_started'] },
      clk(),
      10,
      pln(),
      'salient_perception',
      ['salient_perception'],
    ],
    [
      'plan_blocked',
      pkt(),
      clk(),
      10,
      pln({ lastResult: 'blocked' }),
      'plan_blocked',
      ['plan_blocked'],
    ],
    ['plan_done', pkt(), clk(), 30, pln({ lastResult: 'done' }), 'plan_done', ['plan_done']],
    ['floor', pkt(), clk({ lastTurnTick: 100 }), 105, pln(), 'floor', ['floor'], HOLDS_FLOOR],
    [
      'reconsider',
      pkt(),
      clk({ reconsiderAtTick: 100 }),
      100,
      pln(),
      'reconsider',
      ['reconsider', 'boredom'],
    ],
    ['boredom', pkt(), clk(), 130, pln(), 'boredom', ['boredom']],
  ]
  it.each(cases)('%s', (_name, packet, clock, tick, plan, expected, every, floor) => {
    expect(decideWake(cfg, packet, clock, tick, plan, floor)).toBe(expected)
    expect(wakeReasons(cfg, packet, clock, tick, plan, floor)).toEqual(every)
  })
})

// 82.4% of the gate's 510 calls were charged to salient_perception, and the number was inflated:
// an act lasts one sim-minute, so the plan was finished on nearly every one of those ticks too,
// three lines below where the answer was already given.
describe('wakeReasons — what else was true when the winner was recorded', () => {
  const asleepHungry: PerceptionPacket = {
    ...withNeeds(5, 78, 71),
    self: { ...withNeeds(5, 78, 71).self, asleep: true },
  }

  it('sees the finished plan under the passer-by that bought the call', () => {
    const clock = clk()
    const plan = pln({ lastResult: 'done' })
    expect(decideWake(cfg, conversationPacket, clock, 30, plan)).toBe('salient_perception')
    expect(wakeReasons(cfg, conversationPacket, clock, 30, plan)).toEqual([
      'salient_perception',
      'plan_done',
    ])
  })

  it('a sleeper woken by its body is often owed a morning as well', () => {
    expect(wakeReasons(cfg, asleepHungry, clk(), 600, pln())).toEqual(['body_alarm', 'morning'])
  })

  it('ends the list where the ladder ends: a gate stops what it was always going to stop', () => {
    // The doze answers nothing at all, the retry rung silences a body that is still failing, and
    // the idle floor never let reconsider be reached. None of these is "true but outranked".
    expect(wakeReasons(cfg, conversationPacket, clk({ dozeUntilTick: 50 }), 49, pln())).toEqual([])
    expect(wakeReasons(cfg, asleepHungry, clk({ wakeRetryAtTick: 910 }), 900, pln())).toEqual([])
    expect(wakeReasons(cfg, conversationPacket, clk({ reconsiderAtTick: 0 }), 10, pln())).toEqual([
      'salient_perception',
    ])
  })

  it('a scene reaches one reason and a listener none, whatever else the body is doing', () => {
    const weary = withNeeds(60, 40, 71)
    const plan = pln({ lastResult: 'blocked' })
    expect(wakeReasons(cfg, weary, clk(), 10, plan, HOLDS_FLOOR)).toEqual(['floor'])
    expect(wakeReasons(cfg, weary, clk(), 10, plan, LISTENS)).toEqual([])
  })
})

// Nothing closes a talk for being late any more, so the body alarm is the only thing left that
// can reach a mouth running down mid-sentence.
describe('the body reaches a mind holding the floor', () => {
  it('leaves a merely tired floor-holder talking', () => {
    const tired = withNeeds(60, 40, 71)
    expect(decideWake(cfg, tired, clk(), 10, pln(), HOLDS_FLOOR)).toBe('floor')
  })

  it('takes a failing one off the floor', () => {
    const failing = withNeeds(60, 5, 71)
    expect(decideWake(cfg, failing, clk(), 10, pln(), HOLDS_FLOOR)).toBe('body_alarm')
    expect(wakeReasons(cfg, failing, clk(), 10, pln(), HOLDS_FLOOR)).toContain('body_alarm')
  })

  it('rings once and then gives the floor back, because a spent alarm is disarmed', () => {
    const failing = withNeeds(60, 5, 71)
    const clock = clk()
    disarmBodyAlarm(cfg, failing.self.body, clock)
    expect(decideWake(cfg, failing, clock, 10, pln(), HOLDS_FLOOR)).toBe('floor')
  })

  it('keeps hearing free: a listener with the same body takes no turn', () => {
    const failing = withNeeds(60, 5, 71)
    expect(wakeReasons(cfg, failing, clk(), 10, pln(), LISTENS)).toEqual([])
  })
})

describe('decideWake — priority and floor', () => {
  it('prioritizes body_alarm over heard speech', () => {
    const packet = {
      ...conversationPacket,
      self: {
        ...conversationPacket.self,
        body: {
          ...conversationPacket.self.body,
          needs: { ...conversationPacket.self.body.needs, hunger: 10 },
        },
      },
    }
    expect(decideWake(cfg, packet, clk(), 10, pln())).toBe('body_alarm')
  })

  it('plan_blocked wakes immediately, ignoring the idle floor', () => {
    expect(
      decideWake(cfg, pkt(), clk({ lastTurnTick: 0 }), 1, pln({ lastResult: 'blocked' })),
    ).toBe('plan_blocked')
  })

  it('idle floor blocks plan_done and reconsider until idleGapTicks elapse', () => {
    expect(decideWake(cfg, pkt(), clk(), 5, pln({ lastResult: 'done' }))).toBe(null)
    expect(decideWake(cfg, pkt(), clk({ reconsiderAtTick: 3 }), 5, pln())).toBe(null)
  })

  it('a scene outranks every reason but a failing body, and a listener takes no turn at all', () => {
    const blocked = pln({ lastResult: 'blocked' })
    const well = withNeeds(60, 78, 71)
    const starving = withNeeds(5, 78, 71)
    expect(decideWake(cfg, well, clk(), 10, blocked, HOLDS_FLOOR)).toBe('floor')
    expect(decideWake(cfg, starving, clk(), 10, blocked, HOLDS_FLOOR)).toBe('body_alarm')
    expect(decideWake(cfg, starving, clk(), 10, blocked, LISTENS)).toBe(null)
  })

  it('salient_perception fires when the visible-agent set changes', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        ...quietMeadowPacket.visible,
        agents: [
          {
            id: 'nadia',
            name: 'Nadia',
            x: 16,
            y: 10,
            activityVerb: null,
            collapsed: false,
            asleep: false,
          },
        ],
      },
    }
    expect(decideWake(cfg, packet, clk({ prevVisibleIds: [] }), 40, pln())).toBe(
      'salient_perception',
    )
    expect(decideWake(cfg, packet, clk({ prevVisibleIds: ['nadia'] }), 40, pln())).toBe(null)
    expect(
      decideWake(cfg, packet, clk({ prevVisibleIds: [] }), 10, pln()),
      'a face arriving is noticed, and waits out the idle gap like anything else noticed',
    ).toBe(null)
  })
})

// A word said near a mind is not addressed to it. The scene machine answers speech now: whoever
// was spoken to becomes a participant and holds the floor, which is gap-exempt. Leaving `heard`
// above the gate as well made every bystander pay a full turn for every line it overheard.
describe('hearing is not being spoken to', () => {
  const overheard: PerceptionPacket = {
    ...quietMeadowPacket,
    heard: [{ speakerId: 'nadia', name: 'Nadia', text: 'Six planks, you said.', distance: 2 }],
  }

  it('buys no turn inside the idle gap, however much is said', () => {
    expect(wakeReasons(cfg, overheard, clk(), 10, pln())).toEqual([])
    expect(wakeReasons(cfg, overheard, clk(), 29, pln())).toEqual([])
  })

  it('costs a listener no more than the silence beside it', () => {
    const silent = { ...quietMeadowPacket }
    for (const tick of [5, 10, 20, 29]) {
      expect(wakeReasons(cfg, overheard, clk(), tick, pln()), `tick ${tick}`).toEqual(
        wakeReasons(cfg, silent, clk(), tick, pln()),
      )
    }
  })

  it('still reaches a mind that something happened TO, at once', () => {
    const rained = { ...overheard, feltEvents: ['rain_started'] }
    expect(wakeReasons(cfg, rained, clk(), 10, pln())).toEqual(['salient_perception'])
  })
})

describe('decideWake — asleep gate', () => {
  const asleep = (feltEvents: string[] = []): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: { ...quietMeadowPacket.self, asleep: true },
    feltEvents,
  })
  const asleepAtNight = (feltEvents: string[] = []): PerceptionPacket => ({
    ...asleep(feltEvents),
    time: { ...quietMeadowPacket.time, hour: 23, isNight: true },
  })

  it('ignores boredom while asleep', () => {
    expect(decideWake(cfg, asleepAtNight(), clk(), 130, pln())).toBe(null)
  })

  it('wakes once for the morning when asleep past dawn', () => {
    // quietMeadowPacket is 10:00 — daylight. First look: morning. Once the
    // runtime marks the day, no more morning wakes until the next day.
    expect(decideWake(cfg, asleep(), clk(), 600, pln())).toBe('morning')
    expect(
      decideWake(cfg, asleep(), clk({ morningWokeDay: 0, lastTurnTick: 590 }), 600, pln()),
    ).toBe(null)
    // A nap in daylight ends after napTicks; a whole day is never lost to one bad morning.
    expect(
      decideWake(cfg, asleep(), clk({ morningWokeDay: 0, lastTurnTick: 400 }), 600, pln()),
    ).toBe('morning')
    expect(decideWake(cfg, asleep(), clk({ morningWokeDay: 0 }), 1440 + 600, pln())).toBe('morning')
  })

  it('does not fire morning while it is still night', () => {
    expect(decideWake(cfg, asleepAtNight(), clk(), 1380, pln())).toBe(null)
  })

  it('wakes on you_were_attacked', () => {
    expect(decideWake(cfg, asleep(['you_were_attacked']), clk(), 10, pln())).toBe(
      'salient_perception',
    )
  })

  it('wakes on fire-prefixed felt events', () => {
    expect(decideWake(cfg, asleep(['fire_started']), clk(), 10, pln())).toBe('salient_perception')
  })

  it('ignores non-salient felt events', () => {
    expect(decideWake(cfg, asleepAtNight(['rain_started']), clk(), 10, pln())).toBe(null)
  })

  it('wakes on body_alarm while asleep', () => {
    const packet = {
      ...asleep(),
      self: {
        ...asleep().self,
        body: {
          ...quietMeadowPacket.self.body,
          needs: { ...quietMeadowPacket.self.body.needs, energy: 9 },
        },
      },
    }
    expect(decideWake(cfg, packet, clk(), 10, pln())).toBe('body_alarm')
  })

  it('body_alarm re-fires while asleep even after the armed flag was spent', () => {
    // A starving sleeper never recovers past the re-arm point; asleep, the
    // one-shot armed flag must not silence the body forever.
    const packet = {
      ...asleepAtNight(),
      self: {
        ...asleep().self,
        body: {
          ...quietMeadowPacket.self.body,
          needs: { ...quietMeadowPacket.self.body.needs, hunger: 10 },
        },
      },
    }
    const clock = clk({ alarmArmed: { hunger: false, energy: true, warmth: true } })
    expect(decideWake(cfg, packet, clock, 900, pln())).toBe('body_alarm')
  })

  it('asleep wake reasons respect the wakeRetryAtTick backoff', () => {
    const hungry = {
      ...asleepAtNight(),
      self: {
        ...asleep().self,
        body: {
          ...quietMeadowPacket.self.body,
          needs: { ...quietMeadowPacket.self.body.needs, hunger: 10 },
        },
      },
    }
    expect(decideWake(cfg, hungry, clk({ wakeRetryAtTick: 910 }), 900, pln())).toBe(null)
    expect(decideWake(cfg, hungry, clk({ wakeRetryAtTick: 910 }), 910, pln())).toBe('body_alarm')
    // morning backs off the same way, then fires again — not one-shot.
    expect(decideWake(cfg, asleep(), clk({ wakeRetryAtTick: 620 }), 610, pln())).toBe(null)
    expect(decideWake(cfg, asleep(), clk({ wakeRetryAtTick: 620 }), 620, pln())).toBe('morning')
  })
})

describe('decideWake — hysteresis', () => {
  it('body_alarm fires while armed, stays quiet disarmed, re-arms past threshold + hysteresis', () => {
    const clock = clk()
    const run = (hunger: number, tick: number): WakeReason | null => {
      rearmBodyAlarm(cfg, { needs: { hunger, energy: 78, warmth: 71 } }, clock)
      return decideWake(cfg, withNeeds(hunger, 78, 71), clock, tick, pln())
    }

    expect(run(14, 10)).toBe('body_alarm')
    disarmBodyAlarm(cfg, { needs: { hunger: 14, energy: 78, warmth: 71 } }, clock)

    expect(run(14, 11)).toBe(null)

    // 16 is above threshold but below the 25 re-arm point: still quiet.
    expect(run(16, 12)).toBe(null)
    expect(run(14, 13)).toBe(null)

    // 26 > 15 + 10: climbs past the re-arm point, but healthy → no wake.
    expect(run(26, 14)).toBe(null)
    expect(run(14, 15)).toBe('body_alarm')
  })

  it('a turn at a level between threshold and re-arm point must not disarm the alarm', () => {
    // Regression: hunger 20 lies in (15, 25]; a turn snapshot there used to
    // permanently disarm body_alarm because 20 is not > threshold + hysteresis.
    const clock = clk()
    disarmBodyAlarm(cfg, { needs: { hunger: 20, energy: 78, warmth: 71 } }, clock)
    expect(decideWake(cfg, withNeeds(14, 78, 71), clock, 10, pln())).toBe('body_alarm')
  })
})

// The alarm clock has to know every way a body can fail, or a sleeper dying of thirst has no
// path back at all.
describe('decideWake — the thirst rung and the affliction rung', () => {
  const withThirst = (thirst: number): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: { ...quietMeadowPacket.self, body: { ...quietMeadowPacket.self.body, thirst } },
  })
  const withAffliction = (
    kind: 'fatigue' | 'illness' | 'injury' | 'poison',
    severity: number,
  ): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: {
      ...quietMeadowPacket.self,
      body: { ...quietMeadowPacket.self.body, afflictions: [{ kind, severity }] },
    },
  })
  const sleeping = (packet: PerceptionPacket): PerceptionPacket => ({
    ...packet,
    self: { ...packet.self, asleep: true },
    time: { ...packet.time, hour: 23, isNight: true },
  })

  it('a dry throat rings the bell', () => {
    expect(decideWake(cfg, withThirst(24), clk(), 10, pln())).toBe('body_alarm')
    expect(decideWake(cfg, withThirst(26), clk(), 10, pln())).toBe(null)
  })

  it('a sleeper dying of thirst is woken by its own body', () => {
    expect(decideWake(cfg, sleeping(withThirst(4)), clk(), 900, pln())).toBe('body_alarm')
  })

  it('a packet from before thirst existed reads as a full body', () => {
    expect(decideWake(cfg, quietMeadowPacket, clk(), 10, pln())).toBe(null)
  })

  it.each(['fatigue', 'illness', 'injury', 'poison'] as const)('%s rouses a sleeper', (kind) => {
    expect(decideWake(cfg, sleeping(withAffliction(kind, 1)), clk(), 900, pln())).toBe('body_alarm')
  })

  it('rings once and then keeps quiet until the body is clear of it', () => {
    const clock = clk()
    const poisoned = withAffliction('poison', 2)
    expect(decideWake(cfg, poisoned, clock, 10, pln())).toBe('body_alarm')
    disarmBodyAlarm(cfg, poisoned.self.body, clock)
    expect(decideWake(cfg, poisoned, clock, 11, pln())).toBe(null)

    // Still poisoned, worse: no second bell. Only losing it re-arms the alarm.
    rearmBodyAlarm(cfg, withAffliction('poison', 3).self.body, clock)
    expect(decideWake(cfg, poisoned, clock, 12, pln())).toBe(null)
    rearmBodyAlarm(cfg, quietMeadowPacket.self.body, clock)
    expect(decideWake(cfg, poisoned, clock, 13, pln())).toBe('body_alarm')
  })

  it('thirst disarms and re-arms on the same hysteresis as hunger', () => {
    const clock = clk()
    expect(decideWake(cfg, withThirst(24), clock, 10, pln())).toBe('body_alarm')
    disarmBodyAlarm(cfg, withThirst(24).self.body, clock)
    expect(decideWake(cfg, withThirst(24), clock, 11, pln())).toBe(null)
    rearmBodyAlarm(cfg, withThirst(30).self.body, clock)
    expect(decideWake(cfg, withThirst(24), clock, 12, pln())).toBe(null)
    rearmBodyAlarm(cfg, withThirst(36).self.body, clock)
    expect(decideWake(cfg, withThirst(24), clock, 13, pln())).toBe('body_alarm')
  })
})

describe('decideWake — doze backoff', () => {
  it('suppresses every reason, floor-exempt ones included, until dozeUntilTick', () => {
    const clock = clk({ dozeUntilTick: 50 })
    expect(decideWake(cfg, withNeeds(14, 78, 71), clock, 49, pln())).toBe(null)
    expect(decideWake(cfg, conversationPacket, clock, 49, pln())).toBe(null)
    expect(decideWake(cfg, pkt(), clock, 49, pln({ lastResult: 'blocked' }))).toBe(null)
    expect(decideWake(cfg, withNeeds(14, 78, 71), clock, 50, pln())).toBe('body_alarm')
  })
})

describe('decideWake — reconsider', () => {
  it('reconsider fires once at the scheduled tick; caller clears it after acting', () => {
    expect(decideWake(cfg, pkt(), clk({ reconsiderAtTick: 100 }), 100, pln())).toBe('reconsider')
    expect(
      decideWake(cfg, pkt(), clk({ lastTurnTick: 100, reconsiderAtTick: null }), 130, pln()),
    ).toBe(null)
  })
})

describe('a mind that has never taken a turn', () => {
  // `lastTurnTick: 0` cannot tell "never" from "took one at tick 0", and a fresh town starts at
  // tick 0 — so every new arrival waits out the whole boredom floor before its first thought.
  it('is bored on its first tick, not `boredomTicks` later', () => {
    expect(decideWake(cfg, pkt(), clk({ lastTurnTick: null }), 1, pln())).toBe('boredom')
  })

  it('waits out the floor again once it HAS taken one', () => {
    expect(decideWake(cfg, pkt(), clk({ lastTurnTick: 1 }), 2, pln())).toBe(null)
    expect(decideWake(cfg, pkt(), clk({ lastTurnTick: 1 }), 61, pln())).toBe('boredom')
  })
})

// ★ Two minds paraphrasing each other held each other in the 5-tick cadence for ever, because
// any heard word bought another 60 ticks of it. An echo is heard; it is not news.

describe('★ fire and a blow reach a listener, as they reach a sleeper', () => {
  const rousing = (e: string) => pkt({ feltEvents: [e] })

  it('rouses a listener who is being attacked or burned', () => {
    for (const e of ['you_were_attacked', 'fire_nearby']) {
      expect(decideWake(cfg, rousing(e), clk(), 100, pln(), LISTENS)).toBe('salient_perception')
    }
  })

  it('still holds a listener still for anything less than that', () => {
    expect(decideWake(cfg, rousing('someone_spoke'), clk(), 100, pln(), LISTENS)).toBeNull()
  })
})
