import { useMemo, useSyncExternalStore } from 'react'
import { MILESTONE_ICON, tickToMoment, type ChronicleEntry } from '@sj/shared'
import type { MilestoneRead } from '@sj/shared/narratorSchema'
import { describeEvent } from '../../ui/chronicleFormat.js'
import { chronicleGlyph } from '../../ui/importantFeed.js'
import { editions, type Edition } from '../../ui/dispatches.js'
import { chronicleFeed, dispatchesFeed, milestonesFeed } from '../../ui/feeds.js'
import { firstsByTier } from '../../ui/firsts.js'
import { useFeed, usePolled, type Read } from '../../ui/useEndpoint.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { momentStamp } from '../stamp.js'
import { Days } from './Days.js'
import { Moments } from './Moments.js'
import type { PageProps } from './index.js'

const FEED_MAX = 120
const GLYPH_PX = 8

const GLYPH: Record<string, string> = {
  agent_died: 'death',
  structure_completed: 'done',
  fire_ignited: 'fire',
  weather_changed: 'weather',
}

const NO_ENTRIES: ChronicleEntry[] = []
const NO_EDITIONS: Edition[] = []

type Chapter = { day: number; title: string; text: string }
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

/** The way back to one minute of the town's history, wherever the record offers one. */
function FeedJump({
  tick,
  label,
  icon,
  current,
  onJump,
}: {
  tick: number
  label: string
  icon: string
  current: boolean
  onJump: (tick: number) => void
}) {
  return (
    <button
      className="feed-jump"
      aria-current={current ? 'true' : undefined}
      aria-label={`${label} ${momentStamp(tick)}. Go to this moment.`}
      onClick={() => {
        onJump(tick)
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

function EditionView({ e }: { e: Edition }) {
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
              <b>{f.name}</b> — {f.description}
            </li>
          ))}
        </ul>
      )}
      {e.caption !== null && <p className="edition-caption">{e.caption}</p>}
    </article>
  )
}

function Today({ store, gapTicks, onJump }: PageProps) {
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

      <section className="block">
        <h3 className="feed-head">The paper</h3>
        {latest === null ? (
          <p className="feed-empty">{EMPTY_COPY.paper}</p>
        ) : (
          <EditionView e={latest} />
        )}
      </section>

      <section className="block">
        <h3 className="feed-head">What mattered</h3>
        {entries.length === 0 && !record.loaded ? (
          <div aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton-row" />
            ))}
          </div>
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
                  current={viewTick === e.tick}
                  onJump={onJump}
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
          <ol className="feed" aria-live="polite">
            {lines.map((l) => (
              <li key={l.key} className={`feed-line ${l.kind}`}>
                <span className="stamp">{momentStamp(l.tick)}</span>
                <span className="feed-text">{l.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

/** One first, and — where the town named the thing itself — the words it was named in. */
function FirstLine({
  first,
  current,
  onJump,
}: {
  first: MilestoneRead
  current: boolean
  onJump: (tick: number) => void
}) {
  const quote = first.nameProvenance?.quote ?? null
  return (
    <li className="feed-line">
      <FeedJump
        tick={first.tick}
        label={first.label}
        icon={MILESTONE_ICON}
        current={current}
        onJump={onJump}
      />
      {quote !== null && <p className="discovery-quote">“{quote}”</p>}
    </li>
  )
}

/** The firsts ledger as the chronicle reads it. Rendered from a read rather than from the feed
 *  so the three states — waiting, empty, written — can be asked of it outside a browser. */
export function FirstsView({
  read,
  viewTick,
  onJump,
}: {
  read: Read<MilestoneRead[]>
  viewTick: number | null
  onJump: (tick: number) => void
}) {
  const groups = useMemo(() => firstsByTier(read.data ?? []), [read.data])

  if (groups.length === 0)
    return read.loaded ? (
      <p className="feed-empty">{EMPTY_COPY.firsts}</p>
    ) : (
      <div aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-row" />
        ))}
      </div>
    )

  return (
    <>
      {groups.map((g) => (
        <section key={g.tier} className="block">
          <h3 className="feed-head">{g.head}</h3>
          <ol className="feed important">
            {g.rows.map((first) => (
              <FirstLine
                key={first.kind}
                first={first}
                current={viewTick === first.tick}
                onJump={onJump}
              />
            ))}
          </ol>
        </section>
      ))}
    </>
  )
}

function Firsts({ store, onJump }: PageProps) {
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const read = useFeed(milestonesFeed)
  return <FirstsView read={read} viewTick={mode.live ? null : mode.tick} onJump={onJump} />
}

function Chapters() {
  const chapters = usePolled<Chapter[]>('/api/chapters').data ?? NO_CHAPTERS
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
      {days.length === 0 ? (
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
