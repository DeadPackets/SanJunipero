import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  ADULT_AGE_DAYS,
  CHRONICLE_ICONS,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  MomentsResponseSchema,
  type ChronicleEntry,
} from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { NARRATOR_DDL, NARRATOR_READ_TABLES } from '@sj/shared/narratorSchema'
import { CHRONICLE_MAX } from './narratorApi.js'
import { createGateway, type Gateway } from './server.js'

// The narrator's own DDL, not a copy of it — importing @sj/narrator would drag @sj/llm and
// the `ai` SDK in.
function openNarratorFixtureDb(path: string): Database.Database {
  const db = new Database(path)
  db.exec(NARRATOR_DDL)
  return db
}

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0))

function scriptedWorld(dbPath: string, withDiscoveries = true): Database.Database {
  const db = openDb(dbPath)
  const loop = new TickLoop({
    store: new EventStore(db),
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('narrator-api-test'),
    snapshotEveryTicks: 25,
    onTick: ({ tick, emit }) => {
      if (tick === 1) {
        emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        emit('agent_spawned', { id: 'bob', name: 'Bob', x: 0, y: 1, ageDays: ADULT_AGE_DAYS })
        emit('agent_spawned', { id: 'cara', name: 'Cara', x: 5, y: 5, ageDays: ADULT_AGE_DAYS })
      }
      if (tick === 5) emit('agent_spoke', { agentId: 'alice', text: 'Morning.', x: 0, y: 0 })
      if (tick === 10) {
        emit('structure_planned', {
          id: 's1',
          kind: 'house',
          x: 2,
          y: 2,
          w: 1,
          h: 1,
          maxHp: 50,
          flammable: true,
          builderId: 'bob',
        })
      }
      if (tick === 20) emit('structure_completed', { id: 's1' })
      if (tick === 30) emit('co_slept', { aId: 'alice', bId: 'bob', day: 0 })
      if (tick === 40) emit('fire_ignited', { structureId: 's1', cause: 'hearth' })
      if (tick === 50) emit('agent_died', { agentId: 'cara', cause: 'hunger' })
      if (tick === 60) emit('mystery_event', { kind: 'far_bell' })
      if (!withDiscoveries) return
      if (tick === 40) {
        emit('discovery_made', {
          recipeId: 'recipe:waterskin',
          name: 'stitch a waterskin',
          kind: 'craft',
          byId: 'alice',
          intent: 'i want to carry water in a stitched hide',
          makes: ['waterskin'],
        })
      }
      if (tick === 90) {
        emit('discovery_made', {
          recipeId: 'express:dance',
          name: 'dance',
          kind: 'word',
          byId: 'bob',
          intent: 'i want to dance by the fire',
          makes: [],
        })
      }
    },
  })
  for (let i = 0; i < 100; i++) loop.step()
  return db
}

describe('narrator-backed observer apis, with a narrator.db', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-narrapi-'))
  const narratorPath = join(dir, 'narrator.db')
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = scriptedWorld(dbPath)

    const ndb = openNarratorFixtureDb(narratorPath)
    ndb
      .prepare(
        'INSERT INTO chapters (day, title, text, citations, scene_ids) VALUES (?, ?, ?, ?, ?)',
      )
      .run(0, 'The First Morning', 'They woke.', '[]', '[]')
    ndb
      .prepare(
        'INSERT INTO chapters (day, title, text, citations, scene_ids) VALUES (?, ?, ?, ?, ?)',
      )
      .run(1, 'What the Fire Took', 'It burned.', '[]', '[]')
    ndb
      .prepare(
        `INSERT INTO milestones (kind, label, event_seq, day, tick, tier, domain, agent_ids,
         construct_id, name_provenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'first_death',
        'The first death',
        9000,
        0,
        50,
        '3',
        'ritual',
        '["alice","bob"]',
        'construct_7',
        JSON.stringify({
          name: 'the Long Sit',
          sourceKind: 'speech',
          eventSeq: 8999,
          quote: 'we should call it the Long Sit',
          byId: 'alice',
        }),
      )
    const scene = ndb.prepare(
      'INSERT INTO scenes (day, start_tick, end_tick, event_ids, "cast", location) VALUES (?, ?, ?, ?, ?, ?)',
    )
    scene.run(0, 10, 60, '[1,2]', '["alice","bob"]', 'the plaza')
    scene.run(1, 1440, 1500, '[3]', '["cara"]', null)
    scene.run(2, 2880, 2900, '[]', '[]', 'the riverbank') // a day with no chapter written
    const publish = ndb.prepare(
      'INSERT INTO publications (day, kind, title, body, citations, subject_id) VALUES (?, ?, ?, ?, ?, ?)',
    )
    publish.run(0, 'newspaper', 'The Fire', 'It burned all night.', null, null)
    publish.run(0, 'timelapse_caption', 'Day 0', 'Day 0: The First Morning', null, null)
    publish.run(0, 'biography', 'Alice', 'A first draft.', null, 'alice')
    publish.run(1, 'biography', 'Alice, who woke first', 'She was seen early.', null, 'alice')
    ndb
      .prepare(
        'INSERT INTO eras (start_day, end_day, title, text, citations, chapter_ids) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(0, 6, 'The First Week', 'Seven days.', '[]', '[]')
    ndb
      .prepare(
        `INSERT INTO institutions (kind, name, description, founding_scene_id, member_ids, source_event_ids)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('group', 'the morning watch', 'They rose together.', 1, '["alice","bob"]', '[]')
    ndb
      .prepare(
        `INSERT INTO heat_scores (scene_id, conflict, novelty, firsts, stakes, dramatic_irony, total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 1, 2, 3, 2, 1, 9)
    ndb.close()

    gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      narratorDbPath: narratorPath,
    })
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
      [40, 'discovery_made'],
      [50, 'agent_died'],
      [50, 'first'],
      [60, 'mystery_event'],
      [90, 'discovery_made'],
    ])
  })

  it('clamps a stranger’s window into the world that exists', async () => {
    expect((await chronicle('?fromTick=45')).length).toBeLessThan((await chronicle()).length)
    // an unbounded window is the world's window
    expect((await chronicle('?toTick=1000000000')).length).toBe((await chronicle()).length)
  })

  it('writes each entry as a sentence, never as a payload', async () => {
    const byType = new Map((await chronicle()).map((e) => [e.type, e.label]))
    expect(byType.get('structure_completed')).toBe('The house is finished.')
    expect(byType.get('co_slept')).toBe('Alice and Bob kept house together.')
    expect(byType.get('fire_ignited')).toBe('Fire! The house is burning.')
    expect(byType.get('agent_died')).toBe('Cara starved.')
    expect(byType.get('first')).toBe('The first death')
    // The mind's own words never reach a sentence a mind can read; the name does.
    const said = (await chronicle()).filter((e) => e.type === 'discovery_made').map((e) => e.label)
    expect(said).toEqual([
      'Alice found the way of it — stitch a waterskin.',
      'Bob gave the town a word for it — dance.',
    ])
    for (const line of said) expect(line).not.toContain('i want to')
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
    for (const noise of [
      'agent_spoke',
      'structure_planned',
      'agent_moved',
      'tick_advanced',
      'agent_spawned',
    ]) {
      expect(types.has(noise), noise).toBe(false)
    }
  })

  it('narrows to a tick window when asked', async () => {
    expect((await chronicle('?fromTick=30&toTick=45')).map((e) => e.type)).toEqual([
      'co_slept',
      'fire_ignited',
      'discovery_made',
    ])
    expect(await chronicle('?fromTick=1000&toTick=2000')).toEqual([])
  })

  it('reads the real chapters C7 wrote, prose and all', async () => {
    expect(await (await fetch(`${base}/api/chapters`)).json()).toEqual([
      { day: 0, title: 'The First Morning', text: 'They woke.' },
      { day: 1, title: 'What the Fire Took', text: 'It burned.' },
    ])
  })

  it('sends the town its own paper, its captions, its lives and its weeks', async () => {
    const body = (await (await fetch(`${base}/api/dispatches`)).json()) as Record<
      string,
      { day: number }[]
    >
    expect(body.papers).toEqual([{ day: 0, title: 'The Fire', body: 'It burned all night.' }])
    expect(body.captions).toEqual([{ day: 0, caption: 'Day 0: The First Morning' }])
    expect(body.biographies).toEqual([
      { subjectId: 'alice', day: 1, title: 'Alice, who woke first', body: 'She was seen early.' },
    ])
    expect(body.eras).toEqual([
      { startDay: 0, endDay: 6, title: 'The First Week', text: 'Seven days.' },
    ])
    expect(body.institutions).toEqual([
      {
        day: 0,
        kind: 'group',
        name: 'the morning watch',
        description: 'They rose together.',
        // the viewer's `dispatchesFrom` reads the array; the gateway sends the row as stored
        memberIds: '["alice","bob"]',
      },
    ])
    expect(body.heat).toEqual([{ day: 0, total: 9 }])
  })

  /** The narrator writes day N's paper SECONDS into day N, after the first GET of that day has
   *  already captured a day-keyed memo — which held day N back until day N+2 began. */
  it('★ a paper written after the panel first asked still reaches it the same day', async () => {
    await fetch(`${base}/api/dispatches`) // captures the memo
    const ndb = new Database(narratorPath)
    ndb
      .prepare(
        'INSERT INTO publications (day, kind, title, body, citations, subject_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(0, 'newspaper', 'What the Night Left', 'Written while the day ran.', null, null)
    ndb.close()
    const body = (await (await fetch(`${base}/api/dispatches`)).json()) as {
      papers: { title: string }[]
    }
    expect(body.papers.map((p) => p.title)).toContain('What the Night Left')
  })

  it('reads the firsts ledger to its full width, JSON columns already parsed', async () => {
    expect(await (await fetch(`${base}/api/milestones`)).json()).toEqual([
      {
        kind: 'first_death',
        label: 'The first death',
        eventSeq: 9000,
        day: 0,
        tick: 50,
        tier: 3,
        domain: 'ritual',
        agentIds: ['alice', 'bob'],
        constructId: 'construct_7',
        nameProvenance: {
          name: 'the Long Sit',
          sourceKind: 'speech',
          eventSeq: 8999,
          quote: 'we should call it the Long Sit',
          byId: 'alice',
        },
      },
    ])
  })

  it('turns C7’s recorded scenes into moments a viewer can open', async () => {
    const body = MomentsResponseSchema.parse(await (await fetch(`${base}/api/moments`)).json())
    expect(body.moments).toEqual([
      {
        id: 1,
        day: 0,
        startTick: 10,
        endTick: 60,
        title: 'The First Morning',
        cast: ['alice', 'bob'],
        location: 'the plaza',
      },
      {
        id: 2,
        day: 1,
        startTick: 1440,
        endTick: 1500,
        title: 'What the Fire Took',
        cast: ['cara'],
        location: null,
      },
      // no chapter for day 2 — the day still exists, it just has no name yet
      {
        id: 3,
        day: 2,
        startTick: 2880,
        endTick: 2900,
        title: 'Day 2',
        cast: [],
        location: 'the riverbank',
      },
    ])
  })

  // U14 — the timeline's marks used to come from a 400-entry ring that only holds what arrived
  // since the viewer connected, so a mature world had none. They come from the record now.
  it('hands the timeline every source a mark can come from', async () => {
    const res = await fetch(`${base}/api/timeline/marks`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      throughTick: number
      chapters: { day: number; title: string }[]
      moments: { day: number; startTick: number }[]
      changes: { tick: number }[]
      events: { tick: number; type: string }[]
    }
    expect(body.throughTick).toBeGreaterThanOrEqual(60)
    // a mark is a label on a track: the titles, never the prose `/api/chapters` carries
    expect(body.chapters).toEqual([
      { day: 0, title: 'The First Morning' },
      { day: 1, title: 'What the Fire Took' },
    ])
    // the firsts are `/api/milestones`' to serve; a second copy here is a second one to keep right
    expect(body).not.toHaveProperty('milestones')
    expect(body.moments).toEqual([
      { day: 0, startTick: 10 },
      { day: 1, startTick: 1440 },
      { day: 2, startTick: 2880 },
    ])
    expect(body.changes).toEqual([]) // no agent memory dir on this world
  })

  it('sends only the events the town would remember, and nothing else', async () => {
    const body = (await (await fetch(`${base}/api/timeline/marks`)).json()) as {
      events: { tick: number; type: string }[]
    }
    expect(body.events).toEqual([
      { tick: 1, type: 'agent_spawned' },
      { tick: 1, type: 'agent_spawned' },
      { tick: 1, type: 'agent_spawned' },
      { tick: 20, type: 'structure_completed' },
      { tick: 50, type: 'agent_died' },
    ])
    for (const noise of [
      'agent_spoke',
      'agent_moved',
      'structure_planned',
      'co_slept',
      'fire_ignited',
    ]) {
      expect(
        body.events.some((e) => e.type === noise),
        noise,
      ).toBe(false)
    }
  })
})

describe('narrator-backed observer apis, before a single day is narrated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-narrapi-bare-'))
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = scriptedWorld(dbPath, false)
    // narratorDbPath points at a file that was never written — the ordinary early-town case
    gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      narratorDbPath: join(dir, 'absent.db'),
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
    const dispatches = await fetch(`${base}/api/dispatches`)
    expect(dispatches.status).toBe(200)
    for (const list of Object.values((await dispatches.json()) as Record<string, unknown>))
      expect(list).toEqual([])
    const moments = await fetch(`${base}/api/moments`)
    expect(moments.status).toBe(200)
    expect(MomentsResponseSchema.parse(await moments.json()).moments).toEqual([])
  })

  it('answers the marks endpoint with 200 and typed empties, never a 500', async () => {
    const res = await fetch(`${base}/api/timeline/marks`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.chapters).toEqual([])
    expect(body.moments).toEqual([])
    expect(body.changes).toEqual([])
    // the world's own log survives the narrator's absence — those are the town's, not C7's
    expect((body.events as unknown[]).length).toBeGreaterThan(0)
  })

  it('still keeps the chronicle — the events are the town’s, not the narrator’s', async () => {
    const res = await fetch(`${base}/api/chronicle`)
    const entries = ((await res.json()) as { entries: ChronicleEntry[] }).entries
    expect(entries.map((e) => e.type)).toEqual([
      'structure_completed',
      'co_slept',
      'fire_ignited',
      'agent_died',
      'mystery_event',
    ])
  })
})

describe('the one-way glass the gateway reads through', () => {
  it('selects only columns the narrator schema actually declares', () => {
    const db = new Database(':memory:')
    db.exec(NARRATOR_DDL)
    for (const [table, columns] of Object.entries(NARRATOR_READ_TABLES)) {
      const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      )
      expect(have, table).not.toEqual([])
      for (const col of columns) expect(have, `${table}.${col}`).toContain(col.replaceAll('"', ''))
    }
    db.close()
  })
})

describe('the scrub bar can aim at a discovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-narrapi-disc-'))
  const bareDir = mkdtempSync(join(tmpdir(), 'sj-narrapi-nodisc-'))
  let gw: Gateway, bareGw: Gateway
  let base: string, bareBase: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: scriptedWorld(dbPath),
    })
    base = `http://127.0.0.1:${gw.port}`
    const barePath = join(bareDir, 'world.db')
    bareGw = await createGateway({
      dbPath: barePath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: scriptedWorld(barePath, false),
    })
    bareBase = `http://127.0.0.1:${bareGw.port}`
  })
  afterAll(async () => {
    await gw.close()
    await bareGw.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(bareDir, { recursive: true, force: true })
  })

  it('ships discoveries as their own source, with words already in them', async () => {
    const res = await fetch(`${base}/api/timeline/marks`)
    const body = (await res.json()) as { discoveries?: { tick: number; words: string }[] }
    expect(body.discoveries).toBeDefined()
    expect(body.discoveries).toEqual([
      { tick: 40, words: 'Alice worked out stitch a waterskin' },
      { tick: 90, words: 'Bob found a word: dance' },
    ])
  })

  it('keeps the five event marks it already had, unchanged', async () => {
    const body = (await (await fetch(`${base}/api/timeline/marks`)).json()) as {
      events: { type: string }[]
    }
    expect(body.events.length).toBeGreaterThan(0)
    expect(new Set(body.events.map((e) => e.type))).not.toContain('discovery_made')
  })

  it('is a typed empty on a world that invented nothing, never absent', async () => {
    const body = (await (await fetch(`${bareBase}/api/timeline/marks`)).json()) as {
      discoveries: unknown
    }
    expect(body.discoveries).toEqual([])
  })
})

describe('the days a personality moved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-narrapi-marks-'))
  const agentDbDir = join(dir, 'minds')
  let gw: Gateway
  let base: string
  let loop: TickLoop

  const changes = async (): Promise<{ tick: number }[]> =>
    (
      (await (await fetch(`${base}/api/timeline/marks`)).json()) as {
        changes: { tick: number }[]
      }
    ).changes

  beforeAll(async () => {
    mkdirSync(agentDbDir)
    const adb = new Database(join(agentDbDir, 'alice.db'))
    adb.exec(`CREATE TABLE personality_versions (
      agent_id TEXT NOT NULL, version INTEGER NOT NULL, day INTEGER NOT NULL,
      doc TEXT NOT NULL, edit TEXT, PRIMARY KEY (agent_id, version));`)
    adb
      .prepare(
        'INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, ?)',
      )
      .run('alice', 2, 3, 'wary of fire', 'grew wary of fire')
    adb.close()

    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('marks-memo'),
      snapshotEveryTicks: 500,
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        else emit('agent_moved', { id: 'alice', x: tick % 8, y: 0 })
      },
    })
    loop.step()
    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db, agentDbDir })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Keyed on `mirror.seq()` this reopens every agent memory db from disk, on the tick thread,
   *  on essentially every 30 s-per-viewer poll. */
  it('★ does not re-open every agent memory db when only the tick moved', async () => {
    expect(await changes()).toEqual([{ tick: 3 * MINUTES_PER_DAY }])

    // The sweep's only source, taken away: a re-swept answer is [], a held one is unchanged.
    rmSync(join(agentDbDir, 'alice.db'))
    loop.step()
    gw.pump()
    expect(await changes()).toEqual([{ tick: 3 * MINUTES_PER_DAY }])
  })

  /** A day is the resolution the mark itself reports, so a day is what it may lag by — and it
   *  must actually lag by no more, or the memo is a cache that never refreshes. */
  it('re-reads them once the world reaches a new day', async () => {
    for (let i = 0; i < MINUTES_PER_DAY; i++) loop.step()
    gw.pump()
    expect(await changes()).toEqual([])
  })
})

/** How many rows the chronicle's own SELECT hands back. A stranger picks the window, so an
 *  unbounded miss is the whole weighted history formatted on the thread that ticks the town. */
function spyOnChronicleReads(db: Database.Database): number[] {
  const rows: number[] = []
  const realPrepare = db.prepare.bind(db)
  Object.defineProperty(db, 'prepare', {
    value: (sql: string) => {
      const st = realPrepare(sql) as { all: (...a: unknown[]) => unknown[] }
      if (!sql.includes('tick BETWEEN')) return st
      const realAll = st.all.bind(st)
      st.all = (...a: unknown[]): unknown[] => {
        const r = realAll(...a)
        rows.push(r.length)
        return r
      }
      return st
    },
  })
  return rows
}

describe('a town with more history than a viewer can read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-narrapi-long-'))
  let gw: Gateway
  let base: string
  let reads: number[]

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('chronicle-length'),
      snapshotEveryTicks: 100,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
          emit('agent_spawned', { id: 'bob', name: 'Bob', x: 0, y: 1, ageDays: ADULT_AGE_DAYS })
        }
        if (tick > 1) emit('co_slept', { aId: 'alice', bId: 'bob', day: tick })
      },
    })
    for (let i = 0; i < CHRONICLE_MAX * 2; i++) loop.step()
    reads = spyOnChronicleReads(db)
    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ sends the newest page, not the first N of a town nobody is watching any more', async () => {
    const entries = (
      (await (await fetch(`${base}/api/chronicle`)).json()) as { entries: ChronicleEntry[] }
    ).entries
    expect(entries.length).toBe(CHRONICLE_MAX)

    const all = (
      (await (await fetch(`${base}/api/chronicle?fromTick=0`)).json()) as {
        entries: ChronicleEntry[]
      }
    ).entries
    expect(entries[entries.length - 1]!.seq).toBe(all[all.length - 1]!.seq)
  })

  it('★ a window nobody asked for before costs one page, not the whole history', async () => {
    reads.length = 0
    await fetch(`${base}/api/chronicle?fromTick=1&toTick=999999`)
    await fetch(`${base}/api/chronicle?fromTick=2&toTick=999998`)
    expect(reads, 'a distinct window is a miss by construction').toHaveLength(2)
    for (const n of reads) expect(n).toBeLessThanOrEqual(CHRONICLE_MAX)
  })
})
