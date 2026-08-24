import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LENS_LABELS, LensTabsView, StatusStripView } from './StatusStrip.js'
import { LENSES } from './route.js'
import { lensHints, type TownStats } from './townStats.js'

const EMOJI = /\p{Extended_Pictographic}/u
const stats: TownStats = { day: 0, time: '14:30', weather: 'rain', alive: 2, total: 3 }

describe('StatusStripView', () => {
  const html = renderToStaticMarkup(createElement(StatusStripView, { stats }))

  it('shows the day, the clock, the sky and the living count', () => {
    expect(html).toContain('Day 0')
    expect(html).toContain('14:30')
    expect(html).toContain('rain')            // the weather glyph's own word
    expect(html).toContain('Townsfolk')
    expect(html).toContain('remembered')      // one of the three is gone
  })

  it('draws the weather as palette pixels, never as an emoji', () => {
    expect(html).toContain('<svg')
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).toContain('#7FB0C9')         // water blue, a MASTER_PALETTE member
    expect(html).not.toMatch(EMOJI)
  })

  it('labels the strip and keeps the decorative glyph out of the a11y tree', () => {
    expect(html).toContain('aria-label="The town right now"')
    expect(html).toContain('aria-label="Day 0, 14:30"')
    expect(html).toContain('aria-label="2 townsfolk walking"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('says nothing before the town wakes rather than inventing a sky', () => {
    const cold = renderToStaticMarkup(createElement(StatusStripView, {
      stats: { day: 0, time: '00:00', weather: '—', alive: 0, total: 0 },
    }))
    expect(cold).toContain('Day 0')
    expect(cold).not.toContain('remembered')  // nobody has died, so nothing is remembered
    expect(cold).toMatch(/not read yet/)
  })
})

describe('LensTabsView', () => {
  const hints = lensHints(stats, { chronicle: 11 })
  const html = renderToStaticMarkup(createElement(LensTabsView, { lens: 'chronicle', hints, onNav: () => {} }))

  it('renders one labelled tab per lens and marks the current one', () => {
    for (const lens of LENSES) expect(html, lens).toContain(`>${LENS_LABELS[lens]}`)
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('class="tab active"')
  })

  it('carries a hint on every tab, for the pointer and the screen reader alike', () => {
    expect(html).toContain('title="Walk the town"')
    expect(html).toContain('aria-label="Town — Walk the town"')
    expect(html).toContain('aria-label="Townsfolk — 2 walking the town"')
  })

  it('★ and every VISIBLE count is spoken, because the badge itself is aria-hidden', () => {
    // The number is decoration in the tree; the label is the only place it exists for a
    // screen reader. A tab that shows a count and does not say it is a tab whose count only
    // some readers get.
    for (const [, label, badge] of html.matchAll(
      /aria-label="[^—]+— ([^"]*)"[^>]*>[^<]*(?:<span class="tab-count" aria-hidden="true">(\d+)<\/span>)?/g,
    )) {
      if (badge === undefined) continue
      expect(label, `a badge of ${badge} that the label never says`).toContain(badge)
    }
  })

  it('★ and the strip ACTUALLY ASKS for every count it is able to badge', () => {
    // `lensHints` is a pure model and its tests can only prove what it does with a number it
    // is handed. Deleting the fetch that hands it over leaves every model test green and puts
    // the badge back to nothing — a per-element law that cannot see the screen. This is the
    // wiring, named.
    const src = readFileSync(new URL('./StatusStrip.tsx', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export function LensTabs('))
    for (const [lens, url] of [['society', '/api/bonds'], ['chronicle', '/api/chronicle']] as const) {
      expect(body, `${lens} must be badged from ${url}`).toContain(`useHistoryCount('${url}'`)
      expect(body, `${lens} must reach the counts object`).toMatch(new RegExp(`\\b${lens}\\b`))
    }
  })

  it('badges only the lenses that have a real count', () => {
    expect(html).toContain('<span class="tab-count" aria-hidden="true">2</span>')  // 2 alive
    expect(html.match(/tab-count/g)).toHaveLength(2)                                // townsfolk + chronicle
  })

  it('never renders an emoji in the lens bar', () => {
    expect(html).not.toMatch(EMOJI)
  })
})
