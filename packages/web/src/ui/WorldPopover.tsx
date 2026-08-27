import { useEffect, useState } from 'react'
import type { WorldPick } from '../render/entities.js'
import type { WorldStore } from '../state/worldStore.js'
import { itemCropDetail } from './interaction.js'
import { builtLine, type Provenance } from './interiorModel.js'

const NO_PROVENANCE = 'No one remembers who began this.'

type Journal = { tick: number; text: string }

/** The provenance sentence and the builder's nearest journal line, from the one builder both
 *  the room card and this popover read — the two used to print the same fact differently. */
export function provenanceLines(
  store: WorldStore,
  p: Provenance | null,
  journal: Journal[],
): string {
  const state = store.getState()
  const built = state === null ? null : builtLine(state, p)
  if (built === null || p === null) return NO_PROVENANCE
  const nearest = journal.reduce<Journal | null>(
    (best, e) =>
      best === null || Math.abs(e.tick - p.plannedTick) < Math.abs(best.tick - p.plannedTick)
        ? e
        : best,
    null,
  )
  return nearest === null ? built : `${built}\n"${nearest.text}"`
}

/** What the map says about the thing that was just clicked. One live region for the life of the
 *  app — a region mounted with its own announcement never announces it. */
export function WorldPopover({ store, pick }: { store: WorldStore; pick: WorldPick | null }) {
  const [text, setText] = useState('')

  useEffect(() => {
    if (pick === null) {
      setText('')
      return
    }
    if (pick.kind !== 'structure') {
      setText(itemCropDetail(store.getState(), pick.kind, pick.id) ?? '')
      return
    }
    let live = true
    const id = encodeURIComponent(pick.id)
    void fetch(`/api/structure/${id}/provenance`)
      .then((r) => (r.ok ? (r.json() as Promise<Provenance>) : null))
      .then(async (p) => {
        if (p === null) return { p, journal: [] as Journal[] }
        const jr = await fetch(`/api/agent/${encodeURIComponent(p.builderId)}/journal`)
        return { p, journal: jr.ok ? ((await jr.json()) as Journal[]) : [] }
      })
      .then(({ p, journal }) => {
        if (live) setText(provenanceLines(store, p, journal))
      })
      .catch(() => {
        if (live) setText(NO_PROVENANCE)
      })
    return () => {
      live = false
    }
  }, [pick, store])

  const shown = pick !== null && text !== ''
  return (
    <div
      className="provenance-pop"
      role="status"
      aria-live="polite"
      style={{
        display: shown ? 'block' : 'none',
        left: pick === null ? 0 : Math.round(pick.screenX),
        top: pick === null ? 0 : Math.round(pick.screenY),
      }}
    >
      {text}
    </div>
  )
}
