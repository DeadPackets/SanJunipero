import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bondFrom, type Bond } from '@sj/shared'
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
