import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import Database from 'better-sqlite3'
import { MINUTES_PER_DAY } from '@sj/shared'

/** What a replay elsewhere needs; see `deploy/README.md`. */
export type ExportOpts = {
  worldDbPath: string
  /** `<id>.db` per mind, plus `_ops.db`, `_arbiter.db` and `_narrator.db`. */
  mindsDir: string
  /** The `SimConfig` the world folds with — code, not a table, so it travels as its own file. */
  config: unknown
}

export type RunManifest = {
  /** `SJ_GIT_SHA`, or null when the operator did not stamp the image. */
  gitSha: string | null
  /** `world_meta`: the map, its ring count and the rng seed. */
  world: Record<string, unknown> | null
  tick: number
  day: number
  events: number
  takenAt: string
  files: { path: string; bytes: number }[]
}

const BLOCK = 512
const ROOT = 'run/'

const octal = (n: number, width: number): string => n.toString(8).padStart(width - 1, '0') + '\0'

/** A ustar header. Hand-rolled because a replication export must not add a dependency to the
 *  serving process, and the format is one 512-byte block. */
function tarHeader(name: string, bytes: number, mtimeMs: number): Buffer {
  const head = Buffer.alloc(BLOCK)
  head.write(name, 0, 100, 'utf8')
  head.write('0000644\0', 100, 8, 'utf8')
  head.write('0000000\0', 108, 8, 'utf8')
  head.write('0000000\0', 116, 8, 'utf8')
  head.write(octal(bytes, 12), 124, 12, 'utf8')
  head.write(octal(Math.floor(mtimeMs / 1000), 12), 136, 12, 'utf8')
  head.write('        ', 148, 8, 'utf8') // the checksum field reads as spaces while it is summed
  head.write('0', 156, 1, 'utf8')
  head.write('ustar\0', 257, 6, 'utf8')
  head.write('00', 263, 2, 'utf8')
  let sum = 0
  for (const b of head) sum += b
  head.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')
  return head
}

function writeEntry(out: Writable, name: string, body: Buffer, mtimeMs: number): void {
  out.write(tarHeader(name, body.length, mtimeMs))
  out.write(body)
  const pad = (BLOCK - (body.length % BLOCK)) % BLOCK
  if (pad > 0) out.write(Buffer.alloc(pad))
}

/** A consistent copy of a database that is being written to. `serialize()` reads it under one
 *  transaction; copying the file bytes would tear against the WAL. */
function snapshotDb(path: string): Buffer {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    return db.serialize()
  } finally {
    db.close()
  }
}

function readWorld(
  path: string,
): Pick<RunManifest, 'world' | 'tick' | 'events'> & { bytes: Buffer } {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    // `seq` is an autoincrementing primary key and no row is ever deleted, so its max IS the count.
    const head = db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS events, COALESCE(MAX(tick), 0) AS tick FROM events')
      .get() as { events: number; tick: number }
    // A world db with no `world_meta` still exports; it cannot say which map it was platted on.
    let world: RunManifest['world'] = null
    try {
      world = (db.prepare('SELECT map, rings, seed FROM world_meta WHERE id = 1').get() ??
        null) as RunManifest['world']
    } catch {
      /* no such table: an older world, or one this process never platted */
    }
    return { world, ...head, bytes: db.serialize() }
  } finally {
    db.close()
  }
}

/** Ordering inside a tar carries no meaning, so the manifest is written last, sizes and all. */
export function writeRunTar(out: Writable, opts: ExportOpts): RunManifest {
  const now = Date.now()
  const files: RunManifest['files'] = []
  const put = (path: string, body: Buffer): void => {
    files.push({ path, bytes: body.length })
    writeEntry(out, ROOT + path, body, now)
  }

  const { bytes, ...world } = readWorld(opts.worldDbPath)
  put('world.db', bytes)
  let minds: string[] = []
  try {
    minds = readdirSync(opts.mindsDir)
      .filter((n) => n.endsWith('.db'))
      .sort()
  } catch {
    /* a scripted stream has no minds directory */
  }
  for (const name of minds) put(`minds/${name}`, snapshotDb(join(opts.mindsDir, name)))
  put('config.json', Buffer.from(JSON.stringify(opts.config, null, 2)))

  const manifest: RunManifest = {
    gitSha: process.env.SJ_GIT_SHA ?? null,
    ...world,
    day: Math.floor(world.tick / MINUTES_PER_DAY),
    takenAt: new Date(now).toISOString(),
    files,
  }
  writeEntry(out, `${ROOT}manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), now)
  out.write(Buffer.alloc(BLOCK * 2)) // two zero blocks end a tar
  return manifest
}
