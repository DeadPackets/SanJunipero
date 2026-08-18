import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { WorldStore } from '../state/worldStore.js'
import { ROOM_WORDS, roomCard, type Provenance, type RoomCard } from './interiorModel.js'

// A ROOM TELLS YOU WHOSE IT IS (U4, audit R7, plan task 68).
//
// The bar used to say two things: a title and a one-line roll call. Everything else the world
// already knew about the room — who raised it, who lives in it, what it holds — was reachable
// from the endpoints and shown nowhere. It is a CARD now, and `interiorModel.roomCard` is the
// single answer to "what is this room"; the caption pair it replaces is retired rather than
// left beside it, because two descriptions of one room is the defect this task is fixing.

export { ROOM_WORDS as INTERIOR_ROOM_WORDS } from './interiorModel.js'

export function RoomCardView(
  { card, onBack, backRef }: {
    card: RoomCard
    onBack: () => void
    backRef?: React.Ref<HTMLButtonElement>
  },
) {
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
        {card.present.length === 0
          ? <p className="room-empty">{card.empty}</p>
          : (
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
                  style={h.iconUrl === null ? undefined : { backgroundImage: `url("${h.iconUrl}")` }}
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
export function useProvenance(structureId: string | null): Provenance | null {
  const [prov, setProv] = useState<Provenance | null>(null)
  useEffect(() => {
    setProv(null)
    if (structureId === null) return
    let live = true
    void fetch(`/api/structure/${encodeURIComponent(structureId)}/provenance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (live) setProv(p as Provenance | null) })
      .catch(() => { /* a room with no recorded beginning still opens */ })
    return () => { live = false }
  }, [structureId])
  return prov
}

// Escape leaves the room and focus goes back to the map, so the interior is never a place a
// keyboard can walk into and not out of. The card subscribes to a DERIVED string rather than
// to world state, so a 2.5s tick that changed nobody's whereabouts re-renders nothing.
export function InteriorBar(
  { store, structureId, onBack }: {
    store: WorldStore
    structureId: string | null
    onBack: () => void
  },
) {
  const backRef = useRef<HTMLButtonElement>(null)
  const prov = useProvenance(structureId)
  const signature = useSyncExternalStore(store.subscribe, () => {
    const c = roomCard(store.getState(), structureId, store.assetRecords(), null)
    return c === null ? '' : JSON.stringify(c)
  })
  const open = signature !== ''

  useEffect(() => {
    if (!open) return
    backRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.querySelector<HTMLElement>('.stage-mount')?.focus()
    }
  }, [open, onBack])

  if (!open) return null
  // the signature carries everything but the provenance line, which arrives on its own clock
  const card = { ...(JSON.parse(signature) as RoomCard), built: null }
  const built = roomCard(store.getState(), structureId, store.assetRecords(), prov)?.built ?? null
  return <RoomCardView card={{ ...card, built }} onBack={onBack} backRef={backRef} />
}
