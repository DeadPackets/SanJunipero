import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BackToRoster,
  InspectorBodyView,
  fetchTab,
  journalStamp,
  type InspectorAgent,
} from './InspectorPanel.js'

const EMOJI = /\p{Extended_Pictographic}/u

const person = (over: Partial<InspectorAgent> = {}): InspectorAgent => ({
  alive: true,
  asleep: false,
  activity: null,
  needs: { hunger: 80, energy: 60, warmth: 70, social: 90 },
  hp: 100,
  ill: false,
  injuries: [],
  collapsedSinceTick: null,
  skills: {},
  ...over,
})

const body = (agent: InspectorAgent): string =>
  renderToStaticMarkup(
    createElement(InspectorBodyView, {
      agent,
      tick: 0,
      thought: null,
      carrying: [],
      changes: [],
    }),
  )

describe('BackToRoster', () => {
  const html = renderToStaticMarkup(createElement(BackToRoster, { onBack: () => {} }))

  it('is a real button a keyboard can reach', () => {
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
  })

  it("says where it goes, in the town's own words", () => {
    expect(html).toContain('All townsfolk')
  })

  it('keeps the arrow out of the accessibility tree — the words carry the meaning', () => {
    expect(html).toContain('aria-hidden="true"')
  })

  it('is drawn, never typed as an emoji', () => {
    expect(html).not.toMatch(EMOJI)
  })
})

// Five 0-100 body readings, four of them tracks and one a sentence, read as a need row whose
// track failed to render.
describe('the body block', () => {
  it('draws health as a track, like the four readings beside it', () => {
    const html = body(person())
    expect(html.match(/class="need-row"/g)).toHaveLength(5)
    expect(html).toContain('>Health<')
    expect(html).not.toContain('Health 100')
  })

  it('runs the low fill under the same threshold the needs use', () => {
    expect(body(person({ hp: 12 }))).toContain('need-fill low')
    expect(body(person({ hp: 100 })).match(/need-fill low/g)).toBeNull()
  })

  it('keeps an injury as its own line, which no track can carry', () => {
    const html = body(person({ injuries: [{ kind: 'burn', day: 3 }] }))
    expect(html).toContain('burn injury (day 3)')
    expect(body(person())).not.toContain('injury')
  })
})

// A non-OK response used to be stored as `[]` and re-served for TAB_CACHE_MS, so one transient
// 500 became 30 seconds of "Nothing written yet." about a person.
describe('fetchTab', () => {
  const ok = (rows: unknown[]): Response =>
    ({ ok: true, json: async () => rows }) as unknown as Response
  const fail = (): Response => ({ ok: false, json: async () => [] }) as unknown as Response

  it('never caches a read that failed', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(ok([{ a: 1 }]))
    expect(await fetchTab('miss-1', 'ledger', fetchFn)).toEqual([])
    expect(await fetchTab('miss-1', 'ledger', fetchFn)).toEqual([{ a: 1 }])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('still caches an answer, so a tab flip is not a second read', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(ok([{ a: 1 }]))
    expect(await fetchTab('hit-1', 'ledger', fetchFn)).toEqual([{ a: 1 }])
    expect(await fetchTab('hit-1', 'ledger', fetchFn)).toEqual([{ a: 1 }])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

// The journal feed carries two things now. A dream a viewer cannot tell from a written entry
// reads as the mind claiming it happened.
describe('journalStamp', () => {
  it('marks a dream as a dream, and leaves a written entry alone', () => {
    expect(journalStamp({ tick: 5, day: 3, text: 'x', kind: 'journal' })).toBe('Day 3')
    expect(journalStamp({ tick: 5, day: 3, text: 'x', kind: 'dream' })).toBe('Day 3, a dream')
describe('what is written of them', () => {
  const withBio = (biography: { day: number; title: string; body: string } | null): string =>
    renderToStaticMarkup(
      createElement(InspectorBodyView, {
        agent: person(),
        tick: 0,
        thought: null,
        carrying: [],
        changes: [],
        biography,
      }),
    )

  it('prints the chronicler’s write-up under the day it was written', () => {
    const html = withBio({ day: 6, title: 'Amara, who keeps the tally', body: 'She counted.' })
    expect(html).toContain('Amara, who keeps the tally')
    expect(html).toContain('She counted.')
    expect(html).toContain('Day 6')
  })

  it('says the record is empty rather than that one is coming', () => {
    const html = withBio(null)
    expect(html).toContain('Nobody has written of them yet.')
    expect(html).not.toMatch(EMOJI)
  })
})
