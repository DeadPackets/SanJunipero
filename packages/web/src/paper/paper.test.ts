import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createWorldStore } from '../state/worldStore.js'
import { PageBoundary } from './PageBoundary.js'
import { Paper } from './Paper.js'
import { Signpost } from './Signpost.js'
import { households } from './families.js'
import {
  ARMS,
  GRIP_CLOSE_PX,
  PAGE_TABS,
  PAGE_TITLE,
  firstTab,
  hasTab,
  tabFromKey,
  type PageKey,
} from './pageModel.js'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')
const PAGES = Object.keys(PAGE_TABS) as PageKey[]

const paper = (over: Partial<Parameters<typeof Paper>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(Paper, {
      page: null,
      tab: '',
      subject: null,
      thing: null,
      momentId: null,
      store: createWorldStore(),
      scene: null,
      operatorToken: null,
      insideId: null,
      gapTicks: null,
      onTab: () => {},
      onClose: () => {},
      onSubject: () => {},
      onInside: () => {},
      onJump: () => {},
      onLive: () => {},
      onMoment: () => {},
      ...over,
    }),
  )

// ── the signpost ───────────────────────────────────────────────────────────────────────────

describe('the signpost', () => {
  const post = (open: PageKey | null): string =>
    renderToStaticMarkup(createElement(Signpost, { open, onOpen: () => {} }))

  it('hangs four arms, in the order the direction picked', () => {
    expect([...ARMS]).toEqual(['folk', 'chronicle', 'found', 'laws'])
    const html = post(null)
    expect([...html.matchAll(/data-arm="([a-z]+)"/g)].map((m) => m[1])).toEqual([...ARMS])
    for (const arm of ARMS) expect(html).toContain(`>${PAGE_TITLE[arm]}<`)
  })

  it('★ says which arm is pressed, and only that one', () => {
    const html = post('found')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-arm="found"[^>]*aria-pressed="true"/)
    expect(post(null).match(/aria-pressed="true"/g)).toBeNull()
  })

  // A person's page opens from the ring, not from an arm: no arm may read as pressed for it.
  it('leaves every arm unpressed while the paper is on a subject page', () => {
    expect(post('person').match(/aria-pressed="true"/g)).toBeNull()
    expect(post('building').match(/aria-pressed="true"/g)).toBeNull()
  })

  it('names itself for a screen reader and puts the post under the arms', () => {
    expect(post(null)).toContain('aria-label="Signpost"')
    expect(post(null)).toContain('class="signpost-post"')
  })
})

// ── the page table ─────────────────────────────────────────────────────────────────────────

describe('the pages the paper can carry', () => {
  it('gives every page at least two tabs, and a title', () => {
    for (const page of PAGES) {
      expect(PAGE_TABS[page].length, page).toBeGreaterThanOrEqual(2)
      expect(PAGE_TITLE[page].length, page).toBeGreaterThan(0)
    }
  })

  it('opens on its first tab', () => {
    for (const page of PAGES) {
      expect(firstTab(page)).toBe(PAGE_TABS[page][0])
      expect(hasTab(page, firstTab(page))).toBe(true)
      expect(hasTab(page, 'Nothing')).toBe(false)
    }
  })

  it('walks the tabs with the arrows, wrapping at both ends', () => {
    for (const page of PAGES) {
      const tabs = PAGE_TABS[page] as readonly string[]
      expect(tabFromKey(page, 'ArrowRight', tabs[0]!)).toBe(tabs[1])
      expect(tabFromKey(page, 'ArrowRight', tabs.at(-1)!)).toBe(tabs[0])
      expect(tabFromKey(page, 'ArrowLeft', tabs[0]!)).toBe(tabs.at(-1))
      expect(tabFromKey(page, 'Home', tabs.at(-1)!)).toBe(tabs[0])
      expect(tabFromKey(page, 'End', tabs[0]!)).toBe(tabs.at(-1))
    }
  })

  it('owns no key it was not given', () => {
    for (const key of ['a', 'Enter', ' ', 'ArrowUp', 'Escape', 'Tab'])
      expect(tabFromKey('folk', key, 'People'), key).toBeNull()
  })
})

// ── the paper ──────────────────────────────────────────────────────────────────────────────

describe('the paper', () => {
  it('is a NON-modal dialog: the town keeps living above it', () => {
    const html = paper({ page: 'laws', tab: 'World' })
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="false"')
    expect(html).toContain('aria-labelledby="paper-title"')
  })

  it('★ is hidden from the accessibility tree while it is down, and only while it is down', () => {
    expect(paper()).toMatch(/class="paper"[^>]*aria-hidden="true"/)
    expect(paper({ page: 'folk', tab: 'People' })).toMatch(
      /class="paper"[^>]*data-open="yes"[^>]*aria-hidden="false"/,
    )
  })

  it('★ is out of the keyboard’s reach while it is down, not merely out of the pointer’s', () => {
    // The tabs and the close word stay in the tree for the 300ms slide out, so the sheet keeps
    // two focusable controls. `aria-hidden` left both reachable; `inert` is what takes them out.
    const shut = paper()
    expect(shut).toMatch(/<section class="paper"[^>]*inert=""/)
    expect(shut).toContain('tabindex="0"')
    expect(paper({ page: 'folk', tab: 'People' })).not.toMatch(/<section class="paper"[^>]*inert/)
  })

  it('renders no page body while it is down — a shut sheet reads nothing off the town', () => {
    expect(paper()).not.toContain('class="roster"')
    expect(paper()).not.toContain('skeleton-row')
  })

  it('carries a tablist with ONE tab stop, walked by the arrows', () => {
    const html = paper({ page: 'chronicle', tab: 'Chapters' })
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(PAGE_TABS.chronicle.length)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).toMatch(/id="paper-tab-Chapters"[^>]*aria-selected="true"/)
  })

  it('falls back to the first tab when handed one the page does not have', () => {
    const html = paper({ page: 'found', tab: 'Chapters' })
    expect(html).toMatch(/id="paper-tab-Things"[^>]*aria-selected="true"/)
  })

  it('names the subject rather than the page on a person’s own sheet', () => {
    const html = paper({
      page: 'person',
      tab: 'Story',
      subject: { id: 'amara', kind: 'agent', name: 'Amara' },
    })
    expect(html).toContain('>Amara<')
  })

  it('offers the way out in words, and a grip to pull it down by', () => {
    const html = paper({ page: 'folk', tab: 'People' })
    expect(html).toContain('close · Esc')
    expect(html).toContain('class="paper-grip"')
  })

  it('hangs the dim over the town as a sibling, opening with the sheet', () => {
    expect(paper()).toMatch(/class="town-dim" data-open="no"/)
    expect(paper({ page: 'laws', tab: 'World' })).toMatch(/class="town-dim" data-open="yes"/)
  })
})

// ANTI-DRIFT. The table names the tabs; every page then picks its body by string. Rename a tab
// in the table and the page renders its fallback forever, with no type error to catch it — so
// the sheet is rendered on every tab of every page and the bodies must differ.
describe('★ every tab of every arm reaches its own body', () => {
  // The two subject pages are not here: with nobody picked they correctly render one empty
  // state on every tab. `becoming.test.ts` renders their bodies directly instead.
  it('renders something different on each', () => {
    for (const page of ARMS) {
      const seen = new Map<string, string>()
      for (const tab of PAGE_TABS[page] as readonly string[]) {
        const html = paper({ page, tab })
        const body = html.slice(html.indexOf('id="paper-sheet"'))
        const twin = [...seen].find(([, m]) => m === body)?.[0]
        expect(twin, `${page}: ${tab} renders the same body as ${twin}`).toBeUndefined()
        seen.set(tab, body)
      }
    }
  })
})

// The four ways down and the two focus moves are effects: no DOM runs in this suite, so they are
// pinned where they are written instead of left unasserted.
describe('★ every way the paper goes down, and where focus lands', () => {
  const code = src('./Paper.tsx')

  it('leaves Escape to the one ladder in App rather than listening itself', () => {
    expect(code).not.toContain('Escape')
    expect(code).not.toContain("addEventListener('keydown'")
  })

  it('closes on the close word and on a click on the town', () => {
    expect(code).toMatch(/className="town-dim"[\s\S]{0,120}onClick=\{onClose\}/)
    expect(code).toMatch(/className="paper-close" onClick=\{onClose\}/)
  })

  it(`closes on a grip drag of more than ${GRIP_CLOSE_PX}px, and not on a shorter one`, () => {
    expect(GRIP_CLOSE_PX).toBe(40)
    expect(code).toMatch(/e\.clientY - from > GRIP_CLOSE_PX\) onClose\(\)/)
  })

  it('moves focus to the first tab on the way up, and back to the opener on the way down', () => {
    expect(code).toMatch(/const opener = document\.activeElement/)
    expect(code).toMatch(
      /tabsRef\.current\?\.querySelector<HTMLButtonElement>\('button'\)\?\.focus\(\)/,
    )
    expect(code).toMatch(/opener\?\.focus\(\)/)
  })
})

// ── no page may blank the town ─────────────────────────────────────────────────────────────

// `renderToStaticMarkup` rethrows rather than catching, so the two branches are asked of the
// class's own `render` instead of being triggered by a throwing child.
describe('★ a page that throws costs the viewer the page, not the town', () => {
  const body = createElement('p', null, 'the roster')

  it('hands back its children until one of them throws, then a line about it', () => {
    const boundary = new PageBoundary({ children: body })
    expect(boundary.render()).toBe(body)
    boundary.state = PageBoundary.getDerivedStateFromError()
    expect(renderToStaticMarkup(boundary.render())).toContain('This page could not be read')
  })

  it('wraps the page body, keyed by the page so a tab switch keeps its feeds', () => {
    expect(src('./Paper.tsx')).toContain('<PageBoundary key={key}>')
  })

  it('says whatever the surface it guards asks it to say', () => {
    const boundary = new PageBoundary({
      children: body,
      fallback: createElement('p', null, 'gone'),
    })
    boundary.state = PageBoundary.getDerivedStateFromError()
    expect(renderToStaticMarkup(boundary.render())).toBe('<p>gone</p>')
  })

  // The canvas is inside the tree, so nothing can keep it up through an uncaught render. What
  // the root net owes the viewer is one line of the town's own voice and the way back.
  it('★ nets the whole tree at the root, in the town’s own words', () => {
    const main = src('../main.tsx')
    expect(main).toMatch(/<PageBoundary[\s\S]*<App \/>[\s\S]*<\/PageBoundary>/)
    expect(main).toContain('className="town-lost"')
    expect(main).toMatch(/Reload the page/)
  })
})

// ── the pasted link ────────────────────────────────────────────────────────────────────────

// Ruling 18. `route.test.ts` owns the parse and `worldStore.test.ts` owns the latch the landing
// waits on; what is left is one wiring seam inside an effect, pinned where it is written.
describe('★ a pasted /agent/:id link lands on the person it names', () => {
  const app = src('../App.tsx')

  it('opens their story and pins the camera, once the world can be asked', () => {
    expect(app).toContain("setSheet({ page: 'person', tab: 'Story' })")
    expect(app).toContain('setFollowing(linked)')
    expect(app).toContain('onFirstSnapshot(store, () => {')
  })

  it('holds the ring to one owner, so no id rings a person the town does not have', () => {
    expect(app.match(/setSubject\(\{ id: agentId/g)).toHaveLength(1)
    expect(app).toContain('if (name !== undefined) setSubject(')
  })
})

// ── who came from whom ─────────────────────────────────────────────────────────────────────

describe('households', () => {
  it('gathers the children of one pair into one home, oldest first', () => {
    const homes = households({
      parentOf: [
        { parentId: 'omar', childId: 'mira', tick: 900 },
        { parentId: 'amara', childId: 'mira', tick: 900 },
        { parentId: 'omar', childId: 'yusuf', tick: 400 },
        { parentId: 'amara', childId: 'yusuf', tick: 400 },
      ],
    })
    expect(homes).toHaveLength(1)
    expect(homes[0]!.parents).toEqual(['amara', 'omar'])
    expect(homes[0]!.children.map((c) => c.id)).toEqual(['yusuf', 'mira'])
  })

  it('keeps two different pairs apart, and puts the older home first', () => {
    const homes = households({
      parentOf: [
        { parentId: 'a', childId: 'c1', tick: 50 },
        { parentId: 'b', childId: 'c2', tick: 10 },
      ],
    })
    expect(homes.map((h) => h.parents)).toEqual([['b'], ['a']])
  })

  it('answers a childless town with nothing at all', () => {
    expect(households({ parentOf: [] })).toEqual([])
  })
})
