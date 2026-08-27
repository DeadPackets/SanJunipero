import { useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { RosterExpanded } from './roster/RosterExpanded.js'
import { RosterRowView } from './roster/RosterRowView.js'
import { actsOf, becomingOf as buildBecoming, type Becoming } from './roster/expand.js'
import {
  ROSTER_SORTS,
  ROSTER_SORT_WORD,
  rosterRows2,
  sortRoster,
  type RosterSort,
} from './roster/rosterRow.js'
import { EMPTY_LINEAGE } from './bondModel2.js'
import { changeLog, type PersonalityRow } from './becoming.js'
import { bondsFeed, lineageFeed } from './feeds.js'
import { useFeed, usePolled } from './useEndpoint.js'
import { EMPTY_COPY } from './townStats.js'

const NO_CHANGES: PersonalityRow[] = []
const personalityRows = (body: unknown): PersonalityRow[] =>
  Array.isArray(body) ? (body as PersonalityRow[]) : []

/** The panel with the store taken out of it, so a test can render the markup without a fake
 *  store and without a DOM (the `StatusStripView` precedent). */
export function RosterPanelView({
  rows,
  gone,
  sort,
  openId,
  becomingOf,
  onSort,
  onToggle,
  onOpenFull,
}: {
  rows: ReturnType<typeof rosterRows2>
  gone: number
  sort: RosterSort
  openId: string | null
  /** absent in the cheapest tests; the list renders without an expansion */
  becomingOf?: (agentId: string) => Becoming
  onSort: (by: RosterSort) => void
  onToggle: (agentId: string) => void
  onOpenFull?: (agentId: string) => void
}) {
  return (
    <div className="roster-panel" aria-label="Townsfolk roster">
      <header className="roster-head">
        <h2 className="px-title">Townsfolk</h2>
        {rows.length > 1 && (
          <div className="roster-sorts" role="group" aria-label="Order the roster">
            {ROSTER_SORTS.map((by) => (
              <button
                key={by}
                type="button"
                className={by === sort ? 'roster-sort on' : 'roster-sort'}
                aria-pressed={by === sort}
                onClick={() => {
                  onSort(by)
                }}
              >
                {ROSTER_SORT_WORD[by]}
              </button>
            ))}
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="roster-empty">
          {EMPTY_COPY.roster}
          <em>{EMPTY_COPY.rosterSub}</em>
        </p>
      ) : (
        <ul className="roster-list">
          {rows.map((row) => (
            <li key={row.id}>
              <RosterRowView row={row} open={openId === row.id} onToggle={onToggle} />
              {openId === row.id && becomingOf !== undefined && (
                <RosterExpanded
                  becoming={becomingOf(row.id)}
                  onOpenFull={() => onOpenFull?.(row.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {gone > 0 && (
        <p className="roster-gone">
          {gone === 1 ? 'One rests in the town’s memory.' : `${gone} rest in the town’s memory.`}
        </p>
      )}
    </div>
  )
}

// The Townsfolk lens with nobody picked: a character roster — a face, a name, what they are
// doing, how they are, and where.
export function RosterPanel({
  store,
  openId,
  onToggle,
  onOpenFull,
}: {
  store: WorldStore
  openId: string | null
  onToggle: (agentId: string) => void
  onOpenFull: (agentId: string) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  useSyncExternalStore(store.subscribe, store.assetsSeq) // faces re-resolve on codex pushes
  const [sort, setSort] = useState<RosterSort>('name')
  // The ties are what turn "five strangers" into a town; they arrive on their own clock and
  // the roster is complete without them.
  const bonds = useFeed(bondsFeed).data
  const lineage = useFeed(lineageFeed).data ?? EMPTY_LINEAGE
  // Only the open row's document, and only while it is open — a roster does not fetch five.
  const changes =
    usePolled(
      openId === null ? null : `/api/agent/${encodeURIComponent(openId)}/personality`,
      personalityRows,
    ).data ?? NO_CHANGES

  // The veil covers the stage, not the aside: five slabs at the real row height say what is
  // coming and stop the panel jumping when it lands.
  if (state === null) {
    return (
      <div className="roster-panel" aria-busy="true">
        <h2 className="px-title">Townsfolk</h2>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton-row" />
        ))}
      </div>
    )
  }

  const rows = sortRoster(
    rosterRows2(
      state,
      store.assetRecords(),
      bonds,
      tick,
      store.recentEvents(),
      store.getConfig()?.movement.earshotRadius,
    ),
    sort,
  )
  const gone = Object.values(state.agents).filter((a) => !a.alive).length
  const people = Object.fromEntries(Object.values(state.agents).map((a) => [a.id, a.name]))
  const events = store.recentEvents()

  const becomingOf = (agentId: string): Becoming =>
    buildBecoming({
      id: agentId,
      name: people[agentId] ?? agentId,
      nowTick: tick,
      skills: state.agents[agentId]?.skills ?? {},
      acts: actsOf(agentId, bonds, events),
      bonds,
      lineage,
      people,
      changes: changeLog(changes),
    })

  return (
    <RosterPanelView
      rows={rows}
      gone={gone}
      sort={sort}
      openId={openId}
      becomingOf={becomingOf}
      onSort={setSort}
      onToggle={onToggle}
      onOpenFull={onOpenFull}
    />
  )
}
