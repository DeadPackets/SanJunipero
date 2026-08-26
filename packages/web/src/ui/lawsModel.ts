import type { SimConfig, SimEvent } from '@sj/shared'
// The subpath, never the index: `@sj/engine` re-exports db.ts, which imports better-sqlite3
// at module scope and throws in a browser before React mounts. browserGraph.test.ts pins it.
import { TOGGLABLE_PATHS } from '@sj/engine/laws'

export const ADMIN_TOKEN_KEY = 'sj.adminToken'
export const ADMIN_LAWS_ROUTE = '/admin/laws'

export type LawChange = { tick: number; path: string; value: unknown }
export type LawRow = { path: string; value: unknown; overridden: boolean; history: LawChange[] }
export type LawKind = 'boolean' | 'number' | 'other'
export type EditRow = LawRow & { kind: LawKind; editable: boolean }

export const LAW_PATHS: readonly string[] = Object.keys(TOGGLABLE_PATHS).sort()

// The event log is the truth. A law's history is read out of the deltas the
// viewer received, never out of anything the panel did or hoped for.
export function lawChangesFrom(events: readonly SimEvent[]): LawChange[] {
  const out: LawChange[] = []
  for (const ev of events) {
    if (ev.type !== 'config_changed') continue
    const p = ev.payload as { path?: unknown; value?: unknown }
    if (typeof p.path !== 'string') continue
    out.push({ tick: ev.tick, path: p.path, value: p.value })
  }
  return out
}

function configValueAt(config: SimConfig | null, path: string): unknown {
  if (config === null) return undefined
  let node: unknown = config
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

export function lawRows(
  config: SimConfig | null,
  laws: Record<string, unknown>,
  history: readonly LawChange[],
): LawRow[] {
  return LAW_PATHS.map((path) => ({
    path,
    value: path in laws ? laws[path] : configValueAt(config, path),
    overridden: path in laws,
    history: history.filter((h) => h.path === path),
  }))
}

export function formatLawValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

// The whitelist carries each law's schema, so the control a law needs is a
// question for the schema, not a second table that can drift from it.
export function lawKind(path: string): LawKind {
  const schema = TOGGLABLE_PATHS[path]
  if (schema === undefined) return 'other'
  if (schema.safeParse(true).success) return 'boolean'
  if (schema.safeParse(0.5).success || schema.safeParse(1).success) return 'number'
  return 'other'
}

export function editRows(rows: readonly LawRow[], token: string | null): EditRow[] {
  const usable = token !== null && token.trim().length > 0
  return rows.map((row) => {
    const kind = lawKind(row.path)
    return { ...row, kind, editable: usable && kind !== 'other' }
  })
}

export function adminToken(storage: { getItem(key: string): string | null }): string | null {
  try {
    const raw = storage.getItem(ADMIN_TOKEN_KEY)
    const token = raw === null ? '' : raw.trim()
    return token.length === 0 ? null : token
  } catch {
    return null
  }
}

export type PostLawResult = { ok: true } | { ok: false; message: string }
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

// Optimistic UI is forbidden here: this returns whether the channel accepted the
// change, never the change itself. The value moves when the delta arrives.
export async function postLaw(
  fetchFn: FetchLike,
  opts: { endpoint: string; token: string; path: string; value: unknown },
): Promise<PostLawResult> {
  let res: Response
  try {
    res = await fetchFn(`${opts.endpoint}${ADMIN_LAWS_ROUTE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.token}` },
      body: JSON.stringify({ path: opts.path, value: opts.value }),
    })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
  const text = await res.text()
  if (res.status === 202) return { ok: true }
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === 'string') return { ok: false, message: parsed.error }
  } catch {
    /* the channel spoke plainly; pass its words through */
  }
  return { ok: false, message: text }
}
