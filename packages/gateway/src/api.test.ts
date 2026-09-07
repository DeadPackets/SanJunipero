import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ADULT_AGE_DAYS,
  BondsResponseSchema,
  DEFAULT_CONFIG,
  LawsResponseSchema,
  bondId,
} from '@sj/shared'
import { LAW_FIXTURE } from '@sj/shared/testutil'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import Database from 'better-sqlite3'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createGateway, type Gateway } from './server.js'
import type { RouteHandler } from './router.js'
import { JOURNAL_MAX, mountDataApi } from './api.js'
import { WorldMirror } from './worldMirror.js'

// @sj/agents is frozen this chunk and does not export openAgentDb; DDL below is copied
// verbatim from packages/agents/src/memory/schema.ts for the four tables the API reads.
function openAgentFixtureDb(path: string): Database.Database {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      day INTEGER NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      tick INTEGER NOT NULL,
      day INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      importance INTEGER NOT NULL,
      tags TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledgers (
      agent_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      doc TEXT NOT NULL,
      updated_day INTEGER NOT NULL,
      PRIMARY KEY (agent_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS personality_versions (
      agent_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      day INTEGER NOT NULL,
      doc TEXT NOT NULL,
      edit TEXT,
      PRIMARY KEY (agent_id, version)
    );
  `)
  return db
}

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0))

describe('observer data apis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwapi-'))
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('api-test'),
      snapshotEveryTicks: 25,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          // Alice and Bob founded the place married, and Dan is theirs: a family the world was
          // made with, named on the spawn rather than on a birth.
          emit('agent_spawned', {
            id: 'alice',
            name: 'Alice',
            x: 0,
            y: 0,
            ageDays: ADULT_AGE_DAYS,
            partnerId: 'bob',
          })
          emit('agent_spawned', {
            id: 'bob',
            name: 'Bob',
            x: 0,
            y: 3,
            ageDays: ADULT_AGE_DAYS,
            partnerId: 'alice',
          })
          emit('agent_spawned', { id: 'cara', name: 'Cara', x: 20, y: 20, ageDays: ADULT_AGE_DAYS })
          emit('agent_spawned', {
            id: 'dan',
            name: 'Dan',
            x: 5,
            y: 5,
            ageDays: ADULT_AGE_DAYS,
            parents: ['alice', 'bob'],
          })
        }
        if (tick === 2) {
          emit('agent_spoke', { agentId: 'alice', text: 'Morning.', x: 0, y: 0 })
          emit('agent_spoke', { agentId: 'cara', text: 'To the river.', x: 20, y: 20 }) // in tick window, out of earshot
        }
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
          emit('structure_planned', {
            id: 's2',
            kind: 'shed',
            x: 10,
            y: 10,
            w: 1,
            h: 1,
            maxHp: 40,
            flammable: true,
            builderId: 'cara',
          })
        }
        if (tick === 21)
          emit('agent_spoke', { agentId: 'bob', text: 'Morning to you.', x: 0, y: 3 }) // 19 ticks after alice, dist 3 → talk
        if (tick === 30)
          emit('action_started', {
            agentId: 'alice',
            verb: 'give',
            params: { targetId: 'bob', itemId: 'i1' },
            duration: 2,
          })
        if (tick === 32) emit('action_completed', { agentId: 'alice', verb: 'give' })
        if (tick === 40) emit('structure_completed', { id: 's1' })
        if (tick === 50) emit('agent_spoke', { agentId: 'alice', text: 'Fine day.', x: 0, y: 0 })
        if (tick === 70) emit('agent_died', { agentId: 'dan', cause: 'hunger' })
        if (tick === 75)
          emit('agent_spoke', { agentId: 'bob', text: 'A shame about Dan.', x: 0, y: 3 }) // 25 ticks after alice → no talk
        if (tick === 78)
          emit('action_started', { agentId: 'cara', verb: 'fish', params: {}, duration: 10 })
      },
    })
    for (let i = 0; i < 80; i++) loop.step()

    const adb = openAgentFixtureDb(join(dir, 'alice.db'))
    adb
      .prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, ?, ?, ?)')
      .run('alice', 100, 0, 'First entry')
    adb
      .prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, ?, ?, ?)')
      .run('alice', 2000, 1, 'Second entry')
    const remember = adb.prepare(
      'INSERT INTO memories (agent_id, tick, day, kind, text, importance, tags)' +
        " VALUES (?, ?, ?, ?, ?, 5, '{}')",
    )
    remember.run('alice', 1439, 0, 'dream', 'the storehouse had no door')
    remember.run('alice', 200, 0, 'perception', 'bread, and the smell of it')
    adb
      .prepare('INSERT INTO ledgers (agent_id, person_id, doc, updated_day) VALUES (?, ?, ?, ?)')
      .run('alice', 'bob', 'Steady neighbor.', 1)
    adb
      .prepare(
        'INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, ?)',
      )
      .run('alice', 1, 0, 'Patient and wry.', null)
    adb
      .prepare(
        'INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, ?)',
      )
      .run('alice', 2, 3, 'Patient, wry, wary of fire.', 'grew wary of fire')
    adb
      .prepare(
        'INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        'alice',
        3,
        5,
        JSON.stringify({
          current: {
            mood: 'wary',
            goals: ['keep the fire in', 'owe Bob a loaf'],
            worries: ['the roof'],
          },
        }),
        'took the fire to heart',
      )
    adb.close()

    gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      agentDbDir: dir,
    })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('journal / ledgers / personality read the agent db; missing db → []', async () => {
    // The feed is what a mind wrote AND what it dreamed; nothing else it remembers is a viewer's.
    expect(await (await fetch(`${base}/api/agent/alice/journal`)).json()).toEqual([
      { tick: 100, day: 0, text: 'First entry', kind: 'journal' },
      { tick: 1439, day: 0, text: 'the storehouse had no door', kind: 'dream' },
      { tick: 2000, day: 1, text: 'Second entry', kind: 'journal' },
    ])
    expect(await (await fetch(`${base}/api/agent/alice/ledgers`)).json()).toEqual([
      { personId: 'bob', doc: 'Steady neighbor.', updatedDay: 1 },
    ])
    expect(await (await fetch(`${base}/api/agent/alice/personality`)).json()).toEqual([
      { version: 1, day: 0, doc: 'Patient and wry.', edit: null },
      { version: 2, day: 3, doc: 'Patient, wry, wary of fire.', edit: 'grew wary of fire' },
      {
        version: 3,
        day: 5,
        doc: '{"current":{"mood":"wary","goals":["keep the fire in","owe Bob a loaf"],"worries":["the roof"]}}',
        edit: 'took the fire to heart',
      },
    ])
    // The three lines a viewer meets a person through, off the newest document, for every mind
    // that has one. Bob has no database and is simply not in it.
    expect(await (await fetch(`${base}/api/aims`)).json()).toEqual({
      aims: [
        { agentId: 'alice', day: 5, mood: 'wary', goal: 'keep the fire in', worry: 'the roof' },
      ],
    })
    expect(await (await fetch(`${base}/api/agent/bob/journal`)).json()).toEqual([])
    expect(await (await fetch(`${base}/api/agent/bob/ledgers`)).json()).toEqual([])
    expect(await (await fetch(`${base}/api/agent/bob/personality`)).json()).toEqual([])
  })

  // The reader was widened to spawns and the query was not, so the valley's own two families
  // reached the viewer as no family at all.
  it('★ the lineage feed draws a family the world was founded with, not only the born', async () => {
    const kin = (await (await fetch(`${base}/api/lineage`)).json()) as {
      partnerOf: { aId: string; bId: string }[]
      parentOf: { parentId: string; childId: string }[]
    }
    expect(kin.partnerOf).toEqual([{ aId: 'alice', bId: 'bob' }])
    expect(kin.parentOf.map((e) => `${e.parentId}>${e.childId}`).sort()).toEqual([
      'alice>dan',
      'bob>dan',
    ])
  })

  /** Two prepares per journal GET, on the thread that ticks the town: a stranger looping the
   *  panel paid a compile each time. The SQL is a literal, so the statement is held with it. */
  it('★ compiles a mind\u2019s reads once, not once per GET', async () => {
    const proto = Object.getPrototypeOf(new Database(':memory:')) as {
      prepare: (sql: string) => unknown
    }
    const real = proto.prepare
    let compiled = 0
    proto.prepare = function (this: unknown, sql: string): unknown {
      if (sql.includes('FROM journal')) compiled += 1
      return real.call(this, sql)
    }
    try {
      await (await fetch(`${base}/api/agent/alice/journal`)).json()
      const first = compiled
      for (let i = 0; i < 5; i++) await (await fetch(`${base}/api/agent/alice/journal`)).json()
      expect(compiled, 'five more GETs compiled nothing').toBe(first)
    } finally {
      proto.prepare = real
    }
  })

  it('the journal feed is capped, and the cap keeps the newest of both halves', async () => {
    const over = JOURNAL_MAX + 50
    const cdb = openAgentFixtureDb(join(dir, 'carl.db'))
    const wrote = cdb.prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, ?, ?, ?)')
    const dreamt = cdb.prepare(
      'INSERT INTO memories (agent_id, tick, day, kind, text, importance, tags)' +
        " VALUES (?, ?, ?, 'dream', ?, 5, '{}')",
    )
    for (let i = 0; i < over; i++) {
      wrote.run('carl', i, 0, `entry ${i}`)
      dreamt.run('carl', i, 0, `dream ${i}`)
    }
    cdb.close()

    const rows = (await (await fetch(`${base}/api/agent/carl/journal`)).json()) as {
      tick: number
      kind: string
    }[]
    expect(rows).toHaveLength(JOURNAL_MAX)
    // The newest of the MERGE, not of each half: one row of each kind per tick, so the cap
    // reaches half as far back and still ends at the last thing this mind wrote.
    expect(rows[0]!.tick).toBe(over - JOURNAL_MAX / 2)
    expect(rows.at(-1)!.tick).toBe(over - 1)
    expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['journal', 'dream']))
  })

  it('provenance from the events scan, completedTick null while building', async () => {
    expect(await (await fetch(`${base}/api/structure/s1/provenance`)).json()).toEqual({
      id: 's1',
      kind: 'house',
      plannedTick: 10,
      builderId: 'bob',
      completedTick: 40,
    })
    expect(await (await fetch(`${base}/api/structure/s2/provenance`)).json()).toEqual({
      id: 's2',
      kind: 'shed',
      plannedTick: 10,
      builderId: 'cara',
      completedTick: null,
    })
    expect((await fetch(`${base}/api/structure/s9/provenance`)).status).toBe(404)
  })

  it('society: conversation-adjacency talk links + verb links from started/completed pairs', async () => {
    expect(await (await fetch(`${base}/api/society`)).json()).toEqual({
      nodes: [
        { id: 'alice', name: 'Alice', alive: true },
        { id: 'bob', name: 'Bob', alive: true },
        { id: 'cara', name: 'Cara', alive: true },
        { id: 'dan', name: 'Dan', alive: false },
      ],
      links: [
        { source: 'alice', target: 'bob', kind: 'give', weight: 1 },
        { source: 'alice', target: 'bob', kind: 'talk', weight: 1 },
      ],
    })
  })

  it('chapters is the C7 stub', async () => {
    expect(await (await fetch(`${base}/api/chapters`)).json()).toEqual([])
  })
})

/** Three inspector tabs per viewer, 30 s of client cache and no rate limit: an open+close per GET
 *  was ~0.5 ms and a discarded page cache, on the thread that ticks the town. */
describe('★ the per-mind handles are held, not reopened per request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-agentdb-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const mount = (): { call: (id: string) => unknown; close: () => void } => {
    const worldDb = openDb(join(dir, 'world.db'))
    const mirror = new WorldMirror({ db: worldDb, config: DEFAULT_CONFIG, terrain: GRASS })
    const routes = new Map<string, RouteHandler>()
    const close = mountDataApi(
      {
        route: (m, path, fn) => {
          routes.set(`${m} ${path}`, fn)
        },
      },
      { db: worldDb, mirror, config: DEFAULT_CONFIG, agentDbDir: dir },
    )
    return {
      call: (id) => {
        let body = ''
        routes.get('GET /api/agent/:id/journal')!(
          { url: `/api/agent/${id}/journal` } as IncomingMessage,
          {
            writeHead: () => {},
            end: (b: string) => {
              body = b
            },
          } as unknown as ServerResponse,
          { id },
        )
        return JSON.parse(body) as unknown
      },
      close: () => {
        close()
        worldDb.close()
      },
    }
  }

  it('answers from a handle it already has, and a stranger’s slug opens nothing', () => {
    const adb = openAgentFixtureDb(join(dir, 'mira.db'))
    adb
      .prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, ?, ?, ?)')
      .run('mira', 5, 0, 'I banked the fire.')
    adb.close()

    const api = mount()
    expect(api.call('mira')).toEqual([
      { tick: 5, day: 0, text: 'I banked the fire.', kind: 'journal' },
    ])
    // The file is gone; `fileMustExist` means a per-request open would answer [] from here on.
    rmSync(join(dir, 'mira.db'))
    expect(api.call('mira'), 'the handle was dropped between two requests').toEqual([
      { tick: 5, day: 0, text: 'I banked the fire.', kind: 'journal' },
    ])
    expect(api.call('nobody')).toEqual([])
    api.close()
  })
})

/** The bond graph reads the log directly, so the five acts reach it whatever `FOLD_TYPES` says. */
describe('★ the five acts of a relationship reach the read path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwrel-'))
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('rel-test'),
      snapshotEveryTicks: 25,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['alice', 'Alice'],
            ['bob', 'Bob'],
            ['cara', 'Cara'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        if (tick === 4) emit('invited', { agentId: 'bob', byId: 'alice', verb: 'court' })
        if (tick === 5)
          emit('invitation_refused', {
            agentId: 'bob',
            byId: 'alice',
            verb: 'court',
            witnesses: ['cara'],
          })
        if (tick === 6) emit('invited', { agentId: 'bob', byId: 'alice', verb: 'propose' })
        if (tick === 7)
          emit('invitation_accepted', { agentId: 'bob', byId: 'alice', verb: 'propose' })
        if (tick === 8) emit('partnership_formed', { aId: 'alice', bId: 'bob' })
        if (tick === 9) emit('partnership_dissolved', { aId: 'alice', bId: 'bob', byId: 'bob' })
      },
    })
    for (let i = 0; i < 12; i++) loop.step()
    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('makes the partnership a bond and the public no a slight', async () => {
    const body = BondsResponseSchema.parse(await (await fetch(`${base}/api/bonds`)).json())
    const b = body.bonds.find((x) => x.id === bondId('alice', 'bob'))
    expect(b?.acts).toEqual([{ kind: 'partner', count: 1, firstTick: 8, lastTick: 8 }])
    expect(b?.kind, 'they parted at tick 9').not.toBe('partner')
    expect(b?.warmth).toBeLessThan(0)
  })
})

/** The Laws page's whole supply. The rows are joined off the FOLDED state and a breach count the
 *  read path keeps, so what the page says survives a restart as long as the log does. */
describe('★ /api/laws serves the rules the town wrote, and how often they were broken', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwlaws-'))
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('laws-test'),
      snapshotEveryTicks: 25,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['nadia', 'Nadia'],
            ['omar', 'Omar'],
            ['salma', 'Salma'],
            ['yusuf', 'Yusuf'],
            ['amara', 'Amara'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        // One council a tick, in fixture order: the page's "newest first" is the reverse of this.
        for (const [i, f] of LAW_FIXTURE.entries()) {
          if (tick !== 10 + i) continue
          emit('law_proposed', { lawId: f.id, agentId: f.proposedBy, text: f.text })
          emit('law_ratified', {
            lawId: f.id,
            agentId: f.proposedBy,
            text: f.text,
            why: f.why,
            predicate: f.predicate,
            votes: f.votes,
          })
        }
        if (tick === 20)
          emit('law_broken', {
            lawId: 'law_slate',
            agentId: 'yusuf',
            verb: 'take',
            witnesses: ['nadia'],
          })
        if (tick === 21)
          emit('law_broken', { lawId: 'law_slate', agentId: 'omar', verb: 'take', witnesses: [] })
        if (tick === 22)
          emit('law_repealed', {
            lawId: 'law_fire_tax',
            agentId: 'salma',
            text: LAW_FIXTURE[1]!.text,
          })
      },
    })
    for (let i = 0; i < 25; i++) loop.step()
    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads newest first, in the town’s own words, with the proposer named', async () => {
    const body = LawsResponseSchema.parse(await (await fetch(`${base}/api/laws`)).json())
    expect(body.laws.map((l) => l.id)).toEqual(['law_well_order', 'law_fire_tax', 'law_slate'])
    expect(body.laws.map((l) => l.proposerName)).toEqual(['Amara', 'Salma', 'Nadia'])
    expect(body.laws.find((l) => l.id === 'law_slate')).toEqual({
      id: 'law_slate',
      text: LAW_FIXTURE[0]!.text,
      proposedBy: 'nadia',
      proposerName: 'Nadia',
      ratifiedTick: 10,
      repealedTick: null,
      votes: { for: ['nadia', 'omar'], against: [] },
      why: LAW_FIXTURE[0]!.why,
      enforced: true,
      breaches: 2,
    })
  })

  it('keeps a rule the town let go of, and holds nothing against the unbroken', async () => {
    const body = LawsResponseSchema.parse(await (await fetch(`${base}/api/laws`)).json())
    const gone = body.laws.find((l) => l.id === 'law_fire_tax')!
    expect(gone.repealedTick).toBe(22)
    expect(gone.breaches).toBe(0)
    expect(body.laws.find((l) => l.id === 'law_well_order')!.breaches).toBe(0)
  })

  // Which verb the court compiled a sentence to is ops-plane, and `enforced` is the whole of
  // what a viewer is owed about it.
  it('says whether the world holds anybody to it, and never how', async () => {
    const raw = await (await fetch(`${base}/api/laws`)).text()
    for (const word of ['predicate', 'require_before', 'ordinal', 'itemKind'])
      expect(raw, word).not.toContain(word)
  })
})

/** A viewer opening the page twice in one tick must not re-scan the world, and a viewer opening
 *  it after a council must not be served the answer from before it. */
describe('★ the laws body is built once a generation and dropped when the world moves', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwlawseq-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('serves the same string twice, and a new one once a law lands', () => {
    const db = openDb(join(dir, 'world.db'))
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('laws-seq'),
      snapshotEveryTicks: 25,
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          emit('agent_spawned', { id: 'nadia', name: 'Nadia', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        if (tick === 3)
          emit('law_ratified', {
            lawId: 'law_slate',
            agentId: 'nadia',
            text: LAW_FIXTURE[0]!.text,
            why: LAW_FIXTURE[0]!.why,
            predicate: LAW_FIXTURE[0]!.predicate,
            votes: LAW_FIXTURE[0]!.votes,
          })
      },
    })
    loop.step()
    const mirror = new WorldMirror({ db, config: DEFAULT_CONFIG, terrain: GRASS })
    const routes = new Map<string, RouteHandler>()
    const close = mountDataApi(
      {
        route: (m, path, fn) => {
          routes.set(`${m} ${path}`, fn)
        },
      },
      { db, mirror, config: DEFAULT_CONFIG },
    )
    const get = (): string => {
      let body = ''
      routes.get('GET /api/laws')!(
        { url: '/api/laws' } as IncomingMessage,
        {
          writeHead: () => {},
          end: (b: string) => {
            body = b
          },
        } as unknown as ServerResponse,
        {},
      )
      return body
    }

    const empty = get()
    expect(JSON.parse(empty)).toEqual({ laws: [] })
    expect(get()).toBe(empty)

    for (let i = 0; i < 3; i++) loop.step()
    mirror.poll()
    const after = LawsResponseSchema.parse(JSON.parse(get()))
    expect(after.laws.map((l) => l.id)).toEqual(['law_slate'])

    close()
    db.close()
  })
})
