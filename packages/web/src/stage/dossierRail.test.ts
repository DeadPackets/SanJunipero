import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, type StakeScore, type ThreadRow } from '@sj/shared'
import { genesisState, type WorldState } from '@sj/engine/state'
import { createWorldStore } from '../state/worldStore.js'
import { NEED_LOW } from '../ui/status.js'
import {
  DossierRail,
  DossierRailBody,
  dossiers,
  pressureIndex,
  railLabel,
  type Dossier,
} from './DossierRail.js'

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

const world = (...bodies: Body[]): WorldState => ({
  ...genesisState(DEFAULT_CONFIG),
  agents: Object.fromEntries(bodies.map((b) => [b.id, b])),
})

const stake = (over: Partial<StakeScore> = {}): StakeScore => ({
  sceneId: 'sc_1',
  agentIds: ['nadia', 'yusuf'],
  score: 20,
  why: 'Nadia & Yusuf: falling out',
  ...over,
})

const thread = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: 'th_1',
  members: ['nadia', 'maret'],
  heat: 12,
  peak: 24,
  state: 'rising',
  valence: -1,
  openedTick: 100,
  lastPaidTick: 900,
  terms: ['quarrel'],
  ...over,
})

const rail = (state: WorldState, over: Partial<Parameters<typeof dossiers>[1]> = {}): Dossier[] =>
  dossiers(state, { pressure: new Map(), cutCast: [], now: 1000, ...over })

const pressureOf = (list: readonly Dossier[], id: string): number =>
  list.find((d) => d.id === id)?.pressure ?? -1

describe('★ what a body has riding on it, on scales that already have a denominator', () => {
  it('reads the survey share and the story’s heat against its own peak', () => {
    const p = pressureIndex(
      [stake(), stake({ sceneId: 'sc_2', agentIds: ['maret'], score: 10 })],
      [],
    )
    expect(p.get('nadia')).toBe(1)
    expect(p.get('maret')).toBe(0.5)
  })

  it('takes the heavier of the two sources and never their sum', () => {
    const p = pressureIndex(
      [stake(), stake({ sceneId: 'sc_2', agentIds: ['maret'], score: 5 })],
      [thread({ heat: 24, peak: 24 })],
    )
    // Maret is a quarter of the survey's leader and the whole of her own story's peak.
    expect(p.get('maret')).toBe(1)
    expect(p.get('nadia')).toBe(1)
  })

  it('leaves a body in no scene and no story out, which is zero and not a guess', () => {
    expect(pressureIndex([], []).get('omar')).toBeUndefined()
    expect(pressureOf(rail(world(body('omar', 'Omar'))), 'omar')).toBe(0)
  })

  it('never returns a share above one, whatever a bad frame carries', () => {
    const p = pressureIndex([], [thread({ heat: 2915, peak: 12 })])
    expect(p.get('nadia')).toBe(1)
  })
})

describe('one card per living body, in the order the town has them', () => {
  const town = world(
    body('nadia', 'Nadia'),
    body('yusuf', 'Yusuf'),
    body('maret', 'Maret'),
    body('omar', 'Omar', { alive: false }),
  )

  it('leaves out anyone no longer living', () => {
    expect(rail(town).map((d) => d.id)).not.toContain('omar')
    expect(rail(town)).toHaveLength(3)
  })

  it('ranks by pressure, and settles a tie on the name so the order does not flicker', () => {
    const list = rail(town, { pressure: new Map([['maret', 0.8]]) })
    expect(list.map((d) => d.name)).toEqual(['Maret', 'Nadia', 'Yusuf'])
    expect(list.map((d) => d.rank)).toEqual([0, 1, 2])
  })

  it('★ puts the camera’s own cast first, whatever the survey says about them', () => {
    const list = rail(town, { pressure: new Map([['maret', 0.8]]), cutCast: ['yusuf'] })
    expect(list.map((d) => d.name)).toEqual(['Yusuf', 'Maret', 'Nadia'])
    expect(list[0]!.onScreen).toBe(true)
  })

  it('says nothing at all before the world has arrived', () => {
    expect(dossiers(null, { pressure: new Map(), cutCast: [], now: 0 })).toEqual([])
  })
})

describe('the state line and the one ring', () => {
  it('takes the word off the town’s own table, with the minutes still to run', () => {
    const at = rail(
      world(body('nadia', 'Nadia', { activity: { verb: 'fish', ticksRemaining: 40, params: {} } })),
    )
    expect(at[0]!.line).toContain('Fishing')
    expect(at[0]!.line).toContain('40')
  })

  it('rings nothing while nothing is critical', () => {
    const list = rail(world(body('nadia', 'Nadia')))
    expect(list[0]!.condition).toBeNull()
    expect(railLabel(list[0]!)).toBe('Nadia')
  })

  it('★ rings once and once only, even with three conditions standing', () => {
    const hurting = body('nadia', 'Nadia', {
      ill: true,
      injuries: [{ kind: 'minor', day: 2 }],
      needs: { hunger: NEED_LOW - 1, energy: 90, warmth: 90, social: 90 },
    })
    const d = rail(world(hurting))[0]!
    expect(d.condition).toBe('unwell')
    expect(railLabel(d)).toBe('Nadia, Unwell')
  })

  it('names a missed meal in the town’s own condition word, not a bar', () => {
    const hungry = body('nadia', 'Nadia', {
      needs: { hunger: NEED_LOW - 1, energy: 90, warmth: 90, social: 90 },
    })
    const d = rail(world(hungry))[0]!
    expect(d.condition).toBe('hungry')
    expect(railLabel(d)).toBe('Nadia, Hungry')
  })
})

describe('what the rail actually renders', () => {
  it('★ prints no raw heat, whatever the frame is carrying', () => {
    const list = rail(world(body('nadia', 'Nadia'), body('yusuf', 'Yusuf')), {
      pressure: pressureIndex([stake({ score: 2915 })], [thread({ heat: 1740, peak: 1740 })]),
    })
    const words = renderToStaticMarkup(createElement(DossierRailBody, { cards: list })).replace(
      /<[^>]*>/g,
      ' ',
    )
    expect(words).not.toMatch(/\b\d{4,}\b/)
    expect(words).not.toMatch(/_/)
  })

  it('draws a card per body with its name and its state, and lights the one on screen', () => {
    const list = rail(world(body('nadia', 'Nadia'), body('yusuf', 'Yusuf')), { cutCast: ['yusuf'] })
    const html = renderToStaticMarkup(createElement(DossierRailBody, { cards: list }))
    expect(html).toContain('Nadia')
    expect(html).toContain('Yusuf')
    expect(html).toContain('Between things')
    expect(html.match(/dossier-card lit/g)).toHaveLength(1)
  })

  it('draws nothing at all before the store has a world, and never throws doing it', () => {
    expect(renderToStaticMarkup(createElement(DossierRail, { store: createWorldStore() }))).toBe('')
  })
})

// ★ Several quiet edges lit at once across the rail is the clearest statement the interface can
// make that these are minds, and it makes it without a single spinner.
describe('★ the rail says which of these are thinking', () => {
  it('marks only the bodies with a call in flight', () => {
    const list = rail(world(body('nadia', 'Nadia'), body('yusuf', 'Yusuf')), {
      deciding: new Set(['yusuf']),
    })
    const html = renderToStaticMarkup(createElement(DossierRailBody, { cards: list }))
    expect(html.match(/data-deciding/g)).toHaveLength(1)
    expect(list.find((d) => d.id === 'yusuf')?.deciding).toBe(true)
    expect(list.find((d) => d.id === 'nadia')?.deciding).toBe(false)
  })

  it('marks nobody off the live edge, where the frame does not exist', () => {
    const list = rail(world(body('nadia', 'Nadia')))
    const html = renderToStaticMarkup(createElement(DossierRailBody, { cards: list }))
    expect(html).not.toContain('data-deciding')
  })

  it('reads the store, so a mind frame reaches a card without a second wire', () => {
    const store = createWorldStore()
    store.applyServer({
      t: 'snapshot',
      tick: 0,
      seq: 1,
      state: world(body('nadia', 'Nadia'), body('yusuf', 'Yusuf')),
      config: DEFAULT_CONFIG,
      laws: {},
      live: true,
    })
    store.applyServer({ t: 'mind', agentId: 'nadia', tick: 3, state: 'deciding' })
    const html = renderToStaticMarkup(createElement(DossierRail, { store }))
    expect(html.match(/data-deciding/g)).toHaveLength(1)
  })
})
