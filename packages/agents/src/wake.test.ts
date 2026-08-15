import { describe, expect, it } from 'vitest'
import type { PerceptionPacket } from './prompt/prose.js'
import { quietMeadowPacket, conversationPacket } from './testutil/fixtures.js'
import { decideWake, DEFAULT_MIND_CONFIG, type MindClock, type PlanState, type WakeReason } from './wake.js'

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
  return { lastTurnTick: 0, reconsiderAtTick: null, conversationUntilTick: 0, prevNeeds: null, prevVisibleIds: [], ...overrides }
}

function pln(overrides: Partial<PlanState> = {}): PlanState {
  return { queue: [], lastResult: 'idle', ...overrides }
}

describe('decideWake — one case per reason', () => {
  const cases: Array<[string, PerceptionPacket, MindClock, number, PlanState, WakeReason | null]> = [
    ['body_alarm', withNeeds(24, 78, 71), clk(), 10, pln(), 'body_alarm'],
    ['salient_perception (heard speech)', conversationPacket, clk(), 10, pln(), 'salient_perception'],
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

  it('ignores boredom while asleep', () => {
    expect(decideWake(cfg, asleep(), clk(), 130, pln())).toBe(null)
  })

  it('wakes on you_were_attacked', () => {
    expect(decideWake(cfg, asleep(['you_were_attacked']), clk(), 10, pln())).toBe('salient_perception')
  })

  it('wakes on fire-prefixed felt events', () => {
    expect(decideWake(cfg, asleep(['fire_started']), clk(), 10, pln())).toBe('salient_perception')
  })

  it('ignores non-salient felt events', () => {
    expect(decideWake(cfg, asleep(['rain_started']), clk(), 10, pln())).toBe(null)
  })

  it('wakes on body_alarm while asleep', () => {
    const packet = {
      ...asleep(),
      self: { ...asleep().self, body: { ...quietMeadowPacket.self.body, needs: { ...quietMeadowPacket.self.body.needs, energy: 10 } } },
    }
    expect(decideWake(cfg, packet, clk(), 10, pln())).toBe('body_alarm')
  })
})

describe('decideWake — hysteresis', () => {
  it('body_alarm is edge-triggered and re-arms only past threshold + hysteresis', () => {
    let prevNeeds: MindClock['prevNeeds'] = null
    const run = (hunger: number, tick: number): WakeReason | null =>
      decideWake(cfg, withNeeds(hunger, 78, 71), clk({ prevNeeds }), tick, pln())

    expect(run(24, 10)).toBe('body_alarm')
    prevNeeds = { hunger: 24, energy: 78, warmth: 71 }

    expect(run(24, 11)).toBe(null)
    prevNeeds = { hunger: 24, energy: 78, warmth: 71 }

    // 36 > 25 + 10: climbs past the re-arm point, but healthy → no wake.
    expect(run(36, 12)).toBe(null)
    prevNeeds = { hunger: 36, energy: 78, warmth: 71 }

    expect(run(24, 13)).toBe('body_alarm')
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
