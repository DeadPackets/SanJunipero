import { useSyncExternalStore } from 'react'
import { tickToMoment } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { LAW_GROUPS, lawCopyFor, lawGroupOf, lawReadingRank } from '../ui/lawCopy.js'
import { lawRows, type LawRow } from './lawsModel.js'

/**
 * The World Laws submenu: every law of this town, what it means, what it is set to now, and
 * every time it changed. Read-only for everyone — the panel has no write path.
 *
 * U17: a viewer should learn what governs this world without reading a config key. The human
 * title leads; the machine path is a small subtitle for the operator who needs it.
 */
export function WorldLawsView({ rows }: { rows: readonly LawRow[] }) {
  const byGroup = LAW_GROUPS.map((group) => ({
    group,
    rows: rows.filter((r) => lawGroupOf(r.path) === group)
      .sort((a, b) => lawReadingRank(a.path) - lawReadingRank(b.path)),
  })).filter((g) => g.rows.length > 0)

  return (
    <div className="laws-panel" aria-label="World Laws">
      <h2 className="px-title">World Laws</h2>
      <p className="laws-lede">The rules this town runs on. When one changes, the change is written down here.</p>
      {byGroup.map(({ group, rows: inGroup }) => (
        <section className="law-group" key={group}>
          <h3 className="law-group-name">{group}</h3>
          <ul className="laws-list">
            {inGroup.map((row) => {
              const copy = lawCopyFor(row.path)
              return (
                <li key={row.path} className={row.overridden ? 'law-row changed' : 'law-row'}>
                  <h4 className="law-title">{copy?.title ?? row.path}</h4>
                  {copy !== null && <p className="law-says">{copy.sentence}</p>}
                  <dl className="law-value">
                    {(copy?.render(row.value) ?? [{ label: 'Set to', value: '—' }]).map((cell) => (
                      <div className="law-cell" key={cell.label}>
                        <dt>{cell.label}</dt>
                        <dd>{cell.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <code className="law-path">{row.path}</code>
                  {row.overridden && <span className="badge">changed</span>}
                  {row.history.length > 0 && (
                    <ol className="law-history">
                      {row.history.map((h, i) => {
                        const m = tickToMoment(h.tick)
                        return <li key={`${h.tick}-${i}`}>Changed on day {m.day}, at {m.time}</li>
                      })}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function WorldLaws({ store }: { store: WorldStore }) {
  useSyncExternalStore(store.subscribe, store.getTick)
  return <WorldLawsView rows={lawRows(store.getConfig(), store.getLaws(), store.lawHistory())} />
}
