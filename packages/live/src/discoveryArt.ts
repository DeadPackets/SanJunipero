import type { AssetCodex, Forge } from '@sj/forge'

// Commissioning writes the `assets` table — not the event log, not folded — so it runs off the
// tick and cannot move a golden. `commission()` never rejects, so art never blocks a discovery.

export function artNeededFor(makes: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(makes)].filter((k) => !known.has(k)).sort()
}

// A kind is a slug in the engine and PROSE to a model. This text never enters the world, so
// the framing law does not reach it.
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
  const known = new Set<string>()
  for (const rec of deps.codex.listSince(0)) if (rec.kind !== null) known.add(rec.kind)
  deps.codex.onAssetReady((rec) => {
    if (rec.kind !== null) known.add(rec.kind)
  })

  const inFlight = new Set<Promise<unknown>>()

  return {
    onDiscovery(d) {
      for (const kind of artNeededFor(d.makes, known)) {
        // Claimed BEFORE the await, so a second discovery naming the same kind in the same
        // breath does not pay for it twice.
        known.add(kind)
        const p: Promise<unknown> = deps.forge
          .commission(itemCommissionText(kind, d.name), { w: 1, h: 1 }, 'item', kind)
          .catch((err: unknown) => {
            // commission() contracts never to reject; if it somehow does, the kind goes back
            // so a later discovery can try again, and the run does not stop for a picture.
            known.delete(kind)
            deps.onError?.(kind, err)
          })
          .finally(() => {
            inFlight.delete(p)
          })
        inFlight.add(p)
      }
    },
    async settle() {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

/** A watcher that draws nothing: a run with no image budget must still record every discovery. */
export function noDiscoveryArt(): DiscoveryArtWatcher {
  return {
    onDiscovery() {
      /* the record is already in the world log; a picture is not owed */
    },
    async settle() {
      /* nothing was ever in flight */
    },
  }
}
