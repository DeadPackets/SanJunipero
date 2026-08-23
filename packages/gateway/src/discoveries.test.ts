import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DEFAULT_CONFIG, DiscoveryResponseSchema, type DiscoveryRecord } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { createGateway, type Gateway } from './index.js'

const GRASS: TileId[][] = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => 0 as TileId))

const D1 = {
  recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
  byId: 'a1', intent: 'i want to carry water in a stitched hide', makes: ['waterskin'],
}
const D2 = {
  recipeId: 'express:dance', name: 'dance', kind: 'word',
  byId: 'a2', intent: 'i want to dance by the fire', makes: [],
}

// Two people who worked two things out, one a craft and one a word. The names matter: the
// archive resolves an id to a NAME, and a fixture with no names could not tell the two apart.
function scriptedWorld(dbPath: string, withDiscoveries: boolean): Database.Database {
  const db = openDb(dbPath)
  const loop = new TickLoop({
    store: new EventStore(db),
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('discoveries-test'),
    snapshotEveryTicks: 50,
    onTick: ({ tick, emit }) => {
      if (tick === 1) {
        emit('agent_spawned', { id: 'a1', name: 'Maret', x: 0, y: 0, ageDays: 7300 })
        emit('agent_spawned', { id: 'a2', name: 'Sena', x: 1, y: 0, ageDays: 7300 })
      }
      if (!withDiscoveries) return
      if (tick === 40) emit('discovery_made', D1)
      if (tick === 90) emit('discovery_made', D2)
    },
  })
  for (let i = 0; i < 100; i++) loop.step()
  return db
}

describe('the archive — every discovery, in order, with its credit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-discoveries-'))
  let gw: Gateway
  let base: string
  let dbPath: string

  beforeAll(async () => {
    dbPath = join(dir, 'world.db')
    const db = scriptedWorld(dbPath, true)
    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const get = async (): Promise<DiscoveryRecord[]> => {
    const res = await fetch(`${base}/api/discoveries`)
    expect(res.status).toBe(200)
    return DiscoveryResponseSchema.parse(await res.json()).discoveries
  }

  it('serves both, oldest first', async () => {
    const rows = await get()
    expect(rows.map((r) => r.recipeId)).toEqual(['recipe:waterskin', 'express:dance'])
    expect(rows.map((r) => r.tick)).toEqual([40, 90])
  })

  it('answers all four questions: who, when, from what, and what it unlocked', async () => {
    const [first] = await get()
    expect(first!.byId).toBe('a1')
    expect(first!.by).toBe('Maret')             // resolved to a NAME, not an id
    expect(first!.by).not.toBe(first!.byId)
    expect(first!.tick).toBe(40)
    expect(first!.intent).toBe(D1.intent)       // the mind's own words, viewer-side only
    expect(first!.makes).toEqual(['waterskin'])
  })

  it('tells a craft from a word', async () => {
    expect((await get()).map((r) => r.kind)).toEqual(['craft', 'word'])
  })

  it('SURVIVES A REVERT — the archive reads the log, and the log has no revert path', async () => {
    // A revert is an UPDATE on `rulebook`, in the ARBITER's database. This package has no
    // dependency on @sj/arbiter and must not grow one — that is the §2 seam, and importing it
    // here to stage the revert would put the ops plane one line from the viewer's wire. So the
    // property is proved from this side instead: the only way a record could be lost is a
    // DELETE on the world log, and there is no writer that could issue one.
    const world = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      expect(() => world.prepare('DELETE FROM events WHERE type = ?').run('discovery_made'))
        .toThrow(/readonly/i)
      const tables = (world.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>).map((t) => t.name)
      expect(tables).toContain('events')
      expect(tables).not.toContain('rulebook')   // the ops plane is not in this database at all
      expect(tables).not.toContain('rulings')
    } finally {
      world.close()
    }
    const rows = await get()
    expect(rows.map((r) => r.recipeId)).toContain('recipe:waterskin')
    expect(rows.find((r) => r.recipeId === 'recipe:waterskin')!.by).toBe('Maret')
  })

  it('answers [] on a world that has invented nothing, never a 500', async () => {
    const bareDir = mkdtempSync(join(tmpdir(), 'sj-discoveries-bare-'))
    const barePath = join(bareDir, 'world.db')
    const bareDb = scriptedWorld(barePath, false)
    const bare = await createGateway({
      dbPath: barePath, port: 0, terrain: GRASS, pollMs: 3_600_000, db: bareDb,
    })
    try {
      const res = await fetch(`http://127.0.0.1:${bare.port}/api/discoveries`)
      expect(res.status).toBe(200)
      expect(DiscoveryResponseSchema.parse(await res.json()).discoveries).toEqual([])
    } finally {
      await bare.close()
      rmSync(bareDir, { recursive: true, force: true })
    }
  })

  it('never opens the arbiter’s database — the ops plane stays off the viewer’s wire', () => {
    const src = readFileSync(new URL('./discoveries.ts', import.meta.url), 'utf8').toLowerCase()
    for (const forbidden of ['rulebook', 'openarbiterdb', 'arbiter', 'rulings', 'codex']) {
      expect(src, forbidden).not.toContain(forbidden)
    }
    // Not vacuous: the file exists, is non-trivial, and does serve from the world log.
    expect(src.length).toBeGreaterThan(400)
    expect(src).toContain('from events where type')
  })
})
