import { useEffect, useState, useSyncExternalStore } from 'react'
import { BondsResponseSchema, type BondsResponse } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { RosterRowView } from './roster/RosterRowView.js'
import {
  ROSTER_SORTS, ROSTER_SORT_WORD, rosterRows2, sortRoster, type RosterSort,
} from './roster/rosterRow.js'
import { EMPTY_COPY } from './townStats.js'

export const BUST_PX = 48
export const BONDS_REFETCH_MS = 30_000

/** The panel with the store taken out of it, so a test can render the markup without a fake
 *  store and without a DOM (the `StatusStripView` precedent). */
export function RosterPanelView(
  { rows, gone, sort, openId, onSort, onToggle }: {
    rows: ReturnType<typeof rosterRows2>
    gone: number
    sort: RosterSort
    openId: string | null
    onSort: (by: RosterSort) => void
    onToggle: (agentId: string) => void
  },
) {
  return (
    <div className="roster-panel" aria-label="Townsfolk roster">
      <header className="roster-head">
        <h2>Townsfolk</h2>
        {rows.length > 1 && (
          <div className="roster-sorts" role="group" aria-label="Order the roster">
            {ROSTER_SORTS.map((by) => (
              <button
                key={by}
                type="button"
                className={by === sort ? 'roster-sort on' : 'roster-sort'}
                aria-pressed={by === sort}
                onClick={() => onSort(by)}
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
export function RosterPanel(
  { store, openId, onToggle }: {
    store: WorldStore
    openId: string | null
    onToggle: (agentId: string) => void
  },
) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const tick = useSyncExternalStore(store.subscribe, store.getTick)
  useSyncExternalStore(store.subscribe, store.assetsSeq) // faces re-resolve on codex pushes
  const [sort, setSort] = useState<RosterSort>('name')
  const [bonds, setBonds] = useState<BondsResponse | null>(null)

  // The ties are what turn "five strangers" into a town; they arrive on their own clock and
  // the roster is complete without them.
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void fetch('/api/bonds')
        .then(async (r) => (r.ok ? BondsResponseSchema.safeParse(await r.json()) : null))
        .then((p) => { if (alive && p?.success === true) setBonds(p.data) })
        .catch(() => { /* the town keeps its ties whether or not we can read them */ })
    }
    load()
    const timer = setInterval(load, BONDS_REFETCH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  if (state === null) return null // boot is the veil's moment, not the roster's

  const rows = sortRoster(
    rosterRows2(state, store.assetRecords(), bonds, tick, store.recentEvents()),
    sort,
  )
  const gone = Object.values(state.agents).filter((a) => !a.alive).length

  return (
    <RosterPanelView
      rows={rows}
      gone={gone}
      sort={sort}
      openId={openId}
      onSort={setSort}
      onToggle={onToggle}
    />
  )
}
