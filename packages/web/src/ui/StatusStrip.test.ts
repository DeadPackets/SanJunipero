import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LensTabsView, StatusStripView } from './StatusStrip.js'
import { LENSES, LENS_LABELS } from './route.js'
import { countsFromWorld, lensHints, type LensCounts, type TownStats } from './townStats.js'

const EMOJI = /\p{Extended_Pictographic}/u
const stats: TownStats = { day: 0, time: '14:30', weather: 'rain', alive: 2, total: 3 }

describe('StatusStripView', () => {
  const html = renderToStaticMarkup(createElement(StatusStripView, { stats }))

  it('shows the sky and the living count', () => {
    expect(html).toContain('rain') // the weather glyph's own word
    expect(html).toContain('Townsfolk')
    expect(html).toContain('remembered') // one of the three is gone
  })

  // The topbar badge already reads `Now · Day 0 · 14:30` off the same viewed tick. Two cells of
  // the three were a verbatim repeat of the band directly above them.
  it('does not say the clock the topbar badge is already saying', () => {
    expect(html).not.toContain('14:30')
    expect(html).not.toContain('Day 0')
  })

  it('draws the weather as palette pixels, never as an emoji', () => {
    expect(html).toContain('<svg')
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).toContain('#7FB0C9') // water blue, a MASTER_PALETTE member
    expect(html).not.toMatch(EMOJI)
  })

  it('labels the strip and keeps the decorative glyph out of the a11y tree', () => {
    expect(html).toContain('aria-label="The town right now"')
    expect(html).toContain('aria-label="2 townsfolk walking"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('says nothing before the town wakes rather than inventing a sky', () => {
    const cold = renderToStaticMarkup(
      createElement(StatusStripView, {
        stats: { day: 0, time: '00:00', weather: '—', alive: 0, total: 0 },
      }),
    )
    expect(cold).not.toContain('remembered') // nobody has died, so nothing is remembered
    expect(cold).toMatch(/not read yet/)
  })
})

describe('LensTabsView', () => {
  const hints = lensHints(stats)
  const html = renderToStaticMarkup(
    createElement(LensTabsView, { lens: 'chronicle', hints, onNav: () => {} }),
  )
  // The only render in which a lens other than the living carries a badge at all, so it is the
  // one the "speaks its badge" law below has to walk.
  const badged = renderToStaticMarkup(
    createElement(LensTabsView, {
      lens: 'chronicle',
      hints: lensHints(stats, { ...countsFromWorld(stats), chronicle: 11, society: 3 }),
      onNav: () => {},
    }),
  )

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
    // The number is decoration in the tree; the label is the only place it exists for a reader.
    for (const [, label, badge] of badged.matchAll(
      /aria-label="[^—]+— ([^"]*)"[^>]*>[^<]*(?:<span class="tab-count" aria-hidden="true">(\d+)<\/span>)?/g,
    )) {
      if (badge === undefined) continue
      expect(label, `a badge of ${badge} that the label never says`).toContain(badge)
    }
  })

  it('★ and the strip ACTUALLY ASKS for every count it is able to badge', () => {
    // `lensHints` is a pure model, so deleting the fetch that hands it a number leaves every
    // model test green and the badge back at nothing. This is the wiring, named.
    const src = readFileSync(new URL('./StatusStrip.tsx', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export function LensTabs('))
    for (const [lens, url, binding] of [
      ['society', '/api/bonds/count', 'bonds'],
      ['chronicle', '/api/chronicle/count', 'chronicle'],
    ] as const) {
      expect(body, `${lens} must be badged from ${url}`).toMatch(
        new RegExp(`useHistoryCount\\(\\s*'${url}'`),
      )
      expect(body, `${lens} must reach the counts object`).toMatch(new RegExp(`\\b${binding}\\b`))
    }
  })

  /** Pointing the URL at `/count` is only half the fix: a parser still reading `entries` would
   *  answer `null` and the badge would silently go blank, so the shape it parses is named. */
  it('★ counts from the count endpoints, never by downloading the feed', () => {
    const src = readFileSync(new URL('./StatusStrip.tsx', import.meta.url), 'utf8')
    for (const feed of ['/api/chronicle', '/api/bonds']) {
      expect(src, `${feed} must not be fetched whole to find its length`).not.toMatch(
        new RegExp(`useHistoryCount\\(\\s*'${feed}',`),
      )
    }
    // Pointing the URL at /count is only half of it: a parser still reading the array would
    // answer null and the badge would silently go blank. The shape it parses is named.
    expect(src).toContain('ChronicleCountSchema')
    expect(src).toContain('BondsCountSchema')
    expect(src.match(/p\.data\.count/g), 'both badges read the count field').toHaveLength(2)
    for (const feedSchema of ['ChronicleResponseSchema', 'BondsResponseSchema']) {
      expect(src, `${feedSchema} has no business in a badge`).not.toContain(feedSchema)
    }
  })

  it('badges only the lenses that have a real count', () => {
    expect(html).toContain('<span class="tab-count" aria-hidden="true">2</span>') // 2 alive
    // Townsfolk alone, because the living are the only count the viewer holds without asking.
    expect(html.match(/tab-count/g)).toHaveLength(1)
  })

  it('★ shows the chronicle and the bonds once their own endpoints have answered', () => {
    const counts: LensCounts = { ...countsFromWorld(stats), chronicle: 16, society: 2 }
    const withCounts = renderToStaticMarkup(
      createElement(LensTabsView, {
        lens: 'chronicle',
        hints: lensHints(stats, counts),
        onNav: () => {},
      }),
    )
    expect(withCounts).toContain('<span class="tab-count" aria-hidden="true">16</span>')
    expect(withCounts).toContain('<span class="tab-count" aria-hidden="true">2</span>')
    expect(withCounts.match(/tab-count/g)).toHaveLength(3)
  })

  it('never renders an emoji in the lens bar', () => {
    expect(html).not.toMatch(EMOJI)
  })
})
