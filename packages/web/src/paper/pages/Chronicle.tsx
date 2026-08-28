import { useMemo, useSyncExternalStore } from 'react'
import { ChronicleResponseSchema, tickToMoment, type ChronicleEntry } from '@sj/shared'
import { describeEvent } from '../../ui/chronicleFormat.js'
import { chronicleGlyph } from '../../ui/importantFeed.js'
import { editions, type Edition } from '../../ui/dispatches.js'
import { dispatchesFeed } from '../../ui/feeds.js'
import { useFeed, usePolled } from '../../ui/useEndpoint.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { Days } from './Days.js'
import { Moments } from './Moments.js'
import type { PageProps } from './index.js'

export const CHRONICLE_REFETCH_MS = 20_000
export const FEED_MAX = 120
export const GLYPH_PX = 8

const GLYPH: Record<string, string> = {
  agent_died: 'death',
  structure_completed: 'done',
  fire_ignited: 'fire',
  weather_changed: 'weather',
}

const NO_ENTRIES: ChronicleEntry[] = []
const NO_EDITIONS: Edition[] = []
const chronicleEntries = (body: unknown): ChronicleEntry[] | null => {
  const parsed = ChronicleResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.entries : null
}

type Chapter = { day: number; title: string; text: string }
const NO_CHAPTERS: Chapter[] = []

const stamp = (tick: number): string => {
  const m = tickToMoment(tick)
  return `Day ${m.day} ${m.time}`
}

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

export function ChroniclePage(props: PageProps) {
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

function Today({ store, handle, gapTicks, onView }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const events = useSyncExternalStore(store.subscribe, store.recentEvents, store.recentEvents)
  // The curated feed is history, not a stream: it is read on a slow beat rather than rebuilt
  // every tick, so a 2.5s world never re-renders the sheet underneath the reader's pointer.
  const read = usePolled('/api/chronicle', chronicleEntries, CHRONICLE_REFETCH_MS)
  const entries = read.data ?? NO_ENTRIES
  const paper = useFeed(dispatchesFeed)
  const days = useMemo(
    () => (paper.data === null ? NO_EDITIONS : editions(paper.data)),
    [paper.data],
  )
  const latest = days[0] ?? null
  const daysAway = gapTicks === null ? 0 : Math.floor(gapTicks / 1440)
  const viewTick = mode.live ? null : mode.tick

  const lines: { key: number; tick: number; kind: string; text: string }[] = []
  for (let i = events.length - 1; i >= 0 && lines.length < FEED_MAX; i--) {
    const ev = events[i]!
    const text = describeEvent(ev, state)
    if (text !== null)
      lines.push({ key: ev.seq, tick: ev.tick, kind: GLYPH[ev.type] ?? 'plain', text })
  }

  const jump = (tick: number): void => {
    handle?.scrub(tick)
    onView(tick)
  }

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
        {entries.length === 0 && !read.loaded ? (
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
                <button
                  className="feed-jump"
                  aria-current={viewTick === e.tick ? 'true' : undefined}
                  aria-label={`${e.label} ${stamp(e.tick)}. Go to this moment.`}
                  onClick={() => {
                    jump(e.tick)
                  }}
                >
                  <Glyph icon={e.icon} />
                  <span className="stamp">{stamp(e.tick)}</span>
                  <span className="feed-text">{e.label}</span>
                </button>
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
                <span className="stamp">{stamp(l.tick)}</span>
                <span className="feed-text">{l.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
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
