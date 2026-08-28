import { useState, useSyncExternalStore } from 'react'
import { tickToMoment } from '@sj/shared'
import { LAW_GROUPS, lawCopyFor, lawGroupOf, lawReadingRank } from '../../ui/lawCopy.js'
import {
  editRows,
  formatLawValue,
  lawRows,
  postLaw,
  type EditRow,
  type LawRow,
} from '../../ui/lawsModel.js'
import type { PageProps } from './index.js'

// The admin channel is a separate localhost server, not the viewer's origin.
const ADMIN_ENDPOINT = 'http://127.0.0.1:8788'

export function LawsPage(props: PageProps) {
  return props.tab === 'Admin' ? <Admin {...props} /> : <World {...props} />
}

/** Every law of this town and every time it changed. Read-only: there is no write path. */
export function WorldLawsView({ rows }: { rows: readonly LawRow[] }) {
  const byGroup = LAW_GROUPS.map((group) => ({
    group,
    rows: rows
      .filter((r) => lawGroupOf(r.path) === group)
      .sort((a, b) => lawReadingRank(a.path) - lawReadingRank(b.path)),
  })).filter((g) => g.rows.length > 0)

  return (
    <div className="laws" aria-label="World Laws">
      <p className="sheet-note">
        The rules this town runs on. When one changes, the change is written down here.
      </p>
      {byGroup.map(({ group, rows: inGroup }) => (
        <section className="law-group" key={group}>
          <h3 className="sheet-h">{group}</h3>
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
                        return (
                          <li key={`${h.tick}-${i}`}>
                            Changed on day {m.day}, at {m.time}
                          </li>
                        )
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

function World({ store }: PageProps) {
  useSyncExternalStore(store.subscribe, store.getTick)
  return <WorldLawsView rows={lawRows(store.getConfig(), store.getLaws(), store.lawHistory())} />
}

function nextValue(row: EditRow, raw: string): unknown {
  return row.kind === 'boolean' ? raw === 'on' : Number(raw)
}

// Operator-only. Says so out loud, and offers nothing at all without a token, so a viewer who
// wanders onto the tab sees no control surface to guess at.
function Admin({ store, operatorToken }: PageProps) {
  useSyncExternalStore(store.subscribe, store.getTick)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  if (operatorToken === null)
    return (
      <p className="sheet-empty">
        The operator’s page. Nothing here is shown to a mind, and nothing here can be changed
        without the channel’s token.
      </p>
    )

  const rows = editRows(
    lawRows(store.getConfig(), store.getLaws(), store.lawHistory()),
    operatorToken,
  )

  async function submit(row: EditRow, raw: string): Promise<void> {
    setPending(row.path)
    setNotice(null)
    const r = await postLaw(fetch, {
      endpoint: ADMIN_ENDPOINT,
      token: operatorToken!,
      path: row.path,
      value: nextValue(row, raw),
    })
    setPending(null)
    // Never write the new value here: the page moves when the delta lands.
    setNotice(r.ok ? `${row.path} — asked; it lands at the next tick.` : r.message)
  }

  return (
    <div className="laws-admin" aria-label="World law controls">
      <p className="sheet-note operator">
        The operator’s page — the one write path in the whole product. A mind never sees it.
      </p>
      {notice !== null && (
        <p className="laws-notice" role="status">
          {notice}
        </p>
      )}
      <ul className="laws-edit-list">
        {rows.map((row) => (
          <li key={row.path} className="law-edit">
            <label htmlFor={`law-${row.path}`}>{row.path}</label>
            <span className="law-value">{formatLawValue(row.value)}</span>
            {row.kind === 'boolean' ? (
              <select
                id={`law-${row.path}`}
                value={row.value === true ? 'on' : 'off'}
                disabled={!row.editable || pending === row.path}
                onChange={(e) => void submit(row, e.target.value)}
              >
                <option value="on">on</option>
                <option value="off">off</option>
              </select>
            ) : (
              <input
                id={`law-${row.path}`}
                type="number"
                step="any"
                defaultValue={typeof row.value === 'number' ? row.value : ''}
                disabled={!row.editable || pending === row.path}
                onBlur={(e) => void submit(row, e.target.value)}
              />
            )}
            {!row.editable && row.kind === 'other' && (
              <span className="badge">set it from the channel</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
