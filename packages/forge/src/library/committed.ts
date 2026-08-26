// Items are committed under `content/items/<kind>/` — sprite.png, icon.png and the manifest the
// renderer's `parseLibraryItemManifest` reads back — and this module is the one place reading them.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LibraryItemManifestSchema, type LibraryItemManifest } from '@sj/shared'
import type { AssetCodex } from '../codex.js'
import { libraryEntry, type LibraryEntry } from './catalog.js'
import { ICON_SUFFIX, registerLibraryEntry } from './register.js'
import { registerCommittedInteriors } from '../interiorArt.js'

export const ITEMS_CONTENT_DIR = fileURLToPath(new URL('../../content/items', import.meta.url))

export type CommittedItem = {
  kind: string
  entry: LibraryEntry
  manifest: LibraryItemManifest
  sprite: Buffer
  icon: Buffer
}

/** Every committed item, in kind order. A directory missing any of its three files is an
 *  ERROR, not a skip: half an item on disk is how art goes quietly missing. */
export function listCommittedItems(root: string = ITEMS_CONTENT_DIR): CommittedItem[] {
  if (!existsSync(root)) return []
  const out: CommittedItem[] = []
  for (const kind of readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const base = join(root, kind)
    const paths = {
      manifest: join(base, 'manifest.json'),
      sprite: join(base, 'sprite.png'),
      icon: join(base, 'icon.png'),
    }
    for (const [name, p] of Object.entries(paths)) {
      if (!existsSync(p)) throw new Error(`items/${kind}: ${name} is missing`)
    }
    const manifest = LibraryItemManifestSchema.parse(JSON.parse(readFileSync(paths.manifest, 'utf8')))
    if (manifest.kind !== kind) throw new Error(
      `items/${kind}: manifest kind "${manifest.kind}" belongs in items/${manifest.kind}`)
    // The catalog is the specification and the content is the answer to it: content for a kind
    // the catalog does not carry would ship as a row nothing can ever resolve.
    const entry = libraryEntry(kind)
    if (entry === null) throw new Error(`items/${kind}: no LIBRARY entry — the catalog does not carry this kind`)
    if (manifest.category !== entry.category) throw new Error(
      `items/${kind}: manifest category "${manifest.category}" is not the catalog's "${entry.category}"`)
    out.push({
      kind, entry, manifest,
      sprite: readFileSync(paths.sprite), icon: readFileSync(paths.icon),
    })
  }
  return out
}

export type ItemIngestEntry = { kind: string; action: 'registered' | 'unchanged'; id: string }

function latestItem(codex: AssetCodex, kind: string) {
  return codex.listSince(0)
    .filter((r) => r.status === 'ready' && r.class === 'item' && r.kind === kind).at(-1) ?? null
}

/** Idempotent: unchanged sprite bytes register nothing, and regenerated art gets a new record that
 *  wins by seq. Registration is free — the generation booked its own spend when it was paid for. */
export function registerCommittedItems(
  codex: AssetCodex, opts: { root?: string; interiorRoot?: string } = {},
): ItemIngestEntry[] {
  // The gateway's terrain ingest short-circuits once every terrain kind exists, so a resumed town
  // would never see a piece added later; this ingest is idempotent per item and always runs.
  const out: ItemIngestEntry[] = registerCommittedInteriors(codex, { root: opts.interiorRoot })
  for (const item of listCommittedItems(opts.root)) {
    const existing = latestItem(codex, item.kind)
    if (existing !== null) {
      const stored = codex.get(existing.id)
      if (stored !== null && stored.png.equals(item.sprite)
        && codex.listSince(0).some((r) => r.kind === `${item.kind}${ICON_SUFFIX}`)) {
        out.push({ kind: item.kind, action: 'unchanged', id: existing.id })
        continue
      }
    }
    const { spriteRecord } = registerLibraryEntry(codex, item.entry, {
      sprite: item.sprite, icon: item.icon, score: null, attempts: 1, costUsd: 0,
    })
    out.push({ kind: item.kind, action: 'registered', id: spriteRecord.id })
  }
  return out
}
