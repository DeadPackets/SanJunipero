import { describe, expect, it } from 'vitest'
import type { PerceptionPacket } from './prompt/prose.js'
import { quietMeadowPacket, conversationPacket } from './testutil/fixtures.js'
import { decideWake, disarmBodyAlarm, rearmBodyAlarm, DEFAULT_MIND_CONFIG, type MindClock, type PlanState, type WakeReason } from './wake.js'

const cfg = DEFAULT_MIND_CONFIG

function pkt(overrides: Partial<PerceptionPacket> = {}): PerceptionPacket {
  return { ...quietMeadowPacket, ...overrides }
}

function withNeeds(hunger: number, energy: number, warmth: number): PerceptionPacket {
  const self = quietMeadowPacket.self
  return {
    ...quietMeadowPacket,
    self: { ...self, body: { ...self.body, needs: { ...self.body.needs, hunger, energy, warmth } } },
  }
}

function clk(overrides: Partial<MindClock> = {}): MindClock {
  return {
    lastTurnTick: 0,
    reconsiderAtTick: null,
    conversationUntilTick: 0,
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

describe('decideWake — one case per reason', () => {
  const cases: Array<[string, PerceptionPacket, MindClock, number, PlanState, WakeReason | null]> = [
    ['body_alarm', withNeeds(24, 78, 71), clk(), 10, pln(), 'body_alarm'],
    ['salient_perception (heard speech)', conversationPacket, clk(), 10, pln(), 'salient_perception'],
    ['salient_perception (felt event only)', { ...quietMeadowPacket, feltEvents: ['rain_started'] }, clk(), 10, pln(), 'salient_perception'],
    ['plan_blocked', pkt(), clk(), 10, pln({ lastResult: 'blocked' }), 'plan_blocked'],
    ['plan_done', pkt(), clk(), 30, pln({ lastResult: 'done' }), 'plan_done'],
    ['conversation_beat', pkt(), clk({ lastTurnTick: 100, conversationUntilTick: 160 }), 102, pln(), 'conversation_beat'],
    ['reconsider', pkt(), clk({ reconsiderAtTick: 100 }), 100, pln(), 'reconsider'],
    ['boredom', pkt(), clk(), 130, pln(), 'boredom'],
  ]
  it.each(cases)('%s', (_name, packet, clock, tick, plan, expected) => {
    expect(decideWake(cfg, packet, clock, tick, plan)).toBe(expected)
  })
})

describe('decideWake — priority and floor', () => {
  it('prioritizes body_alarm over heard speech', () => {
    const packet = {
      ...conversationPacket,
      self: { ...conversationPacket.self, body: { ...conversationPacket.self.body, needs: { ...conversationPacket.self.body.needs, hunger: 20 } } },
    }
    expect(decideWake(cfg, packet, clk(), 10, pln())).toBe('body_alarm')
  })

  it('plan_blocked wakes immediately, ignoring the idle floor', () => {
    expect(decideWake(cfg, pkt(), clk({ lastTurnTick: 0 }), 1, pln({ lastResult: 'blocked' }))).toBe('plan_blocked')
  })

  it('idle floor blocks plan_done and reconsider until idleGapTicks elapse', () => {
    expect(decideWake(cfg, pkt(), clk(), 5, pln({ lastResult: 'done' }))).toBe(null)
    expect(decideWake(cfg, pkt(), clk({ reconsiderAtTick: 3 }), 5, pln())).toBe(null)
  })

  it('idle floor does not apply inside an open conversation window', () => {
    // 5 ticks since the last turn: outside conversation the floor would block
    // plan_done (idleGapTicks = 20), but the window is still open.
    expect(decideWake(cfg, pkt(), clk({ lastTurnTick: 100, conversationUntilTick: 160 }), 105, pln({ lastResult: 'done' }))).toBe('plan_done')
  })

  it('salient_perception fires when the visible-agent set changes', () => {
    const packet = {
      ...quietMeadowPacket,
      visible: {
        ...quietMeadowPacket.visible,
        agents: [{ id: 'nadia', name: 'Nadia', x: 16, y: 10, activityVerb: null, collapsed: false, asleep: false }],
      },
    }
    expect(decideWake(cfg, packet, clk({ prevVisibleIds: [] }), 10, pln())).toBe('salient_perception')
    expect(decideWake(cfg, packet, clk({ prevVisibleIds: ['nadia'] }), 10, pln())).toBe(null)
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
    expect(decideWake(cfg, asleep(), clk({ morningWokeDay: 0 }), 600, pln())).toBe(null)
    expect(decideWake(cfg, asleep(), clk({ morningWokeDay: 0 }), 1440 + 600, pln())).toBe('morning')
  })

  it('does not fire morning while it is still night', () => {
    expect(decideWake(cfg, asleepAtNight(), clk(), 1380, pln())).toBe(null)
  })

  it('wakes on you_were_attacked', () => {
    expect(decideWake(cfg, asleep(['you_were_attacked']), clk(), 10, pln())).toBe('salient_perception')
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
      self: { ...asleep().self, body: { ...quietMeadowPacket.self.body, needs: { ...quietMeadowPacket.self.body.needs, energy: 10 } } },
    }
    expect(decideWake(cfg, packet, clk(), 10, pln())).toBe('body_alarm')
  })

  it('body_alarm re-fires while asleep even after the armed flag was spent', () => {
    // A starving sleeper never recovers past the re-arm point; asleep, the
    // one-shot armed flag must not silence the body forever.
    const packet = {
      ...asleepAtNight(),
      self: { ...asleep().self, body: { ...quietMeadowPacket.self.body, needs: { ...quietMeadowPacket.self.body.needs, hunger: 10 } } },
    }
    const clock = clk({ alarmArmed: { hunger: false, energy: true, warmth: true } })
    expect(decideWake(cfg, packet, clock, 900, pln())).toBe('body_alarm')
  })

  it('asleep wake reasons respect the wakeRetryAtTick backoff', () => {
    const hungry = {
      ...asleepAtNight(),
      self: { ...asleep().self, body: { ...quietMeadowPacket.self.body, needs: { ...quietMeadowPacket.self.body.needs, hunger: 10 } } },
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

    expect(run(24, 10)).toBe('body_alarm')
    disarmBodyAlarm(cfg, { needs: { hunger: 24, energy: 78, warmth: 71 } }, clock)

    expect(run(24, 11)).toBe(null)

    // 26 is above threshold but below the 35 re-arm point: still quiet.
    expect(run(26, 12)).toBe(null)
    expect(run(24, 13)).toBe(null)

    // 36 > 25 + 10: climbs past the re-arm point, but healthy → no wake.
    expect(run(36, 14)).toBe(null)
    expect(run(24, 15)).toBe('body_alarm')
  })

  it('a turn at a level between threshold and re-arm point must not disarm the alarm', () => {
    // Regression: hunger 30 lies in (25, 35]; a turn snapshot there used to
    // permanently disarm body_alarm because 30 is not > threshold + hysteresis.
    const clock = clk()
    disarmBodyAlarm(cfg, { needs: { hunger: 30, energy: 78, warmth: 71 } }, clock)
    expect(decideWake(cfg, withNeeds(24, 78, 71), clock, 10, pln())).toBe('body_alarm')
  })
})

// C11 shipped four new ways for a body to fail and the alarm clock knew about none of them:
// the mini-rehearsal's minds ended two sim-days at hunger 0 with fatigue on every one of them,
// and a sleeper dying of thirst had no path back at all.
describe('decideWake — the thirst rung and the affliction rung', () => {
  const withThirst = (thirst: number): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: { ...quietMeadowPacket.self, body: { ...quietMeadowPacket.self.body, thirst } },
  })
  const withAffliction = (kind: 'fatigue' | 'illness' | 'injury' | 'poison', severity: number): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: { ...quietMeadowPacket.self, body: { ...quietMeadowPacket.self.body, afflictions: [{ kind, severity }] } },
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
    expect(decideWake(cfg, withNeeds(24, 78, 71), clock, 49, pln())).toBe(null)
    expect(decideWake(cfg, conversationPacket, clock, 49, pln())).toBe(null)
    expect(decideWake(cfg, pkt(), clock, 49, pln({ lastResult: 'blocked' }))).toBe(null)
    expect(decideWake(cfg, withNeeds(24, 78, 71), clock, 50, pln())).toBe('body_alarm')
  })
})

describe('decideWake — conversation cadence and reconsider', () => {
  it('conversation_beat follows its cadence then falls back to idle', () => {
    const base = { lastTurnTick: 100, conversationUntilTick: 160 }
    const packet = pkt()
    const plan = pln()
    expect(decideWake(cfg, packet, clk(base), 101, plan)).toBe(null)
    expect(decideWake(cfg, packet, clk(base), 102, plan)).toBe('conversation_beat')
    expect(decideWake(cfg, packet, clk(base), 104, plan)).toBe('conversation_beat')
    expect(decideWake(cfg, packet, clk(base), 161, plan)).toBe(null)
  })

  it('reconsider fires once at the scheduled tick; caller clears it after acting', () => {
    expect(decideWake(cfg, pkt(), clk({ reconsiderAtTick: 100 }), 100, pln())).toBe('reconsider')
    expect(decideWake(cfg, pkt(), clk({ lastTurnTick: 100, reconsiderAtTick: null }), 130, pln())).toBe(null)
  })
})
