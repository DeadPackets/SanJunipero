import { useEffect, useRef, useState } from 'react'
import { momentTitle } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import type { TownScene, WorldStore } from '../state/worldStore.js'
import { placeOf } from '../ui/place.js'
import { sceneNames } from '../ui/stageCue.js'
import {
  NO_BOOK,
  NO_ROWS,
  createSceneLedger,
  type SceneBook,
  type SceneRows,
} from './sceneLedger.js'

/** How long the card stands after a cut: long enough to read who and where, gone well before
 *  the shot it introduced is over. A card that outlived its own scene would be a label. */
export const CARD_HOLD_MS = 6000

/** Where the shot is and who is in it, and what the town calls the scene the cut is of. */
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
  scene: TownScene | null,
): SceneCardText | null {
  if (state === null || cast.length === 0) return null
  const names = sceneNames(cast, state.agents)
  if (names === '') return null
  const place = placeWords(state, cast)
  return {
    title: scene === null ? null : momentTitle(scene.kind, null),
    where: place === null ? names : `${place} · ${names}`,
  }
}

/** The words a cut is struck with, off the town as it stands at this moment and no other. The
 *  title comes from the scene the cut is OF: the town runs several at once, and another room's
 *  word would name the wrong thing. */
export function strikeCard(
  store: Pick<WorldStore, 'getState' | 'sceneById'>,
  cast: readonly string[],
  sceneId: string | null,
): SceneCardText | null {
  return sceneCardOf(store.getState(), cast, sceneId === null ? null : store.sceneById(sceneId))
}

/** The cut a card belongs to. The people and the scene, not the array they arrived in: a
 *  re-render that hands over the same names is the same cut. */
export const cutOf = (cast: readonly string[], sceneId: string | null): string =>
  `${sceneId ?? ''} ${cast.join(' ')}`

/** A card on screen and the moment its hold runs out. No React and no clock of its own. */
export type CardShow = {
  cut: string
  rows: SceneRows
  card: SceneCardText | null
  untilMs: number
}

/** Struck when the CUT changes and never again: the people in it keep walking, and a card
 *  re-struck later would rename its own place. A row the talk leaves stands the same words back
 *  up for another hold, because a talk closes long after the shot it opened. */
export function showCard(
  was: CardShow | null,
  cut: string,
  rows: SceneRows,
  nowMs: number,
  strike: () => SceneCardText | null,
): CardShow {
  const held = was !== null && was.cut === cut ? was : null
  if (held !== null && held.rows === rows) return held
  return {
    cut,
    rows,
    card: held === null ? strike() : held.card,
    untilMs: nowMs + CARD_HOLD_MS,
  }
}

/** The card a cut opens with, and again when the talk it is of leaves a ledger. */
export function SceneCard({
  store,
  cast,
  sceneId,
}: {
  store: WorldStore
  /** who the director put in frame */
  cast: readonly string[]
  sceneId: string | null
}) {
  const [show, setShow] = useState<CardShow | null>(null)
  const [book, setBook] = useState<SceneBook>(NO_BOOK)
  const rows = (sceneId === null ? undefined : book[sceneId]) ?? NO_ROWS
  const held = useRef<CardShow | null>(null)

  useEffect(() => {
    const ledger = createSceneLedger(store)
    const off = ledger.onChange(setBook)
    return () => {
      off()
      ledger.destroy()
    }
  }, [store])

  useEffect(() => {
    const nowMs = performance.now()
    const next = showCard(held.current, cutOf(cast, sceneId), rows, nowMs, () =>
      strikeCard(store, cast, sceneId),
    )
    held.current = next
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the store IS the external system: the card is struck from the town as it stood at the cut, which is this moment and no other.
    setShow(next)
    if (next.card === null) return
    const timer = setTimeout(
      () => {
        setShow(null)
      },
      Math.max(0, next.untilMs - nowMs),
    )
    return () => {
      clearTimeout(timer)
    }
  }, [store, cast, sceneId, rows])

  const card = show?.card ?? null
  if (card === null) return null
  return <SceneCardBody card={card} rows={rows} />
}

/** The markup alone. Apart from the card so the ledger it draws can be driven without a browser:
 *  everything above it is an effect, and an effect wants a DOM the suite does not have. */
export function SceneCardBody({ card, rows }: { card: SceneCardText; rows: SceneRows }) {
  return (
    <div className="scene-card">
      {card.title !== null && <span className="scene-card-title">{card.title}</span>}
      <span className="scene-card-where">{card.where}</span>
      {rows.turns.map((turn, i) => (
        <span className="scene-card-turn" key={`${String(i)} ${turn}`}>
          {turn}
        </span>
      ))}
      {rows.chips.map((chip, i) => (
        <span className="scene-card-chip" data-tone={chip.tone} key={`${String(i)} ${chip.text}`}>
          {chip.text}
        </span>
      ))}
    </div>
  )
}
