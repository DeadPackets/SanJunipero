import { useEffect, useState } from 'react'
import type { WorldState } from '@sj/engine/state'
import type { WorldPick } from '../render/entities.js'
import type { WorldStore } from '../state/worldStore.js'
import { itemCropDetail } from './interaction.js'
import { builtLine, type Provenance } from './interiorModel.js'

const NO_PROVENANCE = 'No one remembers who began this.'

type Journal = { tick: number; text: string; kind: 'journal' | 'dream' }

/** The provenance sentence and the builder's nearest journal line, from the one builder both
 *  the room card and this popover read — the two used to print the same fact differently. */
export function provenanceLines(
  state: WorldState | null,
  p: Provenance | null,
  journal: Journal[],
): string {
  if (state === null || p === null) return NO_PROVENANCE
  const built = builtLine(state, p)
  if (built === null) return NO_PROVENANCE
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

async function tellOf(store: WorldStore, structureId: string): Promise<string> {
  const pr = await fetch(`/api/structure/${encodeURIComponent(structureId)}/provenance`)
  if (!pr.ok) return NO_PROVENANCE
  const p = (await pr.json()) as Provenance
  const jr = await fetch(`/api/agent/${encodeURIComponent(p.builderId)}/journal`)
  return provenanceLines(store.getState(), p, jr.ok ? ((await jr.json()) as Journal[]) : [])
}

/** What the map says about the thing that was just clicked. One live region for the life of the
 *  app — a region mounted with its own announcement never announces it. */
export function WorldPopover({ store, pick }: { store: WorldStore; pick: WorldPick | null }) {
  // held WITH the building it describes, so a new pick reads as empty in the same render
  const [told, setTold] = useState<{ id: string; text: string } | null>(null)

  useEffect(() => {
    if (pick?.kind !== 'structure') return
    const id = pick.id
    let live = true
    void tellOf(store, id)
      .catch(() => NO_PROVENANCE)
      .then((text) => {
        if (live) setTold({ id, text })
      })
    return () => {
      live = false
    }
  }, [pick, store])

  const text = textFor(store, pick, told)
  return (
    <div
      className="provenance-pop"
      role="status"
      aria-live="polite"
      style={{
        display: text === '' ? 'none' : 'block',
        left: Math.round(pick?.screenX ?? 0),
        top: Math.round(pick?.screenY ?? 0),
      }}
    >
      {text}
    </div>
  )
}

function textFor(
  store: WorldStore,
  pick: WorldPick | null,
  told: { id: string; text: string } | null,
): string {
  if (pick === null) return ''
  if (pick.kind !== 'structure') return itemCropDetail(store.getState(), pick.kind, pick.id) ?? ''
  return told?.id === pick.id ? told.text : ''
}
