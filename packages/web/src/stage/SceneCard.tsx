import { useEffect, useState } from 'react'
import { momentTitle } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { TownScene, WorldStore } from '../state/worldStore.js'
import { placeOf } from '../ui/place.js'
import { sceneNames } from '../ui/stageCue.js'

/** How long the card stands after a cut: long enough to read who and where, gone well before
 *  the shot it introduced is over. A card that outlived its own scene would be a label. */
export const CARD_HOLD_MS = 6000

/** Where the shot is and who is in it, and — when the town is holding the very scene the cut is
 *  of — what the town calls that scene. */
export type SceneCardText = { title: string | null; where: string }

/** The place of the first body the town can put somewhere, said as the town says it. Open ground
 *  has no name worth printing, so the card falls back to the names alone. */
function placeWords(state: WorldState, cast: readonly string[]): string | null {
  for (const id of cast) {
    const place = placeOf(state, id)
    if (place.kind === 'out') continue
    return place.words.charAt(0).toUpperCase() + place.words.slice(1)
  }
  return null
}

export function sceneCardOf(
  state: WorldState | null,
  cast: readonly string[],
  sceneId: string | null,
  scene: TownScene | null,
): SceneCardText | null {
  if (state === null || cast.length === 0) return null
  const names = sceneNames(cast, state.agents)
  if (names === '') return null
  const place = placeWords(state, cast)
  // Only the scene the cut is OF: with two rooms open the town holds one of them, and titling
  // this shot with the other room's word would name the wrong thing.
  const title = scene !== null && scene.id === sceneId ? momentTitle(scene.kind, null) : null
  return { title, where: place === null ? names : `${place} · ${names}` }
}

/** The card a cut opens with. It is struck once, from the town as it stood at the cut: the
 *  people in it keep walking, and a card that re-read the ground would rename the place. */
export function SceneCard({
  store,
  cast,
  sceneId,
}: {
  store: WorldStore
  /** who the director put in frame; a new array is a new cut */
  cast: readonly string[]
  sceneId: string | null
}) {
  const [card, setCard] = useState<SceneCardText | null>(null)

  useEffect(() => {
    const next = sceneCardOf(store.getState(), cast, sceneId, store.getScene())
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the store IS the external system: the card is struck from the town as it stood at the cut, which is this moment and no other.
    setCard(next)
    if (next === null) return
    const timer = setTimeout(() => {
      setCard(null)
    }, CARD_HOLD_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [store, cast, sceneId])

  if (card === null) return null
  return (
    <div className="scene-card">
      {card.title !== null && <span className="scene-card-title">{card.title}</span>}
      <span className="scene-card-where">{card.where}</span>
    </div>
  )
}
