import { useSyncExternalStore } from 'react'
import { DiscoveryResponseSchema, type DiscoveryRecord } from '@sj/shared'
import { kindWords } from '../../ui/broadcastReady.js'
import { DISCOVERY_REFETCH_MS, leavesOf, recordSummary } from '../../ui/discoveryModel.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { usePolled } from '../../ui/useEndpoint.js'
import type { PageProps } from './index.js'

const NO_RECORDS: DiscoveryRecord[] = []
const discoveryRecords = (body: unknown): DiscoveryRecord[] | null => {
  const parsed = DiscoveryResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.discoveries : null
}

export function FoundPage(props: PageProps) {
  return props.tab === 'Places' ? <Places {...props} /> : <Things {...props} />
}

/**
 * The one place the agent's own words are printed. The chronicle never quotes them: a chronicle
 * line is agent-visible and this page is not.
 */
function Things({ store, onJump }: PageProps) {
  const assets = useSyncExternalStore(store.subscribe, store.assetRecords, store.assetRecords)
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  // The archive is history, not a stream: read on a slow beat, so a 2.5s world never
  // re-renders the record underneath the reader's pointer.
  const read = usePolled('/api/discoveries', discoveryRecords, DISCOVERY_REFETCH_MS)
  const leaves = leavesOf(read.data ?? NO_RECORDS, assets)
  const viewTick = mode.live ? null : mode.tick

  return (
    <>
      {read.loaded || leaves.length > 0 ? (
        <p className="sheet-note">{recordSummary(leaves, state?.tick ?? 0)}</p>
      ) : (
        <div aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-row" />
          ))}
        </div>
      )}
      {leaves.length === 0 ? (
        read.loaded ? (
          <p className="feed-empty">{EMPTY_COPY.discoveries}</p>
        ) : null
      ) : (
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
    </>
  )
}

/** Everything that stands, and who put it there. The whole provenance is one tap away. */
function Places({ store, onSubject }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const standing = Object.values(state?.structures ?? {}).filter((s) => s.stage === 'complete')

  if (standing.length === 0) return <p className="feed-empty">{EMPTY_COPY.places}</p>
  return (
    <ul className="places">
      {standing.map((s) => {
        const words = kindWords(s.kind)
        const builder = s.builtBy === null ? null : (state?.agents[s.builtBy]?.name ?? s.builtBy)
        return (
          <li key={s.id}>
            <button
              type="button"
              className="place-row"
              onClick={() => {
                onSubject({ id: s.id, kind: 'structure', name: words })
              }}
            >
              <span className="place-name">{words}</span>
              <span className="place-by">
                {builder === null ? EMPTY_COPY.provenance : `Built by ${builder}`}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
