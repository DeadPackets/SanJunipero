import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DAYS_PER_YEAR, GIVE_WAY_AFTER, momentTitle, type SimEvent } from '@sj/shared'
import { SceneClosed, SceneLineSaid, SceneOpened } from '@sj/engine'
import type { AgentBody, Structure, WorldState } from '@sj/engine/state'
import type { TownScene } from '../state/worldStore.js'
import {
  CARD_HOLD_MS,
  SceneCard,
  SceneCardBody,
  cutOf,
  sceneCardOf,
  showCard,
  strikeCard,
  type SceneCardText,
} from './SceneCard.js'
import { NO_BOOK, NO_ROWS, createSceneLedger, type SceneBook } from './sceneLedger.js'
import { createTension } from '../render/tension.js'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'

const N = 8
const body = (id: string, name: string, x: number, y: number): AgentBody => ({
  id,
  name,
  x,
  y,
  alive: true,
  asleep: false,
  needs: { hunger: 80, energy: 80, warmth: 80, social: 80 },
  hp: 100,
  injuries: [],
  ill: false,
  ageDays: 30 * DAYS_PER_YEAR,
  skills: {},
  activity: null,
  collapsedSinceTick: null,
  zeroHungerSinceTick: null,
})

const FIRE: Structure = {
  id: 'structure_fire_pit_3_3',
  kind: 'fire_pit',
  x: 3,
  y: 3,
  w: 1,
  h: 1,
  hp: 20,
  maxHp: 20,
  flammable: true,
  stage: 'complete',
  progressTicks: 0,
  builtBy: null,
  burning: false,
  burnTicks: 0,
}

const WORLD: WorldState = {
  tick: 900,
  terrain: Array.from({ length: N }, () => Array.from({ length: N }, () => 0)),
  weather: { kind: 'sunny', temperatureC: 12 },
  agents: { nadia: body('nadia', 'Nadia', 3, 4), yusuf: body('yusuf', 'Yusuf', 4, 4) },
  structures: { [FIRE.id]: FIRE },
  items: {},
  crops: {},
  wildlife: { fish: 1, deer: 1 },
  counters: { nextEntityId: 1 },
} as unknown as WorldState

/** Far from anything the town has a word for: the ground has no name and no thing is near. */
const NOWHERE: WorldState = {
  ...WORLD,
  agents: { nadia: body('nadia', 'Nadia', 7, 7), yusuf: body('yusuf', 'Yusuf', 7, 6) },
  structures: {},
}

const scene = (over: Partial<TownScene> = {}): TownScene => ({
  id: 'sc_1',
  kind: 'quarrel',
  participants: ['nadia', 'yusuf'],
  topic: 'the well',
  stakes: 8,
  open: true,
  ...over,
})

/** The store as the socket leaves it: the scenes the town has told this viewer about, and a
 *  world under them. */
function town(...held: TownScene[]): WorldStore {
  const store = createWorldStore()
  for (const s of held) store.applyServer({ t: 'scene', scene: s })
  return { ...store, getState: () => WORLD }
}

describe('★ the card a cut opens with: where the camera is, and who is in it', () => {
  it('★ names the place and the people, in the town’s own words', () => {
    expect(strikeCard(town(scene()), ['nadia', 'yusuf'], 'sc_1')).toEqual({
      title: momentTitle('quarrel', null),
      where: 'At the fire pit · Nadia & Yusuf',
    })
  })

  it('★ titles the cut only with the scene the cut is OF', () => {
    // the town holds one room; a cut scored on another one must not borrow its word
    const store = town(scene())
    expect(strikeCard(store, ['nadia', 'yusuf'], 'sc_2')?.title).toBeNull()
    // ...and a body-level cut, a death or a birth, is of no scene at all
    expect(strikeCard(store, ['nadia'], null)?.title).toBeNull()
    // ...and the other room's own word comes back the moment the cut is on it
    const both = town(scene(), scene({ id: 'sc_2', kind: 'gathering' }))
    expect(strikeCard(both, ['nadia', 'yusuf'], 'sc_2')?.title).toBe(momentTitle('gathering', null))
  })

  it('★ prints the names alone where the ground has no name worth saying', () => {
    expect(sceneCardOf(NOWHERE, ['nadia', 'yusuf'], null)).toEqual({
      title: null,
      where: 'Nadia & Yusuf',
    })
  })

  it('★ never prints a machine id, a slug or a tile', () => {
    for (const world of [WORLD, NOWHERE, { ...WORLD, agents: {} }]) {
      const card = sceneCardOf(world, ['nadia', 'yusuf'], scene())
      if (card === null) continue
      for (const text of [card.where, card.title ?? '']) {
        expect(text).not.toMatch(/\b(?:item|structure|fauna|crop|recipe)[_:]\w+/)
        expect(text).not.toMatch(/\(?\b\d+\s*,\s*\d+\b\)?/)
        expect(text).not.toMatch(/_/)
      }
    }
  })

  it('says nothing at all with nobody in frame, or before the town has arrived', () => {
    expect(strikeCard(town(scene()), [], 'sc_1')).toBeNull()
    expect(sceneCardOf(null, ['nadia'], scene())).toBeNull()
  })
})

describe('★ what the card actually renders', () => {
  it('★ draws the stamp and the line, and nothing when there is no cut', () => {
    const html = renderToStaticMarkup(
      createElement(SceneCard, { store: town(scene()), cast: ['nadia', 'yusuf'], sceneId: 'sc_1' }),
    )
    // The card is struck in an effect off the store, so the server pass draws the empty slot;
    // what matters here is that it never throws and never leaks a class the sheet has no rule for.
    expect(html).toBe('')
  })

  it('★ every name on it comes through the one id-to-prose door', () => {
    // a body the snapshot has dropped is said as the town says it, never as the id it carries
    expect(strikeCard(town(scene()), ['nadia', 'ghost_9'], 'sc_1')?.where).toBe(
      'At the fire pit · Nadia & someone',
    )
  })
})

describe('★ the card is struck at the cut and never re-read', () => {
  const FIRE_SIDE: SceneCardText = { title: 'A quarrel', where: 'At the fire pit · Nadia & Yusuf' }
  const WELL_SIDE: SceneCardText = { title: 'A quarrel', where: 'At the well · Nadia & Yusuf' }
  const CUT = cutOf(['nadia', 'yusuf'], 'sc_1')
  const ROW = { turns: ['Yusuf gave way'], chips: [] }

  /** the town walks on between one strike and the next */
  function walking(): { strike: () => SceneCardText; strikes: () => number } {
    let strikes = 0
    return {
      strike: () => {
        strikes += 1
        return strikes === 1 ? FIRE_SIDE : WELL_SIDE
      },
      strikes: () => strikes,
    }
  }

  it('★ keeps the words it was struck with when the talk leaves a row two minutes later', () => {
    const walked = walking()
    const first = showCard(null, CUT, NO_ROWS, 0, walked.strike)
    expect(first.card).toEqual(FIRE_SIDE)
    const later = showCard(first, CUT, ROW, 120_000, walked.strike)
    expect(later.card).toEqual(FIRE_SIDE)
    expect(walked.strikes()).toBe(1)
  })

  it('★ stands the same card back up for another six seconds when a row arrives', () => {
    expect(CARD_HOLD_MS).toBe(6000)
    const first = showCard(null, CUT, NO_ROWS, 1000, () => FIRE_SIDE)
    expect(first.untilMs).toBe(1000 + CARD_HOLD_MS)
    const later = showCard(first, CUT, ROW, 20_000, () => WELL_SIDE)
    expect(later.untilMs).toBe(20_000 + CARD_HOLD_MS)
    expect(later.rows).toBe(ROW)
  })

  it('★ is one cut while the people and the scene are, whatever array they arrive in', () => {
    const first = showCard(null, CUT, NO_ROWS, 1000, () => FIRE_SIDE)
    const again = showCard(first, cutOf(['nadia', 'yusuf'], 'sc_1'), NO_ROWS, 5000, () => WELL_SIDE)
    expect(again).toBe(first)
    expect(again.untilMs).toBe(1000 + CARD_HOLD_MS)
  })

  it('strikes the town again the moment the cut moves to somebody else', () => {
    const walked = walking()
    const first = showCard(null, CUT, NO_ROWS, 0, walked.strike)
    const next = showCard(first, cutOf(['maret'], null), NO_ROWS, 9000, walked.strike)
    expect(next.card).toEqual(WELL_SIDE)
    expect(next.untilMs).toBe(9000 + CARD_HOLD_MS)
    expect(walked.strikes()).toBe(2)
  })

  it('holds nothing up for a cut the town could not strike a card for', () => {
    expect(showCard(null, cutOf([], null), NO_ROWS, 0, () => null).card).toBeNull()
  })
})

describe('the ledger a talk leaves behind, which nothing has ever drawn', () => {
  const delta = (kind: string, text: string, settled?: true): unknown => ({
    agentId: 'nadia',
    personId: 'yusuf',
    kind,
    text,
    ...(settled === undefined ? {} : { settled }),
  })

  /** The socket, and the page's one fold of what comes down it. Both stand before any card
   *  does: a viewer who opens the page mid-talk gets the talk the town is already having. */
  type Wire = {
    /** the world says a thing, exactly as the socket delivers it */
    emit: (type: string, payload: unknown) => void
    open: (id: string) => void
    say: (id: string, agentId: string, move: string) => void
    close: (id: string, deltas: unknown[]) => void
    store: Parameters<typeof createSceneLedger>[0]
  }

  type Harness = Wire & {
    book: () => SceneBook
    books: SceneBook[]
  }

  function wire(): Wire {
    const handlers: ((evts: SimEvent[]) => void)[] = []
    const onEvents = (fn: (evts: SimEvent[]) => void): (() => void) => {
      handlers.push(fn)
      return () => handlers.splice(handlers.indexOf(fn), 1)
    }
    let seq = 0
    const emit = (type: string, payload: unknown): void => {
      seq += 1
      for (const fn of [...handlers]) fn([{ seq, tick: seq, type, payload }])
    }
    return {
      emit,
      store: { getState: () => WORLD, onEvents, tension: createTension({ onEvents }) },
      open: (id) => {
        emit(
          'scene_opened',
          SceneOpened.parse({
            id,
            kind: 'quarrel',
            participants: ['nadia', 'yusuf'],
            topic: 'the well',
            stakes: 8,
          }),
        )
      },
      say: (id, agentId, move) => {
        emit('scene_line', SceneLineSaid.parse({ id, agentId, text: 'The well is mine.', move }))
      },
      close: (id, deltas) => {
        emit(
          'scene_closed',
          SceneClosed.parse({ id, summary: 'They settled it.', deltas, closeReason: 'ended' }),
        )
      },
    }
  }

  function harness(w: Wire = wire()): Harness {
    const ledger = createSceneLedger(w.store)
    const books: SceneBook[] = []
    ledger.onChange((b) => books.push(b))
    return { ...w, books, book: () => books[books.length - 1] ?? NO_BOOK }
  }

  const THREE = [
    delta('slight', 'Yusuf took the last of the water and said nothing.'),
    delta('promise', 'Nadia will carry for him at first light.'),
    delta('attraction', 'He liked how she stood up to him.'),
  ]

  it('draws one chip per delta, in the town’s own sentence, unaltered', () => {
    const h = harness()
    h.close('sc_1', THREE)
    expect(h.book().sc_1?.chips.map((c) => c.text)).toEqual([
      'Yusuf took the last of the water and said nothing.',
      'Nadia will carry for him at first light.',
      'He liked how she stood up to him.',
    ])
  })

  it('colours a chip by what the town’s own table says that tie is worth', () => {
    const h = harness()
    h.close('sc_1', [
      delta('slight', 'He took the water.'),
      delta('attraction', 'She liked him for it.'),
      delta('promise', 'He said he would come back.'),
      delta('promise', 'He came back.', true),
    ])
    expect(h.book().sc_1?.chips.map((c) => c.tone)).toEqual(['cost', 'gain', 'plain', 'gain'])
  })

  it('shows no chip at all for a close that changed nothing, and no placeholder for one', () => {
    const h = harness()
    h.close('sc_1', [])
    expect(h.book().sc_1).toEqual({ turns: [], chips: [] })
  })

  it('makes no chip out of a delta the town wrote no sentence for', () => {
    const h = harness()
    h.close('sc_1', [delta('debt', '   '), delta('slight', 'He took the water.')])
    expect(h.book().sc_1?.chips.map((c) => c.text)).toEqual(['He took the water.'])
  })

  it('writes one TURN row per turn, naming whoever gave way', () => {
    const h = harness()
    h.open('sc_1')
    for (let i = 0; i < GIVE_WAY_AFTER; i++) h.say('sc_1', 'nadia', 'press')
    h.say('sc_1', 'yusuf', 'give_way')
    expect(h.book().sc_1?.turns).toEqual(['Yusuf gave way'])
    for (let i = 0; i < GIVE_WAY_AFTER; i++) h.say('sc_1', 'yusuf', 'press')
    h.say('sc_1', 'nadia', 'give_way')
    expect(h.book().sc_1?.turns).toEqual(['Yusuf gave way', 'Nadia gave way'])
  })

  it('★ writes the turn of a talk that was already running when the card was first drawn', () => {
    // one fold, made where the store is: a second one built at mount never heard the talk open,
    // and the turn it gives way on is a line about nothing.
    const w = wire()
    w.open('sc_1')
    for (let i = 0; i < GIVE_WAY_AFTER; i++) w.say('sc_1', 'nadia', 'press')
    const h = harness(w)
    w.say('sc_1', 'yusuf', 'give_way')
    expect(h.book().sc_1?.turns).toEqual(['Yusuf gave way'])
  })

  it('writes no row for somebody letting a thing go that nobody pressed', () => {
    const h = harness()
    h.open('sc_1')
    h.say('sc_1', 'nadia', 'press')
    h.say('sc_1', 'yusuf', 'give_way')
    expect(h.books).toEqual([])
  })

  it('names the yielder in prose even where the town has lost the body', () => {
    const h = harness()
    h.emit(
      'scene_opened',
      SceneOpened.parse({
        id: 'sc_1',
        kind: 'talk',
        participants: ['nadia', 'ghost_9'],
        topic: null,
        stakes: 5,
      }),
    )
    for (let i = 0; i < GIVE_WAY_AFTER; i++) h.say('sc_1', 'nadia', 'press')
    h.say('sc_1', 'ghost_9', 'give_way')
    expect(h.book().sc_1?.turns[0]).toBe('someone gave way')
  })

  it('leaves the framed scene’s ledger exactly where it was when another room closes', () => {
    const h = harness()
    h.close('sc_1', THREE)
    const held = h.book().sc_1
    expect(held?.chips).toHaveLength(3)
    h.close('sc_2', [delta('kin', 'They found they share a grandmother.')])
    expect(h.book().sc_1).toBe(held)
  })

  it('holds a handful of scenes and no more, so a town left running does not grow one', () => {
    const h = harness()
    for (let i = 0; i < 12; i++) h.close(`sc_${String(i)}`, THREE)
    expect(Object.keys(h.book())).toEqual([
      'sc_4',
      'sc_5',
      'sc_6',
      'sc_7',
      'sc_8',
      'sc_9',
      'sc_10',
      'sc_11',
    ])
  })

  it('★ carries the town’s own sentences onto the card, from the close to the markup', () => {
    const h = harness()
    h.open('sc_1')
    for (let i = 0; i < GIVE_WAY_AFTER; i++) h.say('sc_1', 'nadia', 'press')
    h.say('sc_1', 'yusuf', 'give_way')
    h.close('sc_1', THREE)
    const card = strikeCard(town(scene()), ['nadia', 'yusuf'], 'sc_1')!
    const html = renderToStaticMarkup(
      createElement(SceneCardBody, { card, rows: h.book().sc_1 ?? NO_ROWS }),
    )
    expect(html).toContain('<span class="scene-card-turn">Yusuf gave way</span>')
    for (const said of [
      'Yusuf took the last of the water and said nothing.',
      'Nadia will carry for him at first light.',
      'He liked how she stood up to him.',
    ])
      expect(html).toContain(said)
    expect(html.match(/scene-card-chip/g)).toHaveLength(3)
  })

  it('★ draws no chip and no row for a close that changed nothing', () => {
    const h = harness()
    h.close('sc_1', [])
    const card = strikeCard(town(scene()), ['nadia', 'yusuf'], 'sc_1')!
    const html = renderToStaticMarkup(
      createElement(SceneCardBody, { card, rows: h.book().sc_1 ?? NO_ROWS }),
    )
    expect(html).not.toContain('scene-card-chip')
    expect(html).not.toContain('scene-card-turn')
    expect(html).toContain('At the fire pit · Nadia &amp; Yusuf')
  })

  it('puts every row on the card itself, and nothing where the ledger is empty', () => {
    const card = { title: 'A quarrel', where: 'At the fire pit · Nadia & Yusuf' }
    const rows = {
      turns: ['Yusuf gave way'],
      chips: [
        { tone: 'cost' as const, text: 'He took the water.' },
        { tone: 'gain' as const, text: 'She liked him for it.' },
      ],
    }
    const html = renderToStaticMarkup(createElement(SceneCardBody, { card, rows }))
    expect(html).toContain('<span class="scene-card-turn">Yusuf gave way</span>')
    expect(html).toContain('<span class="scene-card-chip" data-tone="cost">He took the water.')
    expect(html).toContain('<span class="scene-card-chip" data-tone="gain">She liked him for it.')
    const bare = renderToStaticMarkup(createElement(SceneCardBody, { card, rows: NO_ROWS }))
    expect(bare).not.toContain('scene-card-chip')
    expect(bare).not.toContain('scene-card-turn')
  })
})
