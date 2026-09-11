import { describe, expect, it } from 'vitest'
import {
  MINUTES_PER_DAY,
  THREAD_TOP_N,
  QUIET_BEAT_TICKS,
  ServerThreads,
  THREAD_MEMBER_CAP,
  THREAD_SILENCE_TICKS,
  THREAD_TURN_WEIGHT,
  type SimEvent,
  type StakeTerm,
  type ThreadRow,
} from '@sj/shared'
import { makeDirector } from './stakes.js'
import { makeThreads, type Threads } from './threads.js'

const NAMES: Record<string, string> = {
  nadia: 'Nadia',
  yusuf: 'Yusuf',
  omar: 'Omar',
  salma: 'Salma',
  bashir: 'Bashir',
  hana: 'Hana',
}

let seq = 0
const ev = (tick: number, type: string, payload: unknown): SimEvent => ({
  seq: ++seq,
  tick,
  type,
  payload,
})

const opened = (tick: number, id: string, kind: string, cast: string[], stakes: number): SimEvent =>
  ev(tick, 'scene_opened', { id, kind, participants: cast, topic: 'a thing said', stakes })
const line = (tick: number, id: string, agentId: string, text: string): SimEvent =>
  ev(tick, 'scene_line', { id, agentId, text, move: 'say' })
const closed = (tick: number, id: string, summary: string, beat?: string): SimEvent =>
  ev(tick, 'scene_closed', {
    id,
    summary,
    deltas: [],
    closeReason: 'ended',
    ...(beat ? { beat } : {}),
  })

/** The gateway's own pair: one event pass, two folds, which is how the pump runs it. */
function town(): { fold: (events: readonly SimEvent[]) => void; threads: Threads } {
  const threads = makeThreads()
  const director = makeDirector(
    (id) => NAMES[id] ?? id,
    () => null,
    threads.pay,
  )
  return {
    threads,
    fold(events) {
      director.fold(events)
      threads.fold(events)
    },
  }
}

/** The one story still running. A story merged away ships one closed row on its way out, and
 *  these tests are about the one that outlived it. */
const survivor = (t: Threads, tick: number): ThreadRow => {
  const rows = t.frame(tick).threads.filter((r) => r.state !== 'closed')
  expect(rows).toHaveLength(1)
  return rows[0]!
}

const only = (t: Threads, tick: number): ThreadRow => {
  const f = t.frame(tick)
  expect(ServerThreads.safeParse(f).success).toBe(true)
  expect(f.threads).toHaveLength(1)
  return f.threads[0]!
}

describe('a thread is keyed by pair edges', () => {
  it('pays every pair of a three-body scene, so any two of them are the same story', () => {
    const t = town()
    t.fold([opened(10, 'scene_a', 'council', ['nadia', 'yusuf', 'omar'], 8)])
    const one = only(t.threads, 11)
    expect(one.members).toEqual(['nadia', 'omar', 'yusuf'])
    // Each of the three pairs the scene made is inside that one story, not beside it.
    t.threads.pay(['nadia', 'yusuf'], 'slight', 6, 12, null)
    t.threads.pay(['nadia', 'omar'], 'slight', 6, 13, null)
    t.threads.pay(['yusuf', 'omar'], 'slight', 6, 14, null)
    const still = only(t.threads, 15)
    expect(still.id).toBe(one.id)
  })

  it('keeps two pairs that share one body apart', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    t.pay(['nadia', 'omar'], 'talk', 10, 1, null)
    expect(t.frame(2).threads).toHaveLength(2)
  })

  it('★ takes one payment per term per tick, at the heaviest weight offered', () => {
    // A civic term pays every witness. Twenty of them on one tick is one council, not twenty.
    const t = makeThreads()
    const witnesses = ['nadia', 'yusuf', 'omar', 'salma']
    for (let w = 1; w <= 20; w++) t.pay(witnesses, 'council', w, 7, null)
    expect(only(t, 7).heat).toBe(20)
  })

  it('holds the cap against a whole council talking in one minute', () => {
    const t = town()
    const cast = ['nadia', 'yusuf', 'omar']
    t.fold([opened(10, 'scene_a', 'council', cast, 8)])
    const base = only(t.threads, 10).heat
    t.fold(cast.map((id) => line(11, 'scene_a', id, 'I swear I never promised that.')))
    // Three lines, two strong words each, one lexicon payment of 4 for the whole minute.
    expect(only(t.threads, 11).heat).toBe(base + 4)
  })

  it('★ a merge carries the tick cap, so one pair is not paid twice in one minute', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    t.pay(['omar', 'salma'], 'talk', 10, 5, null)
    // The four of them talking is a second thing that happened, and it merges the two stories.
    t.pay(['nadia', 'yusuf', 'omar', 'salma'], 'talk', 10, 5, null)
    expect(survivor(t, 5).heat).toBe(20)
    // That same pair again in the same minute is the same talk, and pays nothing.
    t.pay(['omar', 'salma'], 'talk', 10, 5, null)
    expect(survivor(t, 5).heat).toBe(20)
  })

  it('★ two different pairs both get paid for a promise broken in the same minute', () => {
    // The cap used to be per story, and it swallowed 270 of 498 promise_broken weight in one
    // recorded log because two pairs broke a promise inside the same minute.
    const t = makeThreads()
    t.pay(['nadia', 'yusuf', 'omar', 'salma'], 'council', 16, 0, null)
    t.pay(['nadia', 'yusuf'], 'promise_broken', 6, 1, null)
    t.pay(['omar', 'salma'], 'promise_broken', 6, 1, null)
    expect(only(t, 1).heat).toBe(28)
  })

  it('★ one payment names a story once, whatever number of its edges the cast touches', () => {
    // A room of six, holding one story of four. Its six inside pairs are one payment and not
    // six: heat is a story's temperature, not a headcount.
    const t = makeThreads()
    const four = ['nadia', 'yusuf', 'omar', 'salma']
    t.pay(four, 'council', 16, 0, null)
    const one = only(t, 0).id
    t.pay([...four, 'bashir', 'hana'], 'gathering', 6, 0, null)
    expect(t.census(0).find((r) => r.id === one)?.heat).toBe(22)
  })

  it('★ a gathering of twelve does not become one story', () => {
    // Transitive welding left one story holding twelve members and the head of the ribbon on
    // 100% of three separate sim-days. A story is at most four people, and never the room.
    const t = makeThreads()
    const room = Array.from({ length: 12 }, (_, i) => `p${i}`)
    t.pay(room, 'gathering', 12, 0, null)
    const rows = t.census(1)
    expect(rows.length).toBeGreaterThan(1)
    for (const r of rows) expect(r.members.length).toBeLessThanOrEqual(THREAD_MEMBER_CAP)
  })

  it('★ a wide cast feeds the story that already holds an edge instead of opening one', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'quarrel', 14, 0, null)
    const was = t.census(1)[0]!
    t.pay(
      ['nadia', 'yusuf', ...Array.from({ length: 10 }, (_, i) => `p${i}`)],
      'gathering',
      12,
      2,
      null,
    )
    const now = t.census(3).find((r) => r.id === was.id)!
    expect(now.members).toEqual(['nadia', 'yusuf'])
    expect(now.heat).toBeGreaterThan(was.heat)
  })

  it('★ keeps a wide room’s own line off a pair that was only in the room', () => {
    // A real log closed four rooms of five and six with a beat, and every one went to the two
    // members that sorted first: `Leyla makes Amara wait` was about to be printed as the story
    // of Amara and Farida, who is not in the line at all.
    const t = makeThreads()
    t.pay(['amara', 'farida', 'leyla', 'nadia', 'tariq'], 'gathering', 12, 0, 'scene_9449')
    t.fold([closed(1, 'scene_9449', 'Nadia sets the search order.', 'Leyla makes Amara wait.')])
    const rows = t.census(2)
    expect(rows.length).toBeGreaterThan(1)
    for (const r of rows) {
      expect(r.beat).toBeUndefined()
      expect(r.summary).toBeUndefined()
    }
  })

  it('★ a merge that would take a story past four members does not happen', () => {
    const t = makeThreads()
    t.pay(['amara', 'bashir', 'chadi'], 'council', 16, 0, null)
    t.pay(['dilara', 'esma', 'farida'], 'council', 16, 1, null)
    // Two members of each, in one payment. Welding them would make a story of six.
    t.pay(['amara', 'bashir', 'dilara', 'esma'], 'gathering', 12, 2, null)
    const rows = t.census(3)
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r.members.length).toBeLessThanOrEqual(THREAD_MEMBER_CAP)
  })

  it('merges two stories that come to share two members, and keeps the higher peak', () => {
    const t = makeThreads()
    const late = THREAD_SILENCE_TICKS - 2
    t.pay(['nadia', 'yusuf'], 'agent_born', 20, 0, null)
    t.pay(['omar', 'salma'], 'talk', 10, late, null)
    expect(t.frame(late).threads).toHaveLength(2)
    t.pay(['nadia', 'yusuf', 'omar', 'salma'], 'lexicon', 2, late + 1, null)
    const one = survivor(t, late + 1)
    expect(one.members).toEqual(['nadia', 'yusuf', 'omar', 'salma'])
    // Heat is the hotter of the two plus the payment, never the sum of both.
    expect(one.heat).toBeCloseTo(16.14, 2)
    expect(one.peak).toBe(20)
  })
})

describe('heat is a four sim-day memory', () => {
  it('runs the four sim-day curve for as long as the story is alive to read it', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'agent_born', 20, 0, null)
    expect(only(t, 0).heat).toBe(20)
    // Silence ends a story before its heat can halve, so the curve is read inside that window.
    expect(only(t, THREAD_SILENCE_TICKS - 1).heat).toBeCloseTo(14.14, 2)
  })
})

describe('every state word is derived', () => {
  it('opens on the first payment and rises while heat climbs on one side', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    expect(only(t, 1).state).toBe('opened')
    t.pay(['nadia', 'yusuf'], 'attraction', 4, 2, null)
    t.pay(['nadia', 'yusuf'], 'gathering', 12, 3, null)
    t.pay(['nadia', 'yusuf'], 'telling', 12, 4, null)
    expect(only(t, 5).state).toBe('rising')
  })

  it('★ a ten sim-day old story that is still being fed reads rising and never opened', () => {
    // The ribbon printed `opened` on a ten sim-day-old story at 8 of 10 day boundaries: no
    // ordinary payment could beat four sim-days of decay, so `rising` was permanently false
    // and `opened` was the fall-through. The largest word on screen said what was not true.
    const t = makeThreads()
    const words: string[] = []
    for (let m = 0; m <= 10 * MINUTES_PER_DAY; m += 30) {
      t.pay(['bashir', 'farida'], 'talk', 10, m, null)
      t.pay(['bashir', 'farida'], 'lexicon', 4, m + 1, null)
      if (m > 0 && m % MINUTES_PER_DAY === 0) words.push(only(t, m + 2).state)
    }
    expect(words).toHaveLength(10)
    expect([...new Set(words)]).toEqual(['rising'])
  })

  it('holds after a sim day with nothing said, while its heat is still above the floor', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'partnership_formed', 12, 0, null)
    t.pay(['nadia', 'yusuf'], 'co_slept_first', 8, 1, null)
    t.pay(['nadia', 'yusuf'], 'talk', 10, 2, null)
    expect(only(t, MINUTES_PER_DAY + 2).state).toBe('held')
  })

  it('★ cools when a payment no longer keeps up with what the story forgets', () => {
    // Half of its own peak was a floor no live story could reach: heat halves in four sim-days
    // and silence ends a story in two. `cooling` read zero times over two whole logs.
    const t = makeThreads()
    // A quarrel that strained a marriage, and then nothing but the odd strong word.
    t.pay(['nadia', 'yusuf'], 'quarrel', 14, 0, null)
    t.pay(['nadia', 'yusuf'], 'slight', 6, 1, null)
    t.pay(['nadia', 'yusuf'], 'partnership_strained', 10, 2, null)
    expect(only(t, 3).state).toBe('rising')
    t.pay(['nadia', 'yusuf'], 'lexicon', 2, MINUTES_PER_DAY, null)
    const cooled = only(t, MINUTES_PER_DAY + 1)
    expect(cooled.state).toBe('cooling')
    expect(cooled.heat).toBeGreaterThan(cooled.peak / 2)
    t.pay(['nadia', 'yusuf'], 'quarrel', 14, MINUTES_PER_DAY + 2, null)
    expect(only(t, MINUTES_PER_DAY + 3).state).toBe('rising')
  })

  it('★ says `opened` only of a story that is new, whatever it has been paid', () => {
    // A story with two payments a sim-day apart stayed under the opening count for as long as
    // it lived, and one real log printed `opened` on rows up to 2.4 sim-days old.
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    expect(only(t, MINUTES_PER_DAY - 1).state).toBe('opened')
    expect(only(t, MINUTES_PER_DAY).state).toBe('held')
    t.pay(['nadia', 'yusuf'], 'talk', 10, MINUTES_PER_DAY, null)
    expect(only(t, MINUTES_PER_DAY + 1).state).not.toBe('opened')
  })

  it('closes on a parting, and the next quarrel between the two is a new story', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'partnership_formed', 12, 0, null)
    t.pay(['nadia', 'yusuf'], 'partnership_dissolved', 14, 5, null)
    expect(only(t, 6).state).toBe('closed')
    t.pay(['nadia', 'yusuf'], 'quarrel', 16, 9, null)
    const rows = t.frame(10).threads
    expect(rows.map((r) => r.state).sort()).toEqual(['closed', 'opened'])
    expect(rows[0]!.id).not.toBe(rows[1]!.id)
    expect(rows.find((r) => r.state === 'opened')?.terms).toEqual(['quarrel'])
  })

  it('★ closes after two sim days with nobody touching it', () => {
    // The floor test was unreachable: a story at heat 10 took 15.3 sim-days to close and one at
    // 174 took 31.7. Silence is a fact a viewer can check against the same frame.
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    expect(only(t, THREAD_SILENCE_TICKS - 1).state).not.toBe('closed')
    expect(only(t, THREAD_SILENCE_TICKS).state).toBe('closed')
  })

  it('★ does not come back from the dead when the town went quiet instead of parting', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    const gone = THREAD_SILENCE_TICKS
    expect(only(t, gone).state).toBe('closed')
    t.pay(['nadia', 'yusuf'], 'quarrel', 16, gone + 1, null)
    const rows = t.frame(gone + 1).threads
    expect(rows.map((r) => r.state).sort()).toEqual(['closed', 'opened'])
    expect(rows[0]!.id).not.toBe(rows[1]!.id)
  })

  it('★ turns on a payment against the running sign at weight 6, and not at weight 5', () => {
    const warm = (): Threads => {
      const t = makeThreads()
      t.pay(['nadia', 'yusuf'], 'attraction', 4, 0, null)
      t.pay(['nadia', 'yusuf'], 'co_slept_first', 8, 1, null)
      return t
    }
    const light = warm()
    light.pay(['nadia', 'yusuf'], 'slight', THREAD_TURN_WEIGHT - 1, 3, null)
    expect(only(light, 4).state).not.toBe('turned')

    const heavy = warm()
    heavy.pay(['nadia', 'yusuf'], 'slight', THREAD_TURN_WEIGHT, 3, null)
    expect(only(heavy, 4).state).toBe('turned')
    // The reversal is a compulsory held beat, and then the story goes on.
    expect(only(heavy, 3 + QUIET_BEAT_TICKS).state).not.toBe('turned')
  })

  it('★ a reversal outranks how new the story is, and how long it has been quiet', () => {
    // Precedence, not fall-through: the same payment that turns a story is only its third.
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'attraction', 4, 0, null)
    t.pay(['nadia', 'yusuf'], 'slight', THREAD_TURN_WEIGHT, 1, null)
    expect(only(t, 1).state).toBe('turned')
  })

  it('keeps the sign of what it is made of', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'quarrel', 16, 0, null)
    t.pay(['nadia', 'yusuf'], 'slight', 6, 1, null)
    expect(only(t, 2).valence).toBe(-1)
  })

  it('★ says nothing about the warmth arrow, which needs a bond graph this fold cannot read', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'quarrel', 16, 0, null)
    expect(only(t, 1).arc).toBeUndefined()
  })
})

describe('the ranking', () => {
  /** Every weight below is one the town's own table makes: a talk scene is
   *  `STAKES_BY_KIND.talk * SCENE_STAKES_X` = 10, a quarrel 14, a strong word 2 a hit. The
   *  heats are the shape the ten sim-day log printed, hundreds on a pair the town keeps talking
   *  to and ten on a chat nobody came back to. */
  const hot = (t: Threads, until: number): void => {
    for (let m = 0; m < until; m += 240) {
      t.pay(['bashir', 'farida'], 'talk', 10, m, null)
      t.pay(['bashir', 'farida'], 'lexicon', 4, m + 1, null)
    }
  }

  it('★ puts a live quarrel over the hottest story, and that over an idle chat', () => {
    const t = makeThreads()
    const now = 6 * MINUTES_PER_DAY
    hot(t, now)
    t.pay(['dilara', 'leyla'], 'talk', 10, now - 600, null)
    t.pay(['nadia', 'yusuf'], 'quarrel', 14, now - 1, null)
    const rows = t.frame(now).threads
    expect(rows.map((r) => r.members.join('+'))).toEqual([
      'nadia+yusuf',
      'bashir+farida',
      'dilara+leyla',
    ])
    // The quarrel and the chat are worth exactly what the town's own table pays them.
    expect(rows[0]!.heat).toBe(14)
    expect(rows[2]!.heat).toBeCloseTo(9.3, 2)
    // Six sim-days of the town talking to one pair every four sim-hours. The ten sim-day log
    // printed 341.3 for its hottest pair on day 1 and 416.4 on day 2.
    expect(rows[1]!.heat).toBeGreaterThan(300)
  })

  it('★ a story is a fraction of a peak moment, so a fresh town and a ten-day one rank alike', () => {
    // The old term was `0.35 * heat` against an unbounded running sum, and it won 2.70% of
    // 548,008 rank samples on one log. No fixed coefficient passes the plan's own ordering test
    // when the denominator is missing.
    const young = makeThreads()
    hot(young, MINUTES_PER_DAY)
    young.pay(['nadia', 'yusuf'], 'talk', 10, MINUTES_PER_DAY - 1, null)
    expect(young.frame(MINUTES_PER_DAY).threads[0]!.members).toEqual(['bashir', 'farida'])

    const old = makeThreads()
    hot(old, 8 * MINUTES_PER_DAY)
    old.pay(['nadia', 'yusuf'], 'quarrel', 14, 8 * MINUTES_PER_DAY - 1, null)
    expect(old.frame(8 * MINUTES_PER_DAY).threads[0]!.members).toEqual(['nadia', 'yusuf'])
  })

  it('★ with no live story the story term is zero and never a division by nothing', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'partnership_formed', 12, 0, null)
    t.pay(['nadia', 'yusuf'], 'partnership_dissolved', 14, 1, null)
    const row = t.frame(2).threads[0]!
    expect(row.state).toBe('closed')
    expect(Number.isFinite(row.heat)).toBe(true)
  })
})

describe('an offline replay reads the whole census', () => {
  it('hands the ribbon six and a replay every story standing', () => {
    const t = makeThreads()
    for (let i = 0; i < 8; i++) t.pay([`a${i}`, `b${i}`], 'talk', 10, i, null)
    expect(t.frame(10).threads).toHaveLength(THREAD_TOP_N)
    expect(t.census(10)).toHaveLength(8)
  })

  it('counts what no row can show: opened, merged away, and dropped as the coldest', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    t.pay(['omar', 'salma'], 'talk', 10, 1, null)
    t.pay(['nadia', 'yusuf', 'omar', 'salma'], 'lexicon', 2, 2, null)
    expect(t.stats()).toEqual({ made: 2, merged: 1, dropped: 0 })
    for (let i = 0; i < 40; i++) t.pay([`a${i}`, `b${i}`], 'talk', 10, 3, null)
    expect(t.stats().dropped).toBe(1)
  })

  it('★ drops a story that ended before the coldest one still running', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'partnership_formed', 12, 0, null)
    t.pay(['nadia', 'yusuf'], 'partnership_dissolved', 14, 1, null)
    const dead = t.census(1)[0]!.id
    // A parting leaves more heat behind than any live talk, so picking by heat alone kept it.
    for (let i = 0; i < 40; i++) t.pay([`a${i}`, `b${i}`], 'talk', 10, 2, null)
    expect(t.stats().dropped).toBe(1)
    expect(t.census(2).find((r) => r.id === dead)?.state).toBe('closed')
    expect(t.census(2 + QUIET_BEAT_TICKS).map((r) => r.id)).not.toContain(dead)
  })
})

describe('screen time fades', () => {
  /** Two stories of equal weight, both kept alive at the same minutes. Whoever holds the head
   *  of the ribbon pays the screen-time term, so the head changes hands on fatigue alone. */
  const twins = (t: Threads, tick: number): void => {
    t.pay(['nadia', 'yusuf'], 'talk', tick === 0 ? 40 : 10, tick, null)
    t.pay(['omar', 'salma'], 'talk', tick === 0 ? 40 : 10, tick, null)
  }

  it('★ fades on a one sim-day half life, so the ribbon never settles on one couple', () => {
    const t = makeThreads()
    twins(t, 0)
    const perDay = [0, 0, 0, 0, 0, 0]
    let last = ''
    for (let tick = 0; tick <= 6 * MINUTES_PER_DAY; tick++) {
      if (tick > 0 && tick % 240 === 0) twins(t, tick)
      const head = t.frame(tick).threads[0]!.id
      if (head === last) continue
      last = head
      const day = Math.floor(tick / MINUTES_PER_DAY)
      if (day < perDay.length) perDay[day] = (perDay[day] ?? 0) + 1
    }
    // Fatigue that never faded handed the ribbon over once a sim-day by day three and less
    // after that: a challenger missed the bar by 1% at t=5760 and three sim-days saw no change.
    for (const day of [2, 3, 4, 5]) expect(perDay[day] ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('★ a merge takes the larger fatigue and never the sum', () => {
    const t = makeThreads()
    twins(t, 0)
    for (let tick = 0; tick <= 2000; tick++) {
      if (tick > 0 && tick % 240 === 0) twins(t, tick)
      // A wedding and the gathering after it, for a pair the ribbon has never shown.
      if (tick === 1800) {
        t.pay(['bashir', 'hana'], 'partnership_formed', 12, tick, null)
        t.pay(['bashir', 'hana'], 'gathering', 12, tick, null)
      }
      t.frame(tick)
    }
    // A birth takes the head, so every row under it is placed by rank alone.
    t.pay(['kamal', 'leyla'], 'agent_born', 18, 2001, null)
    t.pay(['nadia', 'yusuf', 'omar', 'salma'], 'gathering', 12, 2002, null)
    // Two stories that each led the ribbon led the same screen. Summing the two fatigues drops
    // the merged story under a pair nobody has watched at all.
    const running = t.census(2003).filter((r) => r.state !== 'closed')
    expect(running.map((r) => r.members.join('+'))).toEqual([
      'kamal+leyla',
      'nadia+omar+salma+yusuf',
      'bashir+hana',
    ])
  })
})

describe('a story that ended', () => {
  it('★ shows its ending for one beat and then leaves the ribbon to the living', () => {
    const t = makeThreads()
    t.pay(['omar', 'salma'], 'partnership_formed', 20, 100, null)
    t.pay(['omar', 'salma'], 'partnership_dissolved', 20, 200, null)
    t.pay(['nadia', 'yusuf'], 'quarrel', 8, 300, null)
    const at = (tick: number): ThreadRow[] => t.frame(tick).threads
    expect(at(200)[0]?.state).toBe('closed')
    expect(at(200 + QUIET_BEAT_TICKS - 1).some((r) => r.state === 'closed')).toBe(true)
    // Its leftover heat outranked a live quarrel for three sim-days before this.
    expect(at(300).map((r) => r.members)).toEqual([['nadia', 'yusuf']])
    expect(at(300 + 3 * MINUTES_PER_DAY).every((r) => r.state !== 'closed')).toBe(true)
  })
})

describe('a capsule may not vanish', () => {
  it('★ a story merged away says so once, closed, naming what it became', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 10, 0, null)
    t.pay(['omar', 'salma'], 'talk', 10, 0, null)
    expect(t.census(0)).toHaveLength(2)
    t.pay(['nadia', 'yusuf', 'omar', 'salma'], 'gathering', 12, 1, null)
    expect(ServerThreads.safeParse(t.frame(1)).success).toBe(true)
    const rows = t.census(1)
    const kept = rows.filter((r) => r.state !== 'closed')
    expect(kept).toHaveLength(1)
    const last = rows.find((r) => r.id !== kept[0]!.id)!
    expect(last.state).toBe('closed')
    expect(last.became).toBe(kept[0]!.id)
    expect(last.members).toEqual(['omar', 'salma'])
    // One beat, the same one a closed story already gets, and then it leaves the ribbon.
    expect(t.census(1 + QUIET_BEAT_TICKS).map((r) => r.id)).not.toContain(last.id)
  })

  it('★ a story dropped as the coldest says it is over, with nothing it became', () => {
    const t = makeThreads()
    t.pay(['nadia', 'yusuf'], 'talk', 1, 0, null)
    const cold = t.census(0)[0]!.id
    for (let i = 0; i < 40; i++) t.pay([`a${i}`, `b${i}`], 'talk', 10, 1, null)
    expect(t.stats().dropped).toBe(1)
    const last = t.census(1).find((r) => r.id === cold)!
    expect(last.state).toBe('closed')
    expect(last.became).toBeUndefined()
    expect(t.census(1 + QUIET_BEAT_TICKS).map((r) => r.id)).not.toContain(cold)
  })
})

describe('the fold is replayable', () => {
  const script = (): SimEvent[] => {
    seq = 0
    return [
      opened(100, 'scene_a', 'talk', ['nadia', 'yusuf'], 5),
      line(101, 'scene_a', 'nadia', 'You promised me that barn.'),
      ev(102, 'partnership_formed', { aId: 'omar', bId: 'salma' }),
      opened(103, 'scene_b', 'council', ['nadia', 'yusuf', 'omar'], 8),
      line(104, 'scene_b', 'omar', 'I never swore any such thing.'),
      closed(105, 'scene_a', 'They left it there.', 'Nadia turned her back on him.'),
      ev(106, 'agent_died', { agentId: 'bashir' }),
    ]
  }

  it('folds the same events to the same bytes twice', () => {
    const a = town()
    const b = town()
    a.fold(script())
    b.fold(script())
    expect(JSON.stringify(a.threads.frame(110))).toBe(JSON.stringify(b.threads.frame(110)))
    expect(a.threads.frame(110).threads.length).toBeGreaterThan(0)
  })

  it('carries the prose the town wrote off the scene that closed on it', () => {
    const t = town()
    t.fold(script())
    const row = t.threads.frame(110).threads.find((r) => r.members.includes('nadia'))
    expect(row?.beat).toBe('Nadia turned her back on him.')
    expect(row?.summary).toBe('They left it there.')
    // ★ A line rides a story for sim-days after its scene: one real log shipped a beat 3.0
    // sim-days old, and the ladder cannot fall through what it cannot date.
    expect(row?.proseTick).toBe(105)
  })
})

describe('the ribbon is stepped by the tick, never by the poll', () => {
  /** Two stories of equal weight. The one holding the ribbon pays the screen-time term of the
   *  ranking, so the head changes hands on decay alone, on a tick no payment lands on. */
  const TWIN: [string[], string][] = [
    [['nadia', 'yusuf'], 'talk'],
    [['omar', 'salma'], 'talk'],
  ]

  /** The pump: the ticks since the last poll, then this tick's own payments. `every` is how many
   *  spare polls it makes in between, which must change nothing. */
  const ribbon = (every: number): string => {
    const t = makeThreads()
    for (let tick = 0; tick <= 600; tick++) {
      if (tick === 0) {
        t.frame(-1)
        for (const [cast, term] of TWIN) t.pay(cast, term as StakeTerm, 40, 0, null)
      }
      if (tick === 0 || tick % every === 0) t.frame(tick)
    }
    return JSON.stringify(t.frame(600))
  }

  it('★ a gateway that fell behind hands the ribbon over where a replay does', () => {
    // Screen time and the twelve second hold are both counted in ticks. A poll that skipped
    // twenty of them must land on the film the offline replay predicted, not on a different one.
    for (const every of [4, 20, 200, 600]) expect(ribbon(every)).toBe(ribbon(1))
  })
})
