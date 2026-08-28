import { RosterExpanded } from '../../ui/roster/RosterExpanded.js'
import { RosterRowView } from '../../ui/roster/RosterRowView.js'
import type { Becoming } from '../../ui/roster/expand.js'
import {
  ROSTER_SORTS,
  ROSTER_SORT_WORD,
  type RosterRow2,
  type RosterSort,
} from '../../ui/roster/rosterRow.js'
import { EMPTY_COPY } from '../../ui/townStats.js'

/** The list with the store taken out of it, so a test can render the markup without a fake
 *  store and without a DOM. */
export function RosterListView({
  rows,
  gone,
  sort,
  openId,
  becomingOf,
  onSort,
  onToggle,
  onOpenFull,
}: {
  rows: readonly RosterRow2[]
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
    <div className="roster" aria-label="Townsfolk">
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

      {rows.length === 0 ? (
        <p className="feed-empty">
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
