import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { CHRONICLE_ICONS, DEFAULT_CONFIG, MomentsResponseSchema, type ChronicleEntry } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { NARRATOR_READ_TABLES, createGateway, type Gateway } from './index.js'

// @sj/narrator depends on @sj/agents (onnxruntime, transformers) and the gateway must not
// carry that weight to run four SELECTs — the same call api.test.ts makes for agent memory.
// The DDL below is copied from packages/narrator/src/schema.ts, and the last test in this
// file reads that file and fails if the columns ever move.
function openNarratorFixtureDb(path: string): Database.Database {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL, start_tick INTEGER NOT NULL,
      end_tick INTEGER NOT NULL, event_ids TEXT NOT NULL, "cast" TEXT NOT NULL, location TEXT);
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, day INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
      text TEXT NOT NULL, citations TEXT NOT NULL, scene_ids TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      event_seq INTEGER NOT NULL, day INTEGER NOT NULL, tick INTEGER NOT NULL);
  `)
  return db
}

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0 as TileId))

function scriptedWorld(dbPath: string): Database.Database {
  const db = openDb(dbPath)
  const loop = new TickLoop({
    store: new EventStore(db),
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('narrator-api-test'),
    snapshotEveryTicks: 25,
    onTick: ({ tick, emit }) => {
      if (tick === 1) {
        emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: 7300 })
        emit('agent_spawned', { id: 'bob', name: 'Bob', x: 0, y: 1, ageDays: 7300 })
        emit('agent_spawned', { id: 'cara', name: 'Cara', x: 5, y: 5, ageDays: 7300 })
      }
      if (tick === 5) emit('agent_spoke', { agentId: 'alice', text: 'Morning.', x: 0, y: 0 })
      if (tick === 10) {
        emit('structure_planned', {
          id: 's1', kind: 'hut', x: 2, y: 2, w: 1, h: 1, maxHp: 50, flammable: true, builderId: 'bob',
        })
      }
      if (tick === 20) emit('structure_completed', { id: 's1' })
      if (tick === 30) emit('co_slept', { aId: 'alice', bId: 'bob', day: 0 })
      if (tick === 40) emit('fire_ignited', { structureId: 's1', cause: 'hearth' })
      if (tick === 50) emit('agent_died', { agentId: 'cara', cause: 'hunger' })
      if (tick === 60) emit('mystery_event', { kind: 'far_bell' })
    },
  })
  for (let i = 0; i < 70; i++) loop.step()
  return db
}

describe('narrator-backed observer apis, with a narrator.db', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-narrapi-'))
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = scriptedWorld(dbPath)

    const narratorPath = join(dir, 'narrator.db')
    const ndb = openNarratorFixtureDb(narratorPath)
    ndb.prepare('INSERT INTO chapters (day, title, text, citations, scene_ids) VALUES (?, ?, ?, ?, ?)')
      .run(0, 'The First Morning', 'They woke.', '[]', '[]')
    ndb.prepare('INSERT INTO chapters (day, title, text, citations, scene_ids) VALUES (?, ?, ?, ?, ?)')
      .run(1, 'What the Fire Took', 'It burned.', '[]', '[]')
    ndb.prepare('INSERT INTO milestones (kind, label, event_seq, day, tick) VALUES (?, ?, ?, ?, ?)')
      .run('first_death', 'The first death', 9000, 0, 50)
    const scene = ndb.prepare(
      'INSERT INTO scenes (day, start_tick, end_tick, event_ids, "cast", location) VALUES (?, ?, ?, ?, ?, ?)',
    )
    scene.run(0, 10, 60, '[1,2]', '["alice","bob"]', 'the plaza')
    scene.run(1, 1440, 1500, '[3]', '["cara"]', null)
    scene.run(2, 2880, 2900, '[]', '[]', 'the riverbank')   // a day with no chapter written
    ndb.close()

    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db, narratorDbPath: narratorPath })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const chronicle = async (query = ''): Promise<ChronicleEntry[]> => {
    const res = await fetch(`${base}/api/chronicle${query}`)
    expect(res.status).toBe(200)
    return ((await res.json()) as { entries: ChronicleEntry[] }).entries
  }

  it('keeps only what the town would remember, in the order it happened', async () => {
    const entries = await chronicle()
    expect(entries.map((e) => [e.tick, e.type])).toEqual([
      [20, 'structure_completed'],
      [30, 'co_slept'],
      [40, 'fire_ignited'],
      [50, 'agent_died'],
      [50, 'first'],
      [60, 'mystery_event'],
    ])
  })

  it('writes each entry as a sentence, never as a payload', async () => {
    const byType = new Map((await chronicle()).map((e) => [e.type, e.label]))
    expect(byType.get('structure_completed')).toBe('The hut is finished.')
    expect(byType.get('co_slept')).toBe('Alice and Bob kept house together.')
    expect(byType.get('fire_ignited')).toBe('Fire! The hut is burning.')
    expect(byType.get('agent_died')).toBe('Cara starved.')
    expect(byType.get('first')).toBe('The first death')
  })

  it('tells a mystery in the engine’s authored prose', async () => {
    const mystery = (await chronicle()).find((e) => e.type === 'mystery_event')
    expect(mystery?.label).toBe('A bell rings once, very far off. Nobody here owns a bell.')
  })

  it('carries the icon for each type, and the spark for a first', async () => {
    for (const e of await chronicle()) {
      expect(e.icon, e.type).toBe(e.type === 'first' ? 'spark' : CHRONICLE_ICONS[e.type])
    }
  })

  it('never lets the everyday through — no speech, no plans, no moves', async () => {
    const types = new Set((await chronicle()).map((e) => e.type))
    for (const noise of ['agent_spoke', 'structure_planned', 'agent_moved', 'tick_advanced', 'agent_spawned']) {
      expect(types.has(noise), noise).toBe(false)
    }
  })

  it('narrows to a tick window when asked', async () => {
    expect((await chronicle('?fromTick=30&toTick=45')).map((e) => e.type)).toEqual(['co_slept', 'fire_ignited'])
    expect(await chronicle('?fromTick=1000&toTick=2000')).toEqual([])
  })

  it('reads the real chapters C7 wrote, not the empty stub it replaces', async () => {
    expect(await (await fetch(`${base}/api/chapters`)).json()).toEqual([
      { day: 0, title: 'The First Morning' },
      { day: 1, title: 'What the Fire Took' },
    ])
  })

  it('reads the firsts ledger', async () => {
    expect(await (await fetch(`${base}/api/milestones`)).json()).toEqual([
      { kind: 'first_death', label: 'The first death', day: 0, tick: 50 },
    ])
  })

  it('turns C7’s recorded scenes into moments a viewer can open', async () => {
    const body = MomentsResponseSchema.parse(await (await fetch(`${base}/api/moments`)).json())
    expect(body.moments).toEqual([
      {
        id: 1, day: 0, startTick: 10, endTick: 60,
        title: 'The First Morning', cast: ['alice', 'bob'], location: 'the plaza',
      },
      { id: 2, day: 1, startTick: 1440, endTick: 1500, title: 'What the Fire Took', cast: ['cara'], location: null },
      // no chapter for day 2 — the day still exists, it just has no name yet
      { id: 3, day: 2, startTick: 2880, endTick: 2900, title: 'Day 2', cast: [], location: 'the riverbank' },
    ])
  })
})

describe('narrator-backed observer apis, before a single day is narrated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-narrapi-bare-'))
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = scriptedWorld(dbPath)
    // narratorDbPath points at a file that was never written — the ordinary early-town case
    gw = await createGateway({
      dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db, narratorDbPath: join(dir, 'absent.db'),
    })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('answers with typed empties rather than an error', async () => {
    for (const path of ['/api/chapters', '/api/milestones']) {
      const res = await fetch(`${base}${path}`)
      expect(res.status, path).toBe(200)
      expect(await res.json(), path).toEqual([])
    }
    const moments = await fetch(`${base}/api/moments`)
    expect(moments.status).toBe(200)
    expect(MomentsResponseSchema.parse(await moments.json()).moments).toEqual([])
  })

  it('still keeps the chronicle — the events are the town’s, not the narrator’s', async () => {
    const res = await fetch(`${base}/api/chronicle`)
    const entries = ((await res.json()) as { entries: ChronicleEntry[] }).entries
    expect(entries.map((e) => e.type)).toEqual([
      'structure_completed', 'co_slept', 'fire_ignited', 'agent_died', 'mystery_event',
    ])
  })
})

describe('the one-way glass the gateway reads through', () => {
  it('selects only columns the narrator schema actually declares', () => {
    const schema = readFileSync(
      fileURLToPath(new URL('../../narrator/src/schema.ts', import.meta.url)), 'utf8',
    )
    for (const [table, columns] of Object.entries(NARRATOR_READ_TABLES)) {
      expect(schema, table).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
      for (const col of columns) expect(schema, `${table}.${col}`).toContain(col)
    }
  })
})
