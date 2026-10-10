import { artRetries } from './artRetry.js'
import { characterKind, type AssetCodex } from '@sj/forge'

// A person the town made gets the same sheet the founders have. Like `discoveryArt.ts`, this
// writes the `assets` table and never the event log, so a face cannot move a golden — and until
// the sheet lands the gateway serves the placeholder it already serves for any known agent.

/** Lane A's `NewPerson`, restated structurally so this file can be written and tested before
 *  `@sj/agents` exports the type. The two must stay assignable. */
export type NewPerson = {
  id: string
  name: string
  sex: 'f' | 'm'
  ageYears: number
  parents: readonly [string, string] | null
}

/** What one DAY may put into faces, inside the town's own $3. A person is ~$1.15 at eight
 *  pictures, so this is one new face a day and the minds keep the rest. `SJ_ART_DAILY_USD=0`
 *  draws nothing and every stranger keeps the placeholder. */
export const LIVE_ART_DAILY_USD = 1.25

export type CastArtWatcher = {
  /** Fire-and-forget. Returns immediately; the face arrives when it arrives. */
  onPerson(p: NewPerson): void
  /** Awaits everything in flight. Tests only — the live run never waits on art. */
  settle(): Promise<void>
  retry(): void
}

export function watchCastArt(deps: {
  /** Draws and registers one person's sheet. Contracts never to reject. */
  draw: (p: NewPerson) => Promise<unknown>
  codex: Pick<AssetCodex, 'listSince' | 'onAssetReady'>
  /** Dollars the DAY may still put into art. `<= 0` puts the person back in the queue. */
  artSpendableUsd: () => number
  onError?: (agentId: string, err: unknown) => void
  signal?: AbortSignal
  /** A person whose commission is deferred until the next bounded retry. */
  onDeferred?: (agentId: string) => void
}): CastArtWatcher {
  const retries = artRetries(deps.signal)
  const known = new Set<string>()
  for (const rec of deps.codex.listSince(0))
    if (rec.kind !== null && rec.status === 'ready') known.add(rec.kind)
  deps.codex.onAssetReady((rec) => {
    if (rec.kind !== null && rec.status === 'ready') {
      known.add(rec.kind)
      retries.forget(rec.kind)
    }
  })

  const inFlight = new Set<Promise<unknown>>()
  // One commission at a time bounds image processing memory.
  let queue: Promise<unknown> = Promise.resolve()

  const claim = (p: NewPerson): void => {
    if (deps.signal?.aborted) return
    const kind = characterKind(p.id)
    if (known.has(kind)) return
    // Claimed BEFORE the await, so two arrivals in one breath do not pay for one face twice.
    known.add(kind)
    const give = (): void => {
      known.delete(kind)
      retries.defer(kind, () => {
        claim(p)
      })
      deps.onDeferred?.(p.id)
    }
    const mine: Promise<unknown> = queue
      .then(async () => {
        if (deps.signal?.aborted) return
        // Read inside the queue, not when the person walked in: the person ahead has spent by now.
        if (deps.artSpendableUsd() <= 0) {
          give()
          return
        }
        await deps.draw(p)
        retries.forget(kind)
      })
      .catch((err: unknown) => {
        // A gate that refuses the sheet does not throw — it just draws nothing. A throw is the
        // money running out mid-sheet or the provider falling over, so the person goes back in
        // the queue and the town does not stop for a picture.
        give()
        deps.onError?.(p.id, err)
      })
      .finally(() => {
        inFlight.delete(mine)
      })
    queue = mine
    inFlight.add(mine)
  }

  return {
    retry: retries.retry,
    onPerson(p) {
      if (deps.signal?.aborted || retries.has(characterKind(p.id))) return
      claim(p)
    },
    async settle() {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

/** A watcher that draws nothing: a run with no image budget must still let people arrive. */
export function noCastArt(): CastArtWatcher {
  return {
    retry() {
      /* no deferred faces */
    },
    onPerson() {
      /* the placeholder the gateway serves for any known agent is the face */
    },
    async settle() {
      /* nothing was ever in flight */
    },
  }
}
