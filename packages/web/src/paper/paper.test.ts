// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, Fragment, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createWorldStore } from '../state/worldStore.js'
import { PageBoundary } from './PageBoundary.js'
import { Paper } from './Paper.js'
import { Signpost } from './Signpost.js'
import { HelpButton } from '../stage/HelpButton.js'
import { KEY_MAP_ID, KEY_MAP_KEY, KeyMap } from '../stage/KeyMap.js'
import { households } from './families.js'
import {
  ARMS,
  GRIP_CLOSE_PX,
  GRIP_FLING_PX_MS,
  gripDismiss,
  PAGE_TABS,
  PAGE_TITLE,
  firstTab,
  hasTab,
  tabFromKey,
  type PageKey,
} from './pageModel.js'

import { stamp } from './stamp.js'

// happy-dom's own `URL` resolves a bare path against localhost, so a file read has to be a path.
const src = (rel: string): string => readFileSync(join(import.meta.dirname, rel), 'utf8')
const PAGES = Object.keys(PAGE_TABS) as PageKey[]

/** The masthead and the section rule, without the page body a page may date honestly. */
const headOf = (html: string): string => html.slice(0, html.indexOf('</header>'))
const dated = (when: ReturnType<typeof stamp>): string[] => [
  when.time,
  `DAY ${when.day}`,
  when.weekday,
  when.season,
]

const sheetOf = (over: Partial<Parameters<typeof Paper>[0]> = {}): ReactElement =>
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
    dock: 'sheet',
    onTab: () => {},
    onDock: () => {},
    onClose: () => {},
    onSubject: () => {},
    onInside: () => {},
    onScrub: () => {},
    onPlay: () => {},
    onLive: () => {},
    onMoment: () => {},
    ...over,
  })

const paper = (over: Partial<Parameters<typeof Paper>[0]> = {}): string =>
  renderToStaticMarkup(sheetOf(over))

const roots: { unmount: () => void }[] = []
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.stubGlobal('fetch', () => Promise.reject(new Error('no gateway in a test')))

type Live = {
  host: HTMLElement
  again: (over?: Partial<Parameters<typeof Paper>[0]>) => Promise<void>
  el: (sel: string) => HTMLElement | null
}

/** The sheet on a real DOM, with its own re-render, so an effect can be watched happening. */
async function live(over: Partial<Parameters<typeof Paper>[0]> = {}): Promise<Live> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(sheetOf(over))
  })
  return {
    host,
    again: async (next = {}) => {
      await act(async () => {
        root.render(sheetOf({ ...over, ...next }))
      })
    },
    el: (sel: string): HTMLElement | null => host.querySelector<HTMLElement>(sel),
  }
}

/** happy-dom has no PointerEvent, and React reads `clientY`, `pointerId` and `timeStamp` off
 *  whatever native event arrives under the name. */
function pointer(el: Element, type: string, clientY: number, at = 0): void {
  const ev = new MouseEvent(type, { clientY, bubbles: true }) as MouseEvent & {
    pointerId: number
  }
  Object.defineProperty(ev, 'pointerId', { value: 1 })
  Object.defineProperty(ev, 'timeStamp', { value: at })
  el.dispatchEvent(ev)
}

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

describe('the signpost', () => {
  const post = (open: PageKey | null): string =>
    renderToStaticMarkup(
      createElement(Signpost, { open, onOpen: () => {}, store: createWorldStore(), stories: null }),
    )

  it('hangs four arms, in the order the direction picked', () => {
    expect([...ARMS]).toEqual(['folk', 'chronicle', 'found', 'laws'])
    const html = post(null)
    expect([...html.matchAll(/data-arm="([a-z]+)"/g)].map((m) => m[1])).toEqual([...ARMS])
    for (const arm of ARMS) expect(html).toContain(`>${PAGE_TITLE[arm]}<`)
  })

  // Four arms opening one sheet on four pages is a disclosure set, not four toggles.
  it('★ says which arm is open, and only that one', () => {
    const html = post('found')
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1)
    expect(html).toMatch(/data-arm="found"[^>]*aria-expanded="true"/)
    expect(html.match(/aria-controls="paper"/g)).toHaveLength(4)
    expect(post(null).match(/aria-expanded="true"/g)).toBeNull()
  })

  // A person's page opens from the ring, not from an arm: no arm may read as open for it.
  it('leaves every arm unpressed while the paper is on a subject page', () => {
    expect(post('person').match(/aria-expanded="true"/g)).toBeNull()
    expect(post('building').match(/aria-expanded="true"/g)).toBeNull()
  })

  // The nav laid itself out from this, and the arms then left the corner they were pressed in.
  // It has one home per width now, so the post says nothing about whether the sheet is up.
  it('★ hangs in the same place whether the sheet is up or down', () => {
    expect(post(null)).not.toContain('data-open')
    expect(post('folk')).not.toContain('data-open')
    expect(post('folk')).toBe(post(null).replace('aria-expanded="false"', 'aria-expanded="true"'))
  })

  // ★ 6E supersedes the fifth arm: the way into the key map is the corner button, so the post
  // carries the four sections and nothing else.
  it('★ hangs four arms and no fifth — help is the corner button now', () => {
    const html = post(null)
    expect(html.match(/<button/g)).toHaveLength(ARMS.length)
    expect(html).not.toContain(`>${KEY_MAP_KEY}<`)
    expect([...html.matchAll(/data-arm="([a-z]+)"/g)].map((m) => m[1])).toEqual([...ARMS])
    expect(html.match(/aria-controls="paper"/g)).toHaveLength(ARMS.length)
  })

  it('★ names the corner button for the sheet it opens, at 44px in a corner of its own', () => {
    const html = renderToStaticMarkup(
      createElement(HelpButton, { open: false, onToggle: () => {} }),
    )
    expect(html).toContain('aria-label="What the town answers to"')
    expect(html).toContain(`>${KEY_MAP_KEY}<`)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(
      renderToStaticMarkup(createElement(HelpButton, { open: true, onToggle: () => {} })),
    ).toContain('aria-expanded="true"')

    const css = src('../ui/chrome.css')
    // The corner cluster is one block now: the thoughts switch stands on the same slab.
    // Anchored: the same pair heads the `forced-colors` list, indented, further up the sheet.
    const body =
      /^\.help-button, \.thoughts-button(?:, \.sound-button)? \{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(body).toContain('width: 44px')
    expect(body).toContain('height: 44px')
    expect(css).toMatch(
      /\.help-button, \.thoughts-button, \.sound-button, \.sound-cues \{[^}]*grid-area: foot-left/,
    )
  })

  // The button toggles, so the click-away that shuts the sheet must not count it as away — and
  // it asks the DOM through the disclosure, so the key map imports no opener back.
  it('★ leaves whatever opened the key map out of its own click-away', async () => {
    expect(KEY_MAP_ID).toBe('key-map-sheet')
    const asked: boolean[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    roots.push(root)
    await act(async () => {
      root.render(
        createElement(Fragment, null, [
          createElement(HelpButton, { key: 'b', open: true, onToggle: () => {} }),
          createElement(KeyMap, {
            key: 'm',
            open: true,
            onOpenChange: (v: boolean) => asked.push(v),
          }),
        ]),
      )
    })
    // the sheet carries the id the button names, which is the whole of the wiring between them
    expect(host.querySelector('.help-button')?.getAttribute('aria-controls')).toBe(KEY_MAP_ID)
    expect(host.querySelector(`#${KEY_MAP_ID}`)).not.toBeNull()

    await act(async () => {
      host.querySelector('.help-button')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(asked, 'the opener cannot put down what it puts up').toEqual([])

    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(asked).toEqual([false])
  })

  // React may re-invoke a pending updater, and Safari allows 100 history writes per 30 s: an
  // address written from inside one is written more times than the viewer navigated.
  it('★ writes the address bar outside the state updater, never inside it', () => {
    const app = src('../App.tsx')
    expect(app).not.toMatch(/setRoute\(\([\s\S]{0,200}?writeAddress/)
    expect(app.match(/writeAddress\(/g)).toHaveLength(3) // the definition and its two callers
  })

  it('★ is what the app mounts, with the arm’s wiring kept', () => {
    const app = src('../App.tsx')
    expect(app).toMatch(/<HelpButton\s+open=\{keysOpen\}/)
    expect(app).toContain('setKeysOpen((v) => !v)')
    expect(app).not.toContain('onHelp')
  })

  it('names itself for a screen reader and puts the post under the arms', () => {
    // "Signpost" names the metaphor; a screen reader hears "Signpost, navigation" and learns
    // nothing about what is behind it.
    expect(post(null)).toContain('aria-label="Town sections"')
    expect(post(null)).toContain('class="signpost-post"')
  })
})

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
    const html = paper({ page: 'chronicle', tab: 'Firsts' })
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(PAGE_TABS.chronicle.length)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
    expect(html).toMatch(/id="paper-tab-Firsts"[^>]*aria-selected="true"/)
  })

  it('falls back to the first tab when handed one the page does not have', () => {
    const html = paper({ page: 'found', tab: 'Firsts' })
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
    expect(html).toContain('close')
    // a phone is not told to press a key it does not have (@media (hover: none))
    expect(html).toContain('class="paper-close-key"> · Esc<')
    expect(html).toContain('class="paper-grip"')
  })

  // ★ 4A — the head dated itself off the town's clock until phase 4 gave the Day Bar the one
  // band that says when: a second date is the same minute in a second type face.
  it('★ prints a masthead over the section rule, and dates it nowhere', () => {
    const html = paper({ page: 'chronicle', tab: 'Record' })
    const head = headOf(html)
    expect(head).toContain('class="paper-dateline"')
    expect(head).toMatch(/class="paper-title" id="paper-title">Chronicle</)
    for (const said of dated(stamp(0))) expect(head, said).not.toContain(said)
  })

  it('★ runs the section line INSIDE the dateline, with the keyboard path untouched', () => {
    const html = paper({ page: 'chronicle', tab: 'Record' })
    const line = html.slice(html.indexOf('paper-dateline'), html.indexOf('</header>'))
    expect(line).toContain('role="tablist"')
    expect(line).toContain('aria-describedby="paper-tabs-keys"')
    expect(line.match(/tabindex="0"/g)).toHaveLength(1)
    expect(line).toContain('class="paper-close"')
  })

  it('★ every arm wears the same chrome, not the Chronicle alone', () => {
    for (const page of ARMS) {
      const head = headOf(paper({ page, tab: firstTab(page) }))
      expect(head, page).toContain('class="paper-dateline"')
      for (const said of dated(stamp(0))) expect(head, `${page}: ${said}`).not.toContain(said)
    }
  })

  // Two clocks on one frame can only ever agree or lie, and both read `store.getTick`. The band
  // above the sheet is the surface that says when, so the sheet's head says it nowhere.
  it('★ leaves the head with ONE dated surface on the frame: the Day Bar, not the masthead', () => {
    const head = headOf(paper({ page: 'laws', tab: 'World' }))
    expect(head.match(/class="paper-(?:date|clock)"/g)).toBeNull()
    expect(head).toMatch(/class="paper-marginalia"><button/)
  })

  // The lead story and the live feed, one beside the other — and the lead keeps a real heading
  // for a reader who cannot see that the headline is one.
  it('★ lays the Chronicle out as a front page: a lead story and a column beside it', () => {
    const html = paper({ page: 'chronicle', tab: 'Record' })
    expect(html).toContain('class="bs-front"')
    expect(html).toContain('class="block bs-lead"')
    expect(html).toContain('class="bs-column"')
    // Named out loud now: the edition under it stepped down, so the section head is the head.
    expect(html).toMatch(/class="feed-head">The day’s paper</)
    expect(html).toContain('What mattered')
    expect(html).toContain('Since you arrived')
  })

  it('hangs the dim over the town as a sibling, opening with the sheet', () => {
    expect(paper()).toMatch(/class="town-dim" data-open="no"/)
    expect(paper({ page: 'laws', tab: 'World' })).toMatch(/class="town-dim" data-open="yes"/)
  })
})

// The table names the tabs and every page picks its body by string: rename a tab and the page
// renders its fallback forever, with no type error to catch it.
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

describe('★ every way the paper goes down, and where focus lands', () => {
  const code = src('./Paper.tsx')
  const OPEN = { page: 'folk', tab: 'People' } as const

  it('leaves Escape to the one ladder in App rather than listening itself', async () => {
    const shut: string[] = []
    const p = await live({ ...OPEN, onClose: () => shut.push('esc') })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      p.el('.paper')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(shut, 'a second Escape listener takes two rungs of the ladder at once').toEqual([])
  })

  it('closes on the close word and on a click on the town', async () => {
    const shut: string[] = []
    const p = await live({ ...OPEN, onClose: () => shut.push('x') })
    await act(async () => {
      p.el('.paper-close')?.click()
    })
    expect(shut).toHaveLength(1)
    await act(async () => {
      p.el('.town-dim')?.click()
    })
    expect(shut).toHaveLength(2)
  })

  it(`closes on a grip drag of more than ${GRIP_CLOSE_PX}px, or on a throw`, () => {
    expect(GRIP_CLOSE_PX).toBe(40)
    expect(gripDismiss(GRIP_CLOSE_PX + 1, 0)).toBe(true)
    expect(gripDismiss(GRIP_CLOSE_PX, 0)).toBe(false)
    // a fast 25px flick is a dismissal; waiting for 40px is not
    expect(gripDismiss(25, GRIP_FLING_PX_MS + 0.1)).toBe(true)
    expect(gripDismiss(25, GRIP_FLING_PX_MS)).toBe(false)
    // and an upward throw is never one
    expect(gripDismiss(-60, 2)).toBe(false)
  })

  it(`★ goes down on a drag past ${GRIP_CLOSE_PX}px and comes back from a shorter one`, async () => {
    const far: string[] = []
    const p = await live({ ...OPEN, onClose: () => far.push('down') })
    const grip = p.el('.paper-grip')!
    pointer(grip, 'pointerdown', 100, 0)
    pointer(grip, 'pointermove', 100 + GRIP_CLOSE_PX + 1, 400)
    pointer(grip, 'pointerup', 100 + GRIP_CLOSE_PX + 1, 400)
    expect(far).toEqual(['down'])

    const near: string[] = []
    const q = await live({ ...OPEN, onClose: () => near.push('down') })
    const hold = q.el('.paper-grip')!
    pointer(hold, 'pointerdown', 100, 0)
    pointer(hold, 'pointermove', 100 + GRIP_CLOSE_PX - 1, 400)
    pointer(hold, 'pointerup', 100 + GRIP_CLOSE_PX - 1, 400)
    expect(near).toEqual([])
    // and the sheet is handed back to its own CSS rather than left where the finger left it
    expect(q.el('.paper')?.style.transform ?? '').toBe('')
  })

  it('★ follows the finger, rubber-banded upward, and brightens the town under it', async () => {
    const p = await live(OPEN)
    const grip = p.el('.paper-grip')!
    const sheet = p.el('.paper')!
    const dim = p.el('.town-dim')!
    Object.defineProperty(sheet, 'offsetHeight', { value: 600, configurable: true })
    pointer(grip, 'pointerdown', 200, 0)
    pointer(grip, 'pointermove', 290, 16)
    expect(sheet.style.transform).toBe('translate(-50%, 90px)')
    // ...and upward it gives a third of the throw, because it is already at the top of its travel
    pointer(grip, 'pointermove', 110, 32)
    expect(sheet.style.transform).toBe('translate(-50%, -30px)')
    // the scrim fades with the sheet, so the town brightens under the finger
    pointer(grip, 'pointermove', 500, 48)
    expect(Number(dim.style.opacity)).toBeLessThan(1)
    pointer(grip, 'pointercancel', 500, 48)
  })

  // The sheet is inert while it is down, so its 300ms of held content is not a tab trap in
  // the town, and `aria-hidden` and `inert` never disagree about whether it is there.
  it('★ is inert and hidden together while it is down', async () => {
    expect(paper()).toContain('inert=""')
    expect(paper(OPEN)).not.toContain('inert')
    const p = await live()
    const sheet = p.el('.paper')!
    expect(sheet.getAttribute('aria-hidden')).toBe('true')
    expect(sheet.hasAttribute('inert')).toBe(true)
    await p.again(OPEN)
    expect(sheet.getAttribute('aria-hidden')).toBe('false')
    expect(sheet.hasAttribute('inert')).toBe(false)
  })

  // Switching arms while the sheet is up unmounted the focused tab and dropped focus to <body>.
  // The tab now counts too: on `[open, key]` alone a tab change moved no focus, so a reader was
  // told nothing when the panel under it was replaced.
  it('★ re-seats focus when the arm or the tab changes, not only when the sheet opens', async () => {
    const p = await live(OPEN)
    expect(document.activeElement?.id).toBe('paper-tab-People')
    // a tab change replaces the panel under the reader, and focus goes with it
    await p.again({ tab: 'Families' })
    expect(document.activeElement?.id).toBe('paper-tab-Families')
    // and so does an arm change, which unmounts the tab focus was on
    await p.again({ page: 'laws', tab: 'World' })
    expect(document.activeElement?.id).toBe('paper-tab-World')
  })

  // The opener capture is its own effect: on the focus effect's deps its cleanup fired on every
  // tab change and put focus back on the old tab before the new one took it.
  it('★ hands the opener back only when the sheet goes down', async () => {
    const arm = document.createElement('button')
    arm.id = 'the-arm'
    document.body.append(arm)
    arm.focus()
    const p = await live(OPEN)
    expect(document.activeElement?.id).toBe('paper-tab-People')
    // a tab change must not bounce focus through the arm, which announces the sheet twice
    await p.again({ tab: 'Families' })
    expect(document.activeElement?.id).toBe('paper-tab-Families')
    await p.again({ page: null, tab: '' })
    expect(document.activeElement?.id).toBe('the-arm')
  })

  // A keyboard instruction inside an accessible name is re-announced on every tab focus.
  it('★ describes the arrow keys rather than naming the strip with them', () => {
    const html = paper({ page: 'folk', tab: 'People' })
    expect(html).toContain('aria-describedby="paper-tabs-keys"')
    expect(html).toMatch(/id="paper-tabs-keys"[^>]*>Left and right arrow keys/)
    expect(html).not.toMatch(/aria-label="[^"]*arrow keys/)
  })

  // The first button is not always the selected one: a person page opens on Story and a deep link
  // opens on whatever tab it names, and focus landed on the wrong tab in both.
  it('moves focus to the tab being shown, which is not always the first one', async () => {
    await live({ page: 'folk', tab: 'Families' })
    expect(document.activeElement?.id).toBe('paper-tab-Families')
  })

  // `.focus()` reveals its target by scrolling every ancestor that can scroll, and the sheet's
  // tab strip is one of them while the sheet is still 102% down its own slide.
  it('★ seats that focus without scrolling anything to reach it', () => {
    expect(code).toMatch(/\.focus\(\{ preventScroll: true \}\)/)
  })

  // The sheet's scroll box is one div that React keeps mounted across every arm and tab, so its
  // scrollTop was carried into the next page and dropped the reader mid-way down it.
  it('★ returns the sheet to the top when the page or the tab under it changes', async () => {
    const p = await live(OPEN)
    const box = p.el('.paper-sheet')!
    box.scrollTop = 240
    await p.again({ tab: 'Families' })
    expect(box.scrollTop).toBe(0)
    box.scrollTop = 240
    await p.again({ page: 'laws', tab: 'World' })
    expect(box.scrollTop).toBe(0)
    // A layout effect: Found's own scroll-to-row is a child passive effect, which runs later.
    expect(code).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]*?scrollTop = 0[\s\S]*?\}, \[open, key, current\]\)/,
    )
    expect(src('./pages/Found.tsx')).toContain('scrollIntoView')
  })
})

// `useEndpoint` settles a refusal as `{ data: null, loaded: true }`: the empty copy is news
// about the town, `OutOfReach` is news about the wire.
describe('★ every page that can be quiet can also be out of reach', () => {
  const PAGES = [
    './pages/Found.tsx',
    './pages/Customs.tsx',
    './pages/Chronicle.tsx',
    './pages/Moments.tsx',
    './pages/BondsGraph.tsx',
    './pages/Person.tsx',
    './pages/Building.tsx',
  ]

  it.each(PAGES)('%s branches on the read failing, and offers it again', (page) => {
    const code = src(page)
    expect(code, 'no OutOfReach').toContain("from '../../ui/OutOfReach.js'")
    expect(code, 'no failed branch').toMatch(/\.failed|wireDown/)
    expect(code, 'no way to ask again').toMatch(/onRetry=\{/)
  })

  // A page holding a last good answer keeps showing it: only a panel with nothing at all and a
  // broken wire changes what it says.
  it('never swaps the copy while there is still an answer to show', () => {
    expect(src('./pages/Moments.tsx')).toContain('read.failed && moments === null')
    expect(src('./pages/Chronicle.tsx')).toContain('entries.length === 0 && record.failed')
  })
})

// An operator can press Set and shut the sheet in the same breath, and the paper unmounts its
// body on close: an answer held in the body is an answer nobody ever reads.
describe('★ the operator’s answer outlives the page it was asked from', () => {
  it('is the paper’s state, and the page only hands it over', () => {
    const paper = src('./Paper.tsx')
    expect(paper).toContain('useState<PaperNotice | null>(null)')
    expect(paper).toContain('className="laws-notice"')
    expect(paper).toContain('onNotice={setNotice}')
  })

  it('is written by both operator write paths and held by neither', () => {
    const laws = src('./pages/Laws.tsx')
    expect(laws, 'the page keeps no answer of its own').not.toContain('setNotice')
    expect(laws).toContain('onNotice({')
    expect(laws).toContain('<ExportLink token={operatorToken} onNotice={refused} />')
  })
})

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

  // A boundary has no DOM of its own and the page under it draws different markup per tab, so
  // there is nothing on the screen a remount would change. The key itself is the whole rule.
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

// `route.test.ts` owns the parse and `worldStore.test.ts` owns the latch the landing waits on;
// what is left is one wiring seam inside an effect, pinned where it is written.
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

// ★ THE ALMANAC. Thirteen tabs were four names for one log plus the rest; the four arms became
// four books with a colour each, and the sheet gained a place to stand that does not cover the
// town it is about.
describe('★ the Almanac shell', () => {
  it('★ folds four names for one log into the Record, and keeps the old links landing on it', () => {
    expect([...PAGE_TABS.chronicle]).toEqual(['Record', 'Firsts'])
    for (const old of ['Today', 'Chapters', 'Moments', 'Days']) {
      expect(hasTab('chronicle', old), old).toBe(false)
      expect(paper({ page: 'chronicle', tab: old }), old).toMatch(
        /id="paper-tab-Record"[^>]*aria-selected="true"/,
      )
    }
    expect(ARMS.reduce((n, a) => n + PAGE_TABS[a].length, 0)).toBe(10)
  })

  it('★ names the four books on the arms, Land and Rule among them', () => {
    expect(ARMS.map((a) => PAGE_TITLE[a])).toEqual(['Folk', 'Chronicle', 'Land', 'Rule'])
    const html = renderToStaticMarkup(
      createElement(Signpost, {
        open: null,
        onOpen: () => {},
        store: createWorldStore(),
        stories: null,
      }),
    )
    expect(html).toContain('>Land<')
    expect(html).toContain('>Rule<')
  })

  it('★ carries the open arm’s book on the sheet, and none on a page that is not an arm', () => {
    for (const arm of ARMS)
      expect(paper({ page: arm, tab: firstTab(arm) }), arm).toMatch(
        new RegExp(`class="paper"[^>]*data-book="${arm}"`),
      )
    expect(
      paper({ page: 'person', tab: 'Story', subject: { id: 'a', kind: 'agent', name: 'Amara' } }),
    ).not.toContain('data-book')
  })

  // Today was the newest 200 weighted rows with no day bound at all, so a nine-day town read
  // the same as a one-day town. The range is what bounds it.
  it('★ bounds the Record with a range instead of printing rows of no day at all', () => {
    const html = paper({ page: 'chronicle', tab: 'Record' })
    expect(html).toContain('class="record-range"')
    for (const words of ['Today', 'This week', 'All']) expect(html).toContain(`>${words}<`)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  // The sheet asks and does not decide: Watch has to know where the Almanac stands before it
  // can stop putting it away, so App owns the answer and the storage that remembers it.
  it('★ docks as a column and stops dimming the town, on the word of whoever owns it', async () => {
    const asked: string[] = []
    const p = await live({
      page: 'chronicle',
      tab: 'Record',
      onDock: () => asked.push('dock'),
    })
    expect(p.el('.paper')?.dataset.dock).toBe('off')
    expect(p.el('.town-dim')?.dataset.dock).toBe('off')
    await act(async () => {
      p.el('.paper-dock')?.click()
    })
    expect(asked, 'the sheet docked itself').toEqual(['dock'])
    await p.again({ dock: 'docked' })
    expect(p.el('.paper')?.dataset.dock).toBe('on')
    expect(p.el('.town-dim')?.dataset.dock).toBe('on')
    expect(p.el('.paper-dock')?.getAttribute('aria-pressed')).toBe('true')
  })
})
