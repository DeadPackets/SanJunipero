// The offline art pipeline's own ledger: a `spend.json` the `scripts/gen-*` one-shots keep.
// A live stream books its art to `_ops.db` instead, against the town's lifetime cap.
import { z } from 'zod'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const SPEND_KINDS = ['image_gen', 'vision_qa', 'style_judge'] as const
export type SpendKind = (typeof SPEND_KINDS)[number]

export const PER_ASSET_STOP_USD = 5

export class AnomalyStopError extends Error {
  constructor(
    public assetId: string,
    public totalUsd: number,
  ) {
    super(
      `asset ${assetId} crossed the $${PER_ASSET_STOP_USD} anomaly stop (attempted total $${totalUsd.toFixed(4)})`,
    )
    this.name = 'AnomalyStopError'
  }
}

export const SpendRowSchema = z
  .object({
    assetId: z.string().min(1),
    kind: z.enum(SPEND_KINDS),
    model: z.string().min(1),
    usd: z.number().min(0),
    at: z.string().min(1),
  })
  .strict()
export type SpendRow = z.infer<typeof SpendRowSchema>

function readRows(path: string): SpendRow[] {
  if (!existsSync(path)) return []
  try {
    const parsed = z.array(SpendRowSchema).safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  } // a corrupt or half-written file is a first run, not a crash
}

export class SpendLedger {
  #rows: SpendRow[]
  #flushedUpTo: number

  constructor(
    private path: string | null,
    private now: () => string = () => new Date().toISOString(),
  ) {
    this.#rows = path === null ? [] : readRows(path)
    this.#flushedUpTo = this.#rows.length
  }

  append(input: Omit<SpendRow, 'at'>): void {
    const row = SpendRowSchema.parse({ ...input, at: this.now() })
    const total = this.totalFor(row.assetId) + row.usd
    if (total > PER_ASSET_STOP_USD) throw new AnomalyStopError(row.assetId, total)
    this.#rows.push(row)
  }

  totalFor(assetId: string): number {
    return this.#rows.reduce((s, r) => (r.assetId === assetId ? s + r.usd : s), 0)
  }

  byKind(): Record<SpendKind, number> {
    const out = Object.fromEntries(SPEND_KINDS.map((k) => [k, 0])) as Record<SpendKind, number>
    for (const r of this.#rows) out[r.kind] += r.usd
    return out
  }

  total(): number {
    return this.#rows.reduce((s, r) => s + r.usd, 0)
  }

  rows(): readonly SpendRow[] {
    return this.#rows
  }

  // Read-merge-write: whatever another writer added since we loaded stays, our new rows go on the end.
  flush(): void {
    if (this.path === null) return
    const mine = this.#rows.slice(this.#flushedUpTo)
    const merged = [...readRows(this.path), ...mine]
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(merged, null, 2))
    this.#flushedUpTo = this.#rows.length
  }
}
