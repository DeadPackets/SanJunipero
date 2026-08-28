// The recognizer end to end: a scripted town that keeps coming back to one patch of ground,
// through the registry the live day boundary writes, out of the route the observatory reads,
// and never once across the glass. No provider is reached — every model here is a script.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, scanPromptForGlassLeak, type SimEvent } from '@sj/shared'
import type { LlmClient, LlmMessage, LlmUsage } from '@sj/llm'
import { openDb } from '@sj/engine/store'
import type { TileId } from '@sj/engine'
import { ConstructStore, openArbiterDb, runConstructPass } from '@sj/arbiter'
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

/** One evening at (20, 20): three bodies walk in and stand together. */
const gathering = (day: number): SimEvent[] => {
  const at = day * MINUTES_PER_DAY + 19 * 60
  return THREE.map((id, i) => ev(at, 'agent_moved', { id, x: 20 + i, y: 20 }))
}

/** The night one of them gives the thing a name, out of her own mouth. */
const naming = (day: number): SimEvent =>
  ev(day * MINUTES_PER_DAY + 19 * 60 + 1, 'agent_spoke', {
    agentId: 'bex',
    text: NAMING,
    x: 20,
    y: 20,
  })

const TRANSCRIPT: SimEvent[] = [...gathering(0), ...gathering(1), ...gathering(2), naming(2)]

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0 }

/** Rules every candidate it is shown a festival, and keeps what it was shown. */
class ScriptedLlm {
  systems: string[] = []
  users: string[] = []
  async object(opts: { system: string; messages: LlmMessage[] }) {
    const user = opts.messages.at(-1)?.content ?? ''
    this.systems.push(opts.system)
    this.users.push(user)
    const keys = [...user.matchAll(/^- (\S+)$/gm)].map((m) => m[1]!)
    return {
      value: { rulings: keys.map((key) => ({ key, type: 'festival' })) },
      usage: NO_USAGE,
    }
  }
  async text() {
    return { text: '', usage: NO_USAGE }
  }
  totalCostUsd(): number {
    return 0
  }
  alert(): void {}
}

describe('★ the recognizer, from a repeated gathering to the observatory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-constructs-'))
  const minds = join(dir, 'minds')
  let arbiterDb: Database.Database
  let worldDb: Database.Database
  let gw: Gateway
  let base: string
  const llm = new ScriptedLlm()

  beforeAll(async () => {
    // The arbiter's own file, in the minds directory, exactly where the live cast opens it.
    mkdirSync(minds, { recursive: true })
    arbiterDb = openArbiterDb(join(minds, '_arbiter.db'))
    await runConstructPass({
      events: TRANSCRIPT,
      baseConfig: DEFAULT_CONFIG,
      store: new ConstructStore(arbiterDb),
      llm: llm as unknown as LlmClient,
    })

    worldDb = openDb(join(dir, 'world.db'))
    gw = await createGateway({
      dbPath: join(dir, 'world.db'),
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: worldDb,
      agentDbDir: minds,
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
