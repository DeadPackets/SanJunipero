import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import { interiorOf } from '../render/interiors.js'

// Chrome copy speaks about townsfolk, never machinery (spec §5), and observes rather than
// scores (living-documentary law) — nothing here can be filled, completed or won.
export const INTERIOR_ROOM_WORDS: Record<string, string> = {
  hut: 'hut', storehouse: 'storehouse', shed: 'shed',
}

export type InteriorCaption = { title: string; who: string }

export function interiorCaption(
  state: WorldState | null, structureId: string | null,
): InteriorCaption | null {
  if (state === null || structureId === null) return null
  const room = interiorOf(state, structureId)
  if (room === null) return null
  const word = INTERIOR_ROOM_WORDS[room.kind] ?? 'room'
  const ownerId = room.structure.owner
  const ownerName = ownerId === undefined ? null : state.agents[ownerId]?.name ?? null
  const title = ownerName === null ? `The ${word}` : `${ownerName}'s ${word}`

  const names = room.occupants.map((id) => {
    const a = state.agents[id]
    const name = a?.name ?? id
    return a?.asleep === true ? `${name} asleep` : name
  })
  const who = names.length === 0
    ? 'No one is in just now'
    : names.length === 1 ? `${names[0]} is in`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are in`
  return { title, who }
}

export function InteriorBarView(
  { caption, onBack, backRef }: {
    caption: InteriorCaption
    onBack: () => void
    backRef?: React.Ref<HTMLButtonElement>
  },
) {
  return (
    <div className="interior-bar" role="group" aria-label={`Inside ${caption.title}`}>
      <button ref={backRef} type="button" className="interior-back" onClick={onBack}>
        Back to town
      </button>
      <span className="interior-caption">
        <span className="interior-title">{caption.title}</span>
        <span className="interior-who">{caption.who}</span>
      </span>
    </div>
  )
}

const SEP = '\n'   // a newline: neither the room's title nor its line can contain one

// Escape leaves the room and focus goes back to the map, so the interior is never a place a
// keyboard can walk into and not out of. The bar subscribes to a DERIVED string rather than
// to world state, so a 2.5s tick that changed nobody's whereabouts re-renders nothing.
export function InteriorBar(
  { store, structureId, onBack }: {
    store: WorldStore
    structureId: string | null
    onBack: () => void
  },
) {
  const backRef = useRef<HTMLButtonElement>(null)
  const line = useSyncExternalStore(store.subscribe, () => {
    const c = interiorCaption(store.getState(), structureId)
    return c === null ? '' : `${c.title}${SEP}${c.who}`
  })
  const open = line !== ''

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
  const cut = line.indexOf(SEP)
  const caption = { title: line.slice(0, cut), who: line.slice(cut + 1) }
  return <InteriorBarView caption={caption} onBack={onBack} backRef={backRef} />
}
