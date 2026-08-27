import { useMemo, useState, useSyncExternalStore } from 'react'
import { ChronicleResponseSchema, tickToMoment, type ChronicleEntry } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import type { ObservatoryHandle } from '../net/socket.js'
import { describeEvent } from './chronicleFormat.js'
import { chronicleGlyph } from './importantFeed.js'
import { EMPTY_COPY } from './townStats.js'
import { editions, type Edition } from './dispatches.js'
import { dispatchesFeed } from './feeds.js'
import { useFeed, usePolled } from './useEndpoint.js'

export const FEED_MAX = 120
export const CHRONICLE_REFETCH_MS = 20_000
export const GLYPH_PX = 8

export const CHRONICLE_VIEWS = ['important', 'everything', 'paper'] as const
export type ChronicleView = (typeof CHRONICLE_VIEWS)[number]
// Observation, never achievement: "what mattered" is the editor's word, not the town's score.
export const CHRONICLE_VIEW_LABEL: Record<ChronicleView, string> = {
  important: 'What mattered',
  everything: 'Everything',
  paper: 'The paper',
}

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

/** Where Left/Right/Home/End land from `from`, or `null` for a key the tablist does not own. */
export function tabFromKey(key: string, from: ChronicleView): ChronicleView | null {
  const n = CHRONICLE_VIEWS.length
  const i = CHRONICLE_VIEWS.indexOf(from)
  if (key === 'ArrowRight') return CHRONICLE_VIEWS[(i + 1) % n]!
  if (key === 'ArrowLeft') return CHRONICLE_VIEWS[(i - 1 + n) % n]!
  if (key === 'Home') return CHRONICLE_VIEWS[0]
  if (key === 'End') return CHRONICLE_VIEWS[n - 1]!
  return null
}

/** A tablist with a ROVING TABINDEX: one tab stop for the pair, Left and Right walk it. Without
 *  the walk the inactive tab is out of the tab order and nothing else can reach it. */
export function ChronicleViewTabs({
  view,
  onView,
}: {
  view: ChronicleView
  onView: (v: ChronicleView) => void
}) {
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const next = tabFromKey(e.key, view)
    if (next === null) return
    e.preventDefault()
    onView(next)
    e.currentTarget.querySelector<HTMLButtonElement>(`#chronicle-tab-${next}`)?.focus()
  }
  return (
    <div
      className="feed-switch"
      role="tablist"
      aria-label="What the chronicle shows"
      onKeyDown={onKeyDown}
    >
      {CHRONICLE_VIEWS.map((v) => (
        <button
          key={v}
          role="tab"
          id={`chronicle-tab-${v}`}
          aria-selected={v === view}
          aria-controls={`chronicle-view-${v}`}
          tabIndex={v === view ? 0 : -1}
          className={v === view ? 'feed-tab active' : 'feed-tab'}
          onClick={() => {
            onView(v)
          }}
        >
          {CHRONICLE_VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  )
}

// Newest first, like the live feed beside it: the town's most recent turn is the one a
// viewer arrives looking for.
export function ImportantFeedView({
  entries,
  viewTick,
  onJump,
  loading = false,
}: {
  entries: ChronicleEntry[]
  viewTick: number | null
  onJump: (tick: number) => void
  /** the first fetch has not answered yet — which is NOT the same thing as "nothing happened" */
  loading?: boolean
}) {
  if (entries.length === 0 && loading) {
    return (
      <ol className="feed important" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="skeleton-row" />
        ))}
      </ol>
    )
  }
  if (entries.length === 0) return <p className="feed-empty">{EMPTY_COPY.chronicle}</p>
  return (
    <ol className="feed important">
      {entries.map((e) => (
        <li key={`${e.type}:${e.seq}`} className="feed-line">
          <button
            className="feed-jump"
            aria-current={viewTick === e.tick ? 'true' : undefined}
            aria-label={`${e.label} ${stamp(e.tick)}. Go to this moment.`}
            onClick={() => {
              onJump(e.tick)
            }}
          >
            <Glyph icon={e.icon} />
            <span className="stamp">{stamp(e.tick)}</span>
            <span className="feed-text">{e.label}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

export function EverythingFeedView({
  lines,
  tick = 0,
}: {
  lines: { key: number; tick: number; kind: string; text: string }[]
  tick?: number
}) {
  if (lines.length === 0) {
    const copy = tickToMoment(tick).day >= 1 ? EMPTY_COPY.chronicleQuiet : EMPTY_COPY.chronicle
    return <p className="feed-empty">{copy}</p>
  }
  return (
    <ol className="feed" aria-live="polite">
      {lines.map((l) => (
        <li key={l.key} className={`feed-line ${l.kind}`}>
          <span className="stamp">{stamp(l.tick)}</span>
          <span className="feed-text">{l.text}</span>
        </li>
      ))}
    </ol>
  )
}

/** The town's own paper, one edition per recorded day, newest first. The chronicler writes a
 *  day up when it closes, so a town mid-day has one fewer edition than it has days. */
export function PaperFeedView({
  days,
  loading = false,
}: {
  days: readonly Edition[]
  /** the first fetch has not answered yet — which is NOT the same thing as "nothing printed" */
  loading?: boolean
}) {
  if (days.length === 0 && loading) {
    return (
      <div className="paper" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-row" />
        ))}
      </div>
    )
  }
  if (days.length === 0) return <p className="feed-empty">{EMPTY_COPY.paper}</p>
  return (
    <ol className="paper">
      {days.map((e) => (
        <li key={e.day} className="edition-slot">
          {e.era !== null && (
            <aside className="era-band">
              <p className="era-label">The week that turned</p>
              <h3 className="era-title">{e.era.title}</h3>
              <p className="era-text">{e.era.text}</p>
            </aside>
          )}
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
        </li>
      ))}
    </ol>
  )
}

export function ChroniclePanel({
  store,
  handle,
  onView,
}: {
  store: WorldStore
  handle: ObservatoryHandle | null
  onView: (tick: number | null) => void
}) {
  const events = useSyncExternalStore(store.subscribe, store.recentEvents)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode)
  const [view, setView] = useState<ChronicleView>('important')
  // The curated feed is history, not a stream: it is read on a slow beat rather than rebuilt
  // every tick, so a 2.5s world never re-renders the panel underneath the reader's pointer.
  const read = usePolled('/api/chronicle', chronicleEntries, CHRONICLE_REFETCH_MS)
  const entries = read.data ?? NO_ENTRIES
  const paper = useFeed(dispatchesFeed)
  const days = useMemo(
    () => (paper.data === null ? NO_EDITIONS : editions(paper.data)),
    [paper.data],
  )

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
    <div className="chronicle-panel">
      <h2 className="px-title">Chronicle</h2>
      <ChronicleViewTabs view={view} onView={setView} />
      <div
        role="tabpanel"
        id={`chronicle-view-${view}`}
        aria-labelledby={`chronicle-tab-${view}`}
        tabIndex={-1}
      >
        {view === 'important' ? (
          <ImportantFeedView
            entries={[...entries].reverse()}
            loading={!read.loaded}
            viewTick={mode.live ? null : mode.tick}
            onJump={jump}
          />
        ) : view === 'everything' ? (
          <EverythingFeedView lines={lines} tick={store.getTick()} />
        ) : (
          <PaperFeedView days={days} loading={!paper.loaded} />
        )}
      </div>
    </div>
  )
}
