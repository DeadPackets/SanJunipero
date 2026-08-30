import { useSyncExternalStore } from 'react'
import type { WorldState } from '@sj/engine/state'
import { kindWords } from '../../ui/broadcastReady.js'
import { builtLine, roomCard, type Provenance, type RoomCard } from '../../ui/interiorModel.js'
import { EMPTY_COPY } from '../../ui/townStats.js'
import { usePolled } from '../../ui/useEndpoint.js'
import { Skeleton } from './Skeleton.js'
import type { PageProps } from './types.js'

type Journal = { tick: number; text: string; kind: 'journal' | 'dream' }

/** The provenance sentence and the builder's nearest journal line, from the one builder both
 *  the room card and this page read — the two used to print the same fact differently. */
function provenanceLines(
  state: WorldState | null,
  p: Provenance | null,
  journal: Journal[],
): string {
  if (state === null || p === null) return EMPTY_COPY.provenance
  const built = builtLine(state, p)
  if (built === null) return EMPTY_COPY.provenance
  // Written entries only: a dream quoted under a building reads as what the builder saw.
  const nearest = journal
    .filter((e) => e.kind !== 'dream')
    .reduce<Journal | null>(
      (best, e) =>
        best === null || Math.abs(e.tick - p.plannedTick) < Math.abs(best.tick - p.plannedTick)
          ? e
          : best,
      null,
    )
  return nearest === null ? built : `${built}\n"${nearest.text}"`
}

export function BuildingPage({ tab, subject, store, insideId, onInside }: PageProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  useSyncExternalStore(store.subscribe, store.getTick, store.getTick)
  const id = subject?.kind === 'structure' ? subject.id : null
  // Keyed on the building, so a new subject is structurally a new read and the page can never
  // show one building's sentence under the next one's name.
  const prov = usePolled<Provenance>(
    id === null ? null : `/api/structure/${encodeURIComponent(id)}/provenance`,
  )
  const builderId = prov.data?.builderId ?? null
  const journal = usePolled<Journal[]>(
    builderId === null ? null : `/api/agent/${encodeURIComponent(builderId)}/journal`,
  )

  if (id === null || state === null) return <p className="feed-empty">{EMPTY_COPY.noPlace}</p>
  const structure = state.structures[id]
  if (structure === undefined) return <p className="feed-empty">Nothing stands here now.</p>

  if (tab === 'Inside') {
    const card = roomCard(state, id, store.assetRecords(), prov.data)
    return (
      <Inside
        card={card}
        inside={insideId === id}
        onEnter={() => {
          onInside(id)
        }}
        onLeave={() => {
          onInside(null)
        }}
      />
    )
  }

  const settled = prov.loaded && (prov.data === null || journal.loaded)
  return (
    <section className="provenance">
      <h3 className="feed-head">{kindWords(structure.kind)}</h3>
      {settled ? (
        <p className="provenance-line">{provenanceLines(state, prov.data, journal.data ?? [])}</p>
      ) : (
        <Skeleton rows={1} />
      )}
    </section>
  )
}

/** What InteriorBar used to hand a viewer who had walked the camera in — now a page, with the
 *  door on it either way round. */
function Inside({
  card,
  inside,
  onEnter,
  onLeave,
}: {
  card: RoomCard | null
  inside: boolean
  onEnter: () => void
  onLeave: () => void
}) {
  if (card === null) return <p className="feed-empty">{EMPTY_COPY.room}</p>
  return (
    <section className="room" aria-label={`Inside ${card.title}`}>
      <button
        type="button"
        className="room-door"
        onClick={inside ? onLeave : onEnter}
        aria-pressed={inside}
      >
        {inside ? 'Back to town' : 'Step inside'}
      </button>

      {card.built !== null && <p className="room-built">{card.built}</p>}

      {card.lives.length > 0 && (
        <p className="room-lives">
          <span className="room-label">Home to</span>
          <span className="room-names">{card.lives.join(', ')}</span>
        </p>
      )}

      <div className="room-present" role="group" aria-labelledby="room-present">
        <span className="room-label" id="room-present">
          In just now
        </span>
        {card.present.length === 0 ? (
          <p className="feed-empty">{card.empty}</p>
        ) : (
          <ul className="room-roll">
            {card.present.map((p) => (
              <li key={p.id}>
                <span className="room-who">{p.name}</span>
                <span className="room-state">{p.state}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {card.holds.length > 0 && (
        <div className="room-holds" role="group" aria-labelledby="room-holds">
          <span className="room-label" id="room-holds">
            Holding
          </span>
          <ul className="hold-grid">
            {card.holds.map((h) => (
              <li key={h.kind} className="hold">
                <span
                  className={h.iconUrl === null ? 'hold-icon bare' : 'hold-icon'}
                  style={
                    h.iconUrl === null ? undefined : { backgroundImage: `url("${h.iconUrl}")` }
                  }
                  aria-hidden="true"
                />
                <span className="hold-kind">{h.words}</span>
                <span className="hold-qty">{h.qty}</span>
              </li>
            ))}
          </ul>
          {card.more > 0 && <p className="room-more">and {card.more} more</p>}
        </div>
      )}
    </section>
  )
}
