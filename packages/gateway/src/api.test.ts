import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import Database from 'better-sqlite3'
import { createGateway, type Gateway } from './server.js'

// @sj/agents is frozen this chunk and does not export openAgentDb; DDL below is copied
// verbatim from packages/agents/src/memory/schema.ts for the three tables the API reads.
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

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0 as TileId))

describe('observer data apis', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwapi-'))
  let gw: Gateway
  let base: string
  let liveAgents: Record<string, unknown>

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
          emit('agent_spawned', { id: 'alice', name: 'Alice', x: 0, y: 0, ageDays: 7300 })
          emit('agent_spawned', { id: 'bob', name: 'Bob', x: 0, y: 3, ageDays: 7300 })
          emit('agent_spawned', { id: 'cara', name: 'Cara', x: 20, y: 20, ageDays: 7300 })
          emit('agent_spawned', { id: 'dan', name: 'Dan', x: 5, y: 5, ageDays: 7300 })
        }
        if (tick === 2) {
          emit('agent_spoke', { agentId: 'alice', text: 'Morning.', x: 0, y: 0 })
          emit('agent_spoke', { agentId: 'cara', text: 'To the river.', x: 20, y: 20 }) // in tick window, out of earshot
        }
        if (tick === 10) {
          emit('structure_planned', { id: 's1', kind: 'house', x: 2, y: 2, w: 1, h: 1, maxHp: 50, flammable: true, builderId: 'bob' })
          emit('structure_planned', { id: 's2', kind: 'shed', x: 10, y: 10, w: 1, h: 1, maxHp: 40, flammable: true, builderId: 'cara' })
        }
        if (tick === 21) emit('agent_spoke', { agentId: 'bob', text: 'Morning to you.', x: 0, y: 3 }) // 19 ticks after alice, dist 3 → talk
        if (tick === 30) emit('action_started', { agentId: 'alice', verb: 'give', params: { targetId: 'bob', itemId: 'i1' }, duration: 2 })
        if (tick === 32) emit('action_completed', { agentId: 'alice', verb: 'give' })
        if (tick === 40) emit('structure_completed', { id: 's1' })
        if (tick === 50) emit('agent_spoke', { agentId: 'alice', text: 'Fine day.', x: 0, y: 0 })
        if (tick === 70) emit('agent_died', { agentId: 'dan', cause: 'hunger' })
        if (tick === 75) emit('agent_spoke', { agentId: 'bob', text: 'A shame about Dan.', x: 0, y: 3 }) // 25 ticks after alice → no talk
        if (tick === 78) emit('action_started', { agentId: 'cara', verb: 'fish', params: {}, duration: 10 })
      },
    })
    for (let i = 0; i < 80; i++) loop.step()
    liveAgents = JSON.parse(JSON.stringify(loop.state.agents))

    const adb = openAgentFixtureDb(join(dir, 'alice.db'))
    adb.prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, ?, ?, ?)').run('alice', 100, 0, 'First entry')
    adb.prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, ?, ?, ?)').run('alice', 2000, 1, 'Second entry')
    adb.prepare('INSERT INTO ledgers (agent_id, person_id, doc, updated_day) VALUES (?, ?, ?, ?)').run('alice', 'bob', 'Steady neighbor.', 1)
    adb.prepare('INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, ?)').run('alice', 1, 0, 'Patient and wry.', null)
    adb.prepare('INSERT INTO personality_versions (agent_id, version, day, doc, edit) VALUES (?, ?, ?, ?, ?)').run('alice', 2, 3, 'Patient, wry, wary of fire.', 'grew wary of fire')
    adb.close()

    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db, agentDbDir: dir })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterAll(async () => {
    await gw.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('profile: straight from WorldState, 404 for unknown', async () => {
    const res = await fetch(`${base}/api/agent/alice/profile`)
    expect(res.status).toBe(200)
    const a = liveAgents.alice as Record<string, unknown>
    expect(await res.json()).toEqual({
      id: 'alice', name: 'Alice', alive: true, asleep: a.asleep, x: 0, y: 0,
      needs: a.needs, hp: a.hp, injuries: a.injuries, ill: a.ill, ageDays: a.ageDays,
      skills: a.skills, activity: a.activity,
    })
    expect((await fetch(`${base}/api/agent/nobody/profile`)).status).toBe(404)
  })

  it('journal / ledgers / personality read the agent db; missing db → []', async () => {
    expect(await (await fetch(`${base}/api/agent/alice/journal`)).json()).toEqual([
      { tick: 100, day: 0, text: 'First entry' },
      { tick: 2000, day: 1, text: 'Second entry' },
    ])
    expect(await (await fetch(`${base}/api/agent/alice/ledgers`)).json()).toEqual([
      { personId: 'bob', doc: 'Steady neighbor.', updatedDay: 1 },
    ])
    expect(await (await fetch(`${base}/api/agent/alice/personality`)).json()).toEqual([
      { version: 1, day: 0, doc: 'Patient and wry.', edit: null },
      { version: 2, day: 3, doc: 'Patient, wry, wary of fire.', edit: 'grew wary of fire' },
    ])
    expect(await (await fetch(`${base}/api/agent/bob/journal`)).json()).toEqual([])
    expect(await (await fetch(`${base}/api/agent/bob/ledgers`)).json()).toEqual([])
    expect(await (await fetch(`${base}/api/agent/bob/personality`)).json()).toEqual([])
  })

  it('provenance from the events scan, completedTick null while building', async () => {
    expect(await (await fetch(`${base}/api/structure/s1/provenance`)).json()).toEqual({
      id: 's1', kind: 'house', plannedTick: 10, builderId: 'bob', completedTick: 40,
    })
    expect(await (await fetch(`${base}/api/structure/s2/provenance`)).json()).toEqual({
      id: 's2', kind: 'shed', plannedTick: 10, builderId: 'cara', completedTick: null,
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

  // bob is 2 for speaking and 6 for the house he PLANNED and the town completed at tick 40 —
  // `structure_completed {id}` names no person, and the plan is where the town keeps one.
  it('heat: per-agent 60-tick windows from the stub scorer', async () => {
    expect(await (await fetch(`${base}/api/heat`)).json()).toEqual([
      { fromTick: 0, toTick: 59, agentId: 'alice', score: 4 },
      { fromTick: 0, toTick: 59, agentId: 'bob', score: 8 },
      { fromTick: 0, toTick: 59, agentId: 'cara', score: 2 },
      { fromTick: 60, toTick: 119, agentId: 'bob', score: 2 },
      { fromTick: 60, toTick: 119, agentId: 'dan', score: 20 },
    ])
  })

  it('digest: deaths, completions, top heat moments, human agent lines', async () => {
    expect(await (await fetch(`${base}/api/digest?fromTick=0&toTick=80`)).json()).toEqual({
      days: [0],
      deaths: [{ agentId: 'dan', tick: 70, cause: 'hunger' }],
      births: [],
      structuresCompleted: [{ id: 's1', kind: 'house', tick: 40 }],
      topMoments: [
        { tick: 60, agentId: 'dan', score: 20, moment: { day: 0, time: '01:00' } },
        { tick: 0, agentId: 'bob', score: 8, moment: { day: 0, time: '00:00' } },
        { tick: 0, agentId: 'alice', score: 4, moment: { day: 0, time: '00:00' } },
        { tick: 0, agentId: 'cara', score: 2, moment: { day: 0, time: '00:00' } },
        { tick: 60, agentId: 'bob', score: 2, moment: { day: 0, time: '01:00' } },
      ],
      agentLines: [
        { agentId: 'alice', line: 'Alice was last seen resting' },
        { agentId: 'bob', line: 'Bob was last seen resting' },
        { agentId: 'cara', line: 'Cara was last seen fishing' },
      ],
    })
  })

  it('digest without params covers the whole history', async () => {
    const full = await (await fetch(`${base}/api/digest`)).json() as { deaths: unknown[] }
    expect(full.deaths).toHaveLength(1)
  })
})
