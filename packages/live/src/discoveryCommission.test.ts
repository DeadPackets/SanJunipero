import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { configureSpendLimits, makeBudgetGuard, migrateLlmTables, sumReserved } from '@sj/llm'
import { AssetCodex, encodePng, openForgeDb, type RawImage } from '@sj/forge'
import {
  CRITERIA,
  EST_COST_PER_VISION_CALL,
  type VisionCriteria,
  type VisionJudgeFn,
} from '@sj/forge/gen'
import { FORGE_CALLER, createDiscoveryArt } from './discoveryCommission.js'
import { ledgerTotalUsd } from './liveWorld.js'
import { createGateway } from '@sj/gateway'

const refsFail = vi.hoisted(() => ({ value: false }))
vi.mock('@sj/forge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sj/forge')>()
  return {
    ...actual,
    loadReferenceSheet: async (): Promise<Buffer[]> => {
      if (refsFail.value) throw new Error('the reference sheet could not be encoded')
      return actual.loadReferenceSheet()
    },
  }
})

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
const WATERSKIN = { name: 'stitch a waterskin', makes: ['waterskin'] }
/** One picture at $0.045 plus the one vision-QA call that gates it. */
const JUDGE_USD = EST_COST_PER_VISION_CALL
const ONE_COMMISSION_USD = 0.045 + JUDGE_USD

// A valid 512×512 "generation": magenta field (chroma-keyed away), sage square centred.
function generationPng(): Promise<Buffer> {
  const size = 512
  const img: RawImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const inner = x >= 128 && x < 384 && y >= 128 && y < 384
      img.data.set(inner ? [147, 181, 115, 255] : [255, 0, 255, 255], (y * size + x) * 4)
    }
  return encodePng(img)
}

describe('★ a discovery is drawn, once, out of the minds’ own wallet', () => {
  const IMAGE_USD = 0.045
  let dir: string
  let dbPath: string
  let db: ReturnType<typeof openDb>
  let opsDb: Database.Database
  let codex: AssetCodex
  let calls: string[]
  let png: Buffer

  /** The provider, with no provider: the real `makeImageClient` runs, `fetch` does not. */
  const fakeFetch: typeof fetch = async () => {
    calls.push('image')
    return new Response(
      JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { cost: IMAGE_USD } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  const judge: VisionJudgeFn = async (a) => {
    calls.push('judge')
    const criteria = Object.fromEntries(
      CRITERIA.map((k) => [k, { pass: true, score: 9, evidence: 'scripted' }]),
    ) as VisionCriteria
    return {
      costUsd: JUDGE_USD,
      verdict: {
        assetId: a.assetId,
        model: 'google/gemini-3.7-flash',
        rubricVersion: 'v1',
        criteria,
        feedback: '',
        overall: 'pass' as const,
      },
    }
  }

  const forgeRows = (): { model: string; cost_usd: number }[] =>
    opsDb
      .prepare('SELECT model, cost_usd FROM llm_calls WHERE caller = ? ORDER BY id')
      .all(FORGE_CALLER) as { model: string; cost_usd: number }[]

  const artFor = (budgetUsd: number) => {
    configureSpendLimits(opsDb, { lifetimeUsd: budgetUsd, rollingDayUsd: budgetUsd })
    return createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      judge,
    })
  }

  beforeEach(async () => {
    png = await generationPng()
    calls = []
    dir = mkdtempSync(join(tmpdir(), 'sj-commission-'))
    dbPath = join(dir, 'world.db')
    openForgeDb(dbPath).close()
    db = openDb(dbPath)
    codex = new AssetCodex(db)
    new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('commission'),
      snapshotEveryTicks: 5,
      onTick: () => {},
    }).step()
    opsDb = new Database(':memory:')
    migrateLlmTables(opsDb)
    configureSpendLimits(opsDb, { lifetimeUsd: 3, rollingDayUsd: 3 })
  })
  afterEach(() => {
    refsFail.value = false
    opsDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ placeholder → one commission → booked → the real sprite is served', async () => {
    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    const base = `http://127.0.0.1:${gw.port}`
    try {
      expect((await fetch(`${base}/assets/placeholder/item.png`)).status).toBe(200)

      const art = artFor(3)
      art.onDiscovery(WATERSKIN)
      await art.settle()

      // One asset, resolvable: class + kind + ready is the whole of the renderer's lookup.
      const records = codex.listSince(0)
      expect(records.map((r) => [r.class, r.kind, r.status])).toEqual([
        ['item', 'waterskin', 'ready'],
      ])

      // Every dollar landed in the ledger the minds bill — not beside it.
      expect(forgeRows().filter((r) => r.cost_usd === IMAGE_USD)).toHaveLength(
        calls.filter((c) => c === 'image').length,
      )
      expect(ledgerTotalUsd(opsDb)).toBeCloseTo(ONE_COMMISSION_USD, 6)

      const after = await fetch(`${base}/assets/${records[0]!.id}.png`)
      expect(after.status).toBe(200)
      expect(after.headers.get('content-type')).toBe('image/png')
    } finally {
      await gw.close()
    }
  }, 30_000)

  it('holds an in-flight image and its reviewer against concurrent text allowance', async () => {
    configureSpendLimits(opsDb, { lifetimeUsd: 1, rollingDayUsd: 1 })
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const art = createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      judge,
      fetchFn: async (...args) => {
        entered()
        await gate
        return fakeFetch(...args)
      },
    })
    art.onDiscovery(WATERSKIN)
    await waiting
    try {
      expect(sumReserved(opsDb)).toBeCloseTo(0.0505, 6)
      expect(makeBudgetGuard(opsDb, 'turn').reserve(0.75, null, null)).toHaveProperty('id')
      expect(makeBudgetGuard(opsDb, 'narrator').reserve(0.75, null, null)).toHaveProperty(
        'held',
        'budget',
      )
    } finally {
      release()
      await art.settle()
    }
    expect(ledgerTotalUsd(opsDb)).toBeCloseTo(0.0505, 6)
  }, 30_000)

  it('retains an interrupted image allowance and releases its unused reviewer allowance', async () => {
    const cancellation = new AbortController()
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const art = createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      judge,
      signal: cancellation.signal,
      fetchFn: async (_url, init) =>
        new Promise((_resolve, reject) => {
          entered()
          init!.signal!.addEventListener(
            'abort',
            () => {
              reject(init!.signal!.reason as Error)
            },
            {
              once: true,
            },
          )
        }),
    })
    art.onDiscovery(WATERSKIN)
    await waiting
    expect(sumReserved(opsDb)).toBeCloseTo(0.0505, 6)
    cancellation.abort()
    await art.settle()
    expect(sumReserved(opsDb)).toBe(0.045)
    expect(ledgerTotalUsd(opsDb)).toBe(0)
  }, 30_000)

  it('books an abort-ignoring provider once and refuses late asset writes', async () => {
    const cancellation = new AbortController()
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let requests = 0
    const art = createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      judge,
      signal: cancellation.signal,
      fetchFn: async (...args) => {
        requests++
        entered()
        await gate
        return fakeFetch(...args)
      },
    })
    art.onDiscovery(WATERSKIN)
    await waiting
    cancellation.abort()
    art.onDiscovery({ name: 'late', makes: ['cord'] })
    release()
    await art.settle()
    expect(requests).toBe(1)
    expect(ledgerTotalUsd(opsDb)).toBeCloseTo(0.045, 6)
    expect(sumReserved(opsDb)).toBe(0)
    expect(codex.listSince(0)).toEqual([])
  }, 30_000)

  it('★ once per TOWN: a restarted watcher reads the kind off the codex and pays nothing', async () => {
    const first = artFor(3)
    first.onDiscovery(WATERSKIN)
    await first.settle()
    const spent = calls.length

    const resumed = artFor(3)
    resumed.onDiscovery(WATERSKIN)
    await resumed.settle()

    expect(calls.length).toBe(spent)
    expect(codex.listSince(0)).toHaveLength(1)
  }, 30_000)

  it('★ a balance that cannot pay for the picture AND its eye buys neither', async () => {
    // 0.045 fits on its own; with the eye reserved beside it the pair is 0.0505 and refused,
    // so no money goes out — and a spend stop leaves no row, so tomorrow's balance may draw it.
    const art = artFor(0.05)
    art.onDiscovery(WATERSKIN)
    await art.settle()

    expect(calls).toEqual([])
    expect(codex.listSince(0)).toEqual([])
  }, 30_000)

  it('★ two kinds in one breath cannot both spend the last dollar', async () => {
    // $0.09 buys exactly one commission ($0.0505). Run side by side, both would read the same
    // balance and both would draw.
    const art = artFor(0.09)
    art.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin', 'cord'] })
    await art.settle()

    expect(calls.filter((c) => c === 'image')).toHaveLength(1)
    expect(codex.listSince(0).map((r) => r.status)).toEqual(['ready'])
  }, 30_000)

  it('★ a billed reply that carries no picture is still a row in the minds’ ledger', async () => {
    // The moderation-refusal shape: HTTP 200, a bill, and no image. No candidate comes back to
    // book it, so without a row the money is invisible to the daily budget.
    const noImage: typeof fetch = async () => {
      calls.push('image')
      return new Response(JSON.stringify({ usage: { cost: IMAGE_USD } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const art = createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      fetchFn: noImage,
      judge,
    })
    art.onDiscovery(WATERSKIN)
    await art.settle()

    const images = calls.filter((c) => c === 'image').length
    expect(images).toBeGreaterThan(0)
    expect(forgeRows()).toHaveLength(images)
    expect(ledgerTotalUsd(opsDb)).toBeCloseTo(images * IMAGE_USD, 6)
  }, 30_000)

  it('does not attempt global admission when discovery art is disabled', async () => {
    configureSpendLimits(opsDb, { lifetimeUsd: 0, rollingDayUsd: 0 })
    const art = createDiscoveryArt({
      codex,
      opsDb,
      artDailyUsd: 0,
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      judge,
    })
    art.onDiscovery(WATERSKIN)
    await art.settle()
    expect(calls).toEqual([])
    expect(
      opsDb.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = 'town_budget_refused'").get(),
    ).toEqual({ n: 0 })
  })

  it('★ a spent day draws nothing, spends nothing, and leaves the kind for tomorrow', async () => {
    const refused: string[] = []
    configureSpendLimits(opsDb, { lifetimeUsd: 0, rollingDayUsd: 0 })
    const art = createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      judge,
      onError: (kind) => refused.push(kind),
    })
    art.onDiscovery(WATERSKIN)
    await art.settle()

    expect(calls).toEqual([])
    expect(codex.listSince(0)).toEqual([])
    expect(forgeRows()).toEqual([])
    expect(refused).toEqual(['waterskin'])

    // The refusal is not a verdict on the kind: the window rolls, and the next discovery draws it.
    configureSpendLimits(opsDb, { lifetimeUsd: 3, rollingDayUsd: 3 })
    const tomorrow = createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      judge,
    })
    tomorrow.onDiscovery(WATERSKIN)
    await tomorrow.settle()
    expect(codex.listSince(0).map((r) => r.kind)).toEqual(['waterskin'])
  }, 30_000)

  it('a reference sheet that fails once does not disable art for the whole process', async () => {
    refsFail.value = true
    const refused: string[] = []
    const art = createDiscoveryArt({
      codex,
      opsDb,
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      judge,
      onError: (kind) => refused.push(kind),
    })
    art.onDiscovery(WATERSKIN)
    await art.settle()
    expect(refused).toEqual(['waterskin'])
    expect(codex.listSince(0)).toEqual([])

    refsFail.value = false
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60_001)
    art.retry()
    await art.settle()
    clock.mockRestore()
    expect(codex.listSince(0).map((r) => [r.kind, r.status])).toEqual([['waterskin', 'ready']])
  }, 30_000)

  it('a run with no API key draws nothing at all', () => {
    const art = createDiscoveryArt({ codex, opsDb, apiKey: undefined })
    art.onDiscovery(WATERSKIN)
    expect(calls).toEqual([])
    expect(codex.listSince(0)).toEqual([])
  })
})

describe('the commission path is live-only, and it IS wired', () => {
  const importsOf = (name: string): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), 'utf8')
      .split('\n')
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom '[.@]/.test(l))
      .join('\n')

  it('the watcher g11 imports stays clear of the SDK the commission loads', () => {
    // `discoveryCommission.ts` imports `@sj/forge/gen`, 9.7 MB of LLM SDK; the free stream must
    // not load it, which `town/src/liveSeam.test.ts` walks the package graph for.
    expect(importsOf('discoveryArt.ts')).not.toContain('@sj/forge/gen')
    expect(importsOf('liveWorld.ts')).toContain('discoveryCommission')
  })

  it('the eye it hands the forge is the 7-criterion rubric, not a single score', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'discoveryCommission.ts'),
      'utf8',
    )
    expect(src).toContain('makeVisionJudge')
    expect(src).not.toContain('makeVlmJudge')
  })

  it('the eye is built with the forge config the operator set, not the defaults', () => {
    // `makeVisionJudge` falls back to DEFAULT_FORGE_CONFIG, and it is the eye — not the gate —
    // that draws the retry-vs-blocked line.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'discoveryCommission.ts'),
      'utf8',
    )
    expect(src).toContain('const config = loadForgeConfig()')
    expect(src).toMatch(/makeVisionJudge\(\{[^}]*\bconfig,/)
  })

  it('liveWorld commissions on the codification', () => {
    const live = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'liveWorld.ts'), 'utf8')
    expect(live).toContain('createDiscoveryArt(')
    expect(live).toContain('art.onDiscovery(')
  })
})
