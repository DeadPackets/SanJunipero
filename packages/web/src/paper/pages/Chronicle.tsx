import { useMemo, useSyncExternalStore } from 'react'
import {
  agentName,
  tickToMoment,
  type AssetRecord,
  type ChronicleEntry,
  type NameIndex,
} from '@sj/shared'
import type { MilestoneRead } from '@sj/shared/narratorSchema'
import { describeEvent } from '../../ui/chronicleFormat.js'
import { chronicleGlyph } from '../../ui/importantFeed.js'
import { editions, type Edition } from '../../ui/dispatches.js'
import {
  chaptersFeed,
  chronicleFeed,
  dispatchesFeed,
  milestonesFeed,
  type Chapter,
} from '../../ui/feeds.js'
import { OutOfReach } from '../../ui/OutOfReach.js'
import { firstsByTier } from '../../ui/firsts.js'
import { firstPlate, type FirstPlate } from '../../ui/firstPlate.js'
import { bustStyle } from '../../ui/bustStyle.js'
import { lastVisitTick } from '../../ui/storage.js'
import { pointPlay, type MomentPlay } from '../../ui/replayRun.js'
import { useFeed, type Read } from '../../ui/useEndpoint.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { momentStamp } from '../stamp.js'
import { Days } from './Days.js'
import { Moments } from './Moments.js'
import { Skeleton } from './Skeleton.js'
import type { PageProps } from './types.js'

const FEED_MAX = 120
const GLYPH_PX = 8

const GLYPH: Record<string, string> = {
  agent_died: 'death',
  structure_completed: 'done',
  fire_ignited: 'fire',
  weather_changed: 'weather',
}

const NO_ENTRIES: ChronicleEntry[] = []
const NO_CAST: readonly string[] = []
const NO_RECORDS: AssetRecord[] = []
/** Head and shoulders at the plate's own size; the roster uses 48 and the stream frame 96. */
const BUST_PX = 40
const NO_EDITIONS: Edition[] = []

const NO_CHAPTERS: Chapter[] = []

// Decorative: the sentence beside it carries the meaning, so the glyph stays out of the
// accessibility tree instead of being read twice.
function Glyph({ icon }: { icon: string }) {
  return (
    <svg
      className="feed-glyph"
      viewBox={`0 0 ${GLYPH_PX} ${GLYPH_PX}`}
      width={GLYPH_PX * 2}
      height={GLYPH_PX * 2}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {chronicleGlyph(icon).pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
  )
}

function FeedJump({
  tick,
  label,
  icon,
  cast,
  current,
  edge,
  onPlay,
}: {
  tick: number
  label: string
  icon: string
  cast: readonly string[]
  current: boolean
  edge: number
  onPlay: (play: MomentPlay) => void
}) {
  return (
    <button
      type="button"
      className="feed-jump"
      aria-current={current ? 'true' : undefined}
      aria-label={`${label} ${momentStamp(tick)}. Watch this moment.`}
      onClick={() => {
        onPlay(pointPlay(tick, edge, label, cast))
      }}
    >
      <Glyph icon={icon} />
      <span className="stamp">{momentStamp(tick)}</span>
      <span className="feed-text">{label}</span>
    </button>
  )
}

export function ChroniclePage(props: PageProps) {
  if (props.tab === 'Firsts') return <Firsts {...props} />
  if (props.tab === 'Chapters') return <Chapters />
  if (props.tab === 'Moments') return <Moments {...props} />
  if (props.tab === 'Days') return <Days {...props} />
  return <Today {...props} />
}

function EditionView({ e, lead = false }: { e: Edition; lead?: boolean }) {
  return (
    <article className={lead ? 'edition lead' : 'edition'}>
      <p className="edition-head">
        <span className="edition-day">Day {e.day}</span>
        {e.temper !== null && <span className="edition-temper">{e.temper}</span>}
      </p>
      <h3 className="edition-title">{e.title}</h3>
      <p className="edition-body">{e.body}</p>
      {e.formed.length > 0 && (
        <ul className="edition-formed">
          {e.formed.map((f) => (
            <li key={f.name}>
              <b>{f.name}</b> — {f.description}
            </li>
          ))}
        </ul>
      )}
      {e.caption !== null && <p className="edition-caption">{e.caption}</p>}
    </article>
  )
}

/** The lead before the chronicler has written one: the newest beat as the headline and the two
 *  before it as the deck. A front page whose lead read "nothing printed yet" for a whole day
 *  was the first thing a viewer opened on. */
function DaySoFar({ entries }: { entries: readonly ChronicleEntry[] }) {
  const newest = [...entries].reverse()
  const head = newest[0]!
  const deck = newest.slice(1, 3)
  return (
    <article className="edition lead">
      <p className="edition-head">
        <span className="edition-day">{momentStamp(head.tick)}</span>
        <span className="edition-temper">The day so far</span>
      </p>
      <h3 className="edition-title">{head.label}</h3>
      {deck.length > 0 && (
        <p className="edition-body">
          {deck.map((e, i) => (
            <span key={`${e.type}:${e.seq}`}>
              {i > 0 ? ' ' : ''}
              {e.label}
            </span>
          ))}
        </p>
      )}
    </article>
  )
}

function Today({ store, gapTicks, onPlay }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const events = useSyncExternalStore(store.subscribe, store.recentEvents, store.recentEvents)
  const record = useFeed(chronicleFeed)
  const entries = record.data ?? NO_ENTRIES
  const paper = useFeed(dispatchesFeed)
  const days = useMemo(
    () => (paper.data === null ? NO_EDITIONS : editions(paper.data)),
    [paper.data],
  )
  const latest = days[0] ?? null
  const daysAway = gapTicks === null ? 0 : Math.floor(gapTicks / 1440)
  const viewTick = mode.live ? null : mode.tick
  const edge = useSyncExternalStore(store.subscribe, store.liveEdge, store.liveEdge)

  // A poll landing, a scrub, or the gap notice re-renders this page; the fold behind the feed
  // only changes when the events or the world do.
  const lines = useMemo(() => {
    const out: { key: number; tick: number; kind: string; text: string }[] = []
    for (let i = events.length - 1; i >= 0 && out.length < FEED_MAX; i--) {
      const ev = events[i]!
      const text = describeEvent(ev, state)
      if (text !== null)
        out.push({ key: ev.seq, tick: ev.tick, kind: GLYPH[ev.type] ?? 'plain', text })
    }
    return out
  }, [events, state])

  return (
    <>
      {daysAway > 0 && (
        <p className="sheet-note">
          {daysAway === 1 ? 'A day passed' : `${daysAway} days passed`} while you were away.
        </p>
      )}

      {/* THE FRONT PAGE: the day's own paper is the lead story and the live feed is the column
          beside it. Below the sheet's own 40rem the two stack, which is what a narrow broadsheet
          has always done. */}
      <div className="bs-front">
        <section className="block bs-lead">
          {/* The edition carries its own headline, so the section name is for the reader who
              cannot see that it is one. */}
          <h3 className="stage-sr">The day’s paper</h3>
          {latest === null && paper.failed ? (
            <OutOfReach onRetry={dispatchesFeed.retry} />
          ) : latest === null && entries.length > 0 ? (
            <DaySoFar entries={entries} />
          ) : latest === null ? (
            <p className="feed-empty">{EMPTY_COPY.paper}</p>
          ) : (
            <EditionView e={latest} lead />
          )}
        </section>

        <div className="bs-column">
          <section className="block">
            <h3 className="feed-head">What mattered</h3>
            {entries.length === 0 && !record.loaded ? (
              <Skeleton />
            ) : entries.length === 0 && record.failed ? (
              <OutOfReach onRetry={chronicleFeed.retry} />
            ) : entries.length === 0 ? (
              <p className="feed-empty">{EMPTY_COPY.chronicle}</p>
            ) : (
              <ol className="feed important">
                {[...entries].reverse().map((e) => (
                  <li key={`${e.type}:${e.seq}`} className="feed-line">
                    <FeedJump
                      tick={e.tick}
                      label={e.label}
                      icon={e.icon}
                      cast={e.agentIds ?? NO_CAST}
                      current={viewTick === e.tick}
                      edge={edge}
                      onPlay={onPlay}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="block">
            <h3 className="feed-head">Since you arrived</h3>
            {lines.length === 0 ? (
              <p className="feed-empty">
                {tickToMoment(store.getTick()).day >= 1
                  ? EMPTY_COPY.chronicleQuiet
                  : EMPTY_COPY.chronicle}
              </p>
            ) : (
              <ol className="feed">
                {lines.map((l) => (
                  <li key={l.key} className={`feed-line ${l.kind}`}>
                    <span className="stamp">{momentStamp(l.tick)}</span>
                    <span className="feed-text">{l.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

/** One first, as a plate: the emblem, the name of the thing in the town's title face, the day
 *  it happened, whoever it happened to, the words it was named out of, and one verb. Nothing
 *  counted, nothing ranked, no tier number anywhere — the material carries the rarity. */
function FirstPlateView({
  plate,
  people,
  records,
  current,
  edge,
  onPlay,
}: {
  plate: FirstPlate
  people: NameIndex | undefined
  records: AssetRecord[]
  current: boolean
  edge: number
  onPlay: (play: MomentPlay) => void
}) {
  const named = plate.cast.map((id) => ({ id, name: agentName(people, id) }))
  return (
    <li
      className="first-plate"
      data-material={plate.material}
      data-fresh={plate.fresh ? 'yes' : undefined}
      data-current={current ? 'yes' : undefined}
    >
      <p className="first-emblem" aria-hidden="true">
        <Glyph icon={plate.glyph} />
      </p>
      <h4 className="first-label">{plate.label}</h4>
      <p className="first-when">{momentStamp(plate.tick)}</p>
      {named.length > 0 && (
        <ul className="first-cast">
          {named.map((who) => (
            <li key={who.id}>
              <Bust records={records} agentId={who.id} name={who.name} />
              <span className="first-cast-name">{who.name}</span>
            </li>
          ))}
        </ul>
      )}
      {plate.quote !== null && <p className="first-quote">“{plate.quote}”</p>}
      <button
        type="button"
        className="first-watch"
        aria-label={`${plate.label}, ${momentStamp(plate.tick)}. Watch this moment.`}
        onClick={() => {
          onPlay(pointPlay(plate.tick, edge, plate.label, plate.cast))
        }}
      >
        Watch
      </button>
    </li>
  )
}

/** The head and shoulders off the town's own atlas, or the pixel token where a person has no
 *  art yet. `alt=""` on purpose: the name is printed beside it. */
function Bust({
  records,
  agentId,
  name,
}: {
  records: AssetRecord[]
  agentId: string
  name: string
}) {
  const style = bustStyle(records, agentId, BUST_PX)
  return (
    <span
      className="first-bust"
      data-blank={style === null ? 'yes' : undefined}
      style={style ?? undefined}
      role="img"
      aria-label={name}
    />
  )
}

/** From a read rather than from the feed, so the three states — waiting, empty, written — can
 *  be asked of it outside a browser. */
export function FirstsView({
  read,
  viewTick,
  edge,
  lastVisit = null,
  people,
  records = NO_RECORDS,
  onPlay,
}: {
  read: Read<MilestoneRead[]>
  viewTick: number | null
  edge: number
  /** the tick this browser had watched up to when the tab opened, for the dog-ear */
  lastVisit?: number | null
  people?: NameIndex | undefined
  records?: AssetRecord[]
  onPlay: (play: MomentPlay) => void
}) {
  const groups = useMemo(() => firstsByTier(read.data ?? []), [read.data])

  if (groups.length === 0) {
    if (read.failed) return <OutOfReach onRetry={milestonesFeed.retry} />
    return read.loaded ? <p className="feed-empty">{EMPTY_COPY.firsts}</p> : <Skeleton />
  }

  return (
    <>
      {groups.map((g) => (
        <section key={g.tier} className="block">
          <h3 className="feed-head">{g.head}</h3>
          <ol className="first-shelf">
            {g.rows.map((first) => (
              <FirstPlateView
                key={first.kind}
                plate={firstPlate(first, lastVisit)}
                people={people}
                records={records}
                current={viewTick === first.tick}
                edge={edge}
                onPlay={onPlay}
              />
            ))}
          </ol>
        </section>
      ))}
    </>
  )
}

function Firsts({ store, onPlay }: PageProps) {
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const edge = useSyncExternalStore(store.subscribe, store.liveEdge, store.liveEdge)
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const records = useSyncExternalStore(store.subscribe, store.assetRecords, store.assetRecords)
  const read = useFeed(milestonesFeed)
  return (
    <FirstsView
      read={read}
      viewTick={mode.live ? null : mode.tick}
      edge={edge}
      lastVisit={lastVisitTick()}
      people={state?.agents}
      records={records}
      onPlay={onPlay}
    />
  )
}

function Chapters() {
  const chapters = useFeed(chaptersFeed).data ?? NO_CHAPTERS
  const paper = useFeed(dispatchesFeed)
  const days = useMemo(
    () => (paper.data === null ? NO_EDITIONS : editions(paper.data)),
    [paper.data],
  )

  return (
    <>
      {chapters.length > 0 && (
        <section className="block">
          {[...chapters]
            .sort((a, b) => b.day - a.day)
            .map((c) => (
              <article key={c.day} className="chapter">
                <p className="chapter-head">
                  <span className="stamp">Day {c.day}</span> {c.title}
                </p>
                <p className="chapter-text">{c.text}</p>
              </article>
            ))}
        </section>
      )}
      {days.length === 0 && paper.failed ? (
        <OutOfReach onRetry={dispatchesFeed.retry} />
      ) : days.length === 0 ? (
        <p className="feed-empty">{EMPTY_COPY.paper}</p>
      ) : (
        <ol className="paper-run">
          {days.map((e) => (
            <li key={e.day} className="edition-slot">
              {e.era !== null && (
                <aside className="era-band">
                  <p className="era-label">The week that turned</p>
                  <h3 className="era-title">{e.era.title}</h3>
                  <p className="era-text">{e.era.text}</p>
                </aside>
              )}
              <EditionView e={e} />
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
