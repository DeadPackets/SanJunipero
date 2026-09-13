import { useMemo, useState, useSyncExternalStore } from 'react'
import { LawsResponseSchema, agentName, tickToMoment, type LawRow as TownLaw } from '@sj/shared'
import { editRows, formatLawValue, lawRows, postLaw, type EditRow } from '../../ui/lawsModel.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { OutOfReach } from '../../ui/OutOfReach.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { ClockSection, ExportLink, RulingsSection, SpendSection } from './AdminOps.js'
import { Skeleton } from './Skeleton.js'
import type { PageProps } from './types.js'

export function LawsPage(props: PageProps) {
  return props.tab === 'Admin' ? <Admin {...props} /> : <World {...props} />
}

const NO_LAWS: TownLaw[] = []
const townLaws = (body: unknown): TownLaw[] | null => {
  const parsed = LawsResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.laws : null
}

/** A council closes when a room stops arguing, which is not on a clock — but the sheet is only
 *  open while somebody is reading it, and nothing here is worth a faster poll than the bonds. */
const LAWS_REFETCH_MS = 30_000

const EMPTY =
  'Nothing is agreed yet — a law starts as a sentence somebody says out loud, and stands if the room does not argue it down.'

/** Names, never ids: the votes come off the wire as ids and every one of them is looked up. */
const voices = (ids: readonly string[], people: NameLookup): string =>
  ids.length === 0 ? 'nobody' : ids.map((id) => agentName(people, id)).join(', ')

type NameLookup = Parameters<typeof agentName>[0]

/** A count nobody can misread as a rank. "Never" is the answer worth printing loudest. */
const timesBroken = (n: number): string =>
  n === 0 ? 'never' : n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`

/** The two exceptions a reader has to be told about. A rule that stands and bites wears no
 *  badge: that is what agreeing on something is supposed to mean. */
function markOf(law: TownLaw): string | null {
  if (law.repealedTick !== null) return 'let go'
  return law.enforced ? null : 'in words only'
}

/** Read-only, like every other pane: nothing on this page is ever shown to a mind. Newest first
 *  is the order the endpoint sends — one sorter, in the gateway, so the two cannot drift. */
export function WorldLawsView({ laws, people }: { laws: readonly TownLaw[]; people: NameLookup }) {
  return (
    <section className="laws" aria-label="What the town has agreed">
      <p className="sheet-note">
        What they have agreed among themselves, newest first. Nobody wrote these but them.
      </p>
      <ul className="laws-list">
        {laws.map((law) => {
          const agreed = tickToMoment(law.ratifiedTick)
          const mark = markOf(law)
          const letGo = law.repealedTick === null ? null : tickToMoment(law.repealedTick)
          return (
            <li className="law-row" key={law.id}>
              <h4 className="law-title">“{law.text}”</h4>
              {mark !== null && <span className="badge">{mark}</span>}
              {law.why !== '' && <p className="law-says">In practice: {law.why}</p>}
              <dl className="law-value">
                <div className="law-cell">
                  <dt>Put by</dt>
                  <dd>{law.proposerName}</dd>
                </div>
                <div className="law-cell">
                  <dt>Agreed</dt>
                  <dd>
                    Day {agreed.day}, {agreed.time}
                  </dd>
                </div>
                <div className="law-cell">
                  <dt>For</dt>
                  <dd>{voices(law.votes.for, people)}</dd>
                </div>
                <div className="law-cell">
                  <dt>Against</dt>
                  <dd>{voices(law.votes.against, people)}</dd>
                </div>
                <div className="law-cell">
                  <dt>Broken</dt>
                  <dd>{timesBroken(law.breaches)}</dd>
                </div>
              </dl>
              {letGo !== null && (
                <ol className="law-history">
                  <li>
                    Let go on day {letGo.day}, at {letGo.time}
                  </li>
                </ol>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Subscribing to the tick instead rebuilds every row of the whole config once a tick. */
function useLawsSeq(store: PageProps['store']): string {
  const seq = (): string =>
    `${store.getConfig() === null ? 'wait' : 'have'}:${store.lawHistory().length}`
  return useSyncExternalStore(store.subscribe, seq, seq)
}

function World({ store }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const record = useEndpointFor('/api/laws', townLaws, LAWS_REFETCH_MS)
  const read = useFeed(record)
  const laws = read.data ?? NO_LAWS

  if (laws.length === 0) {
    if (read.failed) return <OutOfReach onRetry={record.retry} />
    return read.loaded ? <p className="feed-empty">{EMPTY}</p> : <Skeleton />
  }
  return <WorldLawsView laws={laws} people={state?.agents} />
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
      {/* The path IS the label now, and it keeps the data face: Silkscreen has no lowercase. */}
      <label htmlFor={id}>
        <code className="law-path">{row.path}</code>
      </label>
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
function Admin({ store, operatorToken, onNotice }: PageProps) {
  const seq = useLawsSeq(store)
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
    onNotice(null)
    const r = await postLaw(fetch, {
      token: operatorToken!,
      path: row.path,
      value: nextValue(row, raw),
    })
    setPending(null)
    // Never write the new value here: the page moves when the delta lands.
    onNotice({
      words: r.ok ? `${row.path} — asked; it lands at the next tick.` : r.message,
      ok: r.ok,
    })
  }

  // The three sections above report failures only; an empty string is their "it went through".
  const refused = (words: string): void => {
    onNotice(words === '' ? null : { words, ok: false })
  }

  return (
    <section className="laws-admin" aria-label="World law controls">
      <p className="sheet-note operator">
        The operator’s page — the one write path in the whole product. A mind never sees it.
      </p>
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
