import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Bond } from '@sj/shared'
import { BondDetailPanel } from './BondDetailPanel.js'
import { BOND_COLORS } from './bondsModel.js'
import { GAMIFICATION_BAN } from './townStats.js'

const bond: Bond = {
  id: 'alice|bob', aId: 'alice', bId: 'bob', kind: 'partner', strength: 3,
  formedTick: 30, lastUpdatedTick: 1500,
  history: [
    { tick: 30, kind: 'partner', note: 'kept house together' },
    { tick: 900, kind: 'partner', note: 'kept house together' },
    { tick: 1500, kind: 'partner', note: 'kept house together' },
  ],
}

const people = { alice: { name: 'Alice', alive: true }, bob: { name: 'Bob', alive: true } }

const html = renderToStaticMarkup(createElement(BondDetailPanel, {
  bond, people, maxStrength: 6, onClose: () => {},
}))

describe('BondDetailPanel', () => {
  it('says who this is about, in words, at the top', () => {
    expect(html).toContain('Alice — kept house with — Bob')
    expect(html).toContain('Kept house')
  })

  it('draws the bar in the kind’s own colour and measures it against the closest pair', () => {
    expect(html).toContain(BOND_COLORS.partner)
    expect(html).toContain('width:50%')
    expect(html).toContain('aria-label="3 shared moments, out of 6 for the closest pair in town"')
  })

  it('keeps a single shared moment visible rather than collapsing it to nothing', () => {
    const thin = renderToStaticMarkup(createElement(BondDetailPanel, {
      bond: { ...bond, strength: 1, history: [bond.history[0]!] }, people, maxStrength: 40, onClose: () => {},
    }))
    expect(thin).toContain('width:6%')
    expect(thin).toContain('1 shared moment')       // singular, not "1 moments"
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
    expect(html).toContain('aria-label="Alice — kept house with — Bob"')
    expect(html).toContain('aria-label="Close this bond"')
  })

  it('measures a history and never a score', () => {
    expect(html.replace(/[<>][^<>]*[<>]/g, ' ')).not.toMatch(GAMIFICATION_BAN)
  })
})
