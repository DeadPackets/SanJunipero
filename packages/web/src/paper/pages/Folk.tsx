import { Suspense, lazy, useMemo, useState, useSyncExternalStore } from 'react'
import { agentName, personWords, tickToMoment } from '@sj/shared'
import { actsOf, becomingOf as buildBecoming, type Becoming } from '../../ui/roster/expand.js'
import { rosterRows2, sortRoster, type RosterSort } from '../../ui/roster/rosterRow.js'
import { EMPTY_LINEAGE } from '../../ui/bondModel2.js'
import { changeLog, personalityRows, type PersonalityRow } from '../../ui/becoming.js'
import { bondsFeed, lineageFeed } from '../../ui/feeds.js'
import { useFeed, usePolled } from '../../ui/useEndpoint.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { households } from '../families.js'
import { CustomsPage } from './Customs.js'
import { RosterListView } from './RosterList.js'
import { Skeleton } from './Skeleton.js'
import type { PageProps } from './types.js'

const NO_CHANGES: PersonalityRow[] = []

// react-force-graph-2d is ~180 KB the roster and the chronicle never reach.
const BondsGraph = lazy(() => import('./BondsGraph.js').then((m) => ({ default: m.BondsGraph })))

export function FolkPage({ tab, store, onSubject }: PageProps) {
  if (tab === 'Bonds')
    return (
      <Suspense fallback={<p className="feed-empty">Reading the town’s ties…</p>}>
        <BondsGraph store={store} onSubject={onSubject} />
      </Suspense>
    )
  if (tab === 'Families') return <Families store={store} />
  if (tab === 'Customs') return <CustomsPage store={store} />
  return <People store={store} onSubject={onSubject} />
}

function People({ store, onSubject }: Pick<PageProps, 'store' | 'onSubject'>) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  useSyncExternalStore(store.subscribe, store.assetsSeq, store.assetsSeq) // faces re-resolve on codex pushes
  const [sort, setSort] = useState<RosterSort>('name')
  const [openId, setOpenId] = useState<string | null>(null)
  const bonds = useFeed(bondsFeed).data
  const lineage = useFeed(lineageFeed).data ?? EMPTY_LINEAGE
  // Only the open row's document, and only while it is open — a roster does not fetch five.
  const changes =
    usePolled(
      openId === null ? null : `/api/agent/${encodeURIComponent(openId)}/personality`,
      personalityRows,
    ).data ?? NO_CHANGES

  const records = store.assetRecords()
  const events = store.recentEvents()
  const earshot = store.getConfig()?.movement.earshotRadius
  // `rosterRows2` hands them back by name; a second pass only earns its keep off that order.
  // The whole fold is one array allocation per person, so opening a row must not redo it.
  const byName = useMemo(
    () => (state === null ? [] : rosterRows2(state, records, bonds, tick, events, earshot)),
    [state, records, bonds, tick, events, earshot],
  )

  if (state === null) return <Skeleton rows={5} />

  const rows = sort === 'name' ? byName : sortRoster(byName, sort)
  const people = Object.fromEntries(Object.values(state.agents).map((a) => [a.id, a.name]))

  const becomingOf = (agentId: string): Becoming =>
    buildBecoming({
      id: agentId,
      name: personWords(people[agentId]),
      nowTick: tick,
      skills: state.agents[agentId]?.skills ?? {},
      acts: actsOf(agentId, bonds, events),
      bonds,
      lineage,
      people,
      changes: changeLog(changes),
    })

  return (
    <RosterListView
      rows={rows}
      // Somebody who walked down the valley road is not resting in anybody's memory; the
      // `departed` marker lands with the fold's own arrivals work.
      gone={
        Object.values(state.agents).filter(
          (a) => !a.alive && (a as { departed?: unknown }).departed === undefined,
        ).length
      }
      sort={sort}
      openId={openId}
      becomingOf={becomingOf}
      onSort={setSort}
      onToggle={(id) => {
        setOpenId((prev) => (prev === id ? null : id))
      }}
      onOpenFull={(id) => {
        onSubject({ id, kind: 'agent', name: personWords(people[id]) })
      }}
    />
  )
}

function Families({ store }: Pick<PageProps, 'store'>) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const lineage = useFeed(lineageFeed).data ?? EMPTY_LINEAGE
  const homes = households(lineage)

  if (homes.length === 0) return <p className="feed-empty">{EMPTY_COPY.families}</p>
  return (
    <ul className="families">
      {homes.map((h) => (
        <li key={h.key} className="family">
          <h3 className="feed-head">
            {h.parents.map((id) => agentName(state?.agents, id)).join(' and ')}
          </h3>
          <ul className="family-children">
            {h.children.map((c) => (
              <li key={c.id}>
                <span className="stamp">Day {tickToMoment(c.tick).day}</span>{' '}
                {agentName(state?.agents, c.id)}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
