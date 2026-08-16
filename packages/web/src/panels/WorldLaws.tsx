import { useSyncExternalStore } from 'react'
import { tickToMoment } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { formatLawValue, lawRows } from './lawsModel.js'

// The World Laws submenu: every law of this town, what it is set to now, and
// every time it changed. Read-only for everyone — the panel has no write path.
export function WorldLaws({ store }: { store: WorldStore }) {
  useSyncExternalStore(store.subscribe, store.getTick)
  const rows = lawRows(store.getConfig(), store.getLaws(), store.lawHistory())

  return (
    <div className="laws-panel" aria-label="World Laws">
      <h2>World Laws</h2>
      <p className="laws-lede">The rules this town runs on. When one changes, the change is written down here.</p>
      <ul className="laws-list">
        {rows.map((row) => (
          <li key={row.path} className={row.overridden ? 'law-row changed' : 'law-row'}>
            <span className="law-path">{row.path}</span>
            <span className="law-value">{formatLawValue(row.value)}</span>
            {row.overridden && <span className="badge">changed</span>}
            {row.history.length > 0 && (
              <ol className="law-history">
                {row.history.map((h, i) => {
                  const m = tickToMoment(h.tick)
                  return (
                    <li key={`${h.tick}-${i}`}>
                      Day {m.day} {m.time} — {formatLawValue(h.value)}
                    </li>
                  )
                })}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
