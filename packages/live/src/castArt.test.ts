import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CharacterAtlasManifestSchema, DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { migrateLlmTables } from '@sj/llm'
import {
  AssetCodex,
  CAST_CONTENT_DIR,
  CAST_V5,
  CHARACTER_IMAGES_MIN,
  characterKind,
  encodePng,
  onMagenta,
  openForgeDb,
  registerCommittedCast,
  trimToFigure,
  downscaleNearest,
  decodePng,
  CHAR_CELL_PX,
  type RawImage,
} from '@sj/forge'
import { LIVE_ART_DAILY_USD, noCastArt, type NewPerson } from './castArt.js'
import { FORGE_CALLER, artSpentUsd, createCastArt, lookOf } from './discoveryCommission.js'
import { ledgerTotalUsd } from './liveWorld.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
/** What one 2048² generation bills at. Eight of them is the ~$1.15 a person costs. */
const IMAGE_USD = 0.1437
const RAW_FACTOR = 2048 / CHAR_CELL_PX

const person = (id: string, over: Partial<NewPerson> = {}): NewPerson => ({
  id,
  name: 'Mira',
  sex: 'f',
  ageYears: 31,
  parents: null,
  ...over,
})

/** The provider is a committed sheet: every "generation" is a real cell off a shipped character,
 *  so the gates read art that once passed them and no image is ever bought. */
async function fixtureProvider(id: string): Promise<{ cell: (name: string) => RawImage }> {
  const dir = join(CAST_CONTENT_DIR, id)
  const atlas = await decodePng(readFileSync(join(dir, 'atlas.webp')))
  const { cells } = CharacterAtlasManifestSchema.parse(
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')),
  )
  return {
    cell: (name) => {
      const r = cells[name]!
      const out: RawImage = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) }
      for (let y = 0; y < r.h; y++) {
        const s = ((r.y + y) * atlas.width + r.x) * 4
        out.data.set(atlas.data.subarray(s, s + r.w * 4), y * r.w * 4)
      }
      const t = trimToFigure(out)
      return downscaleNearest(t, t.width * RAW_FACTOR, t.height * RAW_FACTOR)
    },
  }
}

describe('★ a face for a person the town made, out of the minds’ own wallet', () => {
  let dir: string
  let db: ReturnType<typeof openDb>
  let opsDb: Database.Database
  let codex: AssetCodex
  let bought: string[]
  let errors: string[]
  let fakeFetch: typeof fetch

  const forgeRows = (): { cost_usd: number }[] =>
    opsDb
      .prepare('SELECT cost_usd FROM llm_calls WHERE caller = ? ORDER BY id')
      .all(FORGE_CALLER) as { cost_usd: number }[]

  const artFor = (over: { artDailyUsd?: number; runUsd?: number } = {}) =>
    createCastArt({
      codex,
      opsDb,
      spendableUsd: () => (over.runUsd ?? 3) - ledgerTotalUsd(opsDb),
      apiKey: 'not-a-key',
      fetchFn: fakeFetch,
      onError: (k, e) => {
        errors.push(`${k}: ${String(e).slice(0, 300)}`)
      },
      onNote: (id, line) => {
        if (process.env.SJ_DEBUG_ART) console.log(`${id} ${line}`)
      },
      ...(over.artDailyUsd === undefined ? {} : { artDailyUsd: over.artDailyUsd }),
    })

  beforeEach(async () => {
    bought = []
    errors = []
    dir = mkdtempSync(join(tmpdir(), 'sj-castart-'))
    const dbPath = join(dir, 'world.db')
    openForgeDb(dbPath).close()
    db = openDb(dbPath)
    codex = new AssetCodex(db)
    new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('castart'),
      snapshotEveryTicks: 5,
      onTick: () => {},
    }).step()
    opsDb = new Database(':memory:')
    migrateLlmTables(opsDb)

    // THE PROVIDER IS A COMMITTED SHEET. The real `characterImageClient` runs and books every
    // reply; `fetch` does not, and the picture it gets back is art that once passed these gates.
    const { cell } = await fixtureProvider('mira')
    fakeFetch = async (_url, init) => {
      const prompt = (JSON.parse((init as { body: string }).body) as { prompt: string }).prompt
      bought.push(cellAsked(prompt))
      const png = prompt.includes('Exactly TWO figures')
        ? await pairPng(cell)
        : await encodePng(onMagenta(cell(cellAsked(prompt))))
      return new Response(
        JSON.stringify({
          data: [{ b64_json: png.toString('base64') }],
          usage: { cost: IMAGE_USD },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
  })
  afterEach(() => {
    opsDb.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ commissions nothing for a founder whose sheet is already committed', async () => {
    registerCommittedCast(codex)
    const art = artFor()
    art.onPerson(person('mira'))
    await art.settle()
    expect(bought).toEqual([])
  })

  it('★ draws a stranger once, registers them the way a committed sheet registers, and stops', async () => {
    const art = artFor()
    art.onPerson(person('agent_41'))
    await art.settle()

    const rec = codex.listSince(0).filter((r) => r.kind === characterKind('agent_41'))
    expect(rec.map((r) => [r.class, r.status])).toEqual([['rig-part', 'ready']])
    // The meta is the manifest exactly as `registerCommittedCast` writes one.
    expect(() => CharacterAtlasManifestSchema.parse(JSON.parse(rec[0]!.meta ?? '{}'))).not.toThrow()
    expect(rec[0]!.widthPx).toBeGreaterThan(0)

    // A second call is a no-op: the codex already knows the kind.
    const spent = bought.length
    art.onPerson(person('agent_41'))
    await art.settle()
    expect(bought).toHaveLength(spent)
  }, 90_000)

  it('★ every picture is a row in the minds’ ledger, and a person costs eight of them', async () => {
    const art = artFor()
    art.onPerson(person('agent_41'))
    await art.settle()

    expect(errors).toEqual([])
    expect(bought).toHaveLength(CHARACTER_IMAGES_MIN)
    expect(forgeRows()).toHaveLength(CHARACTER_IMAGES_MIN)
    expect(artSpentUsd(opsDb)).toBeCloseTo(CHARACTER_IMAGES_MIN * IMAGE_USD, 4)
    // ~$1.15: one person is under half of a $3 day and inside the $1.25 the day gives to art.
    expect(artSpentUsd(opsDb)).toBeLessThan(LIVE_ART_DAILY_USD)
  }, 90_000)

  it('★ two people in one breath are drawn one at a time, and the day’s cap stops the second', async () => {
    const art = artFor()
    art.onPerson(person('agent_41'))
    art.onPerson(person('agent_42'))
    await art.settle()

    const drawn = codex.listSince(0).filter((r) => r.class === 'rig-part')
    expect(drawn, 'the day bought two faces out of money for one').toHaveLength(1)
    expect(drawn[0]!.kind).toBe(characterKind('agent_41'))
    expect(artSpentUsd(opsDb)).toBeLessThanOrEqual(LIVE_ART_DAILY_USD + IMAGE_USD)
  }, 120_000)

  it('★ and the one the cap refused is picked up by the next boot', async () => {
    const spent = artFor()
    spent.onPerson(person('agent_41'))
    spent.onPerson(person('agent_42'))
    await spent.settle()
    expect(codex.listSince(0).filter((r) => r.class === 'rig-part')).toHaveLength(1)

    // A new day: the window has rolled, and the boot re-check walks the living cast again.
    opsDb.exec('DELETE FROM llm_calls')
    const tomorrow = artFor()
    tomorrow.onPerson(person('agent_41'))
    tomorrow.onPerson(person('agent_42'))
    await tomorrow.settle()
    expect(
      codex
        .listSince(0)
        .filter((r) => r.class === 'rig-part')
        .map((r) => r.kind)
        .sort(),
    ).toEqual([characterKind('agent_41'), characterKind('agent_42')])
  }, 180_000)

  it('a day with no art money draws nothing and spends nothing', async () => {
    const art = artFor({ artDailyUsd: 0 })
    art.onPerson(person('agent_41'))
    await art.settle()
    expect(bought).toEqual([])
    expect(codex.listSince(0)).toEqual([])
  })

  it('a run with no API key draws nothing at all', () => {
    const art = createCastArt({ codex, opsDb, spendableUsd: () => 3, apiKey: undefined })
    art.onPerson(person('agent_41'))
    expect(bought).toEqual([])
    expect(codex.listSince(0)).toEqual([])
  })
})

describe('who a person is drawn as', () => {
  it('keeps the authored design for an authored id, and derives one for anybody else', () => {
    const mira = CAST_V5.find((c) => c.id === 'mira')!
    expect(lookOf({ id: 'mira', name: 'Mira', sex: 'f', ageYears: 31, parents: null })).toEqual(
      mira,
    )
    const stranger = lookOf({
      id: 'agent_41',
      name: 'Nadia',
      sex: 'f',
      ageYears: 31,
      parents: null,
    })
    expect(stranger.id).toBe('agent_41')
    expect(stranger.desc).not.toEqual(mira.desc)
  })
})

describe('a town that draws no faces still lets people in', () => {
  it('takes a person and settles', async () => {
    const art = noCastArt()
    art.onPerson(person('agent_41'))
    await expect(art.settle()).resolves.toBeUndefined()
  })
})

/** Which cell a prompt is asking for, read the way a model would read it. */
function cellAsked(prompt: string): string {
  if (prompt.includes('Exactly TWO figures')) return 'master'
  if (prompt.includes('fast asleep')) return 'sleep-se'
  const facing = prompt.includes('The figure is the front three-quarter') ? 'se' : 'ne'
  const pose = prompt.includes('CONTACT pose A')
    ? 'contact-a'
    : prompt.includes('CONTACT pose B')
      ? 'contact-b'
      : 'passing-a'
  return `${pose}-${facing}`
}

async function pairPng(cell: (name: string) => RawImage): Promise<Buffer> {
  const se = cell('idle-se'),
    ne = cell('idle-ne')
  const gap = Math.round(Math.max(se.width, ne.width) * 0.5)
  const width = se.width + gap + ne.width
  const height = Math.max(se.height, ne.height)
  const pair: RawImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (const [img, ox] of [
    [se, 0],
    [ne, se.width + gap],
  ] as const) {
    const oy = height - img.height
    for (let y = 0; y < img.height; y++)
      pair.data.set(
        img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4),
        ((oy + y) * width + ox) * 4,
      )
  }
  return encodePng(onMagenta(pair))
}
