import type { AssetCodex, Forge } from '@sj/forge'

/**
 * A discovery that names a thing nobody has drawn asks the forge for its picture.
 *
 * WHERE THIS LIVES, AND WHY IT IS NOT IN `packages/forge`. The controller's ruling for this
 * lane is that the forge is wired into the live run FROM THE GATEWAY SIDE, calling the forge's
 * existing public API, without editing `packages/forge` — that package belongs to another lane
 * in flight. Nothing here reaches inside the forge: `commission`, `listSince` and
 * `onAssetReady` are all already public, and the deps below are `Pick`s of the real types, so
 * a change to either signature fails here at compile time.
 *
 * ART MUST NEVER BLOCK A DISCOVERY. `commission()` contracts never to reject — every path
 * registers a record, ready or placeholder — so `onDiscovery` returns synchronously and a
 * failure is reported through `onError` rather than thrown. The discovery event is already in
 * the world log before this is ever called.
 *
 * THIS CANNOT TOUCH DETERMINISM. Commissioning writes to the `assets` table, which is not the
 * event log and is not folded. It runs off the tick and its timing is irrelevant to replay.
 * Stated because "the forge, on the live path" looks like the kind of change that should move
 * a golden, and it cannot.
 */

/** The item kinds a discovery names that the codex has no art for. Sorted, deduped. */
export function artNeededFor(makes: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(makes)].filter((k) => !known.has(k)).sort()
}

// A kind is a slug in the engine and PROSE to a model — the same law the chronicle follows.
// This text never enters the world, so it is not agent-visible and the framing law does not
// reach it; it is kept plain anyway.
export function itemCommissionText(kind: string, discoveryName: string): string {
  const words = kind.replace(/_/g, ' ')
  return `A single ${words}, the object itself, lying still — the thing a townsperson gets when they ${discoveryName}.`
}

export type DiscoveryArtWatcher = {
  /** Fire-and-forget. Returns immediately; the art arrives when it arrives. */
  onDiscovery(d: { name: string; makes: readonly string[] }): void
  /** Awaits everything in flight. Tests only — the live run never waits on art. */
  settle(): Promise<void>
}

export function watchDiscoveryArt(deps: {
  forge: Pick<Forge, 'commission'>
  codex: Pick<AssetCodex, 'listSince' | 'onAssetReady'>
  onError?: (kind: string, err: unknown) => void
}): DiscoveryArtWatcher {
  // Every kind the codex has ever registered, kept live. `listSince(0)` seeds it once; the
  // ready callback keeps it current, including for art this watcher did not ask for.
  const known = new Set<string>()
  for (const rec of deps.codex.listSince(0)) if (rec.kind !== null) known.add(rec.kind)
  deps.codex.onAssetReady((rec) => { if (rec.kind !== null) known.add(rec.kind) })

  const inFlight = new Set<Promise<unknown>>()

  return {
    onDiscovery(d) {
      for (const kind of artNeededFor(d.makes, known)) {
        // Claimed BEFORE the await, so a second discovery naming the same kind in the same
        // breath does not pay for it twice.
        known.add(kind)
        const p: Promise<void> = deps.forge
          .commission(itemCommissionText(kind, d.name), { w: 1, h: 1 }, 'item')
          .then(() => {})
          .catch((err: unknown) => {
            // commission() contracts never to reject; if it somehow does, the kind goes back
            // so a later discovery can try again, and the run does not stop for a picture.
            known.delete(kind)
            deps.onError?.(kind, err)
          })
          .finally(() => { inFlight.delete(p) })
        inFlight.add(p)
      }
    },
    async settle() {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}
