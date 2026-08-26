// FACING rides IN the codex `kind`: `house` is the SW cell, `house:se` the SE one. SW keeps the
// bare kind, so every existing record and renderer lookup is unchanged by the second facing.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BuildingManifestSchema, type BuildingManifest } from '@sj/shared'
import type { AssetCodex } from './codex.js'

export const STRUCTURE_FACINGS = ['sw', 'se'] as const
export type StructureFacing = (typeof STRUCTURE_FACINGS)[number]
export const DEFAULT_FACING: StructureFacing = 'sw'

export const isStructureFacing = (s: string): s is StructureFacing =>
  (STRUCTURE_FACINGS as readonly string[]).includes(s)

/** The codex `kind` a cell registers under. SW is the bare kind by design — see the header. */
export function facingKind(kind: string, facing: StructureFacing): string {
  return facing === DEFAULT_FACING ? kind : `${kind}:${facing}`
}

/** The inverse. An unsuffixed kind is SW; an unknown suffix is NOT a facing, so `road:nsew`
 *  and `character:omar` come back whole rather than being mistaken for a turned building. */
export function splitFacingKind(codexKind: string): { kind: string; facing: StructureFacing } {
  const at = codexKind.lastIndexOf(':')
  if (at < 1) return { kind: codexKind, facing: DEFAULT_FACING }
  const tail = codexKind.slice(at + 1)
  if (!isStructureFacing(tail) || tail === DEFAULT_FACING)
    return { kind: codexKind, facing: DEFAULT_FACING }
  return { kind: codexKind.slice(0, at), facing: tail }
}

// ── the committed content ──────────────────────────────────────────────────────────────────

export const BUILDINGS_CONTENT_DIR = fileURLToPath(new URL('../content/buildings', import.meta.url))

/** The style anchor and the identity anchors: the human-designated look, kept as the craft
 *  record. `referenceSheet.ts` says why nothing attaches them to a generation. */
export const REFERENCE_CONTENT_DIR = fileURLToPath(new URL('../content/reference', import.meta.url))

export type CommittedBuilding = {
  /** `house-se` — the directory name, and the label the reports use */
  dir: string
  kind: string
  facing: StructureFacing
  /** the codex kind column: `house` or `house:se` */
  codexKind: string
  manifest: BuildingManifest
  png: Buffer
}

/** Every committed cell, in directory order. A directory missing either file is an ERROR, not
 *  a skip: half a cell on disk is how art goes quietly missing. */
export function listCommittedBuildings(root: string = BUILDINGS_CONTENT_DIR): CommittedBuilding[] {
  if (!existsSync(root)) return []
  const out: CommittedBuilding[] = []
  for (const dir of readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    const base = join(root, dir)
    const manifestPath = join(base, 'manifest.json'),
      cellPath = join(base, 'cell.png')
    for (const p of [manifestPath, cellPath]) {
      if (!existsSync(p)) throw new Error(`buildings/${dir}: ${p.split('/').at(-1)} is missing`)
    }
    const manifest = BuildingManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
    const { kind, facing } = splitFacingKind(manifest.kind)
    // The directory name is derived from the manifest, never trusted over it, but the two
    // disagreeing means someone renamed one of them alone.
    const expected = facing === DEFAULT_FACING ? kind : `${kind}-${facing}`
    if (dir !== expected)
      throw new Error(
        `buildings/${dir}: manifest kind "${manifest.kind}" belongs in buildings/${expected}`,
      )
    out.push({ dir, kind, facing, codexKind: manifest.kind, manifest, png: readFileSync(cellPath) })
  }
  return out
}

// ── registration ───────────────────────────────────────────────────────────────────────────

export type BuildingIngestEntry = { kind: string; action: 'registered' | 'unchanged'; id: string }

function latestBuilding(codex: AssetCodex, kind: string) {
  return (
    codex
      .listSince(0)
      .filter((r) => r.status === 'ready' && r.class === 'building' && r.kind === kind)
      .at(-1) ?? null
  )
}

/** Idempotent: unchanged bytes + unchanged manifest register nothing, and a regenerated cell
 *  gets a new record that wins by seq — the renderer's newest-ready law. */
export function registerCommittedBuildings(
  codex: AssetCodex,
  opts: { root?: string } = {},
): BuildingIngestEntry[] {
  const out: BuildingIngestEntry[] = []
  for (const b of listCommittedBuildings(opts.root)) {
    const meta = JSON.stringify(b.manifest)
    const existing = latestBuilding(codex, b.codexKind)
    if (existing !== null && existing.meta === meta) {
      const stored = codex.get(existing.id)
      if (stored !== null && stored.png.equals(b.png)) {
        out.push({ kind: b.codexKind, action: 'unchanged', id: existing.id })
        continue
      }
    }
    const rec = codex.register({
      class: 'building',
      kind: b.codexKind,
      desc: `building v4: ${b.kind} facing ${b.facing}`,
      meta,
      footprint: b.manifest.footprint,
      png: b.png,
      widthPx: b.manifest.cell.w,
      heightPx: b.manifest.cell.h,
      status: 'ready',
      score: null,
      attempts: 1,
      costUsd: 0,
    })
    out.push({ kind: b.codexKind, action: 'registered', id: rec.id })
  }
  return out
}
