import { memo, useMemo, useState, useSyncExternalStore } from 'react'
import { MomentSchema, tickToMoment, type Moment } from '@sj/shared'
import type { PeopleIndex } from '../../ui/bondModel2.js'
import { chaptersFeed, dispatchesFeed } from '../../ui/feeds.js'
import type { Chapter } from '../../ui/chapterCaption.js'
import { editions, type Edition } from '../../ui/dispatches.js'
import { momentDays, moreFromDay, thumbLabel, thumbMotif } from '../../ui/momentThumb.js'
import { sceneWindow, type MomentPlay } from '../../ui/replayRun.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { OutOfReach } from '../../ui/OutOfReach.js'
import { PixelGlyph } from '../../stage/PixelGlyph.js'
import { Skeleton } from './Skeleton.js'
import { momentStamp } from '../stamp.js'
import type { PageProps } from './types.js'

/** Row by row on purpose: the schema wants a title of at least one character, and one untitled
 *  scene parsed as a whole array took the entire filmstrip with it. */
export const momentRows = (body: unknown): Moment[] | null => {
  const rows = (body as { moments?: unknown } | null)?.moments
  if (!Array.isArray(rows)) return null
  return rows.flatMap((row) => {
    const parsed = MomentSchema.safeParse(row)
    return parsed.success ? [parsed.data] : []
  })
}

/** The gateway's card is 1080×565; the lead card draws it at a third and lets CSS cap it. */
const CARD_W = 360
const CARD_H = 188
const NO_CHAPTERS: Chapter[] = []
const NO_EDITIONS: Edition[] = []
/** The postcard the gateway composes for this minute — the same picture a shared link opens
 *  with, so the grid and the og card can never show two different things. */
const postcard = (m: Moment): string => {
  const at = tickToMoment(m.startTick)
  return `/card/moment/${at.day}/${at.time}.png`
}

export function momentPlay(moment: Moment, edge: number): MomentPlay {
  return {
    ...sceneWindow(moment.startTick, moment.endTick, edge),
    cast: moment.cast,
    title: moment.title,
    tick: moment.startTick,
  }
}

export function EditionView({ e }: { e: Edition }) {
  return (
    <article className="edition">
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
              <b>{f.name}</b>, {f.description}
            </li>
          ))}
        </ul>
      )}
      {e.caption !== null && <p className="edition-caption">{e.caption}</p>}
    </article>
  )
}

const MomentCardView = memo(function MomentCardView({
  moment,
  people,
  open,
  lead = false,
  onOpen,
}: {
  moment: Moment
  people: PeopleIndex
  open: boolean
  lead?: boolean
  onOpen: (moment: Moment) => void
}) {
  const label = thumbLabel(moment, people)
  const where = label.location ?? 'somewhere in the town'
  return (
    <li>
      <button
        type="button"
        className={lead ? 'moment-card lead' : 'moment-card'}
        data-open={open ? 'yes' : undefined}
        aria-current={open ? 'true' : undefined}
        aria-label={`${moment.title}. ${momentStamp(moment.startTick)}, ${label.cast}, ${where}. Watch this moment.`}
        onClick={() => {
          onOpen(moment)
        }}
      >
        {lead ? (
          <img
            className="thumb-card"
            src={postcard(moment)}
            alt=""
            loading="lazy"
            decoding="async"
            width={CARD_W}
            height={CARD_H}
          />
        ) : (
          <PixelGlyph className="thumb-motif" pixels={thumbMotif(moment).pixels} scale={3} />
        )}
        <span className="thumb-body">
          <span className="thumb-when">{momentStamp(moment.startTick)}</span>
          <span className="thumb-title">{moment.title}</span>
          {lead && moment.summary !== null && (
            <span className="thumb-summary">{moment.summary}</span>
          )}
          <span className="thumb-meta">
            <span className="thumb-cast">{label.cast}</span>
            {label.location !== null && <span className="thumb-where">{label.location}</span>}
          </span>
        </span>
      </button>
    </li>
  )
})

/** One day of the record: what the narrator called it, what the town printed about it, and the
 *  minutes it kept. */
type RecordDay = {
  day: number
  chapter: Chapter | null
  edition: Edition | null
  lead: Moment | null
  rest: Moment[]
}

function recordDays(
  moments: readonly Moment[],
  chapters: readonly Chapter[],
  written: readonly Edition[],
): RecordDay[] {
  const byDay = new Map<number, RecordDay>()
  const at = (day: number): RecordDay => {
    const seen = byDay.get(day)
    if (seen !== undefined) return seen
    const made: RecordDay = { day, chapter: null, edition: null, lead: null, rest: [] }
    byDay.set(day, made)
    return made
  }
  for (const d of momentDays(moments)) {
    const row = at(d.day)
    row.lead = d.lead
    row.rest = [...d.rest]
  }
  for (const c of chapters) at(c.day).chapter = c
  for (const e of written) at(e.day).edition = e
  return [...byDay.values()].sort((a, b) => b.day - a.day)
}

/** The log the Record is: one section a day, newest first, the chapter as the day's own head and
 *  the filmstrip under it. The sheet CLOSES on play, so a control inside it could never be seen. */
export function Moments({
  store,
  momentId,
  fromDay,
  onPlay,
  onMoment,
}: PageProps & { fromDay: number }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const edge = useSyncExternalStore(store.subscribe, store.liveEdge, store.liveEdge)
  // The town is still watchable without its record, so a refused read stays `null`.
  const record = useEndpointFor('/api/moments', momentRows)
  const read = useFeed(record)
  const moments = read.data
  const chapters = useFeed(chaptersFeed).data ?? NO_CHAPTERS
  const paper = useFeed(dispatchesFeed)
  const written = useMemo(
    () => (paper.data === null ? NO_EDITIONS : editions(paper.data)),
    [paper.data],
  )
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set())

  const people: PeopleIndex = useMemo(() => {
    const out: Record<string, { name: string; alive: boolean }> = {}
    for (const a of Object.values(state?.agents ?? {})) out[a.id] = { name: a.name, alive: a.alive }
    return out
  }, [state])

  const all = useMemo(
    () => recordDays(moments ?? [], chapters, written),
    [moments, chapters, written],
  )
  const days = all.filter((d) => d.day >= fromDay)

  if (read.failed && moments === null && all.length === 0)
    return <OutOfReach onRetry={record.retry} />
  // An empty shelf is a town with no kept days; the read is still out, and the two are not the
  // same sentence.
  if (moments === null && all.length === 0) return <Skeleton rows={3} />
  if (all.length === 0) return <p className="feed-empty">{EMPTY_COPY.moments}</p>
  if (days.length === 0)
    return <p className="feed-empty">Nothing in this range. Widen it to reach the days before.</p>

  const watch = (picked: Moment): void => {
    onMoment(picked.id)
    onPlay(momentPlay(picked, edge))
  }

  return (
    <div className="moment-run">
      {days.map((d) => (
        <section key={d.day} className="block record-day">
          <h3 className="feed-head">
            <span className="record-day-n">Day {d.day}</span>
            {d.chapter?.title}
          </h3>
          {d.chapter !== null && <p className="chapter-text">{d.chapter.text}</p>}
          {d.edition?.era != null && (
            <aside className="era-band">
              <p className="era-label">The week that turned</p>
              <h4 className="era-title">{d.edition.era.title}</h4>
              <p className="era-text">{d.edition.era.text}</p>
            </aside>
          )}
          {d.edition !== null && <EditionView e={d.edition} />}
          {d.lead !== null && (
            <ol className="strip-list" aria-label={`What the town kept from day ${d.day}`}>
              <MomentCardView
                moment={d.lead}
                people={people}
                open={d.lead.id === momentId}
                lead
                onOpen={watch}
              />
              {opened.has(d.day) &&
                d.rest.map((m) => (
                  <MomentCardView
                    key={m.id}
                    moment={m}
                    people={people}
                    open={m.id === momentId}
                    onOpen={watch}
                  />
                ))}
            </ol>
          )}
          {d.rest.length > 0 && (
            <button
              type="button"
              className="moment-more"
              aria-expanded={opened.has(d.day)}
              onClick={() => {
                setOpened((prev) => {
                  const next = new Set(prev)
                  if (!next.delete(d.day)) next.add(d.day)
                  return next
                })
              }}
            >
              {opened.has(d.day) ? 'Fewer' : moreFromDay(d.rest)}
            </button>
          )}
        </section>
      ))}
    </div>
  )
}
