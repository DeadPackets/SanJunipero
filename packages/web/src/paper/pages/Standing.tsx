import { useMemo, useSyncExternalStore } from 'react'
import {
  LawsResponseSchema,
  MINUTES_PER_DAY,
  THREAD_MEMBER_CAP,
  agentName,
  personAt,
  type AssetRecord,
  type Bond,
  type ChronicleEntry,
  type LawRow,
  type NameIndex,
  type ServerThreads,
} from '@sj/shared'
import type { MilestoneRead } from '@sj/shared/narratorSchema'
import type { WorldState } from '@sj/engine/state'
import type { Subject } from '../../stage/index.js'
import { bustStyle } from '../../ui/bustStyle.js'
import { editions } from '../../ui/dispatches.js'
import { bondsFeed, chronicleFeed, dispatchesFeed, milestonesFeed } from '../../ui/feeds.js'
import { PersonLink } from '../../ui/PersonLink.js'
import { ladderLine } from '../../ui/sentenceLadder.js'
import { lastVisitTick } from '../../ui/storage.js'
import { MARKS_POLL_MS, MARKS_URL, markSources } from '../../ui/timelineMarks.js'
import { useFeed, usePolled } from '../../ui/useEndpoint.js'
import { momentStamp } from '../stamp.js'
import type { PageProps } from './types.js'

const NO_BONDS: readonly Bond[] = []
const NO_LINES: readonly ChronicleEntry[] = []

/** The same url and the same beat the Rule book reads on, so the two share one reader. */
const LAWS_REFETCH_MS = 30_000
const townLaws = (body: unknown): LawRow[] | null => {
  const parsed = LawsResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.laws : null
}

/** Head and shoulders at the shelf's own size, so the lead's cast and a first's cast match. */
const BUST_PX = 40
/** Past this the band stops being what you missed and starts being the record itself. */
const SINCE_MAX = 8

const dayOf = (tick: number): number => Math.floor(tick / MINUTES_PER_DAY)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** One record of the town's own, said the way a person would say it. `figure` is pulled out to
 *  the largest step the ladder has, and its sentence carries the denominator. */
type BoardLine = { key: string; figure: string | null; text: string }

type Lead = { text: string; cast: readonly string[] }
type Since = { mins: number; lines: readonly ChronicleEntry[]; rest: number }
type Facts = { lead: Lead | null; since: Since | null; board: readonly BoardLine[] }

const newestFor = (
  entries: readonly ChronicleEntry[],
  members: readonly string[],
): string | null => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    if (e.agentIds?.some((id) => members.includes(id)) === true) return e.label
  }
  return null
}

/** The top story's own sentence, then the day's chapter title, then nothing. The ladder decides:
 *  no rung of it is written here and there is no last resort. */
function leadOf(
  threads: ServerThreads | null,
  entries: readonly ChronicleEntry[],
  chapter: string | null,
  now: number,
): Lead | null {
  const top = threads?.threads[0] ?? null
  const line = ladderLine(
    top === null
      ? { chapter }
      : {
          beat: top.beat,
          summary: top.summary,
          proseTick: top.proseTick,
          chronicle: newestFor(entries, top.members),
          chapter,
        },
    now,
    new Map(),
  )
  if (line === null) return null
  return { text: line.text, cast: top?.members.slice(0, THREAD_MEMBER_CAP) ?? [] }
}

function sinceOf(
  entries: readonly ChronicleEntry[],
  last: number | null,
  now: number,
): Since | null {
  if (last === null || now <= last) return null
  const lines = entries.filter((e) => e.tick > last).sort((a, b) => b.tick - a.tick)
  return {
    mins: now - last,
    lines: lines.slice(0, SINCE_MAX),
    rest: Math.max(0, lines.length - SINCE_MAX),
  }
}

const awayWords = (mins: number): string => {
  const hours = Math.floor(mins / 60)
  if (hours >= 48) return plural(Math.floor(hours / 24), 'day')
  return hours >= 1 ? plural(hours, 'hour') : plural(mins, 'minute')
}

function deathLine(deathTicks: readonly number[], today: number): BoardLine {
  const days = [...new Set(deathTicks.map(dayOf))].sort((a, b) => a - b)
  if (days.length === 0) {
    if (today === 0)
      return {
        key: 'death',
        figure: null,
        text: 'The town is on its first day and nobody in it has died.',
      }
    return {
      key: 'death',
      figure: String(today),
      text: 'days the town has stood, and nobody in it has died.',
    }
  }
  let longest = days[0]!
  let endedDay = days[0]!
  for (let i = 1; i < days.length; i++) {
    const gap = days[i]! - days[i - 1]!
    if (gap > longest) {
      longest = gap
      endedDay = days[i]!
    }
  }
  const since = today - days[days.length - 1]!
  if (since === 0)
    return {
      key: 'death',
      figure: null,
      text:
        longest === 0
          ? 'Somebody died today, the first day this town has lost anyone.'
          : `Somebody died today, and the longest run without a death was ${plural(longest, 'day')}, which ended on day ${endedDay}.`,
    }
  return {
    key: 'death',
    figure: String(since),
    text:
      longest > since
        ? `days since anyone died, the longest run yet was ${longest} and it ended on day ${endedDay}.`
        : 'days since anyone died, longer than any run this town has had before.',
  }
}

function firstsLine(firsts: readonly MilestoneRead[], now: number): BoardLine {
  const week = MINUTES_PER_DAY * 7
  const thisWeek = firsts.filter((f) => f.tick > now - week).length
  const lastWeek = firsts.filter((f) => f.tick > now - 2 * week && f.tick <= now - week).length
  if (thisWeek === 0 && lastWeek === 0)
    return {
      key: 'firsts',
      figure: null,
      text: 'Nothing has happened here for the first time in two weeks.',
    }
  const head = thisWeek === 0 ? 'Nothing' : thisWeek === 1 ? 'One thing' : `${thisWeek} things`
  const tail = lastWeek === 0 ? 'none' : String(lastWeek)
  return {
    key: 'firsts',
    figure: null,
    text: `${head} happened here for the first time this week, against ${tail} the week before.`,
  }
}

function lawsLine(laws: readonly LawRow[]): BoardLine {
  const n = laws.length
  if (n === 0) return { key: 'laws', figure: null, text: 'They have agreed no rules yet.' }
  const stands = laws.filter((l) => l.repealedTick === null).length
  if (n === 1)
    return {
      key: 'laws',
      figure: null,
      text:
        stands === 1
          ? 'They have agreed one rule, and it still stands.'
          : 'They have agreed one rule, and they have since let it go.',
    }
  return {
    key: 'laws',
    figure: null,
    text: `They have agreed ${n} rules, and ${stands === 0 ? 'none' : String(stands)} of the ${n} still stand.`,
  }
}

/** Who is partnered is the WORLD's fact, and only the bonds know the day it began. A pair the
 *  bonds have no date for is left out rather than dated from anything else. */
type Pair = { a: string; b: string; formedTick: number | null }

function partnerships(state: WorldState, bonds: readonly Bond[]): Pair[] {
  const out: Pair[] = []
  for (const a of Object.values(state.agents)) {
    const bId = a.partnerId
    if (bId === undefined || a.id >= bId || !a.alive) continue
    if (personAt(state.agents, bId)?.alive !== true) continue
    const tie = bonds.find(
      (t) => (t.aId === a.id && t.bId === bId) || (t.aId === bId && t.bId === a.id),
    )
    out.push({
      a: a.id,
      b: bId,
      formedTick: tie?.acts.find((r) => r.kind === 'partner')?.firstTick ?? null,
    })
  }
  return out
}

function partnerLine(
  pairs: readonly Pair[],
  now: number,
  people: NameIndex | undefined,
): BoardLine | null {
  if (pairs.length === 0)
    return { key: 'partner', figure: null, text: 'Nobody here has taken a partner yet.' }
  const dated = pairs
    .filter((p): p is Pair & { formedTick: number } => p.formedTick !== null)
    .sort((x, y) => x.formedTick - y.formedTick)
  const top = dated[0]
  if (top === undefined) return null
  const names = `${agentName(people, top.a)} and ${agentName(people, top.b)}`
  const days = dayOf(Math.max(0, now - top.formedTick))
  if (days === 0)
    return {
      key: 'partner',
      figure: null,
      text: `${names} took each other as partners today, and no pair here is older.`,
    }
  const tail = pairs.length === 1 ? 'the only pair in the town' : 'longer than any other pair here'
  return {
    key: 'partner',
    figure: null,
    text: `${names} have been partners ${plural(days, 'day')}, ${tail}.`,
  }
}

/** Counted from the sleeping side. `status.ts` bans the printed word for the other one, and the
 *  world holds `asleep` rather than its opposite. */
function sleepLine(state: WorldState): BoardLine | null {
  const alive = Object.values(state.agents).filter((a) => a.alive)
  if (alive.length === 0) return null
  const abed = alive.filter((a) => a.asleep).length
  if (alive.length === 1)
    return {
      key: 'sleep',
      figure: null,
      text: `The one person here is ${abed === 1 ? '' : 'not '}asleep right now.`,
    }
  if (abed === 0)
    return {
      key: 'sleep',
      figure: null,
      text: `Not one of the ${alive.length} people here is asleep right now.`,
    }
  return {
    key: 'sleep',
    figure: null,
    text: `${abed} of the ${alive.length} people here are asleep right now.`,
  }
}

/** What the town holds, and nothing else: every source is a read that can be null, and a record
 *  whose source has not landed is left out rather than said from a default. */
export type StandingSources = {
  now: number
  state: WorldState | null
  threads: ServerThreads | null
  /** the curated record, oldest first, as `/api/chronicle` serves it */
  entries: readonly ChronicleEntry[] | null
  chapter: string | null
  /** the tick this browser had watched up to when the tab opened */
  lastVisit: number | null
  firsts: readonly MilestoneRead[] | null
  laws: readonly LawRow[] | null
  bonds: readonly Bond[]
  /** every death in the whole log, off `/api/timeline/marks` */
  deathTicks: readonly number[] | null
}

function factsOf(src: StandingSources): Facts {
  const { now, state } = src
  const entries = src.entries ?? NO_LINES
  const board: BoardLine[] = []
  if (src.deathTicks !== null) board.push(deathLine(src.deathTicks, dayOf(now)))
  if (src.firsts !== null) board.push(firstsLine(src.firsts, now))
  if (src.laws !== null) board.push(lawsLine(src.laws))
  if (state !== null) {
    const partner = partnerLine(partnerships(state, src.bonds), now, state.agents)
    if (partner !== null) board.push(partner)
    const abed = sleepLine(state)
    if (abed !== null) board.push(abed)
  }
  return {
    lead: leadOf(src.threads, entries, src.chapter, now),
    since: src.entries === null ? null : sinceOf(entries, src.lastVisit, now),
    board,
  }
}

/** From the town's own reads rather than from the store, so every band and every sentence on
 *  the board can be asked of it outside a browser. */
export function StandingView({
  sources,
  records,
  onSubject,
}: {
  sources: StandingSources
  records: AssetRecord[]
  onSubject: (subject: Subject) => void
}) {
  const people = sources.state?.agents
  const { lead, since, board } = factsOf(sources)
  if (lead === null && since === null && board.length === 0) return null
  return (
    <>
      {lead !== null && (
        <section className="block standing-lead">
          {/* The line IS the headline, so the section name is for the reader who cannot see that. */}
          <h3 className="stage-sr">The lead</h3>
          <p className="standing-line">{lead.text}</p>
          {lead.cast.length > 0 && (
            <ul className="first-cast">
              {lead.cast.map((id) => {
                const name = agentName(people, id)
                const style = bustStyle(records, id, BUST_PX)
                return (
                  <li key={id}>
                    <span
                      className="first-bust"
                      data-blank={style === null ? 'yes' : undefined}
                      style={style ?? undefined}
                      role="img"
                      aria-label={name}
                    />
                    <span className="first-cast-name">
                      <PersonLink id={id} name={name} onSubject={onSubject} />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {since !== null && (
        <section className="block standing-since">
          <h3 className="feed-head">Since you left</h3>
          <p className="sheet-note">The town ran {awayWords(since.mins)} since you last watched.</p>
          {since.lines.length === 0 ? (
            <p className="feed-empty">Nothing the record keeps happened while you were away.</p>
          ) : (
            <ol className="feed">
              {since.lines.map((e) => (
                <li key={`${e.type}:${e.seq}`} className="feed-line">
                  <span className="stamp">{momentStamp(e.tick)}</span>
                  <span className="feed-text">{e.label}</span>
                </li>
              ))}
            </ol>
          )}
          {since.rest > 0 && (
            <p className="sheet-note">
              And {plural(since.rest, 'line')} more in the record since then.
            </p>
          )}
        </section>
      )}

      {board.length > 0 && (
        <section className="block standing-board">
          <h3 className="feed-head">What the town holds</h3>
          <ul className="board">
            {board.map((b) => (
              <li key={b.key} className="board-line">
                {b.figure !== null && <span className="board-figure">{b.figure}</span>}
                {b.figure === null ? b.text : ` ${b.text}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** The front page every book opens on: what is running, what you missed, and what the town's
 *  own record says about itself. */
export function Standing({ store, onSubject }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const threads = useSyncExternalStore(store.subscribe, store.threads, store.threads)
  const records = useSyncExternalStore(store.subscribe, store.assetRecords, store.assetRecords)
  const record = useFeed(chronicleFeed)
  const paper = useFeed(dispatchesFeed)
  const firsts = useFeed(milestonesFeed)
  const bonds = useFeed(bondsFeed)
  const laws = usePolled('/api/laws', townLaws, LAWS_REFETCH_MS)
  const marks = usePolled(MARKS_URL, markSources, MARKS_POLL_MS)

  const chapter = useMemo(
    () => (paper.data === null ? null : (editions(paper.data)[0]?.title ?? null)),
    [paper.data],
  )
  const deathTicks = useMemo(
    () =>
      marks.data === null
        ? null
        : marks.data.events.filter((e) => e.type === 'agent_died').map((e) => e.tick),
    [marks.data],
  )

  return (
    <StandingView
      sources={{
        now: tick,
        state,
        threads,
        entries: record.data,
        chapter,
        lastVisit: lastVisitTick(),
        firsts: firsts.data,
        laws: laws.data,
        bonds: bonds.data?.bonds ?? NO_BONDS,
        deathTicks,
      }}
      records={records}
      onSubject={onSubject}
    />
  )
}
