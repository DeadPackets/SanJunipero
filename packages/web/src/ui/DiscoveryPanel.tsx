import { useEffect, useState, useSyncExternalStore } from 'react'
import { DiscoveryResponseSchema, type DiscoveryRecord } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { kindWords } from './broadcastReady.js'
import { DISCOVERY_REFETCH_MS, leavesOf, recordSummary, type Leaf } from './discoveryModel.js'

/**
 * The one place the agent's own words are printed. The chronicle never quotes them: a chronicle
 * line is agent-visible and this panel is not.
 */

/** The whole record, as a pure view. The panel below is the same thing with a fetch on it. */
export function DiscoveryRecordView({ leaves, throughTick, viewTick, onJump }: {
  leaves: readonly Leaf[]
  throughTick: number
  viewTick: number | null
  onJump: (tick: number) => void
}) {
  return (
    <section className="discovery-record" aria-label="The discovery record">
      <p className="discovery-summary">{recordSummary(leaves, throughTick)}</p>
      {leaves.length === 0 ? null : (
        <ol className="discovery-chain">
          {leaves.map((leaf) => (
            <li key={leaf.record.seq}>
              <button
                type="button"
                className="discovery-leaf"
                aria-current={viewTick === leaf.record.tick ? 'true' : undefined}
                aria-label={`${leaf.headline}, ${leaf.when}. Go to this moment.`}
                onClick={() => onJump(leaf.record.tick)}
              >
                {leaf.assetId === null
                  ? <span className="discovery-art discovery-art-none" aria-hidden="true" />
                  : (
                    <img
                      className="discovery-art" src={`/assets/${leaf.assetId}.png`} alt=""
                      width={48} height={48}
                    />
                  )}
                <span className="discovery-body">
                  <h3>{leaf.record.name}</h3>
                  <p className="discovery-credit">{leaf.when} — {leaf.record.by} worked this out.</p>
                  <p className="discovery-quote">“{leaf.record.intent}”</p>
                  {leaf.record.makes.length > 0 && (
                    <p className="discovery-makes">
                      After this, anyone could make {leaf.record.makes.map(kindWords).join(', ')}.
                    </p>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function DiscoveryPanel({ store, onView }: {
  store: WorldStore
  onView: (tick: number | null) => void
}) {
  const assets = useSyncExternalStore(store.subscribe, store.assetRecords)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [records, setRecords] = useState<DiscoveryRecord[]>([])

  // The archive is history, not a stream: read on the same slow beat the Chronicle uses, so a
  // 2.5s world never re-renders the record underneath the reader's pointer.
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void fetch('/api/discoveries')
        .then(async (r) => (r.ok ? DiscoveryResponseSchema.safeParse(await r.json()) : null))
        .then((parsed) => {
          if (alive && parsed?.success === true) setRecords(parsed.data.discoveries)
        })
        .catch(() => { /* the record simply has not arrived yet */ })
    }
    load()
    const timer = setInterval(load, DISCOVERY_REFETCH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  return (
    <DiscoveryRecordView
      leaves={leavesOf(records, assets)}
      throughTick={state?.tick ?? 0}
      viewTick={null}
      onJump={(tick) => onView(tick)}
    />
  )
}
