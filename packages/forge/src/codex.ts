import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { AssetRecordSchema, AssetClassSchema, FootprintSchema, type AssetRecord } from '@sj/shared'

const RegisterInputSchema = z.object({
  class: AssetClassSchema,
  desc: z.string().min(1),
  kind: z.string().min(1).nullable().optional(),
  meta: z.string().nullable().optional(),
  footprint: FootprintSchema,
  png: z.instanceof(Buffer),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  status: z.enum(['ready', 'placeholder']),
  score: z.number().min(1).max(10).nullable(),
  attempts: z.number().int().min(1).max(3),
  costUsd: z.number().min(0),
}).strict()
type RegisterInput = z.infer<typeof RegisterInputSchema>

type Row = {
  seq: number; id: string; class: string; desc: string; kind: string | null; meta: string | null; footprint_w: number; footprint_h: number
  width_px: number; height_px: number; status: string; score: number | null
  attempts: number; cost_usd: number; created_at: string
}

const COLS = 'seq, id, class, desc, kind, meta, footprint_w, footprint_h, width_px, height_px, status, score, attempts, cost_usd, created_at'

export class AssetCodex {
  #insert; #selById; #selPngById; #selSince
  #listeners: ((rec: AssetRecord) => void)[] = []

  constructor(db: Database.Database) {
    this.#insert = db.prepare(`INSERT INTO assets
      (id, class, desc, kind, meta, footprint_w, footprint_h, png, width_px, height_px, status, score, attempts, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    this.#selById = db.prepare(`SELECT ${COLS} FROM assets WHERE id = ?`)
    this.#selPngById = db.prepare('SELECT png FROM assets WHERE id = ?')
    this.#selSince = db.prepare(`SELECT ${COLS} FROM assets WHERE seq > ? ORDER BY seq`)
  }

  #toRecord(r: Row): AssetRecord {
    return AssetRecordSchema.parse({
      id: r.id, seq: r.seq, class: r.class, desc: r.desc, kind: r.kind, meta: r.meta,
      footprint: { w: r.footprint_w, h: r.footprint_h },
      widthPx: r.width_px, heightPx: r.height_px, status: r.status,
      score: r.score, attempts: r.attempts, costUsd: r.cost_usd, createdAt: r.created_at,
    })
  }

  register(input: RegisterInput): AssetRecord {
    const v = RegisterInputSchema.parse(input)
    const id = `asset_${randomUUID()}`
    this.#insert.run(id, v.class, v.desc, v.kind ?? null, v.meta ?? null, v.footprint.w, v.footprint.h,
      v.png, v.widthPx, v.heightPx, v.status, v.score, v.attempts, v.costUsd)
    const rec = this.#toRecord(this.#selById.get(id) as Row)
    // the row is already committed — a throwing listener must not reject register (duplicate paid regen)
    for (const cb of this.#listeners) {
      try { cb(rec) } catch (e) { console.error('onAssetReady listener failed:', e) }
    }
    return rec
  }

  get(id: string): { record: AssetRecord; png: Buffer } | null {
    const row = this.#selById.get(id) as Row | undefined
    if (!row) return null
    const png = (this.#selPngById.get(id) as { png: Buffer }).png
    return { record: this.#toRecord(row), png: Buffer.from(png) }
  }

  listSince(seqExclusive: number): AssetRecord[] {
    return (this.#selSince.all(seqExclusive) as Row[]).map(r => this.#toRecord(r))
  }

  onAssetReady(cb: (rec: AssetRecord) => void): void { this.#listeners.push(cb) }
}
