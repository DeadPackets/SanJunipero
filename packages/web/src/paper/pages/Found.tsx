import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  type DiscoveryRecord,
  DiscoveryResponseSchema,
  kindWords,
  structureTitle,
} from '@sj/shared'
import { DISCOVERY_REFETCH_MS, leavesOf, recordSummary } from '../../ui/discoveryModel.js'
import { itemCropDetail, thingKind } from '../../ui/interaction.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { useEndpointFor, useFeed } from '../../ui/useEndpoint.js'
import { OutOfReach } from '../../ui/OutOfReach.js'
import { Skeleton } from './Skeleton.js'
import type { PageProps } from './types.js'

const NO_RECORDS: DiscoveryRecord[] = []
const discoveryRecords = (body: unknown): DiscoveryRecord[] | null => {
  const parsed = DiscoveryResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.discoveries : null
}

export function FoundPage(props: PageProps) {
  return props.tab === 'Places' ? <Places {...props} /> : <Things {...props} />
}

/** The one place the agent's own words are printed: a chronicle line is agent-visible and this
 *  page is not. */
function Things({ store, thing, onJump }: PageProps) {
  const assets = useSyncExternalStore(store.subscribe, store.assetRecords, store.assetRecords)
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const mode = useSyncExternalStore(store.subscribe, store.getMode, store.getMode)
  // The archive is history, not a stream: read on a slow beat, so a 2.5s world never
  // re-renders the record underneath the reader's pointer.
  const record = useEndpointFor('/api/discoveries', discoveryRecords, DISCOVERY_REFETCH_MS)
  const read = useFeed(record)
  const leaves = leavesOf(read.data ?? NO_RECORDS, assets)
  const viewTick = mode.live ? null : mode.tick

  // A thing on the ground has no page of its own, so the record it came out of answers for it.
  const clicked = thing === null ? null : itemCropDetail(state, thing)
  const clickedKind = thing === null ? null : thingKind(state, thing)
  const madeBy =
    clickedKind === null
      ? null
      : (leaves.find((l) => l.record.makes.includes(clickedKind))?.record.seq ?? null)
  const atRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    atRef.current?.scrollIntoView({ block: 'nearest' })
  }, [madeBy])

  return (
    <>
      {clicked !== null && (
        <p className="found-clicked">
          {clicked}
          {madeBy === null && '. Nobody has worked out where this comes from yet.'}
        </p>
      )}
      {read.loaded || leaves.length > 0 ? (
        <p className="sheet-note">{recordSummary(leaves, state?.tick ?? 0)}</p>
      ) : (
        <Skeleton />
      )}
      {leaves.length === 0 ? (
        read.failed ? (
          <OutOfReach onRetry={record.retry} />
        ) : read.loaded ? (
          <p className="feed-empty">{EMPTY_COPY.discoveries}</p>
        ) : null
      ) : (
        <ol className="discovery-chain">
          {leaves.map((leaf) => (
            <li key={leaf.record.seq} ref={leaf.record.seq === madeBy ? atRef : undefined}>
              <button
                type="button"
                className="discovery-leaf"
                aria-current={
                  leaf.record.seq === madeBy || viewTick === leaf.record.tick ? 'true' : undefined
                }
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
                  <span className="discovery-name">{leaf.record.name}</span>
                  <span className="discovery-credit">
                    {leaf.when} — {leaf.record.by} worked this out.
                  </span>
                  <span className="discovery-quote">“{leaf.record.intent}”</span>
                  {leaf.record.makes.length > 0 && (
                    <span className="discovery-makes">
                      After this, anyone could make {leaf.record.makes.map(kindWords).join(', ')}.
                    </span>
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

function Places({ store, onSubject }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const standing = Object.values(state?.structures ?? {}).filter((s) => s.stage === 'complete')

  if (standing.length === 0) return <p className="feed-empty">{EMPTY_COPY.places}</p>
  return (
    <ul className="places">
      {standing.map((s) => {
        const words = structureTitle(s)
        const builder = s.builtBy === null ? null : (state?.agents[s.builtBy]?.name ?? null)
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
