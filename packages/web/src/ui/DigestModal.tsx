import { useEffect, useMemo, useRef } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { usePolled } from './useEndpoint.js'

export type Digest = {
  days: number[]
  deaths: unknown[]
  births: unknown[]
  structuresCompleted: unknown[]
  topMoments: {
    tick: number
    agentId: string
    score: number
    moment: { day: number; time: string }
  }[]
  agentLines: { agentId: string; line: string }[]
}

type Chapter = { tick: number; title: string }

const NO_CHAPTERS: Chapter[] = []

export function DigestModal({
  store,
  missedTicks,
  onMoment,
  onClose,
}: {
  store: WorldStore
  missedTicks: number
  onMoment: (tick: number) => void
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Pinned to the window the modal opened over: a later render must not re-ask for a wider one.
  const digestUrl = useMemo(() => {
    const to = store.getTick()
    return `/api/digest?fromTick=${Math.max(0, to - missedTicks)}&toTick=${to}`
  }, [store, missedTicks])
  // The modal says what it can: a missing digest, or missing chapters, is not worth an error.
  const digest = usePolled<Digest>(digestUrl).data
  const chapters = usePolled<Chapter[]>('/api/chapters').data ?? NO_CHAPTERS

  useEffect(() => {
    boxRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const daysAway = Math.floor(missedTicks / 1440)

  return (
    <div className="digest-scrim">
      <div
        className="digest-modal"
        role="dialog"
        aria-modal="true"
        aria-label="While you were away"
        tabIndex={-1}
        ref={boxRef}
      >
        <h2 className="px-title">
          While you were away — {daysAway} {daysAway === 1 ? 'day' : 'days'} passed
        </h2>

        <section className="block">
          <h3>Chapters</h3>
          {chapters.length > 0 ? (
            <ul>
              {chapters.map((c, i) => (
                <li key={i}>{c.title}</li>
              ))}
            </ul>
          ) : digest !== null && digest.days.length > 0 ? (
            <p>
              Days {digest.days[0]}–{digest.days.at(-1)} unfolded quietly.
            </p>
          ) : (
            <p>…</p>
          )}
        </section>

        <section className="block">
          <h3>Moments worth seeing</h3>
          {digest === null ? (
            <p>…</p>
          ) : digest.topMoments.length === 0 ? (
            <p>A calm stretch — nothing shook the town.</p>
          ) : (
            <ul className="moment-list">
              {digest.topMoments.slice(0, 5).map((m, i) => (
                <li key={i}>
                  <button
                    className="moment-link"
                    onClick={() => {
                      onMoment(m.tick)
                    }}
                  >
                    Day {m.moment.day} {m.moment.time}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {digest !== null && (
          <section className="block">
            <h3>The ledger of days</h3>
            <p>
              {digest.deaths.length === 0 ? 'No one was lost.' : `${digest.deaths.length} lost.`}{' '}
              {digest.structuresCompleted.length === 0
                ? 'Nothing new stands.'
                : `${digest.structuresCompleted.length} new ${digest.structuresCompleted.length === 1 ? 'building stands' : 'buildings stand'}.`}
            </p>
          </section>
        )}

        {digest !== null && digest.agentLines.length > 0 && (
          <section className="block">
            <h3>The townsfolk</h3>
            <ul>
              {digest.agentLines.map((l) => (
                <li key={l.agentId}>{l.line}</li>
              ))}
            </ul>
          </section>
        )}

        <p className="digest-footer">The town newspaper arrives with the narrator.</p>
        <button className="tab active digest-close" onClick={onClose}>
          Back to town
        </button>
      </div>
    </div>
  )
}
