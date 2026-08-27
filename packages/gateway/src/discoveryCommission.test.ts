import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { migrateLlmTables } from '@sj/agents'
import { AssetCodex, encodePng, openForgeDb, type RawImage } from '@sj/forge'
import type { JudgeFn } from '@sj/forge/gen'
import { FORGE_CALLER, createDiscoveryArt } from './discoveryArt.js'
import { createGateway, type Gateway } from './server.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
const DAILY_USD = 3
const WATERSKIN = { name: 'stitch a waterskin', makes: ['waterskin'] }

// A valid 512×512 "generation": magenta field (chroma-keyed away), sage square centred.
function generationPng(): Promise<Buffer> {
  const size = 512
  const img: RawImage = {
    width: size,
    height: size,
    data: new Uint8ClampedArray(size * size * 4),
  }
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
  let db: ReturnType<typeof openDb>
  let opsDb: Database.Database
  let codex: AssetCodex
  let gw: Gateway
  let base: string
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
  const judge: JudgeFn = async () => {
    calls.push('judge')
    return { score: 9, notes: 'scripted' }
  }

  const spentToday = (): number =>
    (opsDb.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS t FROM llm_calls').get() as { t: number })
      .t
  const forgeRows = (): { model: string; cost_usd: number }[] =>
    opsDb
      .prepare('SELECT model, cost_usd FROM llm_calls WHERE caller = ? ORDER BY id')
      .all(FORGE_CALLER) as { model: string; cost_usd: number }[]

  const artFor = (spent: () => number = spentToday) =>
    createDiscoveryArt({
      codex,
      opsDb,
      dailyBudgetUsd: DAILY_USD,
      spentTodayUsd: spent,
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      judge,
    })

  beforeEach(async () => {
    png = await generationPng()
    calls = []
    dir = mkdtempSync(join(tmpdir(), 'sj-commission-'))
    const dbPath = join(dir, 'world.db')
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
    gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    base = `http://127.0.0.1:${gw.port}`
  })
  afterEach(async () => {
    await gw.close()
    opsDb.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ placeholder → one commission → booked → the real sprite is served', async () => {
    // Before: the item has no art, and the placeholder assetsHttp serves is what stands in.
    const before = await fetch(`${base}/assets/placeholder/item.png`)
    expect(before.status).toBe(200)
    expect(before.headers.get('content-type')).toBe('image/png')

    const art = artFor()
    art.onDiscovery(WATERSKIN)
    await art.settle()

    // One asset, resolvable: class + kind + ready is the whole of the renderer's lookup.
    const records = codex.listSince(0)
    expect(records.map((r) => [r.class, r.kind, r.status])).toEqual([
      ['item', 'waterskin', 'ready'],
    ])

    // Every dollar landed in the ledger the minds bill — not beside it.
    const rows = forgeRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(spentToday()).toBeCloseTo(
      rows.reduce((s, r) => s + r.cost_usd, 0),
      10,
    )
    expect(rows.filter((r) => r.cost_usd === IMAGE_USD)).toHaveLength(
      calls.filter((c) => c === 'image').length,
    )

    // After: the same URL the viewer builds from the codex row serves the art it paid for.
    const after = await fetch(`${base}/assets/${records[0]!.id}.png`)
    expect(after.status).toBe(200)
    expect(after.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await after.arrayBuffer()).length).toBeGreaterThan(0)

    // And a second discovery of the same kind pays nothing.
    const spent = calls.length
    art.onDiscovery({ name: 'stitch another', makes: ['waterskin'] })
    await art.settle()
    expect(calls.length).toBe(spent)
    expect(codex.listSince(0)).toHaveLength(1)
  }, 30_000)

  it('★ the budget is consulted per image: a day with $0.05 left buys one, not three', async () => {
    // 0.045 fits; the second reservation would total 0.09 and is refused, so the commission
    // ships on the one candidate that was paid for.
    const art = artFor(() => DAILY_USD - 0.05)
    art.onDiscovery(WATERSKIN)
    await art.settle()

    expect(calls.filter((c) => c === 'image')).toHaveLength(1)
    expect(codex.listSince(0).map((r) => r.status)).toEqual(['ready'])
  }, 30_000)

  it('★ a spent day draws nothing, spends nothing, and leaves the kind for tomorrow', async () => {
    const refused: string[] = []
    let spent = DAILY_USD
    const art = createDiscoveryArt({
      codex,
      opsDb,
      dailyBudgetUsd: DAILY_USD,
      spentTodayUsd: () => spent,
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
    spent = 0
    art.onDiscovery(WATERSKIN)
    await art.settle()
    expect(codex.listSince(0).map((r) => r.kind)).toEqual(['waterskin'])
  }, 30_000)
})

describe('the commission path is live-only, and it IS wired', () => {
  const src = (name: string): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), 'utf8')

  it('no scripted gateway file reaches the commission path or the SDK behind it', () => {
    // `discoveryArt.ts` imports `@sj/forge/gen`, 9.7 MB of LLM SDK. The free stream must not
    // load it, and the only file allowed to is the one behind the SJ_LIVE dynamic import.
    const scripted = [
      'devWorld.ts',
      'founders.ts',
      'server.ts',
      'api.ts',
      'serve.ts',
      'assetsHttp.ts',
    ]
    for (const file of scripted) {
      expect(src(file), file).not.toContain('discoveryArt')
      expect(src(file), file).not.toContain('@sj/forge/gen')
    }
  })

  it('liveWorld commissions on the codification, after the world has been told', () => {
    const live = src('liveWorld.ts')
    const wired = ['createDiscoveryArt(', 'bridge?.announce(', 'art.onDiscovery('].map((n) =>
      live.indexOf(n),
    )
    expect(
      wired.every((i) => i > 0),
      'the commission path is not wired',
    ).toBe(true)
    expect([...wired].sort((a, b) => a - b)).toEqual(wired) // in that order
  })
})
