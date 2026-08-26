import { useEffect, useRef, useState } from 'react'
import type { WorldStore } from '../state/worldStore.js'

export type Digest = {
  days: number[]
  deaths: unknown[]
  births: unknown[]
  structuresCompleted: unknown[]
  topMoments: Array<{
    tick: number
    agentId: string
    score: number
    moment: { day: number; time: string }
  }>
  agentLines: Array<{ agentId: string; line: string }>
}

type Chapter = { tick: number; title: string }

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
  const [digest, setDigest] = useState<Digest | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const to = store.getTick()
    const from = Math.max(0, to - missedTicks)
    void fetch(`/api/digest?fromTick=${from}&toTick=${to}`)
      .then(async (r) => (r.ok ? ((await r.json()) as Digest) : null))
      .then((d) => setDigest(d))
      .catch(() => {})
    void fetch('/api/chapters')
      .then(async (r) => (r.ok ? ((await r.json()) as Chapter[]) : []))
      .then(setChapters)
      .catch(() => {})
  }, [store, missedTicks])

  useEffect(() => {
    boxRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
                  <button className="moment-link" onClick={() => onMoment(m.tick)}>
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
