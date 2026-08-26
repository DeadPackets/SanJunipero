// A character ships as ONE codex record: the packed atlas as the png, the atlas manifest as the
// meta — five files instead of a hundred and twenty, and no packing step at boot.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CharacterAtlasManifestSchema,
  FOUNDER_IDS,
  type AssetRecord,
  type CharacterAtlasManifest,
} from '@sj/shared'
import type { AssetCodex } from './codex.js'
import { CELL_NAMES_V4 } from './mirror.js'

export const CAST_CONTENT_DIR = fileURLToPath(new URL('../content/cast', import.meta.url))

/** The codex `kind` a character's sheet registers under — what `textures.ts` resolves on. */
export const characterKind = (id: string): string => `character:${id}`

/** The inverse. A kind that is not a character comes back null. */
export function characterId(codexKind: string): string | null {
  return codexKind.startsWith('character:') ? codexKind.slice('character:'.length) : null
}

export type CommittedCharacter = {
  id: string
  codexKind: string
  manifest: CharacterAtlasManifest
  atlas: Buffer
}

/** Every committed character sheet, in id order. A missing file, or a manifest short of the 24
 *  cells, throws: a sheet with 23 cells draws nothing at all for the pose it is missing. */
export function listCommittedCast(root: string = CAST_CONTENT_DIR): CommittedCharacter[] {
  if (!existsSync(root)) return []
  const out: CommittedCharacter[] = []
  for (const id of readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    const base = join(root, id)
    const manifestPath = join(base, 'manifest.json'),
      atlasPath = join(base, 'atlas.png')
    for (const p of [manifestPath, atlasPath]) {
      if (!existsSync(p)) throw new Error(`cast/${id}: ${p.split('/').at(-1)} is missing`)
    }
    const manifest = CharacterAtlasManifestSchema.parse(
      JSON.parse(readFileSync(manifestPath, 'utf8')),
    )
    const absent = CELL_NAMES_V4.filter((n) => manifest.cells[n] === undefined)
    if (absent.length)
      throw new Error(`cast/${id}: manifest addresses no cell ${absent.join(', ')}`)
    out.push({ id, codexKind: characterKind(id), manifest, atlas: readFileSync(atlasPath) })
  }
  return out
}

export type CastIngestEntry = { kind: string; action: 'registered' | 'unchanged'; id: string }

/** Idempotent on the same law the committed buildings register by. */
export function registerCommittedCast(
  codex: AssetCodex,
  opts: { root?: string } = {},
): CastIngestEntry[] {
  const out: CastIngestEntry[] = []
  // One scan for the whole ingest, written in seq order so the last ready record still wins.
  const latest = new Map<string, AssetRecord>()
  for (const r of codex.listSince(0)) {
    if (r.status === 'ready' && r.class === 'rig-part' && r.kind !== null) latest.set(r.kind, r)
  }
  for (const c of listCommittedCast(opts.root)) {
    const meta = JSON.stringify(c.manifest)
    const existing = latest.get(c.codexKind)
    if (existing !== undefined && existing.meta === meta) {
      const stored = codex.get(existing.id)
      if (stored !== null && stored.png.equals(c.atlas)) {
        out.push({ kind: c.codexKind, action: 'unchanged', id: existing.id })
        continue
      }
    }
    // The atlas canvas is the bounding box of the packed rows, which the manifest already
    // states cell by cell; reading it back off the png would need a decode at boot.
    const width = Math.max(...Object.values(c.manifest.cells).map((r) => r.x + r.w))
    const height = Math.max(...Object.values(c.manifest.cells).map((r) => r.y + r.h))
    const rec = codex.register({
      class: 'rig-part',
      kind: c.codexKind,
      desc: `character sheet v4: ${c.id}`,
      meta,
      footprint: { w: 1, h: 1 },
      png: c.atlas,
      widthPx: width,
      heightPx: height,
      status: 'ready',
      score: null,
      attempts: 1,
      costUsd: 0,
    })
    out.push({ kind: c.codexKind, action: 'registered', id: rec.id })
  }
  return out
}

export { FOUNDER_IDS }
