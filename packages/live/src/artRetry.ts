export function artRetries(signal?: AbortSignal) {
  const pending = new Map<string, { failures: number; due: number; run: () => void }>()
  signal?.addEventListener(
    'abort',
    () => {
      pending.clear()
    },
    { once: true },
  )
  return {
    has: (key: string) => pending.has(key),
    forget: (key: string) => {
      pending.delete(key)
    },
    defer(key: string, run: () => void) {
      if (signal?.aborted) return
      const failures = (pending.get(key)?.failures ?? 0) + 1
      pending.set(key, {
        failures,
        due: Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(6, failures - 1)),
        run,
      })
    },
    retry: () => {
      if (signal?.aborted) return
      for (const work of pending.values()) {
        if (work.due > Date.now()) continue
        work.due = Infinity
        work.run()
      }
    },
  }
}
