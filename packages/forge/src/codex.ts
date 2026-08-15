import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { AssetRecordSchema, type AssetRecord, type AssetClass, type Footprint } from '@sj/shared'

type RegisterInput = {
  class: AssetClass; desc: string; footprint: Footprint; png: Buffer
  widthPx: number; heightPx: number; status: 'ready' | 'placeholder'
  score: number | null; attempts: number; costUsd: number
}

type Row = {
  seq: number; id: string; class: string; desc: string; footprint_w: number; footprint_h: number
  width_px: number; height_px: number; status: string; score: number | null
  attempts: number; cost_usd: number; created_at: string
}

const COLS = 'seq, id, class, desc, footprint_w, footprint_h, width_px, height_px, status, score, attempts, cost_usd, created_at'

export class AssetCodex {
  #insert; #selById; #selPngById; #selSince
  #listeners: ((rec: AssetRecord) => void)[] = []

  constructor(db: Database.Database) {
    this.#insert = db.prepare(`INSERT INTO assets
      (id, class, desc, footprint_w, footprint_h, png, width_px, height_px, status, score, attempts, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    this.#selById = db.prepare(`SELECT ${COLS} FROM assets WHERE id = ?`)
    this.#selPngById = db.prepare('SELECT png FROM assets WHERE id = ?')
    this.#selSince = db.prepare(`SELECT ${COLS} FROM assets WHERE seq > ? ORDER BY seq`)
  }

  #toRecord(r: Row): AssetRecord {
    return AssetRecordSchema.parse({
      id: r.id, seq: r.seq, class: r.class, desc: r.desc,
      footprint: { w: r.footprint_w, h: r.footprint_h },
      widthPx: r.width_px, heightPx: r.height_px, status: r.status,
      score: r.score, attempts: r.attempts, costUsd: r.cost_usd, createdAt: r.created_at,
    })
  }

  register(input: RegisterInput): AssetRecord {
    const id = `asset_${randomUUID()}`
    this.#insert.run(id, input.class, input.desc, input.footprint.w, input.footprint.h,
      input.png, input.widthPx, input.heightPx, input.status, input.score, input.attempts, input.costUsd)
    const rec = this.#toRecord(this.#selById.get(id) as Row)
    for (const cb of this.#listeners) cb(rec)
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
