import type Database from 'better-sqlite3'
import {
  ACT_III_HOUR,
  BODY_HALF_LIFE_TICKS,
  BODY_TERMS,
  castWords,
  COUNCIL_IN_SESSION,
  FIRST_TODAY,
  GIVE_WAY,
  GIVE_WAY_AFTER,
  LEXICON_HIT,
  lexiconHits,
  MINUTES_PER_DAY,
  PEAK_SCORE,
  QUIET_BEAT_TICKS,
  SCENE_STAKES_X,
  STICKY,
  SUMMARY_HOLD_TICKS,
  TIE_TERMS,
  tieActOf,
  tieActOfLetGo,
  whyOf,
  type SceneKind,
  type ServerDirector,
  type SimEvent,
  type StakeScore,
  type StakeTerm,
} from '@sj/shared'

/** The camera's own opinion, folded off the log in the socket pump. Everything here is a pure
 *  function of the events and the tick — no clock, no randomness — so `directorTopFive.ts`
 *  replays the very same cuts off a recorded log. */
export type Director = {
  /** One pass per pump group, in seq order. */
  fold(events: readonly SimEvent[]): void
  /** The frame as it stands at this tick. Cheap enough to call on every pump. */
  frame(tick: number): ServerDirector
  /** The top of the same survey `frame` cuts from, so a board row and the cut never disagree. */
  board(tick: number, top: number): StakeScore[]
  /** On boot: what the town has already seen today, so a resumed run does not stamp ACT I on
   *  its fourth scene. */
  prime(db: Database.Database, tick: number): void
}

/** Every weighted payment the director makes, offered to a second fold so a thread can read the
 *  same terms without a second copy of the event switch. */
export type Pay = (
  cast: readonly string[],
  term: StakeTerm,
  weight: number,
  tick: number,
  sceneId: string | null,
) => void

const NO_PAY: Pay = () => undefined

/** The two heaviest reasons, in two fixed slots. A map per scene would be an allocation per
 *  event on the thread that ticks the town, for an answer that is never longer than two. */
type TopTwo = { a: StakeTerm | null; aw: number; b: StakeTerm | null; bw: number }

const noTerms = (): TopTwo => ({ a: null, aw: 0, b: null, bw: 0 })

/** Sets a term's weight, keeping the heavier of the two in `a`. */
function markTerm(t: TopTwo, term: StakeTerm, weight: number): void {
  if (t.a === term) t.aw = weight
  else if (t.b === term) t.bw = weight
  else if (weight > t.bw) {
    t.b = term
    t.bw = weight
  } else return
  if (t.bw > t.aw) {
    const was = t.a
    const wasWeight = t.aw
    t.a = t.b
    t.aw = t.bw
    t.b = was
    t.bw = wasWeight
  }
}

function dropTerm(t: TopTwo, term: StakeTerm): void {
  if (t.a === term) {
    t.a = t.b
    t.aw = t.bw
    t.b = null
    t.bw = 0
  } else if (t.b === term) {
    t.b = null
    t.bw = 0
  }
}

const addTerm = (t: TopTwo, term: StakeTerm, weight: number): void => {
  markTerm(t, term, (t.a === term ? t.aw : t.b === term ? t.bw : 0) + weight)
}

type Entry = {
  sceneId: string | null
  openedTick: number
  cast: string[]
  terms: TopTwo
  /** Rebuilt when the terms or the cast move, never per frame. */
  why: string
}

type SceneEntry = Entry & {
  kind: SceneKind
  /** The stakes the runtime wrote, doubled, plus a rule in session. */
  base: number
  lexicon: number
  gaveWay: number
  firstToday: number
  ratified: number
  presses: number
  /** Held for `SUMMARY_HOLD_TICKS` after the close, so the shot stays through the summary. */
  closedAt: number | null
}

type BodyEntry = Entry & { score: number; atTick: number }

/** Below this a decayed body is not worth keeping, let alone framing. */
const BODY_FLOOR = 0.5

const hourOf = (tick: number): number => Math.floor((tick % MINUTES_PER_DAY) / 60)

/** The rule id a passed council carries, back to the scene that passed it. `lawIdOf` in the
 *  agents package is this same swap, and a rule cannot be ratified by a scene that never sat. */
const sceneOfLaw = (lawId: string): string => lawId.replace(/^law_/, 'scene_')

const sameCast = (was: readonly string[], now: readonly string[]): boolean =>
  was.length === now.length && was.every((id, i) => id === now[i])

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** Which events pay a body, and what the log calls the term. `co_slept` and `invitation_refused`
 *  are absent: both pay a narrower term than their type, decided at the event. */
const BODY_TERM_OF_TYPE: Readonly<Record<string, StakeTerm>> = {
  agent_died: 'agent_died',
  agent_born: 'agent_born',
  agent_arrived: 'agent_arrived',
  agent_departed: 'agent_departed',
  partnership_formed: 'partnership_formed',
  partnership_dissolved: 'partnership_dissolved',
  law_ratified: 'law_ratified',
  law_broken: 'law_broken',
  law_repealed: 'law_repealed',
  discovery_made: 'discovery_made',
}

/** What `prime` reads off a resumed log. The conditional terms take their event's own type,
 *  which over-primes a co-sleeping pair by at most one `first_today`. */
const PRIMED_TERM_OF_TYPE: Readonly<Record<string, StakeTerm>> = {
  ...BODY_TERM_OF_TYPE,
  co_slept: 'co_slept_first',
  invitation_refused: 'invitation_refused_seen',
  tie_let_go: 'promise_broken',
}
export const PRIMED_TYPES: readonly string[] = Object.keys(PRIMED_TERM_OF_TYPE)

export function makeDirector(
  names: (id: string) => string,
  partnerOf: (id: string) => string | null,
  pay: Pay = NO_PAY,
): Director {
  const scenes = new Map<string, SceneEntry>()
  const bodies = new Map<string, BodyEntry>()
  /** Terms the town has already seen today, town-wide: the second quarrel is not a first. */
  const seenToday = new Set<string>()
  /** Pairs who have already had their first night. Bounded by the pairs the town can make. */
  const firstPair = new Set<string>()
  let day = -1
  let sceneOpenedToday = false
  let peakedToday = false
  /** Whoever holds the shot. Hysteresis and the quiet beat are both about this one key. */
  let current: string | null = null
  let quietUntil = -1
  let beatNo = 0
  /** Survey is a sort over both maps; two readers at one tick read one answer. */
  let surveyAt = -1
  let surveyRows: { key: string; score: number }[] = []

  const sceneKey = (id: string): string => `s:${id}`
  const bodyKey = (id: string): string => `b:${id}`

  const rewhy = (e: Entry): void => {
    const top: StakeTerm[] = []
    if (e.terms.a !== null) top.push(e.terms.a)
    if (e.terms.b !== null) top.push(e.terms.b)
    e.why = whyOf(castWords(e.cast.map(names)), top)
  }

  const setCast = (e: Entry, cast: readonly string[]): void => {
    if (sameCast(e.cast, cast)) return
    e.cast = [...cast]
  }

  const atTick = (tick: number): void => {
    const now = Math.floor(tick / MINUTES_PER_DAY)
    if (now === day) return
    day = now
    seenToday.clear()
    sceneOpenedToday = false
    peakedToday = false
  }

  /** `FIRST_TODAY` the first time the town sees this term today, and nothing after. */
  const firstOf = (term: StakeTerm): number => {
    if (seenToday.has(term)) return 0
    seenToday.add(term)
    return FIRST_TODAY
  }

  const sceneScore = (e: SceneEntry): number =>
    e.base + e.lexicon + e.gaveWay + e.firstToday + e.ratified

  const decayed = (e: BodyEntry, tick: number): number =>
    e.score * Math.pow(2, -Math.max(0, tick - e.atTick) / BODY_HALF_LIFE_TICKS)

  const scoreOf = (key: string, tick: number): number => {
    const id = key.slice(2)
    if (key.startsWith('s:')) {
      const e = scenes.get(id)
      return e === undefined || (e.cast.length < 2 && e.closedAt === null) ? -1 : sceneScore(e)
    }
    const e = bodies.get(id)
    return e === undefined ? -1 : decayed(e, tick)
  }

  /** Handing the shot over, which is what a new beat IS: the score under one shot moves every
   *  minute, and the client cannot tell that from a cut without this counter. */
  const hold = (key: string | null): void => {
    if (key === current) return
    current = key
    beatNo += 1
  }

  const peak = (tick: number, key: string): void => {
    quietUntil = tick + QUIET_BEAT_TICKS
    hold(key)
  }

  const turnScene = (
    id: string,
    kind: SceneKind,
    cast: readonly string[],
    stakes: number,
    tick: number,
  ): void => {
    let e = scenes.get(id)
    if (e === undefined) {
      e = {
        sceneId: id,
        openedTick: tick,
        cast: [...cast],
        terms: noTerms(),
        why: '',
        kind,
        base: 0,
        lexicon: 0,
        gaveWay: 0,
        firstToday: 0,
        ratified: 0,
        presses: 0,
        closedAt: null,
      }
      scenes.set(id, e)
    } else {
      setCast(e, cast)
      if (e.kind !== kind) dropTerm(e.terms, e.kind)
    }
    e.kind = kind
    e.closedAt = null
    e.base = stakes * SCENE_STAKES_X + (kind === 'council' ? COUNCIL_IN_SESSION : 0)
    e.firstToday += firstOf(kind)
    markTerm(e.terms, kind, e.base)
    pay(e.cast, kind, e.base, tick, id)
    rewhy(e)
    sceneOpenedToday = true
  }

  // A null term is a weight with nothing to say for itself — what being the day's first is.
  const payBody = (
    ids: readonly string[],
    term: StakeTerm | null,
    weight: number,
    tick: number,
    sceneId: string | null = null,
  ): void => {
    const cast = [...new Set(ids)].filter((id) => id.length > 0)
    if (cast.length === 0 || weight <= 0) return
    for (const id of cast) {
      let e = bodies.get(id)
      if (e === undefined) {
        e = {
          sceneId: null,
          openedTick: tick,
          cast,
          terms: noTerms(),
          why: '',
          score: 0,
          atTick: tick,
        }
        bodies.set(id, e)
      } else {
        e.score = decayed(e, tick)
        setCast(e, cast)
      }
      e.atTick = tick
      e.score += weight
      if (term !== null) addTerm(e.terms, term, weight)
      rewhy(e)
    }
    if (term !== null) pay(cast, term, weight, tick, sceneId)
    if (weight >= PEAK_SCORE) peak(tick, bodyKey(cast[0]!))
  }

  /** A weighted thing happening to people, plus whatever it is worth for being the day's first. */
  const payEvent = (
    ids: readonly string[],
    term: StakeTerm,
    tick: number,
    sceneId: string | null = null,
  ): void => {
    payBody(ids, term, BODY_TERMS[term] ?? TIE_TERMS[term] ?? 0, tick, sceneId)
    payBody(ids, null, firstOf(term), tick)
  }

  const closeScene = (id: string, deltas: readonly unknown[], tick: number): void => {
    for (const raw of deltas) {
      const d = raw as { agentId?: unknown; personId?: unknown; kind?: unknown; settled?: unknown }
      const a = str(d.agentId)
      const b = str(d.personId)
      const kind = str(d.kind)
      if (a === null || b === null || kind === null) continue
      const act = tieActOf(kind, d.settled === true)
      if (act === 'slight') {
        payEvent([a, b], 'slight', tick, id)
        if (partnerOf(a) === b) payEvent([a, b], 'partnership_strained', tick, id)
      } else if (act === 'attraction') payEvent([a, b], 'attraction', tick, id)
    }
    const e = scenes.get(id)
    if (e === undefined) return
    e.closedAt = tick
    if (sceneScore(e) >= PEAK_SCORE) peak(tick, sceneKey(id))
  }

  const foldOne = (ev: SimEvent): void => {
    atTick(ev.tick)
    const p = ev.payload as Record<string, unknown>
    switch (ev.type) {
      case 'scene_opened':
      case 'scene_turned': {
        const id = str(p.id)
        if (id === null) return
        const cast = Array.isArray(p.participants) ? (p.participants as string[]) : []
        turnScene(id, p.kind as SceneKind, cast, Number(p.stakes) || 0, ev.tick)
        return
      }
      case 'scene_line': {
        const e = scenes.get(str(p.id) ?? '')
        if (e === undefined) return
        const hits = lexiconHits(typeof p.text === 'string' ? p.text : '')
        if (hits > 0) {
          e.lexicon += hits * LEXICON_HIT
          markTerm(e.terms, 'lexicon', e.lexicon)
          pay(e.cast, 'lexicon', hits * LEXICON_HIT, ev.tick, e.sceneId)
          rewhy(e)
        }
        if (p.move === 'press') e.presses += 1
        else if (p.move === 'give_way' && e.presses >= GIVE_WAY_AFTER) {
          e.presses = 0
          e.gaveWay += GIVE_WAY
          markTerm(e.terms, 'give_way', e.gaveWay)
          pay(e.cast, 'give_way', GIVE_WAY, ev.tick, e.sceneId)
          rewhy(e)
        }
        return
      }
      case 'scene_closed': {
        const id = str(p.id)
        if (id === null) return
        closeScene(id, Array.isArray(p.deltas) ? p.deltas : [], ev.tick)
        return
      }
      // A rule the town agreed belongs to the room that agreed it while that room is still on
      // screen; only a council whose scene is gone pays its proposer alone.
      case 'law_ratified': {
        const e = scenes.get(sceneOfLaw(str(p.lawId) ?? ''))
        if (e === undefined) {
          payEvent([str(p.agentId) ?? ''], 'law_ratified', ev.tick)
          return
        }
        e.ratified += BODY_TERMS.law_ratified!
        e.firstToday += firstOf('law_ratified')
        markTerm(e.terms, 'law_ratified', e.ratified)
        pay(e.cast, 'law_ratified', BODY_TERMS.law_ratified!, ev.tick, e.sceneId)
        rewhy(e)
        return
      }
      case 'agent_died':
      case 'agent_departed':
      case 'law_broken':
      case 'law_repealed':
        payEvent([str(p.agentId) ?? ''], BODY_TERM_OF_TYPE[ev.type]!, ev.tick)
        return
      case 'discovery_made':
        payEvent([str(p.byId) ?? ''], 'discovery_made', ev.tick)
        return
      // A stranger's own id: the body has no roster row until the fold makes one.
      case 'agent_arrived':
        payEvent([str(p.id) ?? ''], 'agent_arrived', ev.tick)
        return
      case 'agent_born':
        payEvent([str(p.motherId) ?? '', str(p.fatherId) ?? ''], 'agent_born', ev.tick)
        return
      case 'partnership_formed':
      case 'partnership_dissolved':
        payEvent([str(p.aId) ?? '', str(p.bId) ?? ''], BODY_TERM_OF_TYPE[ev.type]!, ev.tick)
        return
      case 'co_slept': {
        const a = str(p.aId)
        const b = str(p.bId)
        if (a === null || b === null) return
        const pair = [a, b].sort().join('\n')
        if (firstPair.has(pair)) return
        firstPair.add(pair)
        payEvent([a, b], 'co_slept_first', ev.tick)
        return
      }
      // Being turned down alone is a private no; being turned down in front of people is not.
      case 'invitation_refused': {
        if (!Array.isArray(p.witnesses) || p.witnesses.length === 0) return
        payEvent([str(p.byId) ?? '', str(p.agentId) ?? ''], 'invitation_refused_seen', ev.tick)
        return
      }
      case 'tie_let_go': {
        if (tieActOfLetGo(str(p.kind) ?? '') !== 'promise_broken') return
        payEvent([str(p.agentId) ?? '', str(p.personId) ?? ''], 'promise_broken', ev.tick)
        return
      }
      default:
    }
  }

  /** Everything on the board, heaviest first. Sweeps the two maps as it goes: a scene past its
   *  summary and a body decayed to nothing are both gone. Ties break on the key, ascending,
   *  which is the answer the old single-winner loop settled on. */
  const survey = (tick: number): { key: string; score: number }[] => {
    if (tick === surveyAt) return surveyRows
    const rows: { key: string; score: number }[] = []
    const offer = (k: string, s: number): void => {
      if (s > 0) rows.push({ key: k, score: s })
    }
    for (const [id, e] of scenes) {
      if (e.closedAt !== null && tick - e.closedAt >= SUMMARY_HOLD_TICKS) {
        scenes.delete(id)
        continue
      }
      // A talk somebody walked out of is one body standing there: not a shot until it closes
      // with its summary, or somebody else joins.
      if (e.cast.length < 2 && e.closedAt === null) continue
      offer(sceneKey(id), sceneScore(e))
    }
    for (const [id, e] of bodies) {
      const s = decayed(e, tick)
      if (s < BODY_FLOOR) {
        bodies.delete(id)
        continue
      }
      offer(bodyKey(id), s)
    }
    rows.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    surveyAt = tick
    surveyRows = rows
    return rows
  }

  const rowOf = (key: string, score: number): StakeScore | null => {
    const e = entryAt(key)
    if (e === undefined || e.cast.length === 0) return null
    return {
      sceneId: e.sceneId,
      agentIds: e.cast,
      score: Math.round(score),
      why: e.why,
      openedTick: e.openedTick,
    }
  }

  const entryAt = (key: string | null): Entry | undefined =>
    key === null
      ? undefined
      : key.startsWith('s:')
        ? scenes.get(key.slice(2))
        : bodies.get(key.slice(2))

  return {
    fold(events) {
      for (const ev of events) foldOne(ev)
      surveyAt = -1
    },
    frame(tick) {
      atTick(tick)
      const best = survey(tick)[0] ?? { key: null, score: 0 }
      if (best.score >= PEAK_SCORE) peakedToday = true
      const quiet = tick < quietUntil
      const held = current === null ? -1 : scoreOf(current, tick)
      // The incumbent keeps the shot unless it is gone, or a rival clears it by a quarter. In
      // the quiet beat after a peak nothing displaces it at all.
      if (held < 0) hold(best.key)
      else if (!quiet && best.key !== null && best.key !== current && best.score >= held * STICKY) {
        hold(best.key)
      }
      const act = !sceneOpenedToday
        ? null
        : hourOf(tick) >= ACT_III_HOUR
          ? 'III'
          : peakedToday
            ? 'II'
            : 'I'
      const on = current === null ? null : rowOf(current, scoreOf(current, tick))
      if (on === null) {
        hold(null)
        return { t: 'director', tick, cut: null, quiet, act }
      }
      // Rounded: a decaying body would otherwise redraw the frame on every pump.
      return { t: 'director', tick, cut: { ...on, beatId: `${beatNo}` }, quiet, act }
    },
    board(tick, top) {
      atTick(tick)
      const out: StakeScore[] = []
      // One body entry per person carries the whole cast, so a slight between two people offers
      // the board the same row twice. The heavier one stands.
      const seen = new Set<string>()
      for (const r of survey(tick)) {
        if (out.length >= top) break
        const row = rowOf(r.key, r.score)
        if (row === null) continue
        const same = `${row.sceneId ?? ''}|${row.agentIds.join(' ')}`
        if (seen.has(same)) continue
        seen.add(same)
        out.push(row)
      }
      return out
    },
    prime(db, tick) {
      atTick(tick)
      const dayStart = Math.floor(tick / MINUTES_PER_DAY) * MINUTES_PER_DAY
      // The day's scenes, replayed: a gateway restarted mid-quarrel would otherwise hold the
      // camera on bodies until that quarrel turned or closed.
      const scenes = db
        .prepare(
          `SELECT seq, tick, type, payload FROM events
            WHERE type IN ('scene_opened', 'scene_turned', 'scene_line', 'scene_closed')
              AND tick >= ? AND tick <= ? ORDER BY seq`,
        )
        .all(dayStart, tick) as { seq: number; tick: number; type: string; payload: string }[]
      for (const r of scenes) {
        foldOne({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) })
      }
      const seen = db
        .prepare(
          `SELECT DISTINCT type FROM events
            WHERE type IN (${PRIMED_TYPES.map(() => '?').join(', ')})
              AND tick >= ? AND tick <= ?`,
        )
        .all(...PRIMED_TYPES, dayStart, tick) as { type: string }[]
      for (const row of seen) seenToday.add(PRIMED_TERM_OF_TYPE[row.type]!)
      const opened = db
        .prepare(
          "SELECT COUNT(*) AS n FROM events WHERE type = 'scene_opened' AND tick >= ? AND tick <= ?",
        )
        .get(dayStart, tick) as { n: number }
      sceneOpenedToday = opened.n > 0
    },
  }
}
