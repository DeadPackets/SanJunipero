import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, stateHash, type SimEvent } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import {
  RngStreams,
  TickLoop,
  genesisState,
  replayFromGenesis,
  fold,
  type TileId,
} from '@sj/engine'
import { SNAP_AT_OR_BEFORE_SQL, WorldMirror } from './worldMirror.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))

function makeWorld(dbPath: string) {
  const db = openDb(dbPath)
  const store = new EventStore(db)
  const loop = new TickLoop({
    store,
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('mirror-test'),
    snapshotEveryTicks: 5,
    onTick: ({ tick, emit }) => {
      if (tick === 1)
        emit('agent_spawned', { id: 'walker', name: 'walker', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
      if (tick > 1) emit('agent_moved', { id: 'walker', x: (tick - 1) % 8, y: 0 })
    },
  })
  return { db, store, loop }
}

describe('WorldMirror', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-mirror-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('boots to the live state, polls new ticks, and scrubs with stateAt', () => {
    const dbPath = join(dir, 'world.db')
    const { db, store, loop } = makeWorld(dbPath)
    for (let i = 0; i < 12; i++) loop.step()

    const mirror = new WorldMirror({
      db: new Database(dbPath, { readonly: true }),
      config: DEFAULT_CONFIG,
      terrain: GRASS,
    })
    expect(stateHash(mirror.state())).toBe(stateHash(loop.state))
    expect(mirror.seq()).toBe(store.lastSeq())

    // snapshot boot equals a from-genesis fold (snapshot at tick 10 exists)
    expect(stateHash(mirror.state())).toBe(
      stateHash(replayFromGenesis(store, DEFAULT_CONFIG, GRASS)),
    )

    // poll: 3 more steps → exactly 3 groups, strictly increasing tick, hash tracks live
    for (let i = 0; i < 3; i++) loop.step()
    const groups = mirror.poll()
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.tick)).toEqual([13, 14, 15])
    for (const g of groups) expect(g.events.length).toBeGreaterThan(0)
    expect(stateHash(mirror.state())).toBe(stateHash(loop.state))
    expect(mirror.poll()).toEqual([])

    // stateAt: reference fold of every event with tick ≤ 6 from genesis
    const upTo6 = store.readFrom(0).filter((ev: SimEvent) => ev.tick <= 6)
    const ref6 = upTo6.reduce(
      (s, ev) => fold(s, ev, DEFAULT_CONFIG),
      genesisState(DEFAULT_CONFIG, GRASS),
    )
    expect(stateHash(mirror.stateAt(6))).toBe(stateHash(ref6))
    expect(stateHash(mirror.stateAt(0))).toBe(stateHash(genesisState(DEFAULT_CONFIG, GRASS)))
    expect(() => mirror.stateAt(9999)).toThrow(RangeError)
    db.close()
  })

  // Without idx_snapshots_tick this is a SCAN plus a temp b-tree over rows carrying ~30 KB of
  // state JSON each, and it slows as the world ages.
  it('finds the scrub snapshot through the index, never by scanning the table', () => {
    const dbPath = join(dir, 'world3.db')
    const { db, loop } = makeWorld(dbPath)
    for (let i = 0; i < 12; i++) loop.step()

    const plan = db.prepare(`EXPLAIN QUERY PLAN ${SNAP_AT_OR_BEFORE_SQL}`).all(6) as {
      detail: string
    }[]
    const detail = plan.map((r) => r.detail).join(' | ')
    expect(detail).toContain('idx_snapshots_tick')
    expect(detail).not.toContain('SCAN snapshots')
    expect(detail).not.toContain('TEMP B-TREE')
    db.close()
  })

  it('boots from snapshot when one exists mid-run', () => {
    const dbPath = join(dir, 'world2.db')
    const { db, store, loop } = makeWorld(dbPath)
    for (let i = 0; i < 7; i++) loop.step() // snapshot exists at tick 5

    const mirror = new WorldMirror({ db, config: DEFAULT_CONFIG, terrain: GRASS })
    expect(stateHash(mirror.state())).toBe(stateHash(loop.state))
    expect(stateHash(mirror.state())).toBe(
      stateHash(replayFromGenesis(store, DEFAULT_CONFIG, GRASS)),
    )
    db.close()
  })
})
