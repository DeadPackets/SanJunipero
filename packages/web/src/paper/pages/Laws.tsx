import { useMemo, useState, useSyncExternalStore } from 'react'
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
import { EMPTY_COPY } from '../../ui/townStats.js'
import {
  ADMIN_ENDPOINT,
  ClockSection,
  ExportLink,
  RulingsSection,
  SpendSection,
} from './AdminOps.js'
import type { PageProps } from './types.js'

export function LawsPage(props: PageProps) {
  return props.tab === 'Admin' ? <Admin {...props} /> : <World {...props} />
}

/** Every law of this town and every time it changed. Read-only: there is no write path. */
function WorldLawsView({ rows, operator }: { rows: readonly LawRow[]; operator: boolean }) {
  const byGroup = LAW_GROUPS.map((group) => ({
    group,
    rows: rows
      .filter((r) => lawGroupOf(r.path) === group)
      .sort((a, b) => lawReadingRank(a.path) - lawReadingRank(b.path)),
  })).filter((g) => g.rows.length > 0)

  return (
    <section className="laws" aria-label="World Laws">
      <p className="sheet-note">
        The rules this town runs on. When one changes, the change is written down here.
      </p>
      {byGroup.map(({ group, rows: inGroup }) => (
        <section className="law-group" key={group}>
          <h3 className="feed-head">{group}</h3>
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
                  {operator && <code className="law-path">{row.path}</code>}
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
    </section>
  )
}

/** A law moves when a law moves, not when the clock does. Subscribing to the tick rebuilt
 *  every row of every group of the whole config once a tick, with the sheet open. */
function useLawsSeq(store: PageProps['store']): string {
  const seq = (): string =>
    `${store.getConfig() === null ? 'wait' : 'have'}:${store.lawHistory().length}`
  return useSyncExternalStore(store.subscribe, seq, seq)
}

function World({ store, operatorToken }: PageProps) {
  useLawsSeq(store)

  return (
    <WorldLawsView
      rows={lawRows(store.getConfig(), store.getLaws(), store.lawHistory())}
      operator={operatorToken !== null}
    />
  )
}

function nextValue(row: EditRow, raw: string): unknown {
  return row.kind === 'boolean' ? raw === 'on' : Number(raw)
}

/** One law, with the operator's draft of it. The draft lives here rather than on the page so a
 *  keystroke re-renders this row and not the other forty-one. */
function LawEdit({
  row,
  pending,
  onSubmit,
}: {
  row: EditRow
  pending: boolean
  onSubmit: (row: EditRow, raw: string) => void
}) {
  const settled = formatLawValue(row.value)
  const [draft, setDraft] = useState<string | null>(null)
  const raw = draft ?? settled
  const id = `law-${row.path}`
  const stuck = !row.editable || pending

  return (
    <li className="law-edit">
      <label htmlFor={id}>{lawCopyFor(row.path)?.title ?? row.path}</label>
      <code className="law-path">{row.path}</code>
      <span className="law-value">{settled}</span>
      {row.kind === 'boolean' ? (
        <select
          id={id}
          value={raw}
          disabled={stuck}
          onChange={(e) => {
            setDraft(e.target.value)
          }}
        >
          <option value="on">on</option>
          <option value="off">off</option>
        </select>
      ) : (
        <input
          id={id}
          type="number"
          step="any"
          value={raw}
          disabled={stuck}
          onChange={(e) => {
            setDraft(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(row, raw)
          }}
        />
      )}
      <button
        type="button"
        className="rx-full"
        disabled={stuck || raw === settled}
        onClick={() => {
          onSubmit(row, raw)
        }}
      >
        Set
      </button>
      {!row.editable && row.kind === 'other' && (
        <span className="badge">set it from the channel</span>
      )}
    </li>
  )
}

// Operator-only. Says so out loud, and offers nothing at all without a token, so a viewer who
// wanders onto the tab sees no control surface to guess at.
function Admin({ store, operatorToken }: PageProps) {
  const seq = useLawsSeq(store)
  const [notice, setNotice] = useState<{ words: string; ok: boolean } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const rows = useMemo(
    () =>
      operatorToken === null
        ? []
        : editRows(lawRows(store.getConfig(), store.getLaws(), store.lawHistory()), operatorToken),
    // `seq` is the dependency: the rows move when a law does, not when the clock does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, operatorToken, seq],
  )

  if (operatorToken === null) return <p className="feed-empty">{EMPTY_COPY.admin}</p>

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
    setNotice({
      words: r.ok ? `${row.path} — asked; it lands at the next tick.` : r.message,
      ok: r.ok,
    })
  }

  // The three sections above report failures only; an empty string is their "it went through".
  const refused = (words: string): void => {
    setNotice(words === '' ? null : { words, ok: false })
  }

  return (
    <section className="laws-admin" aria-label="World law controls">
      <p className="sheet-note operator">
        The operator’s page — the one write path in the whole product. A mind never sees it.
      </p>
      {notice !== null && (
        <p className="laws-notice" role={notice.ok ? undefined : 'alert'}>
          {notice.words}
        </p>
      )}
      <ClockSection token={operatorToken} onNotice={refused} />
      <SpendSection token={operatorToken} />
      <RulingsSection token={operatorToken} onNotice={refused} />
      <ExportLink token={operatorToken} onNotice={refused} />

      <h3 className="feed-head">Laws</h3>
      <ul className="laws-edit-list">
        {rows.map((row) => (
          <LawEdit
            key={row.path}
            row={row}
            pending={pending === row.path}
            onSubmit={(r, raw) => void submit(r, raw)}
          />
        ))}
      </ul>
    </section>
  )
}
