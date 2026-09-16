import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { agentName, tickToMoment, type ChronicleEntry } from '@sj/shared'
import { chronicleFeed, milestonesFeed, dispatchesFeed } from '../../ui/feeds.js'
import { useFeed } from '../../ui/useEndpoint.js'
import { editions, EMPTY_DISPATCHES } from '../../ui/dispatches.js'
import { lastVisitTick } from '../../ui/storage.js'
import { pointPlay } from '../../ui/replayRun.js'
import { momentStamp } from '../stamp.js'
import type { PageProps } from '../pages/types.js'
import { GameIcon, Portrait, iconOf, Empty, Search, FeedState, useNotebook } from './shared.js'

function category(type: string): string {
  if (/structure|build/.test(type)) return 'Town taking shape'
  if (/birth|partner|marri|bond|gift/.test(type)) return 'Life together'
  if (/weather|fire|season/.test(type)) return 'Around the town'
  if (/discover|recipe|craft/.test(type)) return 'Something new'
  return 'Town life'
}
export function GameChronicle(props: PageProps) {
  const { tab, store, onPlay, onSubject } = props
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const read = useFeed(chronicleFeed)
  const dispatches = useFeed(dispatchesFeed)
  const { following } = useNotebook()
  const [search, setSearch] = useState('')
  const [range, setRange] = useState('all')
  const [selected, setSelected] = useState<ChronicleEntry | null>(null)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    setSelected(null)
  }, [tab])
  useEffect(() => {
    if (selected) back.current?.focus()
  }, [selected])
  const tick = state?.tick ?? 0
  const entries = (read.data ?? [])
    .filter((e) => e.tick <= tick)
    .slice()
    .reverse()
  const days = editions(dispatches.data ?? EMPTY_DISPATCHES)
  const paper = days.find((e) => e.day < tickToMoment(tick).day)
  if (tab === 'Firsts') return <Firsts {...props} />
  if (selected && selected.tick <= tick)
    return (
      <div>
        <button ref={back} type="button" className="sj-back" onClick={() => setSelected(null)}>
          ← Back to {tab === 'Timeline' ? 'timeline' : 'catch up'}
        </button>
        <header className="sj-event-head">
          <GameIcon kind={iconOf(selected.type)} />
          <div>
            <span className="sj-meta">
              {category(selected.type)} · {momentStamp(selected.tick)}
            </span>
            <h3>{selected.label}</h3>
          </div>
        </header>
        <h3 className="sj-heading">People in this moment</h3>
        <div className="sj-cast">
          {selected.agentIds?.map((id) => (
            <button
              type="button"
              key={id}
              onClick={() => onSubject({ kind: 'agent', id, name: agentName(state?.agents, id) })}
            >
              <Portrait store={store} id={id} size={32} />
              {agentName(state?.agents, id)}
            </button>
          ))}
        </div>
        {!selected.agentIds?.length && <p>This event belongs to the town as a whole.</p>}
        <p className="sj-meta">
          From the town’s recorded history. Watch to see what happened at this time.
        </p>
        <button
          type="button"
          className="sj-primary"
          onClick={() =>
            onPlay(
              pointPlay(selected.tick, store.liveEdge(), selected.label, selected.agentIds ?? []),
            )
          }
        >
          <GameIcon kind="compass" />
          Watch this moment →
        </button>
      </div>
    )
  const shown = entries.filter(
    (e) =>
      `${e.label} ${e.agentIds?.map((id) => agentName(state?.agents, id)).join(' ')}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (range !== 'today' || tickToMoment(e.tick).day === tickToMoment(tick).day) &&
      (range !== 'following' || e.agentIds?.some((id) => following.includes(id))),
  )
  const catchup = shown.filter((e) => e.tick > (lastVisitTick() ?? -1))
  const list = tab === 'Timeline' ? shown : (catchup.length ? catchup : shown).slice(0, 12)
  return (
    <div>
      {tab !== 'Timeline' && (
        <div className="sj-dispatch">
          <GameIcon kind="chronicle" />
          <div>
            <h3>{catchup.length ? 'Since your last visit' : 'The latest from town'}</h3>
            <p>
              {catchup.length
                ? `${catchup.length} recorded moments to catch up on.`
                : 'A few moments worth opening.'}
            </p>
          </div>
        </div>
      )}
      {tab !== 'Timeline' && paper && (
        <details className="sj-details">
          <summary>The day’s paper · Day {paper.day}</summary>
          <h3>{paper.title}</h3>
          <p className="sj-prose">{paper.body}</p>
        </details>
      )}
      <Search value={search} onChange={setSearch} placeholder="Find a moment or a person…" />
      {tab === 'Timeline' && (
        <div className="sj-tools">
          <label>
            Show{' '}
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="all">All recorded moments</option>
              <option value="today">Today</option>
              <option value="following">People I follow</option>
            </select>
          </label>
          <span>{shown.length} moments</span>
        </div>
      )}
      <FeedState read={read} retry={chronicleFeed.retry} />
      <div className="sj-events">
        {list.map((e, i) => (
          <div key={`${e.type}:${e.seq}`}>
            {(i === 0 || tickToMoment(list[i - 1]!.tick).day !== tickToMoment(e.tick).day) && (
              <h3 className="sj-day">Day {tickToMoment(e.tick).day}</h3>
            )}
            <button type="button" className="sj-event-button" onClick={() => setSelected(e)}>
              <span className="sj-event-top">
                <GameIcon kind={iconOf(e.type)} />
                <span>
                  <span className="sj-meta">
                    {category(e.type)} · {tickToMoment(e.tick).time}
                  </span>
                  <strong>{e.label}</strong>
                </span>
                <span aria-hidden="true">→</span>
              </span>
              {!!e.agentIds?.length && (
                <span className="sj-event-cast">
                  {e.agentIds.slice(0, 3).map((id) => (
                    <Portrait store={store} id={id} key={id} size={24} />
                  ))}
                  <span>{e.agentIds.map((id) => agentName(state?.agents, id)).join(', ')}</span>
                </span>
              )}
              <span className="sj-card-read">Open this moment →</span>
            </button>
          </div>
        ))}
      </div>
      {read.loaded && !read.failed && !list.length && (
        <Empty
          icon="chronicle"
          title={search || range !== 'all' ? 'No matching moments' : 'The story starts here'}
        >
          {search || range !== 'all'
            ? 'Change the filter to see more of the record.'
            : 'As things happen in town, its story will fill these pages.'}
        </Empty>
      )}
      {tab !== 'Timeline' && (
        <button
          type="button"
          className="sj-link"
          onClick={() => props.onBrowse?.('chronicle', 'Timeline')}
        >
          Explore the full timeline →
        </button>
      )}
      <details className="sj-details">
        <summary>Longer reads & recorded scenes</summary>
        <button
          className="sj-link"
          type="button"
          onClick={() => props.onBrowse?.('chronicle', 'Record')}
        >
          Open the complete town record →
        </button>
      </details>
    </div>
  )
}
function Firsts({ store, onPlay }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const read = useFeed(milestonesFeed)
  const rows = (read.data ?? [])
    .filter((r) => r.tick <= (state?.tick ?? 0))
    .sort((a, b) => b.tick - a.tick)
  return (
    <>
      <div className="sj-dispatch">
        <GameIcon kind="medal" />
        <div>
          <h3>A town of firsts</h3>
          <p>Milestones earned by the lives unfolding here.</p>
        </div>
      </div>
      <FeedState read={read} retry={milestonesFeed.retry} />
      <div className="sj-awards">
        {rows.map((r) => (
          <button
            type="button"
            className="sj-award"
            key={r.kind}
            onClick={() => onPlay(pointPlay(r.tick, store.liveEdge(), r.label, r.agentIds))}
          >
            <GameIcon kind="medal" />
            <span className="sj-meta">{momentStamp(r.tick)}</span>
            <strong>{r.label}</strong>
            {r.nameProvenance?.quote && <span>“{r.nameProvenance.quote}”</span>}
            <span>{r.agentIds.map((id) => agentName(state?.agents, id)).join(', ')}</span>
            <span className="sj-link">Watch the first →</span>
          </button>
        ))}
      </div>
      {read.loaded && !read.failed && !rows.length && (
        <Empty icon="medal" title="The first page is waiting">
          When the town reaches a recorded milestone, it will have a place here. There is no
          checklist to complete.
        </Empty>
      )}
    </>
  )
}
