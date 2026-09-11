import {
  BODY_HALF_LIFE_TICKS,
  decayedHeat,
  decayedScreen,
  MINUTES_PER_DAY,
  PEAK_SCORE,
  QUIET_BEAT_TICKS,
  STICKY,
  THREAD_FLOOR,
  THREAD_MEMBER_CAP,
  THREAD_MERGE_MEMBERS,
  THREAD_OPENING_PAYMENTS,
  THREAD_RANK_COEF,
  THREAD_SCREEN_DIVISOR,
  THREAD_SCREEN_TICKS,
  THREAD_SILENCE_TICKS,
  THREAD_TOP_N,
  THREAD_TURN_WEIGHT,
  TICK_REAL_MS,
  VALENCE,
  type ServerThreads,
  type SimEvent,
  type StakeTerm,
  type ThreadRow,
  type ThreadState,
} from '@sj/shared'
import type { Pay } from './stakes.js'

/** The running stories of a town, folded off the same log and the same payments the director
 *  scores. Pure: a function of the events and the tick, no clock and no randomness, so a
 *  recorded log replays the very same ribbon. */
export type Threads = {
  /** The director's payment sink. Pass it to `makeDirector` so both folds read one event pass. */
  pay: Pay
  /** The town's own prose off a closed scene, which no payment carries. */
  fold(events: readonly SimEvent[]): void
  /** The ribbon as it ships: the wire caps it at `THREAD_TOP_N`. */
  frame(tick: number): ServerThreads
  /** Every story standing, in the same order, for an offline replay reading the whole census.
   *  Not a wire frame: there is no cap on how many rows come back. */
  census(tick: number): ThreadRow[]
  /** What the rows cannot show: stories opened, merged away, and dropped as the coldest. */
  stats(): { made: number; merged: number; dropped: number }
}

/** How many stories are kept at all. Past this the coldest is dropped: a town of forty bodies
 *  has 780 pairs, and a ribbon of six does not need them. */
const THREAD_MAX = 40

/** Four ticks, which is four sim-minutes of town time and twelve real seconds at 1x speed. In
 *  TICKS, so the handover is the same on a replay as on the wire. */
const THREAD_HOLD_TICKS = Math.round(12_000 / TICK_REAL_MS)

/** A story cannot run on after its people. */
const GONE_TERMS: ReadonlySet<StakeTerm> = new Set<StakeTerm>(['agent_died', 'agent_departed'])

/** A tie that ended. The story that took it is over, and the other stories those two are in
 *  are not. */
const ENDED_TERMS: ReadonlySet<StakeTerm> = new Set<StakeTerm>(['partnership_dissolved'])

type Thread = {
  id: string
  /** id to what it has paid, which is how the members are ranked. */
  members: Map<string, number>
  terms: Map<StakeTerm, number>
  /** Heat and the camera's own urgency, both as of `paidAt`: one remembers for four sim-days,
   *  the other for ninety seconds. */
  heat: number
  live: number
  paidAt: number
  peak: number
  openedTick: number
  /** How many payments it has ever taken, which is the only thing `opened` means. */
  paid: number
  /** Warm against cold, signed and running. */
  tone: number
  /** What heat stood at after the payment before the last one, which is the only thing that
   *  says whether this story is being fed faster than it is forgotten. */
  heatWas: number
  turnedAt: number
  /** Ticks of ribbon already had, as of `screenAt`, on a one sim-day half life. */
  screenTicks: number
  screenAt: number
  /** Term and cast to the weight that pair has already taken at `capTick`: the cap is per edge,
   *  so two different pairs both get paid for what happened to each of them. */
  cap: Map<string, number>
  capTick: number
  /** The tick a terminal term ended it, if one has. */
  overAt: number | null
  /** The story it was absorbed into, carried on the one closed row it ships on its way out. */
  became?: string
  beat?: string
  summary?: string
  proseAt?: number
}

const signOf = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0)

const round2 = (n: number): number => Math.round(n * 100) / 100

const heatAt = (t: Thread, tick: number): number => decayedHeat(t.heat, tick - t.paidAt)

const screenNow = (t: Thread, tick: number): number =>
  decayedScreen(t.screenTicks, tick - t.screenAt)

const liveAt = (t: Thread, tick: number): number =>
  t.live * Math.pow(2, -Math.max(0, tick - t.paidAt) / BODY_HALF_LIFE_TICKS)

/** When it ended: on a terminal term, or two sim-days with nothing said at all. */
const closedAt = (t: Thread): number => t.overAt ?? t.paidAt + THREAD_SILENCE_TICKS

/** Precedence, top to bottom, with no fall-through. Every word is a fact a viewer can check
 *  against the same frame. `opened` carries its own age: two payments a sim-day apart kept a
 *  story under the opening count for as long as it lived. */
function stateOf(t: Thread, tick: number): ThreadState {
  if (tick >= closedAt(t)) return 'closed'
  if (tick - t.turnedAt < QUIET_BEAT_TICKS) return 'turned'
  if (t.paid < THREAD_OPENING_PAYMENTS && tick - t.openedTick < MINUTES_PER_DAY) return 'opened'
  if (tick - t.paidAt >= MINUTES_PER_DAY && heatAt(t, tick) > THREAD_FLOOR) return 'held'
  // Against its own last payment, not against its lifetime peak: heat halves in four sim-days
  // and silence ends a story in two, so half of peak is a floor no live story ever reaches.
  if (t.heat <= t.heatWas) return 'cooling'
  return 'rising'
}

/** Both terms as a fraction of a peak moment, so the coefficient means the same thing on a
 *  fresh town and on a ten-day one. With no live story the story term is zero, not a division
 *  by nothing. */
const rankOf = (t: Thread, tick: number, hottest: number): number =>
  Math.max(
    liveAt(t, tick),
    hottest <= 0 ? 0 : (THREAD_RANK_COEF * PEAK_SCORE * heatAt(t, tick)) / hottest,
  ) /
  (1 + (THREAD_SCREEN_DIVISOR * screenNow(t, tick)) / THREAD_SCREEN_TICKS)

/** Heaviest two reasons, heaviest first, ties on the term so a replay ranks them the same way. */
function topTerms(t: Thread): StakeTerm[] {
  return [...t.terms.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 2)
    .map(([term]) => term)
}

function rowOf(t: Thread, tick: number): ThreadRow {
  return {
    id: t.id,
    members: [...t.members.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([id]) => id),
    heat: round2(heatAt(t, tick)),
    peak: round2(t.peak),
    state: stateOf(t, tick),
    valence: signOf(t.tone),
    openedTick: t.openedTick,
    lastPaidTick: t.paidAt,
    terms: topTerms(t),
    ...(t.became === undefined ? {} : { became: t.became }),
    ...(t.beat === undefined ? {} : { beat: t.beat }),
    ...(t.summary === undefined ? {} : { summary: t.summary }),
    ...(t.proseAt === undefined ? {} : { proseTick: t.proseAt }),
  }
}

export function makeThreads(): Threads {
  const threads = new Map<string, Thread>()
  /** Stories off the map, absorbed or dropped, each owed the one last row that says so. A
   *  capsule a viewer is reading may never be replaced without a word. */
  const leaving: Thread[] = []
  /** Which story a scene is being told in, so its closing prose reaches the right one. */
  const sceneOf = new Map<string, string>()
  let made = 0
  let merged = 0
  let dropped = 0
  let held: string | null = null
  let heldSince = -1
  let framedAt = -1

  const open = (cast: readonly string[], tick: number): Thread => {
    made += 1
    const t: Thread = {
      id: `t${made}`,
      members: new Map(cast.map((id) => [id, 0])),
      terms: new Map(),
      heat: 0,
      live: 0,
      paidAt: tick,
      peak: 0,
      openedTick: tick,
      paid: 0,
      tone: 0,
      heatWas: 0,
      turnedAt: Number.NEGATIVE_INFINITY,
      screenTicks: 0,
      screenAt: tick,
      cap: new Map(),
      capTick: -1,
      overAt: null,
    }
    threads.set(t.id, t)
    return t
  }

  /** A story leaves the map. It still owes the viewer the one row that says so, and it ships
   *  that row for the same beat a closed story already gets. */
  const goodbye = (t: Thread, tick: number, became: string | null): void => {
    threads.delete(t.id)
    t.overAt ??= tick
    if (became !== null) t.became = became
    if (tick - closedAt(t) < QUIET_BEAT_TICKS) leaving.push(t)
  }

  const shared = (t: Thread, cast: readonly string[]): number => {
    let n = 0
    for (const id of cast) if (t.members.has(id)) n += 1
    return n
  }

  const unionSize = (keep: Thread, gone: Thread): number => {
    let n = keep.members.size
    for (const id of gone.members.keys()) if (!keep.members.has(id)) n += 1
    return n
  }

  const absorb = (keep: Thread, gone: Thread, tick: number): void => {
    for (const [id, w] of gone.members) keep.members.set(id, (keep.members.get(id) ?? 0) + w)
    for (const [term, w] of gone.terms) keep.terms.set(term, (keep.terms.get(term) ?? 0) + w)
    keep.heat = Math.max(heatAt(keep, tick), heatAt(gone, tick))
    keep.live = Math.max(liveAt(keep, tick), liveAt(gone, tick))
    keep.paidAt = tick
    keep.peak = Math.max(keep.peak, gone.peak)
    keep.paid = Math.max(keep.paid, gone.paid)
    keep.tone += gone.tone
    keep.openedTick = Math.min(keep.openedTick, gone.openedTick)
    keep.turnedAt = Math.max(keep.turnedAt, gone.turnedAt)
    // Two stories that each led the ribbon led the same screen, so the merged one carries the
    // larger fatigue and never the sum of both.
    keep.screenTicks = Math.max(screenNow(keep, tick), screenNow(gone, tick))
    keep.screenAt = tick
    // The tick cap travels with the heat it already took, or the merge itself is a second
    // payment of the same term by the same pair in the same minute.
    if (gone.capTick === tick) {
      if (keep.capTick !== tick) {
        keep.cap.clear()
        keep.capTick = tick
      }
      for (const [key, w] of gone.cap) keep.cap.set(key, Math.max(keep.cap.get(key) ?? 0, w))
    }
    if (keep.beat === undefined && gone.beat !== undefined) keep.beat = gone.beat
    if (keep.summary === undefined && gone.summary !== undefined) keep.summary = gone.summary
    if (keep.proseAt === undefined && gone.proseAt !== undefined) keep.proseAt = gone.proseAt
    merged += 1
    goodbye(gone, tick, keep.id)
    for (const [id, to] of sceneOf) if (to === gone.id) sceneOf.set(id, keep.id)
    if (held === gone.id) held = keep.id
  }

  /** The story this cast belongs to: every running one sharing two members with it, merged, as
   *  far as the member cap allows. A closed one is not a candidate, whether a parting ended it
   *  or the town went quiet on it, so the same two people quarrelling later are a new story and
   *  not the old one back from the dead. */
  const storyFor = (cast: readonly string[], tick: number): Thread => {
    const found = [...threads.values()].filter(
      (t) => tick < closedAt(t) && shared(t, cast) >= THREAD_MERGE_MEMBERS,
    )
    if (found.length === 0) return open(cast, tick)
    found.sort((a, b) => a.openedTick - b.openedTick || (a.id < b.id ? -1 : 1))
    const keep = found[0]!
    for (const other of found.slice(1)) {
      if (unionSize(keep, other) <= THREAD_MEMBER_CAP) absorb(keep, other, tick)
    }
    for (const id of cast) {
      if (keep.members.has(id) || keep.members.size >= THREAD_MEMBER_CAP) continue
      keep.members.set(id, 0)
    }
    return keep
  }

  /** Dead before cold: a story that ended keeps leftover heat for days, and the ribbon answers
   *  what is running. Ties on the older one, so the drop is replayable. */
  const colder = (a: Thread, b: Thread, tick: number): boolean => {
    const ad = tick >= closedAt(a)
    const bd = tick >= closedAt(b)
    if (ad !== bd) return ad
    const ah = heatAt(a, tick)
    const bh = heatAt(b, tick)
    return ah !== bh ? ah < bh : a.openedTick < b.openedTick
  }

  const trim = (tick: number): void => {
    while (threads.size > THREAD_MAX) {
      let worst: Thread | null = null
      for (const t of threads.values()) if (worst === null || colder(t, worst, tick)) worst = t
      if (worst === null) return
      dropped += 1
      goodbye(worst, tick, null)
      for (const [id, to] of sceneOf) if (to === worst.id) sceneOf.delete(id)
      if (held === worst.id) held = null
    }
  }

  /** One payment, by one cast no wider than a story can hold. `edge` is what the tick cap is
   *  keyed on beside the term: the pair by default, and nothing at all when the caller is one
   *  payment walking a wider cast. */
  const payOne = (
    who: readonly string[],
    term: StakeTerm,
    weight: number,
    tick: number,
    sceneId: string | null,
    edge: string = who.join(' '),
  ): void => {
    const t = storyFor(who, tick)
    if (sceneId !== null) sceneOf.set(sceneId, t.id)
    // Heat is a story's temperature and not a headcount: one payment names a story once per
    // term, whatever number of its edges the cast touches, at the highest weight offered.
    if (t.capTick !== tick) {
      t.cap.clear()
      t.capTick = tick
    }
    const key = `${term}\n${edge}`
    const already = t.cap.get(key) ?? 0
    if (weight <= already) return
    const add = weight - already
    t.cap.set(key, weight)

    const v = VALENCE[term]
    const was = signOf(t.tone)
    if (was !== 0 && v !== 0 && v !== was && weight >= THREAD_TURN_WEIGHT) t.turnedAt = tick

    t.heatWas = t.heat
    t.heat = heatAt(t, tick) + add
    t.live = liveAt(t, tick) + add
    t.paidAt = tick
    t.peak = Math.max(t.peak, t.heat)
    t.paid += 1
    t.tone += add * v
    t.terms.set(term, (t.terms.get(term) ?? 0) + add)
    // Only the bodies the story actually holds: at the cap it refuses to absorb another member.
    for (const id of who) {
      const paid = t.members.get(id)
      if (paid !== undefined) t.members.set(id, paid + add)
    }
    if (ENDED_TERMS.has(term) || GONE_TERMS.has(term)) t.overAt ??= tick
    trim(tick)
  }

  const pay: Pay = (cast, term, weight, tick, sceneId) => {
    if (weight <= 0) return
    const who = [...new Set(cast)].filter((id) => id.length > 0).sort()
    // A body alone makes no edge, so it opens no story. What it can still do is end the ones
    // it is in: a story cannot run on past the people in it.
    if (who.length < 2) {
      if (GONE_TERMS.has(term)) {
        for (const t of threads.values()) if (shared(t, who) > 0) t.overAt ??= tick
      }
      return
    }
    if (who.length <= THREAD_MEMBER_CAP) {
      payOne(who, term, weight, tick, sceneId)
      return
    }
    // Wider than any story can hold. A gathering of twelve is twelve people at a gathering: it
    // pays every edge it names into whatever story holds that edge, and never becomes one. A
    // story holding four of those bodies takes one payment and not six, so the cap key drops
    // the pair. The scene goes to none of them, or the room's line is one pair's story.
    for (let i = 0; i < who.length; i++) {
      for (let j = i + 1; j < who.length; j++)
        payOne([who[i]!, who[j]!], term, weight, tick, null, '')
    }
  }

  /** One tick of the ribbon: who holds it, and whether the head changes hands. Driven by the
   *  TICK and never by the poll, so a gateway that fell behind hands over where a replay does. */
  const step = (t: number): Thread[] => {
    // Screen time is counted over the ticks the ribbon's head held it, never over the pumps:
    // a poll rate is not town time and a replay does not have one.
    const on = held === null ? undefined : threads.get(held)
    if (on !== undefined && framedAt >= 0 && t > framedAt) {
      on.screenTicks = screenNow(on, t) + (t - framedAt)
      on.screenAt = t
    }
    framedAt = t
    // A story that ended shows its own ending for one beat and then leaves. The ribbon
    // answers what is running, and a story with leftover heat outranks live ones for days.
    // The hottest live story is the denominator, taken on the same walk that collects them.
    const showing: Thread[] = []
    let hottest = 0
    for (const x of threads.values()) {
      const end = closedAt(x)
      if (t < end) hottest = Math.max(hottest, heatAt(x, t))
      if (t - end < QUIET_BEAT_TICKS) showing.push(x)
    }
    for (let i = leaving.length - 1; i >= 0; i--) {
      const x = leaving[i]!
      if (t - closedAt(x) < QUIET_BEAT_TICKS) showing.push(x)
      else leaving.splice(i, 1)
    }
    if (held !== null && !showing.some((x) => x.id === held)) held = null
    const ranked = showing.sort(
      (a, b) => rankOf(b, t, hottest) - rankOf(a, t, hottest) || (a.id < b.id ? -1 : 1),
    )
    const top = ranked[0]
    if (top !== undefined) {
      const cur = held === null ? undefined : threads.get(held)
      if (cur === undefined) {
        held = top.id
        heldSince = t
      } else if (
        top.id !== cur.id &&
        rankOf(top, t, hottest) >= rankOf(cur, t, hottest) * STICKY &&
        t - heldSince >= THREAD_HOLD_TICKS
      ) {
        held = top.id
        heldSince = t
      }
    }
    return ranked
  }

  /** Every story standing at this tick, ranked, with whoever holds the ribbon first. */
  const ordered = (tick: number): Thread[] => {
    let ranked: Thread[] = []
    for (let t = framedAt < 0 ? tick : Math.min(framedAt + 1, tick); t <= tick; t++)
      ranked = step(t)
    const lead = held === null ? undefined : threads.get(held)
    if (lead === undefined) return ranked
    return [lead, ...ranked.filter((t) => t.id !== lead.id)]
  }

  return {
    pay,
    fold(events) {
      for (const ev of events) {
        if (ev.type !== 'scene_closed') continue
        const p = ev.payload as { id?: unknown; summary?: unknown; beat?: unknown }
        if (typeof p.id !== 'string') continue
        const t = threads.get(sceneOf.get(p.id) ?? '')
        sceneOf.delete(p.id)
        if (t === undefined) continue
        const beat = typeof p.beat === 'string' && p.beat !== '' ? p.beat : undefined
        const summary = typeof p.summary === 'string' && p.summary !== '' ? p.summary : undefined
        if (beat === undefined && summary === undefined) continue
        if (beat !== undefined) t.beat = beat
        if (summary !== undefined) t.summary = summary
        t.proseAt = ev.tick
      }
    },
    stats: () => ({ made, merged, dropped }),
    census: (tick) => ordered(tick).map((t) => rowOf(t, tick)),
    frame(tick) {
      const out = ordered(tick).slice(0, THREAD_TOP_N)
      return { t: 'threads', tick, threads: out.map((t) => rowOf(t, tick)) }
    },
  }
}
