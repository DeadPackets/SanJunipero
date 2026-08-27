import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChronicleEntry } from '@sj/shared'
import {
  CHRONICLE_VIEWS,
  CHRONICLE_VIEW_LABEL,
  ChronicleViewTabs,
  EverythingFeedView,
  ImportantFeedView,
  PaperFeedView,
  tabFromKey,
} from './ChroniclePanel.js'
import { editions } from './dispatches.js'
import { EMPTY_COPY, GAMIFICATION_BAN } from './townStats.js'

const EMOJI = /\p{Extended_Pictographic}/u
// renderToStaticMarkup drops handlers, so the one thing it cannot show is read from source.
const SRC = readFileSync(new URL('./ChroniclePanel.tsx', import.meta.url), 'utf8')

const entries: ChronicleEntry[] = [
  { seq: 9, tick: 50, type: 'agent_died', icon: 'cross', label: 'Cara has died (hunger).' },
  { seq: 4, tick: 20, type: 'structure_completed', icon: 'house', label: 'The house is finished.' },
]

const render = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(node)

describe('ImportantFeedView', () => {
  const html = render(
    createElement(ImportantFeedView, { entries, viewTick: null, onJump: () => {} }),
  )

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
    expect(html).toContain('#43394A') // the cross, in ink
    expect(html).toContain('#93B573') // the finished house, in sage
    expect(html).not.toMatch(EMOJI)
  })

  it('keeps the decorative glyph out of what a screen reader says', () => {
    expect(html).toContain('aria-hidden="true"')
  })

  it('marks the entry the viewer is standing in, and only that one', () => {
    const marked = render(
      createElement(ImportantFeedView, { entries, viewTick: 20, onJump: () => {} }),
    )
    expect(marked.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).not.toContain('aria-current')
  })

  it('says what has not happened yet rather than showing an empty box', () => {
    const empty = render(
      createElement(ImportantFeedView, { entries: [], viewTick: null, onJump: () => {} }),
    )
    expect(empty).toContain(EMPTY_COPY.chronicle)
  })
})

describe('EverythingFeedView', () => {
  it('keeps the live feed and its empty state', () => {
    const html = render(
      createElement(EverythingFeedView, {
        lines: [{ key: 0, tick: 90, kind: 'death', text: 'Cara has died (hunger).' }],
      }),
    )
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
    expect(render(createElement(EverythingFeedView, { lines: [], tick: 12 }))).toContain(
      EMPTY_COPY.chronicle,
    )
  })

  // The store's ring splices its front once it is at cap, shifting every surviving index: keyed
  // on the index, every surviving row's identity changes on the wrap.
  it('keys each row on the event seq, which the ring never renumbers', () => {
    expect(SRC).toContain('key: ev.seq')
    expect(SRC, 'the ring index is not an identity').not.toContain('key: i,')
  })
})

describe('ChronicleViewTabs', () => {
  const html = render(createElement(ChronicleViewTabs, { view: 'important', onView: () => {} }))

  it('offers every reading of the chronicle as a real tab', () => {
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

  // A roving tabindex without a walk is a tab nothing can reach: 'Everything' was pointer-only.
  it('walks the tablist with the arrows, so every other reading is reachable', () => {
    expect(SRC, 'the tablist has no keyboard handler').toMatch(
      /role="tablist"[\s\S]{0,120}onKeyDown=\{onKeyDown\}/,
    )
    // the whole ring, both ways, wrapping at each end
    CHRONICLE_VIEWS.forEach((v, i) => {
      expect(tabFromKey('ArrowRight', v), v).toBe(CHRONICLE_VIEWS[(i + 1) % CHRONICLE_VIEWS.length])
      expect(tabFromKey('ArrowLeft', v), v).toBe(
        CHRONICLE_VIEWS[(i - 1 + CHRONICLE_VIEWS.length) % CHRONICLE_VIEWS.length],
      )
    })
  })

  it('jumps to the ends with Home and End', () => {
    expect(tabFromKey('Home', 'everything')).toBe(CHRONICLE_VIEWS[0])
    expect(tabFromKey('End', 'important')).toBe(CHRONICLE_VIEWS[CHRONICLE_VIEWS.length - 1])
  })

  it('leaves every other key alone', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'a', 'Escape']) {
      expect(tabFromKey(key, 'important'), key).toBeNull()
    }
  })
})

describe('PaperFeedView', () => {
  const days = editions({
    papers: [
      { day: 0, title: 'They woke', body: 'The first morning.' },
      { day: 6, title: 'The well ran dry', body: 'Nobody drank.' },
    ],
    captions: [{ day: 6, caption: 'Day 6: The well ran dry' }],
    biographies: [],
    eras: [{ startDay: 0, endDay: 6, title: 'The First Week', text: 'Seven days.' }],
    institutions: [
      { day: 6, kind: 'group', name: 'the morning watch', description: 'They rose together.' },
    ],
    heat: [{ day: 6, total: 8 }],
  })
  const html = render(createElement(PaperFeedView, { days }))

  it('prints the prose, not an index of titles', () => {
    expect(html).toContain('Nobody drank.')
    expect(html).toContain('The first morning.')
  })

  it('leads each edition with its day and what the day felt like', () => {
    expect(html).toContain('Day 6')
    expect(html).toContain('a loud day')
  })

  it('bands the week over the day that closed it, and over no other', () => {
    expect(html.match(/class="era-band"/g)).toHaveLength(1)
    expect(html).toContain('The First Week')
  })

  it('names what the town formed, and what the day was captioned', () => {
    expect(html).toContain('the morning watch')
    expect(html).toContain('Day 6: The well ran dry')
  })

  it('says the record is empty rather than that a paper is coming', () => {
    const empty = render(createElement(PaperFeedView, { days: [] }))
    expect(empty).toContain(EMPTY_COPY.paper)
    expect(EMPTY_COPY.paper).not.toMatch(GAMIFICATION_BAN)
  })

  it('waits visibly rather than claiming nothing was printed', () => {
    const loading = render(createElement(PaperFeedView, { days: [], loading: true }))
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain(EMPTY_COPY.paper)
  })
})
