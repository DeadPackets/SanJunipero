import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChronicleEntry } from '@sj/shared'
import {
  CHRONICLE_VIEWS, CHRONICLE_VIEW_LABEL, ChronicleViewTabs, EverythingFeedView, ImportantFeedView,
} from './ChroniclePanel.js'
import { EMPTY_COPY, GAMIFICATION_BAN } from './townStats.js'

const EMOJI = /\p{Extended_Pictographic}/u

const entries: ChronicleEntry[] = [
  { seq: 9, tick: 50, type: 'agent_died', icon: 'cross', label: 'Cara has died (hunger).' },
  { seq: 4, tick: 20, type: 'structure_completed', icon: 'house', label: 'The house is finished.' },
]

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

describe('ImportantFeedView', () => {
  const html = render(createElement(ImportantFeedView, { entries, viewTick: null, onJump: () => {} }))

  it('stamps each entry with the day and hour it happened', () => {
    expect(html).toContain('Day 0 00:50')
    expect(html).toContain('Day 0 00:20')
  })

  it('makes every entry a way back to that moment, spoken in full', () => {
    expect(html.match(/class="feed-jump"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Cara has died (hunger). Day 0 00:50. Go to this moment."')
  })

  it('draws the icon as palette pixels, never as an emoji', () => {
    expect(html).toContain('shape-rendering="crispEdges"')
    expect(html).toContain('#43394A')     // the cross, in ink
    expect(html).toContain('#93B573')     // the finished house, in sage
    expect(html).not.toMatch(EMOJI)
  })

  it('keeps the decorative glyph out of what a screen reader says', () => {
    expect(html).toContain('aria-hidden="true"')
  })

  it('marks the entry the viewer is standing in, and only that one', () => {
    const marked = render(createElement(ImportantFeedView, { entries, viewTick: 20, onJump: () => {} }))
    expect(marked.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).not.toContain('aria-current')
  })

  it('says what has not happened yet rather than showing an empty box', () => {
    const empty = render(createElement(ImportantFeedView, { entries: [], viewTick: null, onJump: () => {} }))
    expect(empty).toContain(EMPTY_COPY.chronicle)
  })
})

describe('EverythingFeedView', () => {
  it('keeps the live feed and its empty state', () => {
    const html = render(createElement(EverythingFeedView, {
      lines: [{ key: 0, tick: 90, kind: 'death', text: 'Cara has died (hunger).' }],
    }))
    expect(html).toContain('Day 0 01:30')
    expect(html).toContain('aria-live="polite"')
    expect(render(createElement(EverythingFeedView, { lines: [] }))).toContain(EMPTY_COPY.chronicle)
  })

  // M1: the live feed only holds what arrived since the viewer joined. On a town that is
  // days old, "day one is still unwritten" is a lie about the world, not about the feed.
  it('does not blame day one on a town that is past it', () => {
    const html = render(createElement(EverythingFeedView, { lines: [], tick: 4000 }))
    expect(html).not.toContain(EMPTY_COPY.chronicle)
    expect(html).toContain(EMPTY_COPY.chronicleQuiet)
  })

  it('still says day one is unwritten on a town that is actually on day one', () => {
    expect(render(createElement(EverythingFeedView, { lines: [], tick: 12 }))).toContain(EMPTY_COPY.chronicle)
  })
})

describe('ChronicleViewTabs', () => {
  const html = render(createElement(ChronicleViewTabs, { view: 'important', onView: () => {} }))

  it('offers both readings of the chronicle as real tabs', () => {
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(CHRONICLE_VIEWS.length)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-controls="chronicle-view-important"')
  })

  it('keeps one stop in the tab order, as a tablist must', () => {
    expect(html.match(/tabindex="-1"/g)).toHaveLength(CHRONICLE_VIEWS.length - 1)
  })

  it('speaks of the town, never of a score', () => {
    for (const label of Object.values(CHRONICLE_VIEW_LABEL)) {
      expect(label, label).not.toMatch(GAMIFICATION_BAN)
    }
  })
})
