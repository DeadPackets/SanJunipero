import { useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { bustStyle, rosterRows, type BustStyle, type RosterRow } from './rosterModel.js'
import { CONDITION_WORD } from './status.js'
import { EMPTY_COPY } from './townStats.js'

export const BUST_PX = 48

/** The panel with the store taken out of it, so a test can render the markup without a fake
 *  store and without a DOM (the `StatusStripView` precedent). */
export function RosterPanelView(
  { rows, gone, bustOf, onPick }: {
    rows: RosterRow[]
    gone: number
    bustOf: (agentId: string) => BustStyle | null
    onPick: (agentId: string) => void
  },
) {
  return (
    <div className="roster-panel" aria-label="Townsfolk roster">
      <h2>Townsfolk</h2>
      {rows.length === 0 ? (
        <p className="roster-empty">
          {EMPTY_COPY.roster}
          <em>{EMPTY_COPY.rosterSub}</em>
        </p>
      ) : (
        <ul className="roster-grid">
          {rows.map((row) => {
            const bust = bustOf(row.id)
            const said = [row.state, ...row.conditions.map((c) => CONDITION_WORD[c])].join(', ')
            return (
              <li key={row.id}>
                <button
                  className="roster-card"
                  onClick={() => onPick(row.id)}
                  aria-label={`${row.name} — ${row.band}, ${said}. Open inspector`}
                >
                  {bust !== null ? (
                    <span className="roster-bust" style={bust} aria-hidden="true" />
                  ) : (
                    <span className="roster-bust roster-token" aria-hidden="true">
                      {row.name.slice(0, 1)}
                    </span>
                  )}
                  <span className="roster-name">{row.name}</span>
                  <span className="badges">
                    <span className="badge">{row.band}</span>
                    <span className="badge doing">{row.state}</span>
                    {row.conditions.map((c) => (
                      <span key={c} className={c === 'unwell' ? 'badge ill' : 'badge'}>
                        {CONDITION_WORD[c]}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            )
          })}
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

// The Townsfolk lens with nobody picked: the town's roster page — one slab card
// per living townsfolk; click or Enter opens their inspector.
export function RosterPanel({ store, onPick }: { store: WorldStore; onPick: (agentId: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  useSyncExternalStore(store.subscribe, store.assetsSeq) // busts re-resolve on codex pushes
  const records = store.assetRecords()
  const { alive, gone } = rosterRows(state, state?.tick)

  if (state === null) return null // boot is the veil's moment, not the roster's

  return (
    <RosterPanelView
      rows={alive}
      gone={gone}
      bustOf={(id) => bustStyle(records, id, BUST_PX)}
      onPick={onPick}
    />
  )
}
