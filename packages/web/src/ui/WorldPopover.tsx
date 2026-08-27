import type { WorldState } from '@sj/engine/state'
import type { WorldPick } from '../render/entities.js'
import type { WorldStore } from '../state/worldStore.js'
import { itemCropDetail } from './interaction.js'
import { builtLine, type Provenance } from './interiorModel.js'
import { usePolled, type Read } from './useEndpoint.js'

const NO_PROVENANCE = 'No one remembers who began this.'

type Journal = { tick: number; text: string }

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
  // Keyed on the building, so a new pick is structurally a new read and the popover can never
  // show one building's sentence under the next one's name.
  const id = pick?.kind === 'structure' ? pick.id : null
  const prov = usePolled<Provenance>(
    id === null ? null : `/api/structure/${encodeURIComponent(id)}/provenance`,
  )
  const builderId = prov.data?.builderId ?? null
  const journal = usePolled<Journal[]>(
    builderId === null ? null : `/api/agent/${encodeURIComponent(builderId)}/journal`,
  )

  const text = textFor(store, pick, prov, journal)
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

/** Silent until both reads have settled: the sentence and the journal line under it arrive
 *  together, or a viewer reads the same fact twice a beat apart. */
export function textFor(
  store: WorldStore,
  pick: WorldPick | null,
  prov: Read<Provenance>,
  journal: Read<Journal[]>,
): string {
  if (pick === null) return ''
  if (pick.kind !== 'structure') return itemCropDetail(store.getState(), pick.kind, pick.id) ?? ''
  if (!prov.loaded || (prov.data !== null && !journal.loaded)) return ''
  return provenanceLines(store.getState(), prov.data, journal.data ?? [])
}
