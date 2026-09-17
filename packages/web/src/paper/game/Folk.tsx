import { useState, useSyncExternalStore } from 'react'
import {
  DAYS_PER_YEAR,
  agentName,
  kindWords,
  tickToMoment,
  bondLevel,
  bondWarmth,
} from '@sj/shared'
import { stateWord, conditionsOf, CONDITION_WORD } from '../../ui/status.js'
import { placeOf } from '../../ui/place.js'
import { aimsFeed, bondsFeed, chronicleFeed } from '../../ui/feeds.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { skillPhrase } from '../../ui/roster/expand.js'
import { pointPlay } from '../../ui/replayRun.js'
import { momentStamp } from '../stamp.js'
import type { PageProps } from '../pages/types.js'
import type { JournalRow, LedgerRow } from '../pages/Person.js'
import {
  GameIcon,
  Portrait,
  skillOf,
  tintOf,
  FollowStar,
  useNotebook,
  markOpened,
  useOpened,
  Need,
  Empty,
  Search,
  FeedState,
} from './shared.js'

export function GameFolk({ tab, store, onSubject, onBrowse }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const { following, opened } = useNotebook()
  const [search, setSearch] = useState('')
  if (state === null) return <p role="status">Meeting the town…</p>
  const all = Object.values(state.agents)
    .filter((a) => a.alive && a.departed === undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
  const people = all.filter(
    (a) =>
      (tab !== 'Following' || following.includes(a.id)) &&
      `${a.name} ${skillOf(a).words} ${stateWord(a, state.tick)} ${placeOf(state, a.id).words}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  )
  const read = all.filter((a) => opened.includes(a.id)).length
  return (
    <div className="sj-folk">
      <div className="sj-notebook">
        <GameIcon kind="note" />
        <div>
          <strong>Your town notebook</strong>
          <span>Open a profile to get to know someone.</span>
          <progress value={read} max={Math.max(1, all.length)} aria-label="Profiles opened" />
        </div>
        <b>
          {read}
          <small>/{all.length}</small>
        </b>
      </div>
      <Search value={search} onChange={setSearch} placeholder="Find a person, activity or place…" />
      <p className="sj-count">
        {people.length} {people.length === 1 ? 'person' : 'people'}
        {tab === 'Following' ? ' in your following list' : ' around town'}
      </p>
      <div className="sj-roster">
        {people.map((a) => {
          const skill = skillOf(a)
          return (
            <article key={a.id} className="sj-villager" data-tint={tintOf(a.id)}>
              <button
                className="sj-villager-main"
                type="button"
                onClick={() => {
                  markOpened(a.id)
                  onSubject({ kind: 'agent', id: a.id, name: a.name })
                }}
              >
                <span className="sj-villager-art">
                  <Portrait store={store} id={a.id} size={76} />
                  <span className="sj-crest">
                    <GameIcon kind={skill.icon} />
                  </span>
                </span>
                <strong>{a.name}</strong>
                <span className="sj-skill">{skill.words}</span>
                <span className="sj-task">{stateWord(a, state.tick)}</span>
                <span className="sj-location">{placeOf(state, a.id).words}</span>
                <span className="sj-card-read">
                  {opened.includes(a.id) ? 'Read their story →' : 'Get to know them →'}
                </span>
              </button>
              <FollowStar id={a.id} name={a.name} />
            </article>
          )
        })}
      </div>
      {people.length === 0 && (
        <Empty
          icon={tab === 'Following' ? 'star' : 'search'}
          title={search ? 'Nobody matches yet' : 'Keep your favourites close'}
        >
          {search
            ? 'Try a name or a different activity.'
            : 'Tap the star on a person’s card. Your list stays in this browser.'}
        </Empty>
      )}
      <details className="sj-details">
        <summary>More about the community</summary>
        <div className="sj-links">
          {['Bonds', 'Families', 'Customs'].map((t) => (
            <button type="button" key={t} onClick={() => onBrowse?.('folk', t)}>
              {t} →
            </button>
          ))}
        </div>
        <p>
          {Object.values(state.agents).filter((a) => !a.alive || a.departed !== undefined).length}{' '}
          people have died or left town.
        </p>
        <div className="sj-links">
          {Object.values(state.agents)
            .filter((a) => !a.alive || a.departed !== undefined)
            .map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => onSubject({ kind: 'agent', id: a.id, name: a.name })}
              >
                {a.name} · {a.departed ? 'Left town' : 'Remembered'} →
              </button>
            ))}
        </div>
      </details>
    </div>
  )
}
const journals = (b: unknown) => (Array.isArray(b) ? (b as JournalRow[]) : null)
const ledgers = (b: unknown) => (Array.isArray(b) ? (b as LedgerRow[]) : null)
export function GamePerson(props: PageProps) {
  const { store, subject, tab } = props
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const id = subject?.kind === 'agent' ? subject.id : null
  useOpened(id)
  const aims = useFeed(aimsFeed)
  const journalEndpoint = useEndpointFor(
    id !== null && tab === 'History' ? `/api/agent/${encodeURIComponent(id)}/journal` : null,
    journals,
  )
  const journal = useFeed(journalEndpoint)
  const a = id === null ? undefined : state?.agents[id]
  if (!a || !state)
    return (
      <Empty icon="folk" title="No person here">
        This person is not in the town at this moment.
      </Empty>
    )
  const skill = skillOf(a)
  const aim = mode.live ? aims.data?.aims.find((x) => x.agentId === a.id) : null
  const thought = mode.live ? store.latestThought(a.id) : null
  return (
    <div className="sj-person">
      <button className="sj-back" type="button" onClick={() => props.onBrowse?.('folk')}>
        ← Everyone in town
      </button>
      <header className="sj-character" data-tint={tintOf(a.id)}>
        <span className="sj-villager-art">
          <Portrait store={store} id={a.id} size={76} />
          <span className="sj-crest">
            <GameIcon kind={skill.icon} />
          </span>
        </span>
        <div>
          <h3>{a.name}</h3>
          <p>
            {Math.floor(a.ageDays / DAYS_PER_YEAR)} years ·{' '}
            {a.departed !== undefined ? 'Left town' : stateWord(a, state.tick)}
          </p>
          <span className="sj-skill">{skill.words}</span>
        </div>
        <FollowStar id={a.id} name={a.name} />
      </header>
      {tab === 'Relationships' ? (
        <Relationships {...props} />
      ) : tab === 'History' ? (
        <>
          <PersonEvents {...props} />
          <h3 className="sj-heading">
            <GameIcon kind="note" />
            In their own words
          </h3>
          <FeedState read={journal} retry={journalEndpoint.retry} />
          {journal.loaded && journal.data?.filter((r) => r.tick <= state.tick).length === 0 && (
            <Empty icon="note" title="A story still unwritten">
              Journal entries and dreams will appear when this person has recorded them.
            </Empty>
          )}
          {journal.data
            ?.filter((r) => r.tick <= state.tick)
            .map((r, i) => (
              <article className="sj-entry" key={`${r.tick}:${i}`}>
                <span className="sj-meta">
                  {momentStamp(r.tick)} · {r.kind === 'dream' ? 'Dream' : 'Journal'}
                </span>
                <p className="sj-prose">{r.text}</p>
              </article>
            ))}
          <details className="sj-details">
            <summary>Biography and personality changes</summary>
            {mode.live ? (
              <button
                className="sj-link"
                type="button"
                onClick={() => props.onBrowse?.('person', 'Story')}
              >
                Read the full written record →
              </button>
            ) : (
              <p>Personality documents describe the present. Return to live to read them.</p>
            )}
          </details>
        </>
      ) : (
        <>
          <section className="sj-activity">
            <GameIcon kind={a.asleep ? 'moon' : skill.icon} />
            <div>
              <span className="sj-meta">Right now · {momentStamp(state.tick)}</span>
              <h3>{stateWord(a, state.tick)}</h3>
              <p>{placeOf(state, a.id).words}</p>
            </div>
          </section>
          {conditionsOf(a).length > 0 && (
            <p className="sj-condition">
              {conditionsOf(a)
                .map((c) => CONDITION_WORD[c])
                .join(' · ')}
            </p>
          )}
          <div className="sj-vitals">
            <Need label="Food" icon="bowl" value={a.needs.hunger} />
            <Need label="Rest" icon="moon" value={a.needs.energy} />
          </div>
          <details className="sj-details">
            <summary>More wellbeing & skills</summary>
            <div className="sj-vitals">
              <Need label="Warmth" icon="lamp" value={a.needs.warmth} />
              <Need label="Company" icon="people" value={a.needs.social} />
              <Need label="Health" icon="leaf" value={a.hp} />
              <Need label="Water" icon="bowl" value={a.thirst ?? 100} />
            </div>
            <p className="sj-meta">Higher means the need is better met.</p>
            <h4>Practising</h4>
            {Object.entries(a.skills).length === 0 ? (
              <p>No skills practised yet.</p>
            ) : (
              <ul>
                {Object.entries(a.skills).map(([track, xp]) => (
                  <li key={track}>
                    {skillPhrase(track, xp)} · {Math.round(xp)} XP
                  </li>
                ))}
              </ul>
            )}
            <h4>Carrying</h4>
            <p>
              {Object.values(state.items)
                .filter((it) => it.loc.t === 'agent' && it.loc.id === a.id)
                .map((it) => `${kindWords(it.kind)} × ${it.qty}`)
                .join(', ') || 'Empty hands.'}
            </p>
          </details>
          <section className="sj-context">
            <h3>On their mind</h3>
            {mode.live && <FeedState read={aims} retry={aimsFeed.retry} />}
            {thought ? (
              <blockquote>{thought.text}</blockquote>
            ) : (
              <p>
                {mode.live
                  ? 'No thought recorded at this moment.'
                  : 'Live thoughts are hidden while viewing the past.'}
              </p>
            )}
            {aim?.mood && (
              <p>
                <span className="sj-meta">Mood</span>
                <br />
                {aim.mood}
              </p>
            )}
            {aim?.goal && (
              <p>
                <span className="sj-meta">Hoping to</span>
                <br />
                {aim.goal}
              </p>
            )}
            {aim?.worry && (
              <p>
                <span className="sj-meta">Worried about</span>
                <br />
                {aim.worry}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
function PersonEvents({ store, subject, onPlay }: PageProps) {
  const read = useFeed(chronicleFeed)
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const entries =
    read.data
      ?.filter((e) => e.tick <= (state?.tick ?? 0) && e.agentIds?.includes(subject?.id ?? ''))
      .slice(-20)
      .reverse() ?? []
  return (
    <section>
      <h3 className="sj-heading">
        <GameIcon kind="chronicle" />
        Their moments
      </h3>
      <FeedState read={read} retry={chronicleFeed.retry} />
      {entries.map((e) => (
        <button
          className="sj-event-button"
          key={`${e.type}:${e.seq}`}
          type="button"
          onClick={() => onPlay(pointPlay(e.tick, store.liveEdge(), e.label, e.agentIds ?? []))}
        >
          <span className="sj-meta">{momentStamp(e.tick)}</span>
          <strong>{e.label}</strong>
          <span className="sj-link">Watch this moment →</span>
        </button>
      ))}
      {read.loaded && !read.failed && !entries.length && <p>No moments recorded for them yet.</p>}
    </section>
  )
}
function Relationships({ store, subject, onSubject }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  const read = useFeed(bondsFeed)
  const endpoint = useEndpointFor(
    mode.live && subject !== null ? `/api/agent/${encodeURIComponent(subject.id)}/ledgers` : null,
    ledgers,
  )
  const ledger = useFeed(endpoint)
  const a = state?.agents[subject?.id ?? '']
  if (!a || !state) return null
  const mine = mode.live
    ? (read.data?.bonds.filter((b) => b.aId === a.id || b.bId === a.id) ?? [])
    : []
  const ids = new Set([
    ...(a.parents ?? []),
    ...Object.values(state.agents)
      .filter((p) => p.parents?.includes(a.id))
      .map((p) => p.id),
    ...(a.partnerId ? [a.partnerId] : []),
    ...mine.map((b) => (b.aId === a.id ? b.bId : b.aId)),
  ])
  return (
    <section>
      <h3 className="sj-heading">
        <GameIcon kind="people" />
        The people in their life
      </h3>
      {mode.live && <FeedState read={read} retry={bondsFeed.retry} />}
      {!mode.live && (
        <p className="sj-meta">
          Family at this moment. Personal ties are available in the live view.
        </p>
      )}
      {[...ids]
        .filter((id) => state.agents[id])
        .map((id) => {
          const b = mine.find((b) => b.aId === id || b.bId === id)
          const relation =
            a.partnerId === id
              ? 'Partner'
              : a.parents?.includes(id)
                ? 'Parent'
                : state.agents[id]?.parents?.includes(a.id)
                  ? 'Child'
                  : b
                    ? kindWords(b.kind)
                    : 'Known to them'
          return (
            <button
              type="button"
              className="sj-relationship"
              key={id}
              onClick={() => onSubject({ kind: 'agent', id, name: agentName(state.agents, id) })}
            >
              <Portrait store={store} id={id} size={44} />
              <span>
                <strong>{agentName(state.agents, id)}</strong>
                <span>
                  {relation}
                  {b ? ` · ${kindWords(bondLevel(bondWarmth(b, state.tick)))}` : ''}
                </span>
                {b && <small>Since day {tickToMoment(b.formedTick).day}</small>}
              </span>
              <GameIcon kind="people" />
            </button>
          )
        })}
      {ids.size === 0 && read.loaded && !read.failed && (
        <Empty icon="people" title="Ties take time">
          No family or personal ties have been recorded yet.
        </Empty>
      )}
      {mode.live && (
        <details className="sj-details">
          <summary>What they make of people</summary>
          <FeedState read={ledger} retry={endpoint.retry} />
          {ledger.data?.length === 0 && <p>No personal impressions written yet.</p>}
          {ledger.data?.map((l) => (
            <article key={l.personId}>
              <h4>{agentName(state.agents, l.personId)}</h4>
              <p className="sj-prose">{l.doc}</p>
            </article>
          ))}
        </details>
      )}
    </section>
  )
}
