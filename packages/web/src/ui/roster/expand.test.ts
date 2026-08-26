import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  bondFrom,
  type Bond,
  type BondAct,
  type BondKind,
  type BondsResponse,
  type SimEvent,
} from '@sj/shared'
import { GAMIFICATION_BAN } from '../townStats.js'
import { changeLog } from '../becoming.js'
import { EMPTY_LINEAGE, type LineageLike } from '../bondModel2.js'
import { parseRoute, routeToPath } from '../route.js'
import { RosterPanelView } from '../RosterPanel.js'
import { RosterExpanded } from './RosterExpanded.js'
import { rosterRows2 } from './rosterRow.js'
import {
  ALWAYS_SHOWN,
  CLOSED,
  SECTION_EMPTY,
  SECTION_TITLE,
  SKILL_BANDS,
  actsOf,
  becomingOf,
  expandReducer,
  skillBand,
  type BecomingInput,
  type ExpandState,
} from './expand.js'
import type { TileId, WorldState } from '@sj/engine/state'

const DAY = 1440 // MINUTES_PER_DAY — one tick is one sim-minute
const IDS = ['amara', 'nadia', 'yusuf']

// AUDIT R3's six literals — the placeholders that described an empty person
const R3_LITERALS = ['Their mind is quiet.', 'Still learning everything.']

const at = (tick: number, kind: BondKind): BondAct => ({ tick, kind })

const bond = (aId: string, bId: string, _kind: BondKind, acts: BondAct[], asOfTick = 0): Bond =>
  bondFrom(aId, bId, acts, asOfTick)
const api = (bonds: Bond[]): BondsResponse => ({ bonds, asOfTick: 0 })

const input = (over: Partial<BecomingInput> = {}): BecomingInput => ({
  id: 'amara',
  name: 'Amara',
  nowTick: 0,
  skills: {},
  acts: [],
  bonds: null,
  lineage: EMPTY_LINEAGE,
  people: { amara: 'Amara', nadia: 'Nadia', yusuf: 'Yusuf' },
  changes: [],
  ...over,
})

// ── THE REDUCER ────────────────────────────────────────────────────────────────────────────
describe('expandReducer — one row open, and never a state shaped like nothing', () => {
  it('toggles open and closed', () => {
    const open = expandReducer(CLOSED, { kind: 'toggle', id: 'amara' }, IDS)
    expect(open).toEqual({ openId: 'amara' })
    expect(expandReducer(open, { kind: 'toggle', id: 'amara' }, IDS)).toEqual(CLOSED)
  })

  it('opening a second row closes the first', () => {
    const first: ExpandState = { openId: 'amara' }
    expect(expandReducer(first, { kind: 'toggle', id: 'yusuf' }, IDS)).toEqual({ openId: 'yusuf' })
  })

  it('close from any state clears, and is the same object when already closed', () => {
    expect(expandReducer({ openId: 'nadia' }, { kind: 'close' }, IDS)).toEqual(CLOSED)
    expect(expandReducer(CLOSED, { kind: 'close' }, IDS)).toBe(CLOSED)
  })

  it('next and prev move within the list and WRAP', () => {
    expect(expandReducer({ openId: 'amara' }, { kind: 'next' }, IDS)).toEqual({ openId: 'nadia' })
    expect(expandReducer({ openId: 'yusuf' }, { kind: 'next' }, IDS)).toEqual({ openId: 'amara' })
    expect(expandReducer({ openId: 'amara' }, { kind: 'prev' }, IDS)).toEqual({ openId: 'yusuf' })
    expect(expandReducer(CLOSED, { kind: 'next' }, IDS)).toEqual({ openId: 'amara' })
    expect(expandReducer(CLOSED, { kind: 'prev' }, IDS)).toEqual({ openId: 'yusuf' })
  })

  it('an id the list does not hold is ignored, and an empty list never opens', () => {
    expect(expandReducer(CLOSED, { kind: 'toggle', id: 'nobody' }, IDS)).toBe(CLOSED)
    expect(expandReducer(CLOSED, { kind: 'next' }, [])).toBe(CLOSED)
  })
})

// ── ★ THE BUG THAT CANNOT COME BACK ───────────────────────────────────────────────────────
describe('expanding never removes the way back, because the list never goes away', () => {
  const state: WorldState = {
    tick: 0,
    terrain: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0 as TileId)),
    weather: { kind: 'sunny', temperatureC: 12 },
    agents: Object.fromEntries(
      IDS.map((id, i) => [
        id,
        {
          id,
          name: id[0]!.toUpperCase() + id.slice(1),
          x: i,
          y: 0,
          alive: true,
          asleep: false,
          needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
          hp: 100,
          injuries: [],
          ill: false,
          ageDays: 30 * 364,
          skills: {},
          activity: null,
          collapsedSinceTick: null,
          zeroHungerSinceTick: null,
        },
      ]),
    ) as WorldState['agents'],
    structures: {},
    items: {},
    crops: {},
    wildlife: { fish: 1, deer: 1 },
    counters: { nextEntityId: 1 },
  }
  const rows = rosterRows2(state, [], null, 0)

  const render = (openId: string | null): string =>
    renderToStaticMarkup(
      createElement(RosterPanelView, {
        rows,
        gone: 0,
        sort: 'name' as const,
        openId,
        becomingOf: (id: string) => becomingOf(input({ id, name: id })),
        onSort: () => {},
        onToggle: () => {},
        onOpenFull: () => {},
      }),
    )

  it('★ EVERY reachable state still renders every row of the list', () => {
    for (const openId of [null, ...IDS]) {
      const html = render(openId)
      expect(html.match(/class="roster-row/g)?.length, String(openId)).toBe(rows.length)
      for (const id of IDS) expect(html, `${openId} / ${id}`).toContain(`data-row="${id}"`)
    }
  })

  it('exactly one row is marked open, and only when one is', () => {
    expect(render(null)).not.toContain('aria-expanded="true"')
    const html = render('nadia')
    expect(html.match(/aria-expanded="true"/g)?.length).toBe(1)
    expect(html).toContain('class="roster-expanded"')
  })

  it('the open row is a button carrying aria-expanded, so it is reachable by keyboard', () => {
    const html = render('amara')
    expect(html).toMatch(/<button[^>]*data-row="amara"[^>]*aria-expanded="true"/)
  })
})

// ── THE ROUTE ──────────────────────────────────────────────────────────────────────────────
describe('?open= is a third state of the lens, and every landed route still round-trips', () => {
  it('carries the open row in the address bar', () => {
    const r = parseRoute('/', '?lens=inspector&open=amara')
    expect(r.openId).toBe('amara')
    expect(r.agentId).toBeNull()
    expect(routeToPath(r)).toBe('/?lens=inspector&open=amara')
  })

  it('is independent of ?agent=, which still opens the standalone page', () => {
    const deep = parseRoute('/', '?lens=inspector&agent=amara')
    expect(deep.agentId).toBe('amara')
    expect(deep.openId).toBeNull()
    expect(routeToPath(deep)).toBe('/?lens=inspector&agent=amara')
  })

  it('an address with neither is the plain roster', () => {
    expect(parseRoute('/', '?lens=inspector').openId).toBeNull()
  })
})

// ── DAY 0: honest, and never a description of an empty person ─────────────────────────────
describe('becomingOf on a day-0 person', () => {
  const b = becomingOf(input())

  it('every section is empty, and every empty line is present in the markup', () => {
    expect(b.done).toEqual([])
    expect(b.knows).toEqual([])
    expect(b.good).toEqual([])
    expect(b.changed).toEqual([])
    expect(b.lived).toBe(SECTION_EMPTY.lived)
    const html = renderToStaticMarkup(
      createElement(RosterExpanded, { becoming: b, onOpenFull: () => {} }),
    )
    for (const k of ALWAYS_SHOWN) {
      if (k === 'lived') continue
      expect(html, k).toContain(SECTION_EMPTY[k])
      expect(html, k).toContain(SECTION_TITLE[k])
    }
  })

  it('★ each line says THIS PERSON has not done it — never that the town has not started', () => {
    for (const k of Object.keys(SECTION_EMPTY) as Array<keyof typeof SECTION_EMPTY>) {
      const line = SECTION_EMPTY[k]
      expect(line, k).toMatch(/\bthey\b/i)
      expect(line, k).not.toMatch(/the town has|nothing has happened|no one walks|not started/i)
      expect(line, k).not.toMatch(GAMIFICATION_BAN)
      expect(line, k).not.toMatch(/\d/)
    }
  })

  it('none of audit R3’s literals survives anywhere in the section copy', () => {
    const all = [...Object.values(SECTION_EMPTY), ...Object.values(SECTION_TITLE)].join(' ')
    for (const gone of R3_LITERALS) expect(all).not.toContain(gone)
  })

  it('`wants` is empty today and its section does not render AT ALL', () => {
    expect(b.wants).toEqual([])
    const html = renderToStaticMarkup(
      createElement(RosterExpanded, { becoming: b, onOpenFull: () => {} }),
    )
    expect(html).not.toContain('data-section="wants"')
    expect(html).not.toContain(SECTION_TITLE.wants)
  })
})

// ── DAY 5: full, and ordered so the newest is what a viewer reads first ───────────────────
describe('becomingOf on a person the run has made something of', () => {
  const bonds = api([
    bond('amara', 'nadia', 'owe', [at(4 * DAY, 'owe'), at(5 * DAY, 'owe'), at(5 * DAY, 'friend')]),
    bond('amara', 'yusuf', 'friend', [at(5 * DAY, 'friend')]),
  ])
  const b = becomingOf(
    input({
      nowTick: 5 * DAY,
      skills: { farming: 40, fishing: 2 },
      acts: [
        { tick: 1 * DAY, words: 'put a crop in the ground' },
        { tick: 5 * DAY, words: 'brought a harvest in' },
        { tick: 3 * DAY, words: 'finished a building' },
      ],
      bonds,
      changes: changeLog([
        { version: 1, day: 0, doc: 'a', edit: 'first written' },
        { version: 2, day: 4, doc: 'b', edit: 'after the flood' },
      ]),
    }),
  )

  it('says how long they have lived here, in words rather than as a stat', () => {
    expect(b.lived).toBe('Five days in the town.')
    expect(b.lived).not.toMatch(/\d/)
  })

  // WHAT THE BROWSER CAUGHT: "One days in the town."
  it('can count to one', () => {
    expect(becomingOf(input({ nowTick: DAY })).lived).toBe('One day in the town.')
    expect(becomingOf(input({ nowTick: 2 * DAY })).lived).toBe('Two days in the town.')
    expect(becomingOf(input({ nowTick: 0 })).lived).toBe(SECTION_EMPTY.lived)
  })

  it('`done` is non-empty and ordered by day DESCENDING', () => {
    expect(b.done.length).toBeGreaterThan(0)
    expect(b.done.map((d) => d.day)).toEqual([...b.done.map((d) => d.day)].sort((x, y) => y - x))
    expect(b.done[0]!.day).toBe(5)
  })

  it('`knows` is sorted by level then name, and each line is a sentence', () => {
    expect(b.knows.map((k) => k.name)).toEqual(['Nadia', 'Yusuf'])
    expect(b.knows[0]!.level).toBe('acquaintances')
    expect(b.knows[1]!.level).toBe('strangers')
    for (const k of b.knows) {
      expect(k.words).toContain('Amara')
      expect(k.words).toContain(k.name)
      expect(k.words).not.toMatch(GAMIFICATION_BAN)
    }
  })

  it('`good` is bands in words, with NO digit and no "level"', () => {
    expect(b.good.length).toBe(2)
    for (const g of b.good) {
      expect(g.words).not.toMatch(/\d/)
      expect(g.words).not.toMatch(GAMIFICATION_BAN)
    }
    expect(b.good[0]!.words).toContain('farming')
  })

  it('`changed` carries only the versions that actually moved something', () => {
    expect(b.changed).toEqual([{ day: 4, words: 'after the flood' }])
  })

  // P22.4: the display cannot flatten two people the run treated differently
  it('★ two people with identical genesis and different logs are DIFFERENT objects', () => {
    const quiet = becomingOf(input({ id: 'yusuf', name: 'Yusuf', nowTick: 5 * DAY }))
    expect(b).not.toEqual(quiet)
    expect(b.done).not.toEqual(quiet.done)
    expect(b.knows).not.toEqual(quiet.knows)
  })

  it('is pure — the same input twice gives the same becoming', () => {
    expect(becomingOf(input({ nowTick: 5 * DAY, bonds }))).toEqual(
      becomingOf(input({ nowTick: 5 * DAY, bonds })),
    )
  })
})

describe('skillBand — five bands and no arithmetic reaches a viewer', () => {
  it('is monotonic and never emits a number', () => {
    let last = ''
    const seen: string[] = []
    for (const xp of [0, 3, 5, 11, 20, 50, 100, 10_000]) {
      const w = skillBand(xp)
      expect(w).not.toMatch(/\d/)
      expect(w).not.toMatch(GAMIFICATION_BAN)
      if (w !== last) seen.push(w)
      last = w
    }
    expect(seen).toEqual(SKILL_BANDS.map((b) => b.words))
  })
})

describe('actsOf — what they DID, from the log and nowhere else', () => {
  it('reads the bond history and the live feed, and nobody else’s acts', () => {
    const bonds = api([bond('amara', 'nadia', 'owe', [at(10, 'owe')])])
    const events: SimEvent[] = [
      { seq: 1, tick: 20, type: 'crop_harvested', payload: { agentId: 'amara' } } as SimEvent,
      { seq: 2, tick: 21, type: 'crop_harvested', payload: { agentId: 'yusuf' } } as SimEvent,
      { seq: 3, tick: 22, type: 'weather_changed', payload: { agentId: 'amara' } } as SimEvent,
    ]
    const acts = actsOf('amara', bonds, events)
    expect(acts.map((a) => a.words).sort()).toEqual(['brought a harvest in', 'gave something away'])
  })

  it('a person with no log has done nothing, which is not an error', () => {
    expect(actsOf('amara', null, [])).toEqual([])
  })
})

describe('the rendered expansion', () => {
  const b = becomingOf(
    input({
      nowTick: 2 * DAY,
      skills: { farming: 40 },
      acts: [{ tick: DAY, words: 'finished a building' }],
    }),
  )
  const html = renderToStaticMarkup(
    createElement(RosterExpanded, { becoming: b, onOpenFull: () => {} }),
  )

  it('is a labelled group with a keyboard-reachable way into the whole page', () => {
    expect(html).toContain('aria-label="Who they have become"')
    expect(html).toMatch(/<button[^>]*class="rx-full"/)
  })

  it('carries no gamification anywhere in its prose', () => {
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(GAMIFICATION_BAN)
  })
})
