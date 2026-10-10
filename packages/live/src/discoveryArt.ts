import { artRetries } from './artRetry.js'
import { buildingMaterialPrompt, type AssetCodex, type Forge } from '@sj/forge'

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
  onDiscovery(d: {
    name: string
    makes: readonly string[]
    raises?: readonly { kind: string; w: number; h: number }[]
  }): void
  /** Awaits everything in flight. Tests only — the live run never waits on art. */
  settle(): Promise<void>
  retry(): void
}

export function watchDiscoveryArt(deps: {
  forge: Pick<Forge, 'commission'>
  codex: Pick<AssetCodex, 'listSince' | 'onAssetReady'>
  onError?: (kind: string, err: unknown) => void
  signal?: AbortSignal
}): DiscoveryArtWatcher {
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

  const commission = (...args: Parameters<Forge['commission']>): void => {
    const kind = args[3]
    if (deps.signal?.aborted || known.has(kind)) return
    known.add(kind)
    const defer = () => {
      known.delete(kind)
      retries.defer(kind, () => {
        commission(...args)
      })
    }
    const pending = deps.forge
      .commission(...args)
      .then((record) => {
        if (record.status === 'ready') retries.forget(kind)
        else {
          defer()
          if (args[2] === 'building')
            deps.onError?.(
              kind,
              new Error('material generation left the existing surface in place'),
            )
        }
      })
      .catch((err: unknown) => {
        defer()
        deps.onError?.(kind, err)
      })
      .finally(() => {
        inFlight.delete(pending)
      })
    inFlight.add(pending)
  }

  return {
    retry: retries.retry,
    onDiscovery(d) {
      if (deps.signal?.aborted) return
      for (const b of d.raises ?? []) {
        for (const slot of ['wood', 'roof'] as const) {
          const kind = `material:${b.kind}:${slot}`
          if (!retries.has(kind))
            commission(buildingMaterialPrompt(b.kind, slot), { w: b.w, h: b.h }, 'building', kind)
        }
      }
      for (const kind of artNeededFor(d.makes, known)) {
        if (!retries.has(kind))
          commission(itemCommissionText(kind, d.name), { w: 1, h: 1 }, 'item', kind)
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
    retry() {
      /* no deferred discoveries */
    },
    onDiscovery() {
      /* the record is already in the world log; a picture is not owed */
    },
    async settle() {
      /* nothing was ever in flight */
    },
  }
}
