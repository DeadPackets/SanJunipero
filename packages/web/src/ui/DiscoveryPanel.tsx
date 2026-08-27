import { useSyncExternalStore } from 'react'
import { DiscoveryResponseSchema, type DiscoveryRecord } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'
import { kindWords } from './broadcastReady.js'
import { DISCOVERY_REFETCH_MS, leavesOf, recordSummary, type Leaf } from './discoveryModel.js'
import { usePolled } from './useEndpoint.js'

const NO_RECORDS: DiscoveryRecord[] = []
const discoveryRecords = (body: unknown): DiscoveryRecord[] | null => {
  const parsed = DiscoveryResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.discoveries : null
}

/**
 * The one place the agent's own words are printed. The chronicle never quotes them: a chronicle
 * line is agent-visible and this panel is not.
 */

/** The whole record, as a pure view. The panel below is the same thing with a fetch on it. */
export function DiscoveryRecordView({
  leaves,
  throughTick,
  viewTick,
  onJump,
  loading = false,
}: {
  leaves: readonly Leaf[]
  throughTick: number
  viewTick: number | null
  onJump: (tick: number) => void
  /** the first fetch has not answered yet — which is NOT the same thing as "nothing was made" */
  loading?: boolean
}) {
  return (
    <section className="discovery-record" aria-label="The discovery record">
      <h2 className="px-title">What they made</h2>
      {loading && leaves.length === 0 ? (
        <div aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      ) : (
        <p className="discovery-summary">{recordSummary(leaves, throughTick)}</p>
      )}
      {leaves.length === 0 ? null : (
        <ol className="discovery-chain">
          {leaves.map((leaf) => (
            <li key={leaf.record.seq}>
              <button
                type="button"
                className="discovery-leaf"
                aria-current={viewTick === leaf.record.tick ? 'true' : undefined}
                aria-label={`${leaf.headline}, ${leaf.when}. Go to this moment.`}
                onClick={() => {
                  onJump(leaf.record.tick)
                }}
              >
                {leaf.assetId === null ? (
                  <span className="discovery-art discovery-art-none" aria-hidden="true" />
                ) : (
                  <img
                    className="discovery-art"
                    src={`/assets/${leaf.assetId}.png`}
                    alt=""
                    width={48}
                    height={48}
                  />
                )}
                <span className="discovery-body">
                  <h3>{leaf.record.name}</h3>
                  <p className="discovery-credit">
                    {leaf.when} — {leaf.record.by} worked this out.
                  </p>
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

export function DiscoveryPanel({
  store,
  onView,
}: {
  store: WorldStore
  onView: (tick: number | null) => void
}) {
  const assets = useSyncExternalStore(store.subscribe, store.assetRecords)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode)
  // The archive is history, not a stream: read on the same slow beat the Chronicle uses, so a
  // 2.5s world never re-renders the record underneath the reader's pointer.
  const read = usePolled('/api/discoveries', discoveryRecords, DISCOVERY_REFETCH_MS)
  const records = read.data ?? NO_RECORDS

  return (
    <DiscoveryRecordView
      leaves={leavesOf(records, assets)}
      throughTick={state?.tick ?? 0}
      loading={!read.loaded}
      viewTick={mode.live ? null : mode.tick}
      onJump={(tick) => {
        onView(tick)
      }}
    />
  )
}
