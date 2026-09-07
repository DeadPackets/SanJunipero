import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY } from '@sj/shared'
import type { PerceptionPacket } from './prompt/prose.js'
import { openAgentDb } from './memory/schema.js'
import { WantStore } from './memory/wants.js'
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
    gatheringDay: null,
    wakeRetryAtTick: 0,
    ...overrides,
  }
}

function pln(overrides: Partial<PlanState> = {}): PlanState {
  return { queue: [], lastResult: 'idle', ...overrides }
}

const HOLDS_FLOOR: FloorState = { inScene: true, holdsFloor: true }
const LISTENS: FloorState = { inScene: true, holdsFloor: false }
const NO_SCENE: FloorState = { inScene: false, holdsFloor: false }

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
    // A clock apiece: the gate spends the felt latch on the ask, so asking twice is not one ask.
    expect(decideWake(cfg, packet, { ...clock }, tick, plan, floor)).toBe(expected)
    expect(wakeReasons(cfg, packet, { ...clock }, tick, plan, floor)).toEqual(every)
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
// can reach a mouth running down mid-sentence, and it waits for the line to be said.
describe('the body reaches a mind in a talk', () => {
  it('leaves a merely tired floor-holder talking', () => {
    const tired = withNeeds(60, 40, 71)
    expect(decideWake(cfg, tired, clk(), 10, pln(), HOLDS_FLOOR)).toBe('floor')
  })

  it('lets a failing one say its line, and rings the beat after, in the talk', () => {
    const failing = withNeeds(60, 5, 71)
    expect(decideWake(cfg, failing, clk(), 10, pln(), HOLDS_FLOOR)).toBe('floor')
    expect(decideWake(cfg, failing, clk(), 10, pln(), LISTENS)).toBe('body_alarm')
    expect(wakeReasons(cfg, failing, clk(), 10, pln(), LISTENS)).toContain('body_alarm')
  })

  it('rings once and then listens again, because a spent alarm is disarmed', () => {
    const failing = withNeeds(60, 5, 71)
    const clock = clk()
    disarmBodyAlarm(cfg, failing.self.body, clock, 10)
    expect(decideWake(cfg, failing, clock, 10, pln(), LISTENS)).toBe(null)
  })

  it('rings again after alarmRepeatTicks for a body still failing, in the talk or out of it', () => {
    const failing = withNeeds(60, 5, 71)
    const clock = clk()
    disarmBodyAlarm(cfg, failing.self.body, clock, 10)
    const again = 10 + cfg.alarmRepeatTicks
    expect(decideWake(cfg, failing, clock, again - 1, pln(), LISTENS)).toBe(null)
    // Ordinary turns in between, each disarming again, do not push the repeat back.
    disarmBodyAlarm(cfg, failing.self.body, clock, 60)
    expect(decideWake(cfg, failing, clock, again, pln(), LISTENS)).toBe('body_alarm')
    disarmBodyAlarm(cfg, failing.self.body, clock, again)
    expect(decideWake(cfg, failing, clock, again + 1, pln(), LISTENS)).toBe(null)
    expect(decideWake(cfg, failing, clock, again * 2 - 10, pln(), LISTENS)).toBe('body_alarm')
    expect(
      wakeReasons(cfg, failing, { ...clock, lastTurnTick: again * 2 - 11 }, again * 2 - 10, pln()),
    ).toEqual(['body_alarm'])
    // Recovered past the bell, the repeat has nothing to ring for.
    expect(decideWake(cfg, withNeeds(60, 40, 71), clock, again, pln(), LISTENS)).toBe(null)
  })

  it('takes a failing listener out of the talk too', () => {
    const failing = withNeeds(60, 5, 71)
    expect(decideWake(cfg, failing, clk(), 10, pln(), LISTENS)).toBe('body_alarm')
  })

  it('keeps hearing free: a merely tired listener takes no turn', () => {
    const tired = withNeeds(60, 40, 71)
    expect(wakeReasons(cfg, tired, clk(), 10, pln(), LISTENS)).toEqual([])
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

  it('a scene outranks every reason but a failing body, and the floor outranks even that', () => {
    const blocked = pln({ lastResult: 'blocked' })
    const well = withNeeds(60, 78, 71)
    const starving = withNeeds(5, 78, 71)
    expect(decideWake(cfg, well, clk(), 10, blocked, HOLDS_FLOOR)).toBe('floor')
    expect(decideWake(cfg, well, clk(), 10, blocked, LISTENS)).toBe(null)
    expect(decideWake(cfg, starving, clk(), 10, blocked, HOLDS_FLOOR)).toBe('floor')
    expect(decideWake(cfg, starving, clk(), 10, blocked, LISTENS)).toBe('body_alarm')
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
    expect(decideWake(cfg, packet, clk(), 40, pln())).toBe('salient_perception')
    expect(decideWake(cfg, packet, clk({ facesSeen: { nadia: 39 } }), 40, pln())).toBe(null)
    expect(
      decideWake(cfg, packet, clk(), 10, pln()),
      'a face arriving is noticed, and waits out the idle gap like anything else noticed',
    ).toBe(null)
  })
})

// r29: 590 of 786 turns were bought by a face coming into view or a line overheard, a third of
// them silent. Company is news once; a departure never was; being named always is.
describe('company is news once', () => {
  const nadia = {
    id: 'nadia',
    name: 'Nadia',
    x: 16,
    y: 10,
    activityVerb: null,
    collapsed: false,
    asleep: false,
  }
  const company = pkt({ visible: { ...quietMeadowPacket.visible, agents: [nadia] } })
  const alone = pkt()
  const overheard = pkt({
    heard: [{ speakerId: 'nadia', name: 'Nadia', text: 'Six planks, you said.', distance: 2 }],
  })

  it('a face that stays is noticed once, not on every turn after', () => {
    const clock = clk()
    expect(decideWake(cfg, company, clock, 40, pln())).toBe('salient_perception')
    clock.lastTurnTick = 40
    expect(decideWake(cfg, company, clock, 80, pln())).toBe(null)
  })

  it('a face gone and back inside the memory window is the same company', () => {
    const clock = clk({ facesSeen: { nadia: 100 } })
    expect(decideWake(cfg, company, { ...clock, lastTurnTick: 150 }, 200, pln())).toBe(null)
    const long = clk({ facesSeen: { nadia: 100 } })
    expect(
      decideWake(
        cfg,
        company,
        { ...long, lastTurnTick: 150 },
        100 + cfg.faceMemoryTicks + 1,
        pln(),
      ),
    ).toBe('salient_perception')
  })

  it('a departure is not news', () => {
    const clock = clk({ facesSeen: { nadia: 39 }, lastTurnTick: 0 })
    expect(decideWake(cfg, alone, clock, 40, pln())).toBe(null)
  })

  it('a voice is news once, and again only after the memory window', () => {
    const clock = clk()
    expect(decideWake(cfg, overheard, clock, 40, pln())).toBe('salient_perception')
    clock.lastTurnTick = 40
    expect(decideWake(cfg, overheard, clock, 80, pln())).toBe(null)
    expect(decideWake(cfg, overheard, clock, 80 + cfg.voiceMemoryTicks + 1, pln())).toBe(
      'salient_perception',
    )
  })

  it('being named reaches you whatever the memory says', () => {
    const clock = clk({ voicesHeard: { nadia: 39 }, lastTurnTick: 0 })
    expect(decideWake(cfg, overheard, clock, 40, pln())).toBe(null)
    expect(
      decideWake(cfg, overheard, clock, 40, pln(), {
        inScene: false,
        holdsFloor: false,
        addressed: true,
      }),
    ).toBe('salient_perception')
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

describe('a night somebody meant to be up for, and hours that differ', () => {
  const asleepAt = (hour: number): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: { ...quietMeadowPacket.self, asleep: true },
    time: { ...quietMeadowPacket.time, hour, isNight: hour >= 20 || hour < 6 },
  })

  it('wakes a sleeper at the hour they named before they lay down', () => {
    const at0230 = 2 * 60 + 30
    const clock = () => clk({ reconsiderAtTick: at0230 })
    expect(decideWake(cfg, asleepAt(2), clock(), at0230, pln())).toBe('reconsider')
    expect(decideWake(cfg, asleepAt(2), clock(), at0230 - 1, pln())).toBe(null)
    expect(decideWake(cfg, asleepAt(2), clk(), at0230, pln())).toBe(null)
  })

  it('leaves a late riser in bed at six and has them up at nine', () => {
    const late = { ...cfg, riseHour: 9 }
    expect(decideWake(late, asleepAt(6), clk(), 6 * 60, pln())).toBe(null)
    expect(decideWake(late, asleepAt(9), clk(), 9 * 60, pln())).toBe('morning')
    expect(decideWake(cfg, asleepAt(6), clk(), 6 * 60, pln())).toBe('morning')
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

  it('wakes on body_alarm while asleep, when the need is one a bed cannot mend', () => {
    const packet = {
      ...asleep(),
      self: {
        ...asleep().self,
        body: {
          ...quietMeadowPacket.self.body,
          needs: { ...quietMeadowPacket.self.body.needs, hunger: 9 },
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
    disarmBodyAlarm(cfg, { needs: { hunger: 14, energy: 78, warmth: 71 } }, clock, 10)

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
    disarmBodyAlarm(cfg, { needs: { hunger: 20, energy: 78, warmth: 71 } }, clock, 10)
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

  it('★ a sleeper worn to nothing sleeps on: tiredness is what the bed is for', () => {
    expect(decideWake(cfg, sleeping(withNeeds(60, 4, 71)), clk(), 900, pln())).toBe(null)
    expect(decideWake(cfg, withNeeds(60, 4, 71), clk(), 900, pln())).toBe('body_alarm')
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
    disarmBodyAlarm(cfg, poisoned.self.body, clock, 10)
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
    disarmBodyAlarm(cfg, withThirst(24).self.body, clock, 10)
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

// ★ One rainfall sat in the perception window for all 66 of its ticks, and the felt rung is
// above the idle gate: every awake mind bought a turn on every one of them.

describe('★ a felt event buys one turn, not one a tick', () => {
  const rained = pkt({ feltEvents: ['rain_started'] })

  it('wakes for the rain once and stays quiet while it is still in the window', () => {
    const clock = clk()
    expect(wakeReasons(cfg, rained, clock, 10, pln())).toEqual(['salient_perception'])
    for (const tick of [11, 20, 40, 70]) {
      expect(wakeReasons(cfg, rained, clock, tick, pln()), `tick ${tick}`).not.toContain(
        'salient_perception',
      )
    }
  })

  it('wakes again for a second thing felt under the first', () => {
    const clock = clk()
    expect(wakeReasons(cfg, rained, clock, 10, pln())).toEqual(['salient_perception'])
    const tended = pkt({ feltEvents: ['rain_started', 'you_were_tended'] })
    expect(wakeReasons(cfg, tended, clock, 12, pln())).toEqual(['salient_perception'])
  })

  it('does not wake a maker to say their fish was eaten; the next turn hears it', () => {
    const clock = clk()
    const relied = pkt({ feltEvents: ['your_work_used_ate'] })
    expect(wakeReasons(cfg, relied, clock, 10, pln())).not.toContain('salient_perception')
    const both = pkt({ feltEvents: ['your_work_used_ate', 'rain_started'] })
    expect(wakeReasons(cfg, both, clock, 12, pln())).toEqual(['salient_perception'])
  })

  it('wakes again when the same thing happens after the first has aged out', () => {
    const clock = clk()
    expect(wakeReasons(cfg, rained, clock, 10, pln())).toEqual(['salient_perception'])
    expect(wakeReasons(cfg, pkt(), clock, 80, pln())).not.toContain('salient_perception')
    expect(wakeReasons(cfg, rained, clock, 90, pln())).toContain('salient_perception')
  })

  it('holds nothing against a mind that was dozing when it happened', () => {
    const clock = clk({ dozeUntilTick: 50 })
    expect(wakeReasons(cfg, rained, clock, 40, pln())).toEqual([])
    expect(wakeReasons(cfg, rained, clock, 50, pln())).toContain('salient_perception')
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

// ★ Phase 2 took `salient_perception` off the ambient rung and the town went a third as
// sociable: 78 scenes opened before it, 26 after. This is the designed replacement — one rung,
// above the idle gate, that reads the one want a scene answers.

describe('★ the dusk gathering: the rung that reads a want', () => {
  const DUSK = 19 * 60
  const NOON = 12 * 60
  const LONELY = cfg.gatheringWant + 1
  const day = (n: number, minuteOfDay: number): number => n * MINUTES_PER_DAY + minuteOfDay

  // A mind that has just taken a turn, which is the mind this rung exists for: everything below
  // the idle gate is silent, so what the ladder answers here is the want and nothing else.
  const woke = (
    tick: number,
    belonging: number,
    over: Partial<MindClock> = {},
  ): WakeReason | null =>
    decideWake(
      cfg,
      pkt(),
      clk({ lastTurnTick: tick - 1, ...over }),
      tick,
      pln(),
      NO_SCENE,
      belonging,
    )

  it('fires at dusk for a mind whose belonging is over the gate', () => {
    expect(woke(DUSK, LONELY)).toBe('gathering')
  })

  it('never fires for a mind at or under the gate, however long the dusk', () => {
    for (const level of [0, 30, cfg.gatheringWant]) {
      expect(woke(DUSK, level), `${level}`).toBeNull()
    }
  })

  it('is a dusk rung and nothing else: silent at noon and through the night', () => {
    for (const t of [NOON, 6 * 60, 21 * 60, 3 * 60]) {
      expect(woke(t, LONELY), `${t}`).toBeNull()
    }
  })

  // The whole point of the rung: a mind that has just taken a turn is idle-gated into silence,
  // and loneliness is exactly the thing that gate must not swallow.
  it('reaches a mind the idle gate would otherwise hold', () => {
    const justSpoke = clk({ lastTurnTick: DUSK - 1 })
    expect(wakeReasons(cfg, pkt(), justSpoke, DUSK, pln(), NO_SCENE, LONELY)).toEqual(['gathering'])
    expect(wakeReasons(cfg, pkt(), justSpoke, DUSK, pln(), NO_SCENE, 0)).toEqual([])
  })

  it('waits behind the body: a starving mind eats before it seeks company', () => {
    const starving = withNeeds(5, 78, 71)
    const clock = clk({ lastTurnTick: DUSK - 1 })
    expect(decideWake(cfg, starving, clock, DUSK, pln(), NO_SCENE, LONELY)).toBe('body_alarm')
    expect(wakeReasons(cfg, starving, clock, DUSK, pln(), NO_SCENE, LONELY)).toEqual([
      'body_alarm',
      'gathering',
    ])
  })

  it('fires once per dusk, not once per tick of it', () => {
    for (const t of [DUSK, DUSK + 1, DUSK + 119]) {
      expect(woke(t, LONELY, { gatheringDay: 0 }), `${t}`).toBeNull()
    }
    expect(woke(day(1, DUSK), LONELY, { gatheringDay: 0 })).toBe('gathering')
  })

  it('leaves a sleeper asleep — the gate it beats is the idle gap, not the night', () => {
    const asleep = pkt({ self: { ...quietMeadowPacket.self, asleep: true } })
    const clock = clk({ lastTurnTick: DUSK - 1 })
    expect(wakeReasons(cfg, asleep, clock, DUSK, pln(), NO_SCENE, LONELY)).not.toContain(
      'gathering',
    )
  })

  it('never fires on a mind already in company, whichever end of the talk it is', () => {
    const clock = clk({ lastTurnTick: DUSK - 1 })
    expect(decideWake(cfg, pkt(), clock, DUSK, pln(), LISTENS, LONELY)).toBeNull()
    expect(decideWake(cfg, pkt(), clock, DUSK, pln(), HOLDS_FLOOR, LONELY)).toBe('floor')
  })

  // What makes the rung affordable, said as arithmetic rather than as an intention: the want it
  // reads is the one a scene zeroes, so company itself is what takes the mind off the ladder.
  it('goes quiet for days after a scene, and comes back when the loneliness does', () => {
    const db = openAgentDb(':memory:')
    const wants = new WantStore(db, 'tamar')
    wants.begin(0)
    const at = (tick: number): WakeReason | null => woke(tick, wants.levelOf('belonging', tick))

    expect(at(day(0, DUSK))).toBeNull() // 19.4 — nowhere near it
    expect(at(day(1, DUSK))).toBe('gathering') // 43.9, the first dusk that clears 40

    wants.feed(['scene'], day(1, DUSK))
    expect(at(day(2, DUSK))).toBeNull() // 24.5 — one evening's company bought two days
    expect(at(day(3, DUSK))).toBe('gathering') // 49.0
    db.close()
  })
})

describe('an hour lain with somebody', () => {
  const lying = (): PerceptionPacket => ({
    ...quietMeadowPacket,
    self: { ...quietMeadowPacket.self, activity: 'lie_with' },
  })

  it('buys no boredom turn and no plan turn, the way sleep buys none', () => {
    expect(wakeReasons(cfg, lying(), clk(), 600, pln({ lastResult: 'done' }))).toEqual([])
    expect(wakeReasons(cfg, lying(), clk(), 600, pln())).toEqual([])
  })

  it('is still pierced by a blow', () => {
    const struck = { ...lying(), feltEvents: ['you_were_attacked'] }
    expect(wakeReasons(cfg, struck, clk(), 600, pln())).toContain('salient_perception')
  })

  it('is still pierced by a body that is failing', () => {
    const failing = {
      ...lying(),
      self: {
        ...lying().self,
        body: {
          ...quietMeadowPacket.self.body,
          needs: { ...quietMeadowPacket.self.body.needs, hunger: 1 },
        },
      },
    }
    expect(wakeReasons(cfg, failing, clk(), 600, pln())).toContain('body_alarm')
  })

  it('holds nobody still whose hands are on ordinary work', () => {
    const working = {
      ...quietMeadowPacket,
      self: { ...quietMeadowPacket.self, activity: 'craft' },
    }
    expect(wakeReasons(cfg, working, clk(), 600, pln({ lastResult: 'done' }))).toContain(
      'plan_done',
    )
  })
})

// r37: Dilara, asleep at six energy, was asked at dawn, in the cold and for her plan, and every
// answer stood her up to fall again two hours on.
describe('★ a spent sleeper is asked nothing', () => {
  it('no turn at dawn, cold or hungry while energy is under the line; a rested sleeper is asked as before', () => {
    const cfg = DEFAULT_MIND_CONFIG
    const spent = { ...withNeeds(5, 20, 10) }
    spent.self = { ...spent.self, asleep: true }
    expect(wakeReasons(cfg, spent, clk(), 600, pln())).toEqual([])
    const rested = { ...withNeeds(5, 78, 71) }
    rested.self = { ...rested.self, asleep: true }
    expect(wakeReasons(cfg, rested, clk(), 600, pln())).toEqual(['body_alarm', 'morning'])
  })
})
