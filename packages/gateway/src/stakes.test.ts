import { describe, expect, it } from 'vitest'
import {
  MINUTES_PER_DAY,
  PEAK_SCORE,
  QUIET_BEAT_TICKS,
  scanRulingForGlassLeak,
  ServerDirector,
  STAKE_TERMS,
  SUMMARY_HOLD_TICKS,
  WHY_PHRASE,
  whyOf,
  type SimEvent,
} from '@sj/shared'
import { makeDirector, type Director } from './stakes.js'

const NAMES: Record<string, string> = {
  nadia: 'Nadia',
  yusuf: 'Yusuf',
  omar: 'Omar',
  salma: 'Salma',
  bashir: 'Bashir',
}
const nameOf = (id: string): string => NAMES[id] ?? id

let seq = 0
const ev = (tick: number, type: string, payload: unknown): SimEvent => ({
  seq: ++seq,
  tick,
  type,
  payload,
})

const director = (partners: Record<string, string> = {}): Director =>
  makeDirector(nameOf, (id) => partners[id] ?? null)

const QUARREL = 'scene_1000_aaaa1111'
const COUNCIL = 'scene_1000_bbbb2222'

const opened = (tick: number, id: string, kind: string, cast: string[], stakes: number): SimEvent =>
  ev(tick, 'scene_opened', { id, kind, participants: cast, topic: 'a thing said', stakes })
const turned = (tick: number, id: string, kind: string, cast: string[], stakes: number): SimEvent =>
  ev(tick, 'scene_turned', { id, kind, participants: cast, stakes })
const line = (tick: number, id: string, agentId: string, text: string, move: string): SimEvent =>
  ev(tick, 'scene_line', { id, agentId, text, move })
const closed = (tick: number, id: string, deltas: unknown[] = []): SimEvent =>
  ev(tick, 'scene_closed', { id, summary: 'It ended.', deltas, closeReason: 'ended' })

/** The design's own flow: a talk that becomes a quarrel, beside a harvest that scores nothing. */
function theQuarrel(d: Director, at = 1000): void {
  d.fold([
    opened(at, QUARREL, 'talk', ['nadia', 'yusuf'], 5),
    ev(at, 'crop_harvested', { agentId: 'omar' }),
    ev(at, 'structure_completed', { id: 'barn' }),
    turned(at + 3, QUARREL, 'quarrel', ['nadia', 'yusuf'], 8),
    line(at + 5, QUARREL, 'yusuf', 'I will never forgive that.', 'press'),
    line(at + 6, QUARREL, 'nadia', 'You said the word.', 'press'),
    line(at + 7, QUARREL, 'yusuf', 'And I meant it.', 'press'),
    line(at + 8, QUARREL, 'nadia', 'Take the planks then.', 'give_way'),
  ])
}

describe('the director follows the stakes', () => {
  it('takes the quarrel over the harvest, and names both people and the falling out', () => {
    const d = director()
    theQuarrel(d)
    const f = d.frame(1010)
    expect(ServerDirector.safeParse(f).success).toBe(true)
    expect(f.cut?.sceneId).toBe(QUARREL)
    expect(f.cut?.agentIds).toEqual(['nadia', 'yusuf'])
    // 8 stakes doubled, one strong word, a give-way after three presses, two firsts today
    expect(f.cut?.score).toBe(16 + 2 + 6 + 6)
    expect(f.cut?.why).toBe('Nadia & Yusuf — falling out, one of them gave way')
  })

  it('takes the council over the storm — a fire is weather and scores nothing', () => {
    const d = director()
    d.fold([
      ev(500, 'fire_ignited', { structureId: 'barn' }),
      ev(500, 'fire_spread', { toId: 'hut' }),
      opened(501, COUNCIL, 'council', ['omar', 'salma', 'bashir'], 8),
    ])
    const f = d.frame(505)
    expect(f.cut?.sceneId).toBe(COUNCIL)
    // 8 doubled, a rule in session, and 3 for the first council today
    expect(f.cut?.score).toBe(16 + 6 + 3)
    expect(f.cut?.why).toBe('Omar, Salma & Bashir — putting a rule to the room')
  })

  it('drops the opening kind when the talk turns, rather than saying both', () => {
    const d = director()
    d.fold([
      opened(1000, QUARREL, 'talk', ['nadia', 'yusuf'], 5),
      turned(1003, QUARREL, 'quarrel', ['nadia', 'yusuf'], 8),
    ])
    expect(d.frame(1004).cut?.why).not.toContain('talking')
  })
})

describe('the quiet beat after a peak', () => {
  it('holds the shot for the whole beat, then lets the better scene take it', () => {
    const d = director({ nadia: 'yusuf', yusuf: 'nadia' })
    theQuarrel(d)
    // 30 at the close: a peak, so the beat starts and the pair carry the tie deltas
    d.fold([
      closed(1010, QUARREL, [{ agentId: 'nadia', personId: 'yusuf', kind: 'grudge', text: 'x' }]),
    ])
    expect(d.frame(1010).quiet).toBe(true)

    // A council worth 22 opens inside the beat and takes nothing.
    d.fold([opened(1012, COUNCIL, 'council', ['omar', 'salma'], 8)])
    const inside = d.frame(1013)
    expect(inside.quiet).toBe(true)
    expect(inside.cut?.sceneId).toBe(QUARREL)

    const after = d.frame(1010 + QUIET_BEAT_TICKS)
    expect(after.quiet).toBe(false)
    expect(after.cut?.sceneId).toBe(COUNCIL)
  })

  it('holds a closed scene for its summary and no longer', () => {
    const d = director()
    theQuarrel(d)
    d.fold([closed(1010, QUARREL)])
    expect(d.frame(1010 + SUMMARY_HOLD_TICKS - 1).cut?.sceneId).toBe(QUARREL)
    expect(d.frame(1010 + SUMMARY_HOLD_TICKS + QUIET_BEAT_TICKS).cut).toBeNull()
  })
})

describe('hysteresis — the shot does not flicker', () => {
  it('keeps the incumbent against a rival a fifth better, and yields to one a third better', () => {
    // The first talk today is worth 10 and 3 for being the first; the second gets the 10 alone.
    const near = director()
    near.fold([opened(100, QUARREL, 'talk', ['nadia', 'yusuf'], 5)])
    expect(near.frame(101).cut?.score).toBe(13)
    near.fold([opened(101, COUNCIL, 'talk', ['omar', 'salma'], 8)])
    // 16 against 13 is 1.23x, under the sticky factor, so the shot does not move
    expect(near.frame(102).cut?.sceneId).toBe(QUARREL)

    const far = director()
    far.fold([opened(100, QUARREL, 'talk', ['nadia', 'yusuf'], 5)])
    expect(far.frame(101).cut?.sceneId).toBe(QUARREL)
    far.fold([opened(102, COUNCIL, 'talk', ['omar', 'salma'], 9)])
    // 18 against 13 is 1.38x, and the second talk takes it
    expect(far.frame(103).cut?.sceneId).toBe(COUNCIL)
  })
})

describe('the act marks', () => {
  it('runs null, I, II and III over one day and resets at midnight', () => {
    const d = director()
    const dawn = 6 * 60
    expect(d.frame(dawn - 1).act).toBeNull()
    d.fold([opened(dawn, QUARREL, 'talk', ['nadia', 'yusuf'], 5)])
    expect(d.frame(dawn + 1).act).toBe('I')
    d.fold([turned(14 * 60, QUARREL, 'quarrel', ['nadia', 'yusuf'], 9)])
    expect(d.frame(14 * 60 + 1).act).toBe('II')
    expect(d.frame(19 * 60).act).toBe('III')
    expect(d.frame(MINUTES_PER_DAY).act).toBeNull()
  })
})

describe('what the log pays for', () => {
  it('pays a term once a day, town-wide, and again after midnight', () => {
    const d = director()
    d.fold([ev(10, 'law_broken', { lawId: 'law_a', agentId: 'omar', verb: 'take', witnesses: [] })])
    const first = d.frame(10).cut!.score
    d.fold([
      ev(11, 'law_broken', { lawId: 'law_b', agentId: 'salma', verb: 'take', witnesses: [] }),
    ])
    // Omar's 12 is 9 + the first today; Salma is paid 9 alone and cannot outrank him.
    expect(first).toBe(12)
    expect(d.frame(11).cut?.agentIds).toEqual(['omar'])

    d.fold([
      ev(MINUTES_PER_DAY + 1, 'law_broken', {
        lawId: 'law_c',
        agentId: 'bashir',
        verb: 'take',
        witnesses: [],
      }),
    ])
    expect(d.frame(MINUTES_PER_DAY + 1).cut?.score).toBe(12)
  })

  it('pays a pair for their first night under one roof and never for the second', () => {
    const night = ev(10, 'co_slept', { aId: 'nadia', bId: 'yusuf', day: 0 })
    const once = director()
    once.fold([night])
    const twice = director()
    twice.fold([night, ev(11, 'co_slept', { aId: 'nadia', bId: 'yusuf', day: 1 })])
    expect(twice.frame(20).cut?.score).toBe(once.frame(20).cut?.score)
    expect(once.frame(20).cut?.why).toContain('a first night under one roof')
  })

  it('reads partners at odds off the partnership, not off the words', () => {
    const delta = [{ agentId: 'nadia', personId: 'yusuf', kind: 'slight', text: 'x' }]
    const strangers = director()
    strangers.fold([opened(10, QUARREL, 'talk', ['nadia', 'yusuf'], 5), closed(11, QUARREL, delta)])
    const partners = director({ nadia: 'yusuf', yusuf: 'nadia' })
    partners.fold([opened(10, QUARREL, 'talk', ['nadia', 'yusuf'], 5), closed(11, QUARREL, delta)])

    const held = 11 + SUMMARY_HOLD_TICKS
    expect(partners.frame(held).cut!.score).toBeGreaterThan(strangers.frame(held).cut!.score)
    expect(partners.frame(held).cut?.why).toContain('partners at odds')
  })

  it('says nothing about a refusal nobody saw, and pays one people watched', () => {
    const alone = director()
    alone.fold([
      ev(10, 'invitation_refused', {
        agentId: 'nadia',
        byId: 'yusuf',
        verb: 'court',
        witnesses: [],
      }),
    ])
    expect(alone.frame(10).cut).toBeNull()

    const seen = director()
    seen.fold([
      ev(10, 'invitation_refused', {
        agentId: 'nadia',
        byId: 'yusuf',
        verb: 'court',
        witnesses: ['omar'],
      }),
    ])
    expect(seen.frame(10).cut?.why).toContain('turned down in front of people')
  })

  it('gives a death the whole ninety seconds before a fresh talk outlives it', () => {
    const d = director()
    d.fold([ev(10, 'agent_died', { agentId: 'omar', cause: 'age' })])
    d.fold([opened(11, QUARREL, 'talk', ['nadia', 'yusuf'], 5)])
    // Inside the beat the death holds it whatever the talk is worth.
    expect(d.frame(12).cut?.agentIds).toEqual(['omar'])
    expect(d.frame(12).cut?.why).toContain('a death')
    expect(d.frame(200).cut?.sceneId).toBe(QUARREL)
  })
})

describe('the frame itself', () => {
  it('hands back the same cast array while nothing changes', () => {
    const d = director()
    theQuarrel(d)
    expect(d.frame(1010).cut!.agentIds).toBe(d.frame(1011).cut!.agentIds)
  })

  it('holds nothing at all before the town has done anything', () => {
    const f = director().frame(0)
    expect(f).toEqual({ t: 'director', tick: 0, cut: null, quiet: false, act: null })
  })
})

describe('the caption is the whole vocabulary', () => {
  it('gives every term a phrase, and no phrase is one of ours', () => {
    for (const term of STAKE_TERMS) {
      const phrase = WHY_PHRASE[term]
      expect(phrase, term).toBeTruthy()
      expect(phrase, term).not.toContain('_')
      expect(scanRulingForGlassLeak(phrase), term).toEqual([])
    }
  })

  it('renders every phrase into a sentence a reader could say out loud', () => {
    for (const term of STAKE_TERMS) {
      const said = whyOf('Nadia & Yusuf', [term])
      expect(scanRulingForGlassLeak(said), term).toEqual([])
      expect(said.startsWith('Nadia & Yusuf — '), term).toBe(true)
    }
  })

  it('never says the word a scene is filed under', () => {
    const d = director()
    d.fold([opened(10, COUNCIL, 'council', ['omar', 'salma'], 8)])
    const why = d.frame(11).cut!.why
    expect(why).not.toContain('council')
    expect(why).not.toContain('a thing said')
  })
})

describe('a resumed town', () => {
  it('does not stamp ACT I on a day that already had its scenes', async () => {
    const { default: Database } = await import('better-sqlite3')
    const db = new Database(':memory:')
    db.exec(
      'CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER, type TEXT, payload TEXT)',
    )
    const at = MINUTES_PER_DAY * 3 + 700
    db.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)').run(
      at - 100,
      'scene_opened',
      '{}',
    )
    db.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)').run(
      at - 90,
      'agent_died',
      '{}',
    )
    const d = director()
    d.prime(db, at)
    expect(d.frame(at).act).toBe('I')
    // The death is already spent, so the next one today is not the first.
    d.fold([ev(at, 'agent_died', { agentId: 'omar', cause: 'age' })])
    expect(d.frame(at).cut?.score).toBe(20)
    expect(PEAK_SCORE).toBeLessThanOrEqual(20)
    db.close()
  })
})
