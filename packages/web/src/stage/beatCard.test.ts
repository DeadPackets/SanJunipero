import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  GIVE_WAY_AFTER,
  MINUTES_PER_DAY,
  type Aim,
  type NameIndex,
  type SimEvent,
  type ThreadRow,
} from '@sj/shared'
import { SceneClosed, SceneLineSaid, SceneOpened } from '@sj/engine'
import type { TownScene } from '../state/worldStore.js'
import { createWorldStore } from '../state/worldStore.js'
import { createTension } from '../render/tension.js'
import {
  BeatCard,
  BeatCardBody,
  MOVE_WORDS,
  NO_MOVES,
  beatViewOf,
  readMoves,
  threadOf,
  tryOf,
  wantOf,
  type BeatArgs,
  type MoveBook,
} from './BeatCard.js'
import { NO_BOOK, NO_ROWS, createSceneLedger, type SceneBook } from './sceneLedger.js'

const AGENTS: NameIndex = { nadia: { name: 'Nadia' }, yusuf: { name: 'Yusuf' } }

const scene = (over: Partial<TownScene> = {}): TownScene => ({
  id: 'sc_1',
  kind: 'quarrel',
  participants: ['nadia', 'yusuf'],
  topic: null,
  stakes: 8,
  open: true,
  ...over,
})

const thread = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  id: 'th_1',
  members: ['nadia', 'yusuf'],
  heat: 12,
  peak: 24,
  state: 'rising',
  valence: -1,
  openedTick: 100,
  lastPaidTick: 900,
  terms: ['quarrel', 'slight'],
  ...over,
})

const aim = (agentId: string, goal: string | null): Aim => ({
  agentId,
  mood: null,
  goal,
  worry: null,
  goals: goal === null ? [] : [goal],
  worries: [],
  day: 3,
})

const args = (over: Partial<BeatArgs> = {}): BeatArgs => ({
  scene: scene(),
  agents: AGENTS,
  rows: NO_ROWS,
  moves: NO_MOVES,
  aims: [],
  threads: [],
  now: 900,
  ...over,
})

let seq = 0
const ev = (type: string, payload: unknown): SimEvent => {
  seq += 1
  return { seq, tick: seq, type, payload }
}

const said = (id: string, agentId: string, move: string): SimEvent =>
  ev('scene_line', SceneLineSaid.parse({ id, agentId, text: 'The well is mine.', move }))

describe('★ the try row: the move the world already records on every line', () => {
  it('★ keeps the newest move per room, and reads the ten the world may write', () => {
    expect(Object.keys(MOVE_WORDS).sort()).toEqual(
      [
        'agree',
        'ask',
        'deflect',
        'give_way',
        'joke',
        'none',
        'press',
        'shift',
        'tease',
        'tell',
      ].sort(),
    )
    let book: MoveBook = NO_MOVES
    book = readMoves(book, [said('sc_1', 'nadia', 'press'), said('sc_2', 'yusuf', 'joke')])
    expect(book).toEqual({
      sc_1: { agentId: 'nadia', move: 'press' },
      sc_2: { agentId: 'yusuf', move: 'joke' },
    })
    book = readMoves(book, [said('sc_1', 'yusuf', 'deflect')])
    expect(book.sc_1).toEqual({ agentId: 'yusuf', move: 'deflect' })
  })

  it('★ forgets a room the moment it closes, so a night of talking leaves no key behind', () => {
    let book = readMoves(NO_MOVES, [said('sc_1', 'nadia', 'press')])
    book = readMoves(book, [
      ev(
        'scene_closed',
        SceneClosed.parse({ id: 'sc_1', summary: 'x', deltas: [], closeReason: 'ended' }),
      ),
    ])
    expect(book).toEqual({})
  })

  it('reads no move off a line the world never wrote one on', () => {
    expect(
      readMoves(NO_MOVES, [ev('scene_line', { id: 'sc_1', agentId: 'nadia', move: 'sulk' })]),
    ).toBe(NO_MOVES)
    expect(readMoves(NO_MOVES, [ev('agent_spoke', { agentId: 'nadia', text: 'hello' })])).toBe(
      NO_MOVES,
    )
  })

  it('★ names whoever moved, and says nothing at all for a line doing nothing', () => {
    expect(tryOf({ agentId: 'nadia', move: 'press' }, AGENTS)).toBe('Nadia is pressing')
    expect(tryOf({ agentId: 'ghost_9', move: 'ask' }, AGENTS)).toBe('someone is asking')
    expect(tryOf({ agentId: 'nadia', move: 'none' }, AGENTS)).toBeNull()
    expect(tryOf(undefined, AGENTS)).toBeNull()
  })
})

describe('★ the want row: the town says it, or nobody does', () => {
  it('★ takes the topic the room opened on before anything else', () => {
    expect(wantOf(scene({ topic: 'the well' }), [aim('nadia', 'mend the roof')], thread())).toBe(
      'the well',
    )
  })

  it('★ falls to the first goal anybody in the room carries into the day', () => {
    expect(wantOf(scene(), [aim('yusuf', 'mend the roof')], thread())).toBe('mend the roof')
    // a blank goal is not a goal
    expect(wantOf(scene(), [aim('nadia', '  '), aim('yusuf', 'mend the roof')], thread())).toBe(
      'mend the roof',
    )
  })

  it('★ falls last to the two reasons this story weighs, in the camera’s own words', () => {
    expect(wantOf(scene(), [], thread())).toBe('falling out, a slight')
  })

  it('★ says nothing rather than invent one, where the town has written none', () => {
    expect(wantOf(scene(), [], null)).toBeNull()
    expect(wantOf(scene({ topic: '   ' }), [aim('nadia', null)], null)).toBeNull()
  })
})

describe('★ the story a room belongs to', () => {
  it('★ takes the widest overlap and never two rows, the way the ribbon lights a capsule', () => {
    const rows = [
      thread({ id: 'th_a', members: ['maret', 'omar'] }),
      thread({ id: 'th_b', members: ['nadia', 'yusuf', 'omar'] }),
    ]
    expect(threadOf(rows, ['nadia', 'yusuf'], 900)?.id).toBe('th_b')
    expect(threadOf(rows, ['maret'], 900)?.id).toBe('th_a')
  })

  it('marks nothing where the cast is in no story the gateway is running', () => {
    expect(threadOf([thread({ members: ['maret', 'omar'] })], ['nadia'], 900)).toBeNull()
    expect(threadOf([], ['nadia'], 900)).toBeNull()
  })
})

describe('★ the card, which omits a row rather than fake one', () => {
  it('★ draws only the rows the town has a source for', () => {
    expect(beatViewOf(args())?.rows).toEqual([])
    const full = beatViewOf(
      args({
        scene: scene({ topic: 'the well' }),
        moves: { sc_1: { agentId: 'nadia', move: 'press' } },
        rows: { turns: ['Yusuf gave way'], chips: [] },
      }),
    )
    expect(full?.rows).toEqual([
      { label: 'WANT', text: 'the well' },
      { label: 'TRY', text: 'Nadia is pressing' },
      { label: 'TURN', text: 'Yusuf gave way' },
    ])
  })

  it('★ shows the newest turn, not the first: a talk can turn twice', () => {
    const view = beatViewOf(
      args({ rows: { turns: ['Yusuf gave way', 'Nadia gave way'], chips: [] } }),
    )
    expect(view?.rows).toEqual([{ label: 'TURN', text: 'Nadia gave way' }])
  })

  it('★ heads the card with the room’s own prose, and with the story’s when it has none yet', () => {
    expect(beatViewOf(args({ scene: scene({ beat: 'They settled the well.' }) }))?.head?.text).toBe(
      'They settled the well.',
    )
    const carried = beatViewOf(
      args({
        threads: [thread({ beat: 'It began over water.', proseTick: 900 - MINUTES_PER_DAY })],
      }),
    )
    expect(carried?.head).toEqual({
      text: 'It began over water.',
      rung: 'beat',
      ageTicks: MINUTES_PER_DAY,
      stale: true,
    })
    expect(beatViewOf(args())?.head).toBeNull()
  })

  it('★ takes the eyebrow and its colour off the town’s own tables, never a new one', () => {
    expect(beatViewOf(args())).toMatchObject({ eyebrow: 'falling out', tone: 'cost' })
    expect(beatViewOf(args({ scene: scene({ kind: 'gathering' }) }))).toMatchObject({
      eyebrow: 'gathered at dusk',
      tone: 'gain',
    })
    expect(beatViewOf(args({ scene: scene({ kind: 'talk' }) }))?.tone).toBe('plain')
  })

  it('says nothing at all in the minutes the camera is on no room', () => {
    expect(beatViewOf(args({ scene: null }))).toBeNull()
  })

  it('carries four busts and says the rest as a count, never as a face too small to read', () => {
    const view = beatViewOf(
      args({ scene: scene({ participants: ['a', 'b', 'c', 'd', 'e', 'f'] }) }),
    )
    expect(view?.cast).toEqual(['a', 'b', 'c', 'd'])
    expect(view?.more).toBe(2)
  })
})

describe('★ what the card actually renders', () => {
  const view = (over: Partial<BeatArgs> = {}) => beatViewOf(args(over))!

  it('★ draws each row under its own label, in the town’s own sentence', () => {
    const html = renderToStaticMarkup(
      createElement(BeatCardBody, {
        view: view({
          scene: scene({ topic: 'the well' }),
          moves: { sc_1: { agentId: 'nadia', move: 'press' } },
        }),
      }),
    )
    expect(html).toContain('<dt class="beat-card-label">WANT</dt>')
    expect(html).toContain('<dd class="beat-card-text">the well</dd>')
    expect(html).toContain('<dd class="beat-card-text">Nadia is pressing</dd>')
    expect(html).not.toContain('TURN')
  })

  it('★ hands the closed room its chips, and marks the card closed so it collapses', () => {
    const html = renderToStaticMarkup(
      createElement(BeatCardBody, {
        view: view({
          scene: scene({ open: false, summary: 'They settled it.' }),
          rows: {
            turns: [],
            chips: [
              { tone: 'cost', text: 'He took the water.' },
              { tone: 'gain', text: 'She liked him for it.' },
            ],
          },
        }),
      }),
    )
    expect(html).toContain('data-open="off"')
    expect(html).toContain('<li class="beat-card-chip" data-tone="cost">He took the water.</li>')
    expect(html).toContain('<li class="beat-card-chip" data-tone="gain">She liked him for it.</li>')
  })

  it('★ renders no bare unbounded number and no machine id anywhere on it', () => {
    const html = renderToStaticMarkup(
      createElement(BeatCardBody, {
        view: view({
          scene: scene({ participants: ['nadia', 'yusuf', 'maret', 'omar', 'ghost_9'] }),
          threads: [thread({ heat: 2915, peak: 2915 })],
          moves: { sc_1: { agentId: 'nadia', move: 'press' } },
        }),
      }),
    )
    const words = html.replace(/<[^>]*>/g, ' ')
    expect(words).not.toMatch(/\b\d{4,}\b/)
    expect(words).not.toMatch(/\b(?:item|structure|fauna|crop|recipe)[_:]\w+/)
    expect(words).not.toMatch(/_/)
  })

  it('draws nothing at all before the store has a cut, and never throws doing it', () => {
    expect(renderToStaticMarkup(createElement(BeatCard, { store: createWorldStore() }))).toBe('')
  })

  // ★ The card is the one card in Watch and Deck. The sheet gates it on `at-watch`, so a card
  // that does not carry the class is up in Stage, where the plan has the world and nothing else.
  it('★ says which densities it belongs to, so the sheet can take it down in Stage', () => {
    const html = renderToStaticMarkup(createElement(BeatCardBody, { view: view() }))
    expect(html).toContain('class="beat-card at-watch"')
  })
})

describe('★ the card reads a talk that was already running when it mounted', () => {
  it('★ folds the turn and the chips off the page’s one ledger, not a second one', () => {
    const handlers: ((evts: SimEvent[]) => void)[] = []
    const onEvents = (fn: (evts: SimEvent[]) => void): (() => void) => {
      handlers.push(fn)
      return () => handlers.splice(handlers.indexOf(fn), 1)
    }
    const emit = (e: SimEvent): void => {
      for (const fn of [...handlers]) fn([e])
    }
    const ledger = createSceneLedger({
      getState: () => ({ agents: AGENTS }) as never,
      onEvents,
      tension: createTension({ onEvents }),
    })
    let book: SceneBook = NO_BOOK
    ledger.onChange((b) => {
      book = b
    })
    let moves: MoveBook = NO_MOVES
    onEvents((evts) => {
      moves = readMoves(moves, evts)
    })

    emit(
      ev(
        'scene_opened',
        SceneOpened.parse({
          id: 'sc_1',
          kind: 'quarrel',
          participants: ['nadia', 'yusuf'],
          topic: 'the well',
          stakes: 8,
        }),
      ),
    )
    for (let i = 0; i < GIVE_WAY_AFTER; i++) emit(said('sc_1', 'nadia', 'press'))
    emit(said('sc_1', 'yusuf', 'give_way'))

    expect(
      beatViewOf(args({ scene: scene({ topic: 'the well' }), rows: book.sc_1 ?? NO_ROWS, moves }))
        ?.rows,
    ).toEqual([
      { label: 'WANT', text: 'the well' },
      { label: 'TRY', text: 'Yusuf is giving way' },
      { label: 'TURN', text: 'Yusuf gave way' },
    ])
  })
})

describe('a head the town wrote a sim-day ago is kept and marked', () => {
  // `LadderLine.stale` was computed and read by nobody, so a day-old sentence stood at the top
  // of the card as if it were this minute.
  it('marks a stale head and leaves a fresh one alone', () => {
    const stale = beatViewOf(
      args({
        threads: [thread({ beat: 'It began over water.', proseTick: 900 - MINUTES_PER_DAY })],
      }),
    )
    expect(stale).not.toBeNull()
    expect(renderToStaticMarkup(createElement(BeatCardBody, { view: stale! }))).toContain(
      'data-stale="yes"',
    )
    const fresh = beatViewOf(args({ scene: scene({ beat: 'They settled the well.' }) }))
    expect(fresh).not.toBeNull()
    expect(renderToStaticMarkup(createElement(BeatCardBody, { view: fresh! }))).not.toContain(
      'data-stale',
    )
  })
})
