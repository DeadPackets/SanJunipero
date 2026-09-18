// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  type ServerBoard,
  type ServerDirector,
  type ServerThreads,
  type StakeScore,
  type ThreadRow,
} from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { createWorldStore, type TownScene, type WorldStore } from '../state/worldStore.js'
import { BeatCard } from './BeatCard.js'
import { DossierRail } from './DossierRail.js'
import { ShotBoard } from './ShotBoard.js'
import { StoryStrip } from './StoryStrip.js'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// One town, four surfaces, driven through the real store rather than hand-made props: a leak in
// the model between the frame and the markup is invisible to a body test that never sees it.

const NOW = 8 * MINUTES_PER_DAY

type Body = WorldState['agents'][string]

const body = (id: string, name: string, over: Partial<Body> = {}): Body => ({
  id,
  name,
  x: 0,
  y: 0,
  alive: true,
  asleep: false,
  needs: { hunger: 90, energy: 90, warmth: 90, social: 90 },
  hp: 10,
  injuries: [],
  ill: false,
  ageDays: ADULT_AGE_DAYS,
  skills: {},
  activity: null,
  collapsedSinceTick: null,
  zeroHungerSinceTick: null,
  ...over,
})

const PEOPLE = ['nadia', 'yusuf', 'maret', 'omar', 'ada', 'bo'] as const
const NAMES: Record<string, string> = {
  nadia: 'Nadia',
  yusuf: 'Yusuf',
  maret: 'Maret',
  omar: 'Omar',
  ada: 'Ada',
  bo: 'Bo',
}

const world = (over: Partial<Body> = {}): WorldState => ({
  ...genesisState(DEFAULT_CONFIG),
  tick: NOW,
  agents: Object.fromEntries(PEOPLE.map((id) => [id, body(id, NAMES[id]!, over)])),
})

const thread = (over: Partial<ThreadRow> & { id: string }): ThreadRow => ({
  members: ['nadia', 'yusuf'],
  heat: 12,
  peak: 24,
  state: 'rising',
  valence: -1,
  openedTick: NOW - MINUTES_PER_DAY,
  lastPaidTick: NOW,
  terms: ['quarrel'],
  ...over,
})

const stake = (over: Partial<StakeScore> = {}): StakeScore => ({
  sceneId: 'sc_1',
  agentIds: ['nadia', 'yusuf'],
  score: 20,
  why: 'Nadia & Yusuf: falling out',
  ...over,
})

const scene = (over: Partial<TownScene> = {}): TownScene => ({
  id: 'sc_1',
  kind: 'quarrel',
  participants: ['nadia', 'yusuf'],
  topic: null,
  stakes: 8,
  open: true,
  ...over,
})

type Town = {
  state?: WorldState | null
  threads?: ThreadRow[] | null
  board?: StakeScore[] | null
  cut?: StakeScore | null
  shot?: TownScene | null
}

// Every frame is built once: `useSyncExternalStore` reads a snapshot on every pass and a fresh
// object each time is an endless render, which is a fault in the fake and not in the surface.
const town = (t: Town = {}): WorldStore => {
  const threads: ServerThreads | null =
    t.threads == null ? null : { t: 'threads', tick: NOW, threads: t.threads }
  const board: ServerBoard | null =
    t.board == null ? null : { t: 'board', tick: NOW, rows: t.board }
  const director: ServerDirector | null =
    t.cut == null ? null : { t: 'director', tick: NOW, cut: t.cut, quiet: false, act: null }
  return {
    ...createWorldStore(),
    getTick: () => NOW,
    getState: () => t.state ?? null,
    shotScene: () => t.shot ?? null,
    threads: () => threads,
    board: () => board,
    getDirector: () => director,
  }
}

/** The five in the order the plan stacks them. The strip is in every mode, the rest in Deck. */
const SURFACES: readonly (readonly [string, ComponentType<Parameters<typeof StoryStrip>[0]>])[] = [
  ['story strip', StoryStrip],
  ['beat card', BeatCard],
  ['shot board', ShotBoard],
  ['dossier rail', DossierRail],
]

const draw = (
  Surface: ComponentType<Parameters<typeof StoryStrip>[0]>,
  store: WorldStore,
): string => renderToStaticMarkup(createElement(Surface, { store, onChronicle: () => {} }))

/** Everything a reader actually sees: the markup and its attributes taken away. */
const words = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, '’')

describe('★ no surface prints a bare four-figure number, whatever the frame carries', () => {
  // Heat is raw on the wire and never on screen. 2915 over a peak of 2915 is the worst case: a
  // bar at its own ceiling, where a naive renderer prints the numerator.
  const hot = town({
    state: world(),
    shot: scene(),
    threads: [
      thread({ id: 'th_1', heat: 2915, peak: 2915, beat: 'The well ran dry between them.' }),
      thread({ id: 'th_2', members: ['maret', 'omar'], heat: 1740, peak: 2100 }),
    ],
    board: [
      stake({ score: 2915 }),
      stake({ sceneId: 'sc_2', agentIds: ['maret'], score: 1740, why: 'Maret: a death' }),
    ],
    cut: stake({ score: 2915 }),
  })

  for (const [name, Surface] of SURFACES) {
    it(`★ ${name} renders under heat 2915 and score 2915 with no four-figure number`, () => {
      const said = words(draw(Surface, hot))
      expect(said).not.toMatch(/\d{4}/)
      expect(said).not.toMatch(/2915|1740/)
    })
  }

  it('★ every surface did render something, so the scan is not passing on an empty screen', () => {
    for (const [name, Surface] of SURFACES) expect([name, draw(Surface, hot)][1]).not.toBe('')
  })

  // A thread id, a scene id and an agent id are all machine words. The label a reader hears is
  // the one place an id reaches a person without reaching the paint, so this reads the markup.
  it('★ puts no machine id on screen, not even for a body the census has never heard of', () => {
    const stranger = town({
      state: world(),
      shot: scene({ participants: ['nadia', 'ghost_9'] }),
      threads: [thread({ id: 'th_1', members: ['nadia', 'ghost_9'] })],
      board: [stake({ agentIds: ['nadia', 'ghost_9'] })],
      cut: stake({ agentIds: ['nadia', 'ghost_9'] }),
    })
    for (const [name, Surface] of SURFACES) {
      const html = draw(Surface, stranger)
      expect([name, /\bth_1\b|\bsc_1\b|\bghost_9\b/.test(html)][1]).toBe(false)
    }
  })
})

describe('★ the quiet town: ~30% of real ticks nothing is hot anywhere', () => {
  const quiet = town({ state: world(), threads: [], board: [], cut: null, shot: null })

  it('the strip says one true line and invents no story', () => {
    const said = words(draw(StoryStrip, quiet))
    expect(said).toContain('No active stories right now.')
    expect(said).not.toMatch(/RISING|COOLING|HANDED OVER/)
  })

  it('the board and the beat card stand down rather than stand empty', () => {
    expect(draw(ShotBoard, quiet)).toBe('')
    expect(draw(BeatCard, quiet)).toBe('')
  })

  // The rail is the census, not the ranking: everybody is still alive in a quiet minute and the
  // screen holds that. Pressure is honestly zero and draws no bar.
  it('the rail still names every living body, at a pressure of zero', () => {
    const html = draw(DossierRail, quiet)
    expect(words(html)).toContain('Nadia')
    expect(html.match(/dossier-card"/g)).toHaveLength(PEOPLE.length)
    expect(html).not.toContain('dossier-card lit')
    expect(html).toContain('height:0.0%')
  })

  // ★ A scrub nulls the director, the board and the ribbon together. Zero pressure is a claim
  // about the minute on screen, and off the live edge nothing in hand supports it.
  it('★ the rail keeps the census off the live edge and draws no pressure it cannot read', () => {
    const scrub = town({ state: world(), threads: null, board: null, cut: null, shot: null })
    const html = draw(DossierRail, scrub)
    expect(words(html)).toContain('Nadia')
    expect(html).not.toContain('dossier-gutter')
    for (const [, Surface] of [SURFACES[0]!, SURFACES[1]!, SURFACES[2]!]) {
      const html = draw(Surface, scrub)
      if (Surface === StoryStrip) {
        expect(html).toContain('Return to now for unfolding stories')
        expect(html).not.toContain('story-capsule')
      } else expect(html).toBe('')
    }
  })
})

describe('★ the strip does not read its own last frame as the town repeating itself', () => {
  const host: HTMLElement[] = []
  afterEach(() => {
    for (const el of host.splice(0)) el.remove()
  })

  /** A store a test can move, so a surface is driven the way the page drives it. */
  const live = (t: Town) => {
    const subs = new Set<() => void>()
    let director: ServerDirector | null = null
    const store: WorldStore = {
      ...town(t),
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
      getDirector: () => director,
    }
    return {
      store,
      // A new cut is a new frame every pump, and its `agentIds` is a new array every time.
      cutTo: (agentIds: string[]) => {
        director = {
          t: 'director',
          tick: NOW,
          cut: stake({ sceneId: 'sc_9', agentIds, why: 'Maret: a slight' }),
          quiet: false,
          act: null,
        }
        for (const fn of subs) fn()
      },
    }
  }

  it('★ keeps the town’s own sentence on the band when the director frame moves', () => {
    const { store, cutTo } = live({
      state: world(),
      threads: [thread({ id: 'th_1', beat: 'The well ran dry between them.' })],
      cut: null,
    })
    const el = document.createElement('div')
    document.body.append(el)
    host.push(el)
    const root = createRoot(el)
    act(() => {
      root.render(createElement(StoryStrip, { store, onChronicle: () => {} }))
    })
    expect(el.textContent).toContain('The well ran dry between them.')
    act(() => {
      cutTo(['maret'])
    })
    expect(el.textContent).toContain('The well ran dry between them.')
    act(() => {
      cutTo(['omar'])
    })
    expect(el.textContent).toContain('The well ran dry between them.')
    act(() => {
      root.unmount()
    })
  })
})

describe('★ the camera is usually not row one, and the screen has to agree with its own picture', () => {
  // The ribbon's head agrees with the cut on 47.9% of ticks by design. A strip that marks row one
  // contradicts the world under it about half the time.
  it('★ marks the third row, not the first, when the cut is cast in the third story', () => {
    const rows = [
      thread({ id: 'th_1', members: ['nadia', 'yusuf'] }),
      thread({ id: 'th_2', members: ['maret', 'omar'] }),
      thread({ id: 'th_3', members: ['ada', 'bo'] }),
    ]
    const html = draw(
      StoryStrip,
      town({
        state: world(),
        threads: rows,
        cut: stake({ sceneId: 'sc_3', agentIds: ['ada', 'bo'], why: 'Ada & Bo: falling out' }),
      }),
    )
    const lit = html.slice(html.indexOf('story-capsule lit'))
    expect(html.match(/story-capsule lit/g)).toHaveLength(1)
    expect(words(lit)).toContain('Ada & Bo')
    expect(words(lit)).toContain('On screen')
    expect(words(html.slice(0, html.indexOf('story-capsule lit')))).not.toContain('On screen')
  })

  it('★ the board lights the row the camera holds and no other', () => {
    const held = stake({ sceneId: 'sc_2', agentIds: ['maret'], score: 8, why: 'Maret: a slight' })
    const html = draw(
      ShotBoard,
      town({ state: world(), board: [stake({ score: 20 }), held], cut: held }),
    )
    expect(html.match(/shot-row lit/g)).toHaveLength(1)
    expect(words(html.slice(html.indexOf('shot-row lit')))).toContain('Maret')
  })
})
