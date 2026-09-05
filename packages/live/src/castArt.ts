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
}

export function watchCastArt(deps: {
  /** Draws and registers one person's sheet. Contracts never to reject. */
  draw: (p: NewPerson) => Promise<unknown>
  codex: Pick<AssetCodex, 'listSince' | 'onAssetReady'>
  /** Dollars the DAY may still put into art. `<= 0` puts the person back in the queue. */
  artSpendableUsd: () => number
  onError?: (agentId: string, err: unknown) => void
  /** A person the day's art money could not reach. The next arrival, or the next boot, tries. */
  onDeferred?: (agentId: string) => void
}): CastArtWatcher {
  const known = new Set<string>()
  for (const rec of deps.codex.listSince(0)) if (rec.kind !== null) known.add(rec.kind)
  deps.codex.onAssetReady((rec) => {
    if (rec.kind !== null) known.add(rec.kind)
  })

  const inFlight = new Set<Promise<unknown>>()
  // One at a time: side by side two commissions would each read the same balance and each spend
  // it. Art is fire-and-forget, so the queue costs nothing anyone waits on.
  let queue: Promise<unknown> = Promise.resolve()
  const deferred = new Map<string, NewPerson>()

  const claim = (p: NewPerson): void => {
    const kind = characterKind(p.id)
    if (known.has(kind)) return
    // Claimed BEFORE the await, so two arrivals in one breath do not pay for one face twice.
    known.add(kind)
    const give = (): void => {
      known.delete(kind)
      deferred.set(p.id, p)
      deps.onDeferred?.(p.id)
    }
    const mine: Promise<unknown> = queue
      .then(async () => {
        // Read inside the queue, not when the person walked in: the person ahead has spent by now.
        if (deps.artSpendableUsd() <= 0) return give()
        await deps.draw(p)
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
    onPerson(p) {
      // Whoever the money could not reach goes back in the queue ahead of the newcomer, so a
      // deferred face is drawn the moment the window rolls rather than waiting for a restart.
      const waiting = [...deferred.values()]
      deferred.clear()
      for (const q of waiting) claim(q)
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
    onPerson() {
      /* the placeholder the gateway serves for any known agent is the face */
    },
    async settle() {
      /* nothing was ever in flight */
    },
  }
}
