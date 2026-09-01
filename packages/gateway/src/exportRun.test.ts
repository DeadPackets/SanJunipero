import { PassThrough } from 'node:stream'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from '@sj/engine/store'
import { writeRunTar, type RunManifest } from './exportRun.js'

const dir = mkdtempSync(join(tmpdir(), 'sj-export-'))
const WORLD = join(dir, 'world.db')
const MINDS = join(dir, 'minds')

function untar(tar: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = tar
      .subarray(at, at + 100)
      .toString('utf8')
      .replace(/\0.*$/, '')
    if (name === '') break
    const size = parseInt(
      tar
        .subarray(at + 124, at + 136)
        .toString('utf8')
        .replace(/\0.*$/, ''),
      8,
    )
    out.set(name, tar.subarray(at + 512, at + 512 + size))
    at += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

async function exported(): Promise<{ files: Map<string, Buffer>; manifest: RunManifest }> {
  const sink = new PassThrough()
  const chunks: Buffer[] = []
  sink.on('data', (c: Buffer) => chunks.push(c))
  const manifest = await writeRunTar(sink, {
    worldDbPath: WORLD,
    mindsDir: MINDS,
    config: { seed: 'g6' },
  })
  sink.end()
  await new Promise((r) => sink.on('end', r))
  return { files: untar(Buffer.concat(chunks)), manifest }
}

beforeAll(() => {
  const world = openDb(WORLD)
  world.exec(
    'CREATE TABLE world_meta (id INTEGER PRIMARY KEY CHECK (id = 1),' +
      ' map TEXT NOT NULL, rings INTEGER NOT NULL, seed TEXT NOT NULL)',
  )
  world.exec("INSERT INTO world_meta (id, map, rings, seed) VALUES (1, 'showcase', 3, 'g6')")
  const put = world.prepare('INSERT INTO events (tick, type, payload) VALUES (?, ?, ?)')
  for (let tick = 1; tick <= 1500; tick++) put.run(tick, 'tick_advanced', '{}')
  world.close()

  mkdirSync(MINDS, { recursive: true })
  for (const name of ['amara.db', '_ops.db', '_arbiter.db']) {
    const db = openDb(join(MINDS, name))
    db.close()
  }
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the replication export', () => {
  it('★ carries the world, every mind db, the config and a manifest', async () => {
    const { files } = await exported()
    expect([...files.keys()].sort()).toEqual([
      'run/config.json',
      'run/manifest.json',
      'run/minds/_arbiter.db',
      'run/minds/_ops.db',
      'run/minds/amara.db',
      'run/world.db',
    ])
    expect(JSON.parse(files.get('run/config.json')!.toString())).toEqual({ seed: 'g6' })
    // A sqlite file, not a torn WAL copy: the header is the format's own.
    expect(files.get('run/world.db')!.subarray(0, 15).toString()).toBe('SQLite format 3')
  })

  it('the manifest says which world, at which day, and what it packed', async () => {
    const { files, manifest } = await exported()
    expect(manifest.world).toMatchObject({ map: 'showcase', rings: 3, seed: 'g6' })
    expect(manifest.tick).toBe(1500)
    expect(manifest.day).toBe(1)
    expect(manifest.events).toBe(1500)
    expect(manifest.files.map((f) => f.path)).toContain('minds/amara.db')
    // The manifest is written last and still names itself correctly to a reader.
    const onDisk = JSON.parse(files.get('run/manifest.json')!.toString()) as RunManifest
    expect(onDisk.files).toEqual(manifest.files)
  })

  /** Every db used to be `serialize()`d into a Buffer and pushed at the writer whatever it said,
   *  so peak memory was the export's own size on the thread that ticks the town. */
  it('★ waits for the reader instead of pushing the whole run at it', async () => {
    const sink = new PassThrough({ highWaterMark: 512 })
    let finished = false
    const run = writeRunTar(sink, {
      worldDbPath: WORLD,
      mindsDir: MINDS,
      config: { seed: 'g6' },
    }).then(() => {
      finished = true
    })
    await new Promise((r) => setTimeout(r, 100))
    expect(finished, 'a reader that has read nothing cannot have been handed the whole tar').toBe(
      false,
    )
    expect(sink.readableLength).toBeLessThan(200_000)
    sink.resume()
    await run
  })

  it('names the code that folded the events when the image was stamped', async () => {
    expect((await exported()).manifest.gitSha).toBeNull()
    process.env.SJ_GIT_SHA = 'deadbeef'
    try {
      expect((await exported()).manifest.gitSha).toBe('deadbeef')
    } finally {
      delete process.env.SJ_GIT_SHA
    }
  })
})
