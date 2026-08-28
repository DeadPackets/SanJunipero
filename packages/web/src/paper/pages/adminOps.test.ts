import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createWorldStore } from '../../state/worldStore.js'
import { LawsPage } from './Laws.js'
import {
  ClockView,
  RulingsView,
  SPEED_STOPS,
  SpendView,
  pct,
  usd,
  type CostReport,
} from './AdminOps.js'

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

const COST: CostReport = {
  live: true,
  today: { calls: 40, usd: 0.4123 },
  lifetime: { calls: 900, usd: 7.5412 },
  projection: { usdPerSimDay: 1.64, windowRealMinutes: 15, sampledCalls: 12 },
  byCaller: [
    { caller: 'turn', calls: 700, usd: 5.1 },
    { caller: 'arbiter', calls: 12, usd: 1.2 },
  ],
  byMind: [{ agentId: 'amara', calls: 200, usd: 2.5 }],
  cacheReadShare: 0.62,
  caps: { dailyUsd: 3, lifetimeUsd: 50 },
  stop: { dailyReached: false, lifetimeReached: false },
  alerts: [{ ts: 1, kind: 'spend_projection', detail: 'over the threshold' }],
  answerRate: {
    stated: 214,
    answered: 168,
    abandoned: 40,
    inFlight: 6,
    rate: 168 / 214,
    byVerb: [{ verb: 'build', stated: 30, answered: 22 }],
  },
}

describe('the operator’s clock', () => {
  it('says whether the town is moving, and offers the other word', () => {
    const running = html(
      createElement(ClockView, {
        clock: { paused: false, speed: 1, tick: 1500 },
        onWrite: () => {},
      }),
    )
    expect(running).toContain('>Running<')
    expect(running).toContain('>Pause<')
    expect(running).toContain('Day 1 01:00')

    const stopped = html(
      createElement(ClockView, { clock: { paused: true, speed: 2, tick: 0 }, onWrite: () => {} }),
    )
    expect(stopped).toContain('ops-word stopped')
    expect(stopped).toContain('>Stopped<')
    expect(stopped).toContain('>Resume<')
  })

  it('★ the speed in force is the one key left pressed', () => {
    const at = (speed: number): string =>
      html(
        createElement(ClockView, { clock: { paused: false, speed, tick: 0 }, onWrite: () => {} }),
      )
    for (const stop of SPEED_STOPS) {
      const markup = at(stop)
      expect(markup.match(/aria-pressed="true"/g), `speed ${stop}`).toHaveLength(1)
      expect(markup).toMatch(new RegExp(`aria-pressed="true"[^>]*>${stop}`))
    }
    // A speed the dial has no key for presses none of them rather than lying about one.
    expect(at(3).match(/aria-pressed="true"/g)).toBeNull()
  })
})

describe('the spend dashboard', () => {
  it('★ leads with the answer rate, not with the money', () => {
    const markup = html(createElement(SpendView, { cost: COST }))
    const figure = markup.indexOf('ops-figure')
    expect(figure).toBeGreaterThan(-1)
    expect(markup).toContain('>79%<')
    expect(markup).toContain('of 214 acts begun were finished')
    expect(figure, 'the money must not come first').toBeLessThan(markup.indexOf('Lifetime'))
  })

  it('prints every dollar to the same width, so a column stays a column', () => {
    expect(usd(0.4123)).toBe('$0.4123')
    expect(usd(7)).toBe('$7.0000')
    expect(pct(null)).toBe('—')
    const markup = html(createElement(SpendView, { cost: COST }))
    for (const cell of ['$0.4123', '$7.5412', '$3.0000', '$50.0000']) expect(markup).toContain(cell)
    expect(markup).toContain('>62%<')
  })

  it('a scripted town says it bought nothing, and still reports the motive number', () => {
    const scripted: CostReport = {
      ...COST,
      live: false,
      today: { calls: 0, usd: 0 },
      lifetime: { calls: 0, usd: 0 },
      byCaller: [],
      byMind: [],
      alerts: [],
    }
    const markup = html(createElement(SpendView, { cost: scripted }))
    expect(markup).toContain('This town is scripted')
    expect(markup).not.toContain('By caller')
    expect(markup).toContain('>79%<')
  })
})

describe('the ruling queue', () => {
  it('offers a person both words on every pending rule, and a place to say why', () => {
    const markup = html(
      createElement(RulingsView, {
        pending: [{ id: 1, ruleId: 7, recipeId: 'recipe:weave_rope', tick: 2880 }],
        onDecide: () => {},
      }),
    )
    expect(markup).toContain('recipe:weave_rope')
    expect(markup).toContain('Day 2 00:00')
    expect(markup).toContain('>Keep<')
    expect(markup).toContain('>Revert<')
    expect(markup).toContain('id="ruling-reason"')
  })

  it('an empty queue is not an error', () => {
    const markup = html(createElement(RulingsView, { pending: [], onDecide: () => {} }))
    expect(markup).toContain('Nothing is waiting on a person')
    expect(markup).not.toContain('ruling-reason')
  })
})

describe('★ the whole page is the operator’s, and a viewer without a key sees none of it', () => {
  const page = (operatorToken: string | null): string =>
    html(
      createElement(LawsPage, {
        tab: 'Admin',
        subject: null,
        thing: null,
        momentId: null,
        store: createWorldStore(),
        scene: null,
        operatorToken,
        insideId: null,
        gapTicks: null,
        onSubject: () => {},
        onInside: () => {},
        onJump: () => {},
        onLive: () => {},
        onMoment: () => {},
      }),
    )

  it('offers no control surface at all without a token', () => {
    const shut = page(null)
    for (const word of ['Clock', 'Spend', 'Rulings', 'Download']) expect(shut).not.toContain(word)
  })

  it('mounts all three sections and the export, and says whose page it is', () => {
    const open = page('a-key')
    expect(open).toContain('The operator’s page')
    // Server-rendered, nothing has been read yet: each section says what it is waiting on
    // rather than showing a control surface built on numbers it does not have.
    const waiting = ['its clock', 'Reading the ledger', 'Reading the queue']
    for (const said of waiting) expect(open).toContain(said)
    expect(waiting.map((w) => open.indexOf(w))).toEqual(
      [...waiting.map((w) => open.indexOf(w))].sort((a, b) => a - b),
    )
    expect(open).toContain('Download the whole run')
    expect(open.indexOf('Download'), 'the laws stay last').toBeLessThan(
      open.indexOf('laws-edit-list'),
    )
  })
})
