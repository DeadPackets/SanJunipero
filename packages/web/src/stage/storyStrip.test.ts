import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MINUTES_PER_DAY, type ServerDirector, type ThreadRow } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { threadCapsules, type Capsule } from '../ui/threadModel.js'
import {
  STRIP_QUIET,
  StoryStrip,
  becameWords,
  castLabel,
  daysWord,
  stateWord,
  stripCast,
} from './StoryStrip.js'

const NOW = 8 * MINUTES_PER_DAY

const row = (over: Partial<ThreadRow> & { id: string }): ThreadRow => ({
  members: ['a', 'b'],
  heat: 10,
  peak: 20,
  state: 'rising',
  valence: 0,
  openedTick: NOW - MINUTES_PER_DAY,
  lastPaidTick: NOW,
  terms: ['talk'],
  ...over,
})

const capsule = (over: Partial<Capsule> & { id: string }): Capsule => ({
  cast: ['a', 'b'],
  more: 0,
  line: null,
  days: 1,
  heatShare: 0.5,
  state: 'rising',
  valence: 0,
  onScreen: false,
  handover: null,
  ...over,
})

const PEOPLE = ['ada', 'bo', 'cyd', 'dee', 'eli'] as const
const NAMES: Record<string, string> = {
  ada: 'Ada',
  bo: 'Bo',
  cyd: 'Cyd',
  dee: 'Dee',
  eli: 'Eli',
}

const town = (
  threads: ThreadRow[] | null,
  cutCast: readonly string[] | null = null,
): WorldStore => ({
  ...createWorldStore(),
  getTick: () => NOW,
  getState: () =>
    ({
      tick: NOW,
      agents: Object.fromEntries(PEOPLE.map((id) => [id, { name: NAMES[id] }])),
    }) as unknown as WorldState,
  threads: () => (threads === null ? null : { t: 'threads', tick: NOW, threads }),
  getDirector: () =>
    cutCast === null
      ? null
      : ({
          t: 'director',
          tick: NOW,
          cut: { sceneId: 's', agentIds: cutCast, score: 40, why: 'why' },
          quiet: false,
          act: null,
        } as ServerDirector),
})

const draw = (store: WorldStore): string =>
  renderToStaticMarkup(createElement(StoryStrip, { store }))

/** Every word the strip actually prints, with the markup and its attributes taken away. */
const words = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, '’')

describe('the story strip prints no number without its unit', () => {
  it('says the days running with the unit, singular at one', () => {
    expect(daysWord(6.2)).toBe('6.2 days')
    expect(daysWord(1)).toBe('1.0 day')
    expect(daysWord(-3)).toBe('0.0 days')
  })

  // ★ Heat is raw on the wire and never on screen: 2915 against a peak of 3000 is a bar.
  it('★ renders no bare four-figure number under a heat of 2915', () => {
    const html = draw(
      town([row({ id: 't1', heat: 2915, peak: 3000, beat: 'The mill wheel turned again.' })]),
    )
    expect(html).toContain('The mill wheel turned again.')
    expect(words(html)).not.toMatch(/\d{4}/)
    expect(words(html)).not.toMatch(/2915/)
  })
})

describe('the story strip never contradicts the picture it stands under', () => {
  // ★ The ribbon's head agrees with the cut on 47.9% of ticks by design, so the top three alone
  // would leave the camera's own story off the band about half the time.
  it('★ keeps the capsule the camera is on when it ranks below the third', () => {
    const caps = ['t1', 't2', 't3', 't4', 't5'].map((id) => capsule({ id, onScreen: id === 't5' }))
    expect(stripCast(caps).map((c) => c.id)).toEqual(['t1', 't2', 't5'])
  })

  it('leaves the ranking alone when the camera is already on it', () => {
    const caps = ['t1', 't2', 't3', 't4'].map((id) => capsule({ id, onScreen: id === 't2' }))
    expect(stripCast(caps).map((c) => c.id)).toEqual(['t1', 't2', 't3'])
  })

  it('takes the top three when no story is lit at all', () => {
    const caps = ['t1', 't2', 't3', 't4'].map((id) => capsule({ id }))
    expect(stripCast(caps).map((c) => c.id)).toEqual(['t1', 't2', 't3'])
  })

  it('marks the lit capsule with a change of paper, not an outline', () => {
    const rows = [
      row({ id: 't1', members: ['ada', 'bo'] }),
      row({ id: 't2', members: ['cyd', 'dee'] }),
    ]
    const html = draw(town(rows, ['cyd']))
    expect(html).toContain('story-capsule lit')
    expect(html).toContain('ON SCREEN')
    expect(html.match(/story-capsule lit/g)).toHaveLength(1)
  })
})

describe('the story strip in a quiet town says only what is true', () => {
  it('claims nothing at all off the live edge, where there is no frame', () => {
    expect(draw(town(null))).toBe('')
  })

  it('says one true line when the town holds no running story', () => {
    const html = draw(town([]))
    expect(words(html)).toContain(STRIP_QUIET)
    expect(html).not.toContain('story-capsule')
  })

  // A capsule the town has written nothing for still has a cast and a state, and no sentence.
  it('names the cast rather than writing a sentence the town did not', () => {
    const html = draw(town([row({ id: 't1', members: ['ada', 'bo'] })]))
    expect(words(html)).toContain('Ada & Bo')
    expect(words(html)).toContain('RISING')
  })

  it('prints the town’s own sentence when it has one', () => {
    const rows = [row({ id: 't1', members: ['ada', 'bo'], beat: 'Ada would not look at him.' })]
    expect(words(draw(town(rows)))).toContain('Ada would not look at him.')
  })
})

describe('a story that merges away says goodbye and hands over', () => {
  it('reads HANDED OVER rather than one more state word', () => {
    expect(stateWord(capsule({ id: 't1', state: 'closed', handover: 't2' }))).toBe('HANDED OVER')
    expect(stateWord(capsule({ id: 't1', state: 'closed' }))).toBe('CLOSED')
  })

  it('names the story it became, and says nothing when that story is not in the frame', () => {
    const rows = [row({ id: 't2', members: ['cyd', 'dee'] })]
    const nameOf = (id: string): string => NAMES[id] ?? 'someone'
    expect(becameWords(rows, 't2', nameOf)).toBe('Cyd & Dee')
    expect(becameWords(rows, 't9', nameOf)).toBeNull()
    expect(becameWords(rows, null, nameOf)).toBeNull()
  })

  it('ships the goodbye on the last row, beside the story that took it', () => {
    const rows = [
      row({ id: 't2', members: ['cyd', 'dee'] }),
      row({ id: 't1', members: ['ada', 'bo'], state: 'closed', became: 't2' }),
    ]
    const said = words(draw(town(rows)))
    expect(said).toContain('HANDED OVER')
    expect(said).toContain('to Cyd & Dee')
  })
})

describe('the cast a reader cannot see the busts of', () => {
  const nameOf = (id: string): string => NAMES[id] ?? 'someone'

  it('counts everyone the three names leave out, busts and members alike', () => {
    expect(castLabel(capsule({ id: 't1', cast: ['ada', 'bo'] }), nameOf)).toBe('Ada & Bo')
    expect(castLabel(capsule({ id: 't1', cast: ['ada', 'bo', 'cyd', 'dee'] }), nameOf)).toBe(
      'Ada, Bo & Cyd and 1 more',
    )
    expect(
      castLabel(capsule({ id: 't1', cast: ['ada', 'bo', 'cyd', 'dee'], more: 2 }), nameOf),
    ).toBe('Ada, Bo & Cyd and 3 more')
  })

  it('puts the whole cast on the busts as their accessible name', () => {
    const rows = [row({ id: 't1', members: ['ada', 'bo', 'cyd', 'dee', 'eli'] })]
    expect(draw(town(rows))).toContain('aria-label="Ada, Bo &amp; Cyd and 2 more"')
  })
})

describe('the capsule model the strip draws from', () => {
  it('hands the strip a share of the story’s own peak, never the heat', () => {
    const caps = threadCapsules([row({ id: 't1', heat: 2915, peak: 3000 })], { now: NOW })
    expect(caps[0]!.heatShare).toBeCloseTo(0.9717, 3)
    expect(caps[0]!.days).toBe(1)
  })
})

describe('★ the band says which way a story runs', () => {
  // ★ Every capsule painted one heat colour and `valence` reached no attribute at all, so a
  // courtship and a quarrel came off the wire opposite and rendered byte-identical.
  it('★ marks a warm story and a cold one with two different tones', () => {
    const html = draw(
      town([
        row({ id: 't1', valence: 1, members: ['ada', 'bo'], beat: 'They walked back together.' }),
        row({ id: 't2', valence: -1, members: ['cyd', 'dee'], beat: 'He would not look at her.' }),
      ]),
    )
    expect(html).toContain('data-tone="gain"')
    expect(html).toContain('data-tone="cost"')
  })

  it('gives a story with no sign the plain tone and no accent', () => {
    const html = draw(town([row({ id: 't1', valence: 0 })]))
    expect(html).toContain('data-tone="plain"')
    expect(html).not.toContain('data-tone="cost"')
    expect(html).not.toContain('data-tone="gain"')
  })
})

describe('a day-old sentence is kept and marked, never passed off as this minute', () => {
  it('marks a head the town wrote a sim-day ago', () => {
    const html = draw(
      town([
        row({
          id: 't1',
          beat: 'The mill wheel turned again.',
          proseTick: NOW - MINUTES_PER_DAY,
        }),
      ]),
    )
    expect(html).toContain('The mill wheel turned again.')
    expect(html).toContain('data-stale="yes"')
  })

  it('leaves a sentence written this hour unmarked', () => {
    const html = draw(
      town([row({ id: 't1', beat: 'The mill wheel turned again.', proseTick: NOW - 30 })]),
    )
    expect(html).toContain('The mill wheel turned again.')
    expect(html).not.toContain('data-stale')
  })
})
