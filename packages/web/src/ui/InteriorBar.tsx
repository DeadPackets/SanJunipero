import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { roomCard, type Provenance, type RoomCard } from './interiorModel.js'

export function RoomCardView({
  card,
  onBack,
  backRef,
}: {
  card: RoomCard
  onBack: () => void
  backRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <aside className="room-card" role="group" aria-label={`Inside ${card.title}`}>
      <div className="room-head">
        <button ref={backRef} type="button" className="interior-back" onClick={onBack}>
          Back to town
        </button>
        <span className="room-title">{card.title}</span>
      </div>
      {/* the provenance takes the card's full width: squeezed beside the button it wrapped
          mid-phrase, which the browser showed */}
      {card.built !== null && <p className="room-built">{card.built}</p>}

      {card.lives.length > 0 && (
        <p className="room-lives">
          <span className="room-label">Home to</span>
          <span className="room-names">{card.lives.join(', ')}</span>
        </p>
      )}

      <div className="room-present">
        <span className="room-label">In just now</span>
        {card.present.length === 0 ? (
          <p className="room-empty">{card.empty}</p>
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
        <div className="room-holds">
          <span className="room-label">Holding</span>
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
    </aside>
  )
}

/** The provenance endpoint, as a hook. A room the gateway has forgotten is `null`, which the
 *  card renders by omitting the line rather than by printing a blank. */
function useProvenance(structureId: string | null): Provenance | null {
  // held WITH the room it describes, so a new room reads as "nothing yet" in the same render
  const [got, setGot] = useState<{ id: string; prov: Provenance | null } | null>(null)
  useEffect(() => {
    if (structureId === null) return
    let live = true
    void fetch(`/api/structure/${encodeURIComponent(structureId)}/provenance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (live) setGot({ id: structureId, prov: p as Provenance | null })
      })
      .catch(() => {
        /* a room with no recorded beginning still opens */
      })
    return () => {
      live = false
    }
  }, [structureId])
  return got?.id === structureId ? got.prov : null
}

// Escape leaves the room, so the interior is never a place a keyboard can walk into and not out
// of. The card subscribes to a DERIVED string, so a tick that moved nobody re-renders nothing.
export function InteriorBar({
  store,
  structureId,
  onBack,
}: {
  store: WorldStore
  structureId: string | null
  onBack: () => void
}) {
  const backRef = useRef<HTMLButtonElement>(null)
  const prov = useProvenance(structureId)
  const signature = useSyncExternalStore(store.subscribe, () => {
    const c = roomCard(store.getState(), structureId, store.assetRecords(), null)
    return c === null ? '' : JSON.stringify(c)
  })
  const open = signature !== ''

  // Escape is App's single `escapeStep` reducer — a listener here would leave the room even
  // when the step belonged to something on top of it.
  useEffect(() => {
    if (!open) return
    backRef.current?.focus()
    return () => {
      document.querySelector<HTMLElement>('.stage-mount')?.focus()
    }
  }, [open])

  if (!open) return null
  // the signature carries everything but the provenance line, which arrives on its own clock
  const card = { ...(JSON.parse(signature) as RoomCard), built: null }
  const built = roomCard(store.getState(), structureId, store.assetRecords(), prov)?.built ?? null
  return <RoomCardView card={{ ...card, built }} onBack={onBack} backRef={backRef} />
}
