import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb } from '@sj/engine'
import { startDevWorld } from './devWorld.js'
import { FOUNDERS } from './founders.js'
import { thoughtsSince } from './observer.js'
import { readWorldMeta } from './worldMeta.js'
import { until } from './testutil.js'

/** Boot, run to at least `toTick`, close cleanly. Returns what the town looked like at the end. */
const runTo = async (
  dbPath: string,
  toTick: number,
  opts: Parameters<typeof startDevWorld>[0] = {},
): Promise<{
  tick: number
  structures: number
  agents: string[]
  resumedAtTick: number | null
}> => {
  const dw = await startDevWorld({ realMsPerTick: 1, port: 0, dbPath, ...opts })
  try {
    await until(() => dw.loop.state.tick >= toTick, 30_000)
    return {
      tick: dw.loop.state.tick,
      structures: Object.keys(dw.loop.state.structures).length,
      agents: Object.keys(dw.loop.state.agents).sort(),
      resumedAtTick: dw.resumedAtTick,
    }
  } finally {
    await dw.stop()
  }
}

const countEvents = (dbPath: string, type: string): number => {
  const db = openDb(dbPath)
  try {
    return (
      db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type) as { n: number }
    ).n
  } finally {
    db.close()
  }
}

/** Removing the world-db delete ALONE is strictly worse than the wipe: the loop was built from
 *  `genesisState` unconditionally, so boot 2 would append a SECOND town's events at tick 1 into a
 *  db already holding 10 000 ticks. These tests pin both halves together. */
describe('★ the town survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-persist-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('resumes the same town on a second boot — same day, same buildings, same people', async () => {
    const dbPath = join(dir, 'resume.db')
    const first = await runTo(dbPath, 30)
    expect(first.tick).toBeGreaterThanOrEqual(30)
    expect(first.structures).toBeGreaterThan(0)

    const second = await runTo(dbPath, first.tick + 5)

    // the day counter carries: boot 2 starts where boot 1 stopped, it does not restart
    expect(second.resumedAtTick).toBe(first.tick)
    expect(second.tick).toBeGreaterThan(first.tick)
    expect(second.structures).toBe(first.structures)
    expect(second.agents).toEqual(first.agents)
    // and the genesis burst fired exactly once across both boots — no second town in the log
    expect(countEvents(dbPath, 'agent_spawned')).toBe(first.agents.length)
    expect(countEvents(dbPath, 'structure_completed')).toBe(first.structures)
  }, 90_000)

  it('folds the resumed log to exactly one tick per tick_advanced event', async () => {
    const dbPath = join(dir, 'ticks.db')
    await runTo(dbPath, 20)
    const after = await runTo(dbPath, 40)
    expect(countEvents(dbPath, 'tick_advanced')).toBe(after.tick)
  }, 90_000)

  it('fresh: true is the ONLY way to throw a town away, and it is explicit', async () => {
    const dbPath = join(dir, 'fresh.db')
    const first = await runTo(dbPath, 20)
    const second = await runTo(dbPath, 5, { fresh: true })
    expect(second.tick).toBeLessThan(first.tick)
    expect(countEvents(dbPath, 'tick_advanced')).toBe(second.tick)
  }, 90_000)

  it('does not re-publish every historic thought on resume', async () => {
    const dbPath = join(dir, 'thoughts.db')
    const readThoughts = (): { id: number; tick: number }[] => {
      const db = openDb(dbPath)
      try {
        return thoughtsSince(db, 0)
      } finally {
        db.close()
      }
    }
    const first = await runTo(dbPath, 60)
    const before = readThoughts()
    expect(before.length).toBeGreaterThanOrEqual(FOUNDERS.length)

    const second = await runTo(dbPath, first.tick + 3)
    // A cursor left at seq 0 re-scans the whole log on the first resumed tick and publishes
    // thoughts stamped with HISTORIC ticks — the tell is the tick, not the count.
    const added = readThoughts().filter((t) => !before.some((b) => b.id === t.id))
    for (const t of added)
      expect(t.tick, `a thought re-published from history at tick ${t.tick}`).toBeGreaterThan(
        second.resumedAtTick!,
      )
  }, 120_000)

  it('the gateway is handed the terrain the world resumed on, not one recomputed from env', async () => {
    const dbPath = join(dir, 'terrain.db')
    await runTo(dbPath, 70, { map: 'showcase', rings: 1 }) // past the tick-60 snapshot
    const dw = await startDevWorld({
      realMsPerTick: 100_000,
      port: 0,
      dbPath,
      map: 'showcase',
      rings: 1,
    })
    try {
      expect(dw.resumedAtTick).not.toBeNull()
      expect(dw.terrain).toBe(dw.loop.state.terrain)
    } finally {
      await dw.stop()
    }
  }, 90_000)
})

/** `WorldState.terrain` rides in the snapshot, so a resumed world keeps its real map while the
 *  gateway is handed one recomputed from the environment: one map scrubbed, another simulated,
 *  with no error anywhere. */
describe('★ a resumed world refuses a boot that is not the same world', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-identity-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('records who the town is on the first boot', async () => {
    const dbPath = join(dir, 'meta.db')
    await runTo(dbPath, 5, { map: 'showcase', rings: 1, seed: 'g6' })
    const db = openDb(dbPath)
    try {
      expect(readWorldMeta(db)).toEqual({ map: 'showcase', rings: 1, seed: 'g6' })
    } finally {
      db.close()
    }
  }, 60_000)

  it('refuses a different ring count, and names both sides and the way out', async () => {
    const dbPath = join(dir, 'rings.db')
    await runTo(dbPath, 5, { map: 'showcase', rings: 1 })
    await expect(
      startDevWorld({ realMsPerTick: 100_000, port: 0, dbPath, map: 'showcase', rings: 3 }),
    ).rejects.toThrow(/rings 1 → 3/)
    await expect(
      startDevWorld({ realMsPerTick: 100_000, port: 0, dbPath, map: 'showcase', rings: 3 }),
    ).rejects.toThrow(/SJ_FRESH=1/)
  }, 60_000)

  it('refuses a different map and a different seed too', async () => {
    const dbPath = join(dir, 'map.db')
    await runTo(dbPath, 5, { map: 'showcase', rings: 1, seed: 'g6' })
    await expect(
      startDevWorld({ realMsPerTick: 100_000, port: 0, dbPath, map: 'scripted' }),
    ).rejects.toThrow(/map/)
    await expect(
      startDevWorld({
        realMsPerTick: 100_000,
        port: 0,
        dbPath,
        map: 'showcase',
        rings: 1,
        seed: 'other',
      }),
    ).rejects.toThrow(/seed/)
  }, 60_000)

  it('a fresh start re-stamps the identity instead of refusing', async () => {
    const dbPath = join(dir, 'restamp.db')
    await runTo(dbPath, 5, { map: 'showcase', rings: 1 })
    await runTo(dbPath, 3, { map: 'showcase', rings: 3, fresh: true })
    const db = openDb(dbPath)
    try {
      expect(readWorldMeta(db)?.rings).toBe(3)
    } finally {
      db.close()
    }
  }, 60_000)
})

/** Agent memory lives in separate `<id>.db` files the world-db delete never touched, so a `fresh`
 *  boot gives the worst of both: the buildings gone and every mind still remembering. */
describe('★ fresh means fresh for the minds too', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-minds-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('wipes the agent memory dbs together with the world db', async () => {
    const dbPath = join(dir, 'w.db')
    const agentDbDir = join(dir, 'minds')
    mkdirSync(agentDbDir, { recursive: true })
    const omar = join(agentDbDir, 'omar.db')
    writeFileSync(omar, 'not really sqlite, but it is a mind file')
    writeFileSync(join(agentDbDir, 'notes.txt'), 'left alone: not a mind')

    await runTo(dbPath, 3, { fresh: true, agentDbDir })
    expect(existsSync(omar), 'a fresh town must not keep a mind that remembers the old one').toBe(
      false,
    )
    expect(existsSync(join(agentDbDir, 'notes.txt'))).toBe(true)
  }, 60_000)

  it('keeps the agent memory dbs when the world resumes', async () => {
    const dbPath = join(dir, 'keep.db')
    const agentDbDir = join(dir, 'keepminds')
    mkdirSync(agentDbDir, { recursive: true })
    const omar = join(agentDbDir, 'omar.db')
    await runTo(dbPath, 3, { agentDbDir })
    writeFileSync(omar, 'a memory written while the town ran')
    await runTo(dbPath, 6, { agentDbDir })
    expect(existsSync(omar)).toBe(true)
  }, 60_000)
})
