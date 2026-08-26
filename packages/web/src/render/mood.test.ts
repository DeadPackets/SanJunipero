import { describe, expect, it } from 'vitest'
import type { AssetRecord, SimEvent } from '@sj/shared'
import {
  EXPRESSIONS,
  MOOD_COMFORT,
  MOOD_ENERGY_WEARY,
  MOOD_PRIORITY,
  MOOD_WINDOW_TICKS,
  moodOf,
  portraitKind,
  portraitUrl,
  type Expression,
  type MoodView,
} from './mood.js'

const NOW = 1000

const body = (over: Partial<MoodView> = {}): MoodView => ({
  id: 'amara',
  alive: true,
  asleep: false,
  ill: false,
  injuries: [],
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  collapsedSinceTick: null,
  ...over,
})

const ev = (type: string, payload: Record<string, unknown>, tick = NOW - 10): SimEvent =>
  ({ seq: 1, tick, type, payload }) as SimEvent

const rec = (id: string, kind: string): AssetRecord => ({
  id,
  seq: 1,
  class: 'portrait',
  desc: kind,
  kind,
  footprint: { w: 1, h: 1 },
  widthPx: 128,
  heightPx: 128,
  status: 'ready',
  score: null,
  attempts: 1,
  costUsd: 0,
  createdAt: 'now',
  meta: null,
})

describe('moodOf — each row of the table fires exactly once', () => {
  const cases: Array<[Expression, MoodView, SimEvent[]]> = [
    ['asleep', body({ asleep: true }), []],
    ['angry', body(), [ev('agent_attacked', { targetId: 'amara' })]],
    ['sad', body(), [ev('agent_died', { id: 'amara' })]],
    ['surprised', body(), [ev('mystery_event', { agentId: 'amara' })]],
    [
      'weary',
      body({ needs: { hunger: 80, energy: MOOD_ENERGY_WEARY - 1, warmth: 80, social: 80 } }),
      [],
    ],
    ['happy', body(), [ev('item_given', { targetId: 'amara' })]],
    ['neutral', body(), []],
  ]

  it('lands on each expression from its own fixture', () => {
    for (const [want, a, evts] of cases) expect(moodOf(a, evts, NOW), want).toBe(want)
    expect(new Set(cases.map((c) => c[0])).size).toBe(EXPRESSIONS.length)
  })

  it('the priority array covers the union exactly, and is the only order', () => {
    expect([...MOOD_PRIORITY].sort()).toEqual([...EXPRESSIONS].sort())
  })
})

describe('moodOf — priority, asserted directly', () => {
  it('a sleeper who was attacked this hour is asleep', () => {
    expect(moodOf(body({ asleep: true }), [ev('agent_attacked', { targetId: 'amara' })], NOW)).toBe(
      'asleep',
    )
  })

  it('angry beats sad, and sad beats surprised', () => {
    const both = [ev('agent_attacked', { targetId: 'amara' }), ev('agent_died', { id: 'amara' })]
    expect(moodOf(body(), both, NOW)).toBe('angry')
    expect(
      moodOf(
        body(),
        [ev('agent_died', { id: 'amara' }), ev('world_grown', { agentId: 'amara' })],
        NOW,
      ),
    ).toBe('sad')
  })

  it('weary beats happy — a tired person with good news is still tired', () => {
    const tired = body({
      needs: { hunger: 90, energy: MOOD_ENERGY_WEARY - 1, warmth: 90, social: 90 },
    })
    expect(moodOf(tired, [ev('item_given', { targetId: 'amara' })], NOW)).toBe('weary')
  })

  it('an injury or an illness is weariness even at full energy', () => {
    expect(moodOf(body({ ill: true }), [], NOW)).toBe('weary')
    expect(moodOf(body({ injuries: [{ kind: 'minor', day: 1 }] }), [], NOW)).toBe('weary')
    expect(moodOf(body({ collapsedSinceTick: 900 }), [], NOW)).toBe('weary')
  })

  it('happy needs BOTH comfort and something good — neither alone is enough', () => {
    expect(moodOf(body(), [], NOW)).toBe('neutral')
    const pinched = body({ needs: { hunger: MOOD_COMFORT, energy: 90, warmth: 90, social: 90 } })
    expect(moodOf(pinched, [ev('item_given', { targetId: 'amara' })], NOW)).toBe('neutral')
  })
})

describe('moodOf — the window, and whose feeling it is', () => {
  it('an event one tick past the window no longer counts', () => {
    const inside = ev('agent_attacked', { targetId: 'amara' }, NOW - MOOD_WINDOW_TICKS)
    const outside = ev('agent_attacked', { targetId: 'amara' }, NOW - MOOD_WINDOW_TICKS - 1)
    expect(moodOf(body(), [inside], NOW)).toBe('angry')
    expect(moodOf(body(), [outside], NOW)).toBe('neutral')
  })

  it('somebody else’s fight is not this person’s mood', () => {
    expect(
      moodOf(body(), [ev('agent_attacked', { targetId: 'yusuf', agentId: 'omar' })], NOW),
    ).toBe('neutral')
  })

  it('a world with no C11 fields present is simply neutral', () => {
    expect(moodOf(body(), [], NOW)).toBe('neutral')
  })

  it('is pure — the same inputs twice give the same face', () => {
    const evts = [ev('agent_died', { id: 'amara' })]
    expect(moodOf(body(), evts, NOW)).toBe(moodOf(body(), evts, NOW))
  })
})

describe('portraitKind / portraitUrl', () => {
  it('is one spelling, and it is the one the ingest writes', () => {
    expect(portraitKind('amara', 'happy')).toBe('portrait:amara:happy')
    for (const e of EXPRESSIONS) expect(portraitKind('a', e)).toBe(`portrait:a:${e}`)
  })

  it('prefers the expression, falls back to neutral, then to null', () => {
    const both = [
      rec('p1', portraitKind('amara', 'happy')),
      rec('p2', portraitKind('amara', 'neutral')),
    ]
    expect(portraitUrl(both, 'amara', 'happy')).toBe('/assets/p1.png')
    expect(portraitUrl([both[1]!], 'amara', 'happy')).toBe('/assets/p2.png')
    expect(portraitUrl([], 'amara', 'happy')).toBeNull()
    // never a broken image, and never the wrong person's face
    expect(portraitUrl(both, 'yusuf', 'happy')).toBeNull()
  })

  it('a neutral request never silently resolves some other expression', () => {
    expect(portraitUrl([rec('p1', portraitKind('amara', 'sad'))], 'amara', 'neutral')).toBeNull()
  })
})
