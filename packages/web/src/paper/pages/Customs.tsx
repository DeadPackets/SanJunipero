import { useSyncExternalStore } from 'react'
import {
  ConstructsResponseSchema,
  UNNAMED_CONSTRUCT_COPY,
  type ConstructKind,
  type ConstructRecord,
} from '@sj/shared'
import { usePolled } from '../../ui/useEndpoint.js'
import type { PageProps } from './index.js'

const NO_CUSTOMS: ConstructRecord[] = []
const customs = (body: unknown): ConstructRecord[] | null => {
  const parsed = ConstructsResponseSchema.safeParse(body)
  return parsed.success ? parsed.data : null
}

/** The recognizer runs once a sim-day, which is once a real hour. */
const CUSTOMS_REFETCH_MS = 60_000

/** What each kind is, in the observer's voice. Never the id, which is ours. */
const KIND_LINE: Readonly<Record<ConstructKind, string>> = {
  festival: 'Something they celebrate.',
  faith: 'Something they hold sacred.',
  council: 'Somewhere they settle things.',
  market: 'Somewhere things change hands.',
  custom: 'Something they keep doing.',
}

const EMPTY = 'Nobody keeps anything yet — a custom is a place they keep coming back to.'

/** What the town does over and over, and what it calls it. Read-only, like every other pane:
 *  nothing on this page is ever shown to a mind. */
export function CustomsPage({ store }: Pick<PageProps, 'store'>) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const read = usePolled('/api/constructs', customs, CUSTOMS_REFETCH_MS)
  const rows = read.data ?? NO_CUSTOMS
  const nameOf = (id: string): string => state?.agents[id]?.name ?? id

  if (rows.length === 0)
    return read.loaded ? (
      <p className="feed-empty">{EMPTY}</p>
    ) : (
      <div aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-row" />
        ))}
      </div>
    )
  return (
    <ul className="families">
      {rows.map((c) => (
        <li key={c.id} className="family">
          <h3 className="feed-head">{c.name ?? UNNAMED_CONSTRUCT_COPY}</h3>
          <ul className="family-children">
            <li>
              <span className="stamp">Day {c.firstDay}</span>
              {KIND_LINE[c.type]}
            </li>
            <li>
              <span className="stamp">×{c.gatherings}</span>
              {c.members.map(nameOf).join(', ')}
            </li>
            {c.quote !== null && (
              <li>
                “{c.quote}” — {nameOf(c.saidBy ?? '')}
              </li>
            )}
          </ul>
        </li>
      ))}
    </ul>
  )
}
