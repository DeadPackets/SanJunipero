import { createReadStream, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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

/** `write()` returning false is the only backpressure a socket gives, and an export the reader
 *  is not keeping up with is otherwise held whole in the serving process's memory. */
async function put(out: Writable, buf: Buffer): Promise<void> {
  if (!out.write(buf)) await once(out, 'drain')
}

const padding = (bytes: number): number => (BLOCK - (bytes % BLOCK)) % BLOCK

async function writeEntry(
  out: Writable,
  name: string,
  body: Buffer,
  mtimeMs: number,
): Promise<void> {
  await put(out, tarHeader(name, body.length, mtimeMs))
  await put(out, body)
  const pad = padding(body.length)
  if (pad > 0) await put(out, Buffer.alloc(pad))
}

async function writeFileEntry(
  out: Writable,
  name: string,
  file: string,
  mtimeMs: number,
): Promise<number> {
  const bytes = statSync(file).size
  await put(out, tarHeader(name, bytes, mtimeMs))
  await pipeline(createReadStream(file), out, { end: false })
  const pad = padding(bytes)
  if (pad > 0) await put(out, Buffer.alloc(pad))
  return bytes
}

/** A consistent copy of a database that is being written to, taken to disk rather than to a
 *  Buffer: `serialize()` is the whole file in memory, on the thread that ticks the town. */
async function snapshotDb(path: string, into: string): Promise<string> {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    await db.backup(into)
    return into
  } finally {
    db.close()
  }
}

function readWorld(path: string): Pick<RunManifest, 'world' | 'tick' | 'events'> {
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
    return { world, ...head }
  } finally {
    db.close()
  }
}

/** Ordering inside a tar carries no meaning, so the manifest is written last, sizes and all. */
export async function writeRunTar(out: Writable, opts: ExportOpts): Promise<RunManifest> {
  const now = Date.now()
  const files: RunManifest['files'] = []
  const scratch = await mkdtemp(join(tmpdir(), 'sj-run-'))
  try {
    const snapOf = (source: string): Promise<string> =>
      snapshotDb(source, join(scratch, `${files.length}.db`))
    const putSnapshot = async (path: string, snap: string): Promise<void> => {
      files.push({ path, bytes: await writeFileEntry(out, ROOT + path, snap, now) })
      await rm(snap, { force: true }) // peak disk is one database, not the whole run
    }

    // Read from the copy that ships, not from a live world that has ticked past it.
    const worldSnap = await snapOf(opts.worldDbPath)
    const world = readWorld(worldSnap)
    await putSnapshot('world.db', worldSnap)
    let minds: string[] = []
    try {
      minds = readdirSync(opts.mindsDir)
        .filter((n) => n.endsWith('.db'))
        .sort()
    } catch {
      /* a scripted stream has no minds directory */
    }
    for (const name of minds)
      await putSnapshot(`minds/${name}`, await snapOf(join(opts.mindsDir, name)))

    const config = Buffer.from(JSON.stringify(opts.config, null, 2))
    files.push({ path: 'config.json', bytes: config.length })
    await writeEntry(out, `${ROOT}config.json`, config, now)

    const manifest: RunManifest = {
      gitSha: process.env.SJ_GIT_SHA ?? null,
      ...world,
      day: Math.floor(world.tick / MINUTES_PER_DAY),
      takenAt: new Date(now).toISOString(),
      files,
    }
    await writeEntry(
      out,
      `${ROOT}manifest.json`,
      Buffer.from(JSON.stringify(manifest, null, 2)),
      now,
    )
    await put(out, Buffer.alloc(BLOCK * 2)) // two zero blocks end a tar
    return manifest
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
