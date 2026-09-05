// No provider is reached — every model here is a script.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  scanPromptForGlassLeak,
  type SimEvent,
} from '@sj/shared'
import type { LlmClient, LlmMessage, LlmUsage } from '@sj/llm'
import { openDb } from '@sj/engine/store'
import type { TileId } from '@sj/engine'
import { ConstructStore, openArbiterDb, runConstructPass } from '@sj/arbiter'
import { NarratorStore, constructMilestones, openNarratorDb } from '@sj/narrator'
import { createGateway, type Gateway } from '@sj/gateway'

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0))
const THREE = ['ada', 'bex', 'cass']
const NAMING = 'We call it the Long Table, and we keep it.'

let seq = 0
const ev = (tick: number, type: string, payload: unknown): SimEvent => ({
  seq: ++seq,
  tick,
  type,
  payload,
})

const gathering = (day: number): SimEvent[] => {
  const at = day * MINUTES_PER_DAY + 19 * 60
  return THREE.map((id, i) => ev(at, 'agent_moved', { id, x: 20 + i, y: 20 }))
}

const naming = (day: number): SimEvent =>
  ev(day * MINUTES_PER_DAY + 19 * 60 + 1, 'agent_spoke', {
    agentId: 'bex',
    text: NAMING,
    x: 20,
    y: 20,
  })

/** The three of them arriving, so the same log folds into a world the observatory can serve. */
const SPAWNS: SimEvent[] = THREE.map((id, i) =>
  ev(0, 'agent_spawned', { id, name: id, x: 20 + i, y: 20, ageDays: ADULT_AGE_DAYS }),
)

const TRANSCRIPT: SimEvent[] = [
  ...SPAWNS,
  ...gathering(0),
  ...gathering(1),
  ...gathering(2),
  naming(2),
  // The clock the observatory reads its window from; only this event moves it.
  ev(2 * MINUTES_PER_DAY + 19 * 60 + 2, 'tick_advanced', {}),
]

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }

/** Rules every candidate it is shown a festival. Never leaves the process. */
const scriptedLlm = () =>
  ({
    async object(opts: { messages: LlmMessage[] }) {
      const user = opts.messages.at(-1)?.content ?? ''
      const keys = [...user.matchAll(/^- (\S+)$/gm)].map((m) => m[1]!)
      return { value: { rulings: keys.map((key) => ({ key, type: 'festival' })) }, usage: NO_USAGE }
    },
  }) as unknown as LlmClient

describe('★ the recognizer, from a repeated gathering to the observatory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-constructs-'))
  const minds = join(dir, 'minds')
  let arbiterDb: Database.Database
  let worldDb: Database.Database
  let gw: Gateway
  let base: string

  beforeAll(async () => {
    // The arbiter's own file, in the minds directory, exactly where the live cast opens it.
    mkdirSync(minds, { recursive: true })
    arbiterDb = openArbiterDb(join(minds, '_arbiter.db'))
    const recognized = await runConstructPass({
      events: TRANSCRIPT,
      baseConfig: DEFAULT_CONFIG,
      store: new ConstructStore(arbiterDb),
      llm: scriptedLlm(),
    })

    // What the day boundary does next: the registry is the arbiter's, so the milestone row is
    // the only way the chronicle ever hears about it.
    const narratorDb = openNarratorDb(join(minds, '_narrator.db'))
    const chronicle = new NarratorStore(narratorDb)
    for (const m of constructMilestones(recognized, chronicle.milestoneKinds()))
      chronicle.insertMilestone(m)
    narratorDb.close()

    worldDb = openDb(join(dir, 'world.db'))
    const ins = worldDb.prepare('INSERT INTO events (seq, tick, type, payload) VALUES (?, ?, ?, ?)')
    for (const e of TRANSCRIPT) ins.run(e.seq, e.tick, e.type, JSON.stringify(e.payload))
    gw = await createGateway({
      dbPath: join(dir, 'world.db'),
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: worldDb,
      agentDbDir: minds,
      narratorDbPath: join(minds, '_narrator.db'),
    })
    base = `http://127.0.0.1:${gw.port}`
  })

  afterAll(async () => {
    await gw.close()
    arbiterDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const served = async (): Promise<Record<string, unknown>[]> => {
    const res = await fetch(`${base}/api/constructs`)
    expect(res.status).toBe(200)
    return (await res.json()) as Record<string, unknown>[]
  }

  it('lands exactly one row in the registry, typed and named out of a mouth', () => {
    const rows = new ConstructStore(arbiterDb).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'festival', name: 'Long Table' })
    expect(rows[0]!.nameProvenance?.quote).toBe(NAMING)
    expect(rows[0]!.participants).toEqual([...THREE].sort())
  })

  it('and the route serves it: what it is, who kept it, when it started, and the evidence', async () => {
    expect(await served()).toEqual([
      {
        id: 'construct_21_20',
        type: 'festival',
        name: 'Long Table',
        members: [...THREE].sort(),
        firstDay: 0,
        gatherings: 3,
        anchor: { x: 21, y: 20 },
        quote: NAMING,
        saidBy: 'bex',
      },
    ])
  })

  it('★ the keystone: the chronicle carries the first of its kind, and the name they gave it', async () => {
    const res = await fetch(`${base}/api/chronicle`)
    expect(res.status).toBe(200)
    const { entries } = (await res.json()) as { entries: { label: string }[] }
    expect(entries.map((e) => e.label)).toEqual([
      'the first time they gathered to celebrate',
      'the day they had a word of their own for it: Long Table',
    ])
  })

  it('★ ONE-WAY GLASS: the registry is the arbiter’s alone, and the world log stays clean', async () => {
    const tablesIn = (db: Database.Database): string[] =>
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string
        }[]
      ).map((r) => r.name)
    expect(tablesIn(arbiterDb)).toContain('constructs')
    expect(tablesIn(worldDb)).not.toContain('constructs')

    // The town's own record — the only thing a mind's perception is folded from — names none
    // of the ops plane's words, before or after the pass.
    expect(scanPromptForGlassLeak(JSON.stringify(TRANSCRIPT))).toEqual([])

    // And the scan is not vacuous: the OBSERVER is handed the taxonomy by name.
    expect(scanPromptForGlassLeak(JSON.stringify(await served()))).toContain('festival')
  })
})
