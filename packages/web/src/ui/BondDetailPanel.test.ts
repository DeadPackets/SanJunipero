import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BOND_RECENT_ACTS, bondFrom, type Bond } from '@sj/shared'
import { BondDetailPanel } from './BondDetailPanel.js'
import { bondArc } from './bondModel2.js'
import { GAMIFICATION_BAN } from './townStats.js'

const bond: Bond = bondFrom('alice', 'bob', [
  { tick: 30, kind: 'partner' },
  { tick: 900, kind: 'partner' },
  { tick: 1500, kind: 'partner' },
], 1500)

const people = { alice: { name: 'Alice', alive: true }, bob: { name: 'Bob', alive: true } }
const arc = bondArc(bond, 1500)

const html = renderToStaticMarkup(createElement(BondDetailPanel, {
  bond, people, type: 'partner' as const, level: 'friendly' as const, arc,
  words: 'Alice and Bob are partners, and they are friends.',
  onClose: () => {},
}))

describe('BondDetailPanel — the landed assertions, carried across the redraw', () => {
  it('says who this is about, in words, at the top', () => {
    expect(html).toContain('Alice')
    expect(html).toContain('Bob')
    expect(html).toContain('Partners')
  })

  it('dates the first and the last of it', () => {
    expect(html).toContain('Day 0 00:30')
    expect(html).toContain('Day 1 01:00')
  })

  it('tells the history newest first, as a sentence about them', () => {
    const list = html.slice(html.indexOf('bond-history'))
    expect(list.indexOf('Day 1 01:00')).toBeLessThan(list.indexOf('Day 0 00:30'))
    expect(html).toContain('They kept house together.')
  })

  it('is a labelled dialog with a way out', () => {
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Alice and Bob are partners, and they are friends."')
    expect(html).toContain('aria-label="Close this bond"')
  })

  it('measures a history and never a score', () => {
    expect(html.replace(/[<>][^<>]*[<>]/g, ' ')).not.toMatch(GAMIFICATION_BAN)
  })
})

// THE THREE ENCODINGS THE REDRAW RETIRED. Each of these was in the landed panel and each is a
// claim the new model can make better — so each is pinned as a thing that must not come back.
describe('what the redraw took OUT', () => {
  it('★ the filled strength bar is gone — a relationship is not a meter with a leader', () => {
    expect(html).not.toContain('bond-bar')
    expect(html).not.toMatch(/width:\s*\d+%/)
  })

  it('the "out of N for the closest pair in town" ranking is gone', () => {
    expect(html).not.toMatch(/out of \d+/)
    expect(html).not.toContain('closest pair')
  })

  it('the unsigned "N shared moments" count is gone — it could only ever go up', () => {
    expect(html).not.toMatch(/shared moments?/)
  })
})

/**
 * ★ A PANEL THAT IS HANDED A WINDOW MUST NOT READ AS IF IT WERE HANDED EVERYTHING.
 *
 * The feed used to carry every act that ever formed the tie — 83 704 521 B at sim-day 20 of a
 * talkative town, and a list of two hundred thousand identical sentences that no browser was
 * going to render and no person was going to read. It is now the last `BOND_RECENT_ACTS` of it,
 * so the panel has to SAY that: a tally of the whole history above the column, and a line under
 * it naming how many acts are counted rather than listed.
 *
 * This is the "silently blank" failure from the badge, one panel over — a reader shown a short
 * list with nothing telling it the list is short.
 */
describe('★ the panel says what the window cannot', () => {
  const long: Bond = bondFrom('alice', 'bob', [
    ...Array.from({ length: 300 }, (_, i) => ({ tick: 100 + i * 10, kind: 'friend' as const })),
    { tick: 50, kind: 'partner' as const },
  ], 4000)
  const deep = renderToStaticMarkup(createElement(BondDetailPanel, {
    bond: long, people, type: 'partner' as const, level: 'friendly' as const,
    arc: bondArc(long, 4000), words: 'Alice and Bob are partners.', onClose: () => {},
  }))

  it('lists the window and counts the whole history', () => {
    expect(long.strength).toBe(301)
    expect(long.recent).toHaveLength(BOND_RECENT_ACTS)
    // the tally is over ALL of it, including the one act too old to be in the window
    expect(deep).toContain('300×')
    expect(deep).toContain('They spoke together, first on Day 0.')
    expect(deep).toContain('1×')
    expect(deep).toContain('They kept house together, first on Day 0.')
  })

  it('names the acts it is not listing, rather than looking complete', () => {
    expect(deep).toContain(`${301 - BOND_RECENT_ACTS} earlier times are counted above.`)
  })

  it('a bond that fits inside its window says nothing about earlier times', () => {
    expect(html).not.toContain('earlier times')
    expect(html).not.toContain('earlier time is')
  })

  it('is still a history and never a score', () => {
    expect(deep.replace(/[<>][^<>]*[<>]/g, ' ')).not.toMatch(GAMIFICATION_BAN)
  })
})
