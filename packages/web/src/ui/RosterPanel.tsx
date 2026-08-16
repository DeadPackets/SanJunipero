import { useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { bustStyle, rosterRows } from './rosterModel.js'

export const BUST_PX = 48

// The Townsfolk lens with nobody picked: the town's roster page — one slab card
// per living townsfolk; click or Enter opens their inspector.
export function RosterPanel({ store, onPick }: { store: WorldStore; onPick: (agentId: string) => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  useSyncExternalStore(store.subscribe, store.assetsSeq) // busts re-resolve on codex pushes
  const records = store.assetRecords()
  const { alive, gone } = rosterRows(state)

  if (state === null) return null // boot is the veil's moment, not the roster's

  return (
    <div className="roster-panel" aria-label="Townsfolk roster">
      <h2>Townsfolk</h2>
      {alive.length === 0 ? (
        <p className="roster-empty">No one walks the town yet — the first footsteps are still to come.</p>
      ) : (
        <ul className="roster-grid">
          {alive.map((row) => {
            const bust = bustStyle(records, row.id, BUST_PX)
            return (
              <li key={row.id}>
                <button
                  className="roster-card"
                  onClick={() => onPick(row.id)}
                  aria-label={`${row.name} — ${row.band}${row.asleep ? ', asleep' : ''}, ${row.doing}. Open inspector`}
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
                    {row.asleep && <span className="badge">asleep</span>}
                    <span className="badge doing">{row.doing}</span>
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
