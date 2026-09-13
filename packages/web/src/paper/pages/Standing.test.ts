import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MINUTES_PER_DAY, type AssetRecord, type Bond, type ChronicleEntry } from '@sj/shared'
import type { AgentBody, WorldState } from '@sj/engine/state'
import type { Subject } from '../../stage/index.js'
import { GAMIFICATION_BAN } from '../../ui/townStats.js'
import { StandingView, type StandingSources } from './Standing.js'

const DAY = MINUTES_PER_DAY
const NOW = 46 * DAY + 9 * 60
const NO_RECORDS: AssetRecord[] = []

const body = (over: Partial<AgentBody> & { id: string; name: string }): AgentBody => ({
  x: 1,
  y: 1,
  alive: true,
  asleep: false,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 100,
  injuries: [],
  ill: false,
  ageDays: 9_000,
  skills: {},
  activity: null,
  collapsedSinceTick: null,
  zeroHungerSinceTick: null,
  ...over,
})

const WORLD: WorldState = {
  tick: NOW,
  terrain: [[0]],
  weather: { kind: 'sunny', temperatureC: 12 },
  agents: {
    salma: body({ id: 'salma', name: 'Salma', partnerId: 'yusuf' }),
    yusuf: body({ id: 'yusuf', name: 'Yusuf', partnerId: 'salma' }),
    omar: body({ id: 'omar', name: 'Omar', partnerId: 'tala' }),
    tala: body({ id: 'tala', name: 'Tala', partnerId: 'omar', asleep: true }),
    idris: body({ id: 'idris', name: 'Idris', asleep: true }),
    hana: body({ id: 'hana', name: 'Hana', alive: false }),
  },
  structures: {},
  items: {},
  crops: {},
  wildlife: { fish: 1, deer: 1 },
  counters: { nextEntityId: 1 },
}

const tie = (aId: string, bId: string, firstTick: number): Bond => ({
  id: `${aId}:${bId}`,
  aId,
  bId,
  kind: 'partner',
  strength: 4,
  formedTick: firstTick,
  lastUpdatedTick: NOW,
  recent: [],
  acts: [{ kind: 'partner', count: 1, firstTick, lastTick: firstTick }],
  warmth: 3,
  priorWarmth: 2,
  levelChangedTick: firstTick,
})

const entry = (seq: number, tick: number, label: string): ChronicleEntry => ({
  seq,
  tick,
  type: 'agent_spoke',
  icon: 'star',
  label,
  agentIds: ['salma', 'yusuf'],
})

/** Twenty two lines since the last visit, so the cap and the count of the rest both fire. */
const ENTRIES: ChronicleEntry[] = Array.from({ length: 22 }, (_, i) =>
  entry(i + 1, NOW - (22 - i) * 30, `Salma and Yusuf went at each other over the well again.`),
)

const first = (kind: string, tick: number) => ({
  kind,
  label: `The first ${kind}`,
  eventSeq: 1,
  day: Math.floor(tick / DAY),
  tick,
  tier: 1,
  domain: 'craft',
  agentIds: ['salma'],
  nameProvenance: null,
})

/** Every band full, every source landed: the fixture the ban is measured over. */
const RICH: StandingSources = {
  now: NOW,
  state: WORLD,
  threads: {
    t: 'threads',
    tick: NOW,
    threads: [
      {
        id: 'th1',
        members: ['salma', 'yusuf'],
        heat: 40,
        peak: 60,
        state: 'rising',
        valence: -1,
        openedTick: NOW - 4 * DAY,
        lastPaidTick: NOW,
        terms: ['quarrel'],
        beat: 'Salma would not let the matter of the well go.',
        proseTick: NOW - 30,
      },
    ],
  },
  entries: ENTRIES,
  chapter: 'The week the well ran low',
  lastVisit: NOW - 19 * 60 - 7,
  firsts: [
    first('bread', NOW - 2 * DAY),
    first('rope', NOW - 3 * DAY),
    first('kiln', NOW - 5 * DAY),
    first('net', NOW - 9 * DAY),
    first('cart', NOW - 10 * DAY),
    first('loom', NOW - 11 * DAY),
    first('dye', NOW - 12 * DAY),
    first('ink', NOW - 13 * DAY),
  ],
  laws: Array.from({ length: 7 }, (_, i) => ({
    id: `law${i}`,
    text: 'Nobody takes wood from the far stand.',
    proposedBy: 'salma',
    proposerName: 'Salma',
    ratifiedTick: 10,
    repealedTick: i < 2 ? 900 : null,
    votes: { for: ['salma'], against: [] },
    why: 'the wood was going',
    enforced: true,
    breaches: 0,
  })),
  bonds: [tie('salma', 'yusuf', NOW - 23 * DAY), tie('omar', 'tala', NOW - 6 * DAY)],
  deathTicks: [9 * DAY + 200, 40 * DAY + 60, 34 * DAY + 10],
}

const EMPTY: StandingSources = {
  now: 0,
  state: null,
  threads: null,
  entries: null,
  chapter: null,
  lastVisit: null,
  firsts: null,
  laws: null,
  bonds: [],
  deathTicks: null,
}

const draw = (sources: StandingSources): string =>
  renderToStaticMarkup(
    createElement(StandingView, {
      sources,
      records: NO_RECORDS,
      onSubject: (_s: Subject) => undefined,
    }),
  )

/** The markup with its tags taken off, which is what a reader actually sees. */
const words = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('the Standing', () => {
  it('★ prints not one word the gamification ban matches, over a full board', () => {
    const text = words(draw(RICH))
    expect(text.length, 'the fixture rendered nothing').toBeGreaterThan(400)
    expect(GAMIFICATION_BAN.exec(text)).toBeNull()
  })

  it('★ says the days since anyone died against the longest run and the day it ended', () => {
    expect(words(draw(RICH))).toContain(
      '6 days since anyone died, the longest run yet was 25 and it ended on day 34.',
    )
  })

  it('★ pulls the one large figure out of the sentence that denominates it', () => {
    expect(draw(RICH)).toContain('<span class="board-figure">6</span> days since anyone died')
  })

  it('counts the firsts of this week against last week', () => {
    expect(words(draw(RICH))).toContain(
      '3 things happened here for the first time this week, against 5 the week before.',
    )
  })

  it('counts the rules ever agreed against the ones that still stand', () => {
    expect(words(draw(RICH))).toContain('They have agreed 7 rules, and 5 of the 7 still stand.')
  })

  it('names the longest partnership running and how long it has run', () => {
    expect(words(draw(RICH))).toContain(
      'Salma and Yusuf have been partners 23 days, longer than any other pair here.',
    )
  })

  it('counts who is abed against everyone alive, never against everyone ever', () => {
    expect(words(draw(RICH))).toContain('2 of the 5 people here are asleep right now.')
  })

  it('★ leads on the top story’s own sentence, and opens every name in it as a door', () => {
    const html = draw(RICH)
    expect(html).toContain('Salma would not let the matter of the well go.')
    expect(html.match(/class="person-link"/g)).toHaveLength(2)
  })

  it('★ falls to the day’s chapter title when the town is quiet, and to nothing after that', () => {
    const quiet = draw({ ...RICH, threads: null })
    expect(quiet).toContain('The week the well ran low')
    const mute = draw({ ...RICH, threads: null, chapter: null })
    expect(mute).not.toContain('standing-line')
  })

  it('★ counts the time away in sim hours, not in whole days', () => {
    expect(words(draw(RICH))).toContain('The town ran 19 hours since you last watched.')
  })

  it('says days once the hours would run past two days of them', () => {
    const gone = draw({ ...RICH, lastVisit: NOW - 3 * DAY - 5 * 60 })
    expect(words(gone)).toContain('The town ran 3 days since you last watched.')
  })

  it('★ caps the lines it prints at eight and counts the rest in a unit', () => {
    const html = draw(RICH)
    expect(html.match(/class="feed-line"/g)).toHaveLength(8)
    expect(words(html)).toContain('And 14 lines more in the record since then.')
  })

  it('★ is absent on a first visit rather than welcoming anybody', () => {
    const html = draw({ ...RICH, lastVisit: null })
    expect(html).not.toContain('Since you left')
    expect(html).toContain('What the town holds')
  })

  it('says nothing at all when the town has handed it nothing', () => {
    expect(draw(EMPTY)).toBe('')
  })

  it('★ leaves out a record whose source has not landed, rather than saying it from a default', () => {
    const html = draw({ ...RICH, laws: null, deathTicks: null, firsts: null })
    expect(html).not.toContain('They have agreed')
    expect(html).not.toContain('since anyone died')
    expect(html).not.toContain('for the first time')
    expect(html).toContain('are asleep right now')
  })
})
