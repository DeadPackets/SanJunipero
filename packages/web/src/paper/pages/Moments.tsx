import { memo, useMemo, useState, useSyncExternalStore } from 'react'
import { MomentSchema, type Moment } from '@sj/shared'
import type { PeopleIndex } from '../../ui/bondModel2.js'
import {
  momentDays,
  moreFromDay,
  thumbLabel,
  thumbMotif,
  thumbTitle,
} from '../../ui/momentThumb.js'
import { sceneWindow, type MomentPlay } from '../../ui/replayRun.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { OutOfReach } from '../../ui/OutOfReach.js'
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

const MOTIF_PX = 8

export function momentPlay(moment: Moment, edge: number): MomentPlay {
  return {
    ...sceneWindow(moment.startTick, moment.endTick, edge),
    cast: moment.cast,
    title: thumbTitle(moment),
    tick: moment.startTick,
  }
}

function Motif({ moment }: { moment: Moment }) {
  return (
    <svg
      className="thumb-motif"
      viewBox={`0 0 ${MOTIF_PX} ${MOTIF_PX}`}
      width={MOTIF_PX * 3}
      height={MOTIF_PX * 3}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {thumbMotif(moment).pixels.map(([x, y, fill]) => (
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </svg>
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
        aria-label={`${thumbTitle(moment)}. ${momentStamp(moment.startTick)}, ${label.cast}, ${where}. Watch this moment.`}
        onClick={() => {
          onOpen(moment)
        }}
      >
        <Motif moment={moment} />
        <span className="thumb-body">
          <span className="thumb-when">{momentStamp(moment.startTick)}</span>
          <span className="thumb-title">{thumbTitle(moment)}</span>
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

/** The cards alone: the sheet CLOSES on play, so a transport inside it could never be seen.
 *  The town's own strip is the one that runs a moment (`stage/Transport`). */
export function Moments({ store, momentId, onPlay, onMoment }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const edge = useSyncExternalStore(store.subscribe, store.liveEdge, store.liveEdge)
  // The town is still watchable without its record, so a refused read stays `null`.
  const record = useEndpointFor('/api/moments', momentRows)
  const read = useFeed(record)
  const moments = read.data
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set())

  const people: PeopleIndex = useMemo(() => {
    const out: Record<string, { name: string; alive: boolean }> = {}
    for (const a of Object.values(state?.agents ?? {})) out[a.id] = { name: a.name, alive: a.alive }
    return out
  }, [state])

  const days = useMemo(() => momentDays(moments ?? []), [moments])

  if (read.failed && moments === null) return <OutOfReach onRetry={record.retry} />
  if (moments !== null && moments.length === 0)
    return <p className="feed-empty">{EMPTY_COPY.moments}</p>

  const watch = (picked: Moment): void => {
    onMoment(picked.id)
    onPlay(momentPlay(picked, edge))
  }

  return (
    <div className="moment-run">
      {days.map((d) => (
        <section key={d.day} className="block moment-day">
          <h3 className="feed-head">Day {d.day}</h3>
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
