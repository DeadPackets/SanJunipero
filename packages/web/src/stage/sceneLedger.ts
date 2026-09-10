import { TIE_VALENCE, agentName, tieActOf } from '@sj/shared'
import type { WorldStore } from '../state/worldStore.js'

// What a talk changed and where it turned, off the deltas every close has always carried.

type ChipTone = 'cost' | 'gain' | 'plain'
/** One thing the talk changed, in the town's own sentence. */
type SceneChip = { tone: ChipTone; text: string }
export type SceneRows = { turns: readonly string[]; chips: readonly SceneChip[] }
/** Every scene the ledger still holds, by id. */
export type SceneBook = Readonly<Record<string, SceneRows>>

export const NO_ROWS: SceneRows = { turns: [], chips: [] }
export const NO_BOOK: SceneBook = {}

/** Two rooms run at once and a card reads one of them, so a handful covers every cut. */
const LEDGER_SCENES = 8

type Delta = { kind: string; text: string; settled?: true }

/** Cost, gain or neither, off the town's own table of what a tie between two people is worth. */
function chipOf(delta: Delta): SceneChip {
  const act = tieActOf(delta.kind, delta.settled === true)
  const worth = act === null ? 0 : TIE_VALENCE[act]
  return { tone: worth < 0 ? 'cost' : worth > 0 ? 'gain' : 'plain', text: delta.text }
}

export function createSceneLedger(store: Pick<WorldStore, 'getState' | 'onEvents' | 'tension'>): {
  onChange: (fn: (book: SceneBook) => void) => () => void
  destroy: () => void
} {
  const rows = new Map<string, SceneRows>()
  const subs = new Set<(book: SceneBook) => void>()

  const put = (sceneId: string, next: SceneRows): void => {
    rows.delete(sceneId)
    rows.set(sceneId, next)
    for (const oldest of rows.keys()) {
      if (rows.size <= LEDGER_SCENES) break
      rows.delete(oldest)
    }
    const book = Object.fromEntries(rows)
    for (const fn of subs) fn(book)
  }

  const offTurn = store.tension.onTurn((turn) => {
    const at = rows.get(turn.sceneId) ?? NO_ROWS
    const name = agentName(store.getState()?.agents, turn.yielder)
    put(turn.sceneId, { ...at, turns: [...at.turns, `${name} gave way`] })
  })

  const offEvents = store.onEvents((evts) => {
    for (const ev of evts) {
      if (ev.type !== 'scene_closed') continue
      const closed = ev.payload as { id: string; deltas: readonly Delta[] }
      const chips = closed.deltas.filter((d) => d.text.trim() !== '').map(chipOf)
      put(closed.id, { ...(rows.get(closed.id) ?? NO_ROWS), chips })
    }
  })

  return {
    onChange: (fn) => {
      subs.add(fn)
      return () => subs.delete(fn)
    },
    destroy: () => {
      offTurn()
      offEvents()
      rows.clear()
      subs.clear()
    },
  }
}
