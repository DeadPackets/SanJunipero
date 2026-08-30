import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { migrateLlmTables } from '@sj/llm'
import { AssetCodex, encodePng, openForgeDb, type RawImage } from '@sj/forge'
import { CRITERIA, type VisionCriteria, type VisionJudgeFn } from '@sj/forge/gen'
import { FORGE_CALLER, createDiscoveryArt } from './discoveryCommission.js'
import { ledgerTotalUsd } from './liveWorld.js'
import { createGateway } from '@sj/gateway'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
const WATERSKIN = { name: 'stitch a waterskin', makes: ['waterskin'] }
/** One picture at $0.045 plus the one vision-QA call that gates it. */
const JUDGE_USD = 0.0055
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

  const artFor = (budgetUsd: number) =>
    createDiscoveryArt({
      codex,
      opsDb,
      spendableUsd: () => budgetUsd - ledgerTotalUsd(opsDb),
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      judge,
    })

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
  })
  afterEach(() => {
    opsDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ placeholder → one commission → booked → the real sprite is served', async () => {
    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    const base = `http://127.0.0.1:${gw.port}`
    try {
      // Before: the item has no art, and the placeholder assetsHttp serves is what stands in.
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

      // After: the same URL the viewer builds from the codex row serves the art it paid for.
      const after = await fetch(`${base}/assets/${records[0]!.id}.png`)
      expect(after.status).toBe(200)
      expect(after.headers.get('content-type')).toBe('image/png')
    } finally {
      await gw.close()
    }
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

  it('★ the budget is consulted per call: $0.05 buys the picture but not the eye', async () => {
    // 0.045 fits; the vision call that gates it would total 0.0505 and is refused, so nothing
    // reaches the codex but the placeholder.
    const art = artFor(0.05)
    art.onDiscovery(WATERSKIN)
    await art.settle()

    expect(calls).toEqual(['image'])
    expect(codex.listSince(0).map((r) => r.status)).toEqual(['placeholder'])
  }, 30_000)

  it('★ two kinds in one breath cannot both spend the last dollar', async () => {
    // $0.09 buys exactly one commission ($0.0505). Run side by side, both would read the same
    // balance and both would draw.
    const art = artFor(0.09)
    art.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin', 'cord'] })
    await art.settle()

    expect(calls.filter((c) => c === 'image')).toHaveLength(1)
    expect(codex.listSince(0).filter((r) => r.status === 'ready')).toHaveLength(1)
    expect(codex.listSince(0).filter((r) => r.status === 'placeholder')).toHaveLength(1)
  }, 30_000)

  it('★ a spent day draws nothing, spends nothing, and leaves the kind for tomorrow', async () => {
    const refused: string[] = []
    let budgetUsd = 0
    const art = createDiscoveryArt({
      codex,
      opsDb,
      spendableUsd: () => budgetUsd - ledgerTotalUsd(opsDb),
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
    budgetUsd = 3
    art.onDiscovery(WATERSKIN)
    await art.settle()
    expect(codex.listSince(0).map((r) => r.kind)).toEqual(['waterskin'])
  }, 30_000)

  it('a run with no API key draws nothing at all', () => {
    const art = createDiscoveryArt({ codex, opsDb, spendableUsd: () => 3, apiKey: undefined })
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

  it('liveWorld commissions on the codification', () => {
    const live = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'liveWorld.ts'), 'utf8')
    expect(live).toContain('createDiscoveryArt(')
    expect(live).toContain('art.onDiscovery(')
  })
})
