import { useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { editRows, formatLawValue, lawRows, postLaw, type EditRow } from './lawsModel.js'

export type LawsDashboardProps = {
  store: WorldStore
  token: string | null
  // The admin channel is a separate localhost server, not the viewer's origin.
  endpoint?: string
  fetchFn?: typeof fetch
}

export const DEFAULT_ADMIN_ENDPOINT = 'http://127.0.0.1:8788'

function nextValue(row: EditRow, raw: string): unknown {
  return row.kind === 'boolean' ? raw === 'on' : Number(raw)
}

// Operator-only. Renders nothing at all without a token, so a viewer who wanders
// onto the route sees no control surface to guess at.
export function LawsDashboard({
  store,
  token,
  endpoint = DEFAULT_ADMIN_ENDPOINT,
  fetchFn,
}: LawsDashboardProps) {
  useSyncExternalStore(store.subscribe, store.getTick)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  if (token === null) return null

  const rows = editRows(lawRows(store.getConfig(), store.getLaws(), store.lawHistory()), token)

  async function submit(row: EditRow, raw: string): Promise<void> {
    setPending(row.path)
    setNotice(null)
    const r = await postLaw(fetchFn ?? fetch, {
      endpoint,
      token: token!,
      path: row.path,
      value: nextValue(row, raw),
    })
    setPending(null)
    // Never write the new value here: the panel moves when the delta lands.
    setNotice(r.ok ? `${row.path} — asked; it lands at the next tick.` : r.message)
  }

  return (
    <div className="laws-dashboard" aria-label="World law controls">
      <h2 className="px-title">World law controls</h2>
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
