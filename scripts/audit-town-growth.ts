import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  DEFAULT_CONFIG,
  ADULT_AGE_DAYS,
  POPULATION_MAX_DEFAULT,
} from '../packages/shared/src/index.js'
import {
  fold,
  genesisState,
  searchPath,
  unregisterVerb,
  type TileId,
} from '../packages/engine/src/index.js'
import { EventStore, openDb, packState } from '../packages/engine/src/store.js'
import { AssetCodex, openForgeDb, encodePng, decodePng } from '../packages/forge/src/index.js'
import {
  expressiveRow,
  makeArbiter,
  openArbiterDb,
  RulebookStore,
} from '../packages/arbiter/src/index.js'
import { renderRoster } from '../packages/agents/src/prompt/rulesOfBeing.js'
import type { LlmClient } from '../packages/llm/src/index.js'

const dir = mkdtempSync(join(tmpdir(), 'sj-growth-'))
const measurements = []
try {
  const png = await encodePng({
    width: 512,
    height: 512,
    data: new Uint8ClampedArray(512 * 512 * 4).fill(180),
  })
  for (const side of [32, 64, 128, 256]) {
    const worldPath = join(dir, `world-${side}.db`)
    const arbiterPath = join(dir, `arbiter-${side}.db`)
    openForgeDb(worldPath).close()
    const worldDb = openDb(worldPath)
    const arbiterDb = openArbiterDb(arbiterPath)
    const store = new EventStore(worldDb)
    const rulebook = new RulebookStore(arbiterDb)
    const minted: string[] = []
    try {
      const terrain: TileId[][] = Array.from({ length: side }, (_, y) =>
        Array.from({ length: side }, (_, x) => (x === side / 2 && y < side - 1 ? 2 : 0)),
      )
      let state = genesisState(DEFAULT_CONFIG, terrain)
      const append = (type: string, payload: unknown) => {
        state = fold(state, store.append(0, type, payload), DEFAULT_CONFIG)
      }
      const people = Math.min(POPULATION_MAX_DEFAULT, side / 8)
      worldDb.transaction(() => {
        for (let i = 0; i < people; i++)
          append('agent_spawned', {
            id: `person_${i}`,
            name: `Person ${i}`,
            ageDays: ADULT_AGE_DAYS,
            x: 1 + i,
            y: 1,
          })
        for (let i = 0; i < side * 4; i++)
          append('item_spawned', {
            id: `item_${i}`,
            kind: 'wood',
            qty: 1,
            loc: { t: 'tile', x: i % side, y: Math.floor(i / side) + 3 },
          })
        for (let i = 0; i < side / 8; i++)
          append('structure_planned', {
            id: `structure_${i}`,
            kind: 'house',
            x: 1 + i * 3,
            y: side - 5,
            w: 2,
            h: 2,
            maxHp: 100,
            flammable: true,
            builderId: 'person_0',
          })
        store.saveSnapshot(0, store.lastSeq(), state, {})
      })()
      const codex = new AssetCodex(worldDb)
      let decodedTextureBytes = 0
      for (let i = 0; i < side / 4; i++) {
        const asset = codex.register({
          class: 'item',
          kind: `fixture_${i}`,
          desc: `Fixture ${i}`,
          footprint: { w: 1, h: 1 },
          png,
          widthPx: 512,
          heightPx: 512,
          status: 'ready',
          score: 9,
          attempts: 1,
          costUsd: 0,
        })
        const stored = codex.get(asset.id)
        if (stored === null) throw new Error('registered fixture asset missing')
        decodedTextureBytes += (await decodePng(stored.png)).data.byteLength
      }
      for (let i = 0; i < side / 2; i++) {
        const word = `song${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`
        const row = expressiveRow({
          word,
          sense: 'sound',
          takes: 'minutes',
          energyCost: 1,
          targeted: false,
          emote: 'Sings a tune by the fire.',
        })
        rulebook.insert(row, 0)
        minted.push(row.id)
      }
      const llm = {
        forCaller: () => llm,
        alert: () => {
          throw new Error('unexpected fixture alert')
        },
      } as unknown as LlmClient
      const arbiter = makeArbiter({
        db: arbiterDb,
        llm,
        embedder: {
          embed: () => Promise.reject(new Error('growth audit must not infer')),
        },
      })
      const roster = renderRoster(arbiter.roster())
      let pathRefusals = 0
      let pathCapped = 0
      const started = performance.now()
      for (let i = 0; i < 64; i++) {
        const result = searchPath(
          state,
          { x: 1, y: 1 },
          { x: i % 2 === 0 ? side - 2 : side / 2 - 2, y: 1 + (i % (side - 2)) },
          DEFAULT_CONFIG,
        )
        if (result === null) pathRefusals++
        else if (result.capped) pathCapped++
      }
      const pathMs = performance.now() - started
      worldDb.pragma('wal_checkpoint(TRUNCATE)')
      arbiterDb.pragma('wal_checkpoint(TRUNCATE)')
      measurements.push({
        side,
        cells: side * side,
        agents: people,
        entities:
          Object.keys(state.agents).length +
          Object.keys(state.items).length +
          Object.keys(state.structures).length,
        worldDatabaseBytes: statSync(worldPath).size,
        arbiterDatabaseBytes: statSync(arbiterPath).size,
        snapshotJsonBytes: Buffer.byteLength(JSON.stringify(state)),
        snapshotGzipBytes: packState(state).byteLength,
        activeRules: arbiter.roster().length,
        rosterTokensEstimated: Math.ceil(roster.length / 4),
        pathQueries: 64,
        pathRefusals,
        pathCapped,
        pathMs: Math.round(pathMs * 100) / 100,
        assets: codex.listSince(0).length,
        decodedTextureBytes,
      })
    } finally {
      for (const id of minted) unregisterVerb(id)
      store.close()
      worldDb.close()
      arbiterDb.close()
    }
  }
  console.log(
    JSON.stringify(
      {
        fixture:
          'Synthetic grass town with a water wall and one far gap; no provider calls or network.',
        limits: { population: POPULATION_MAX_DEFAULT, pathNodes: DEFAULT_CONFIG.pathing.maxNodes },
        assumptions: [
          'Database bytes are checkpointed main files; snapshots and history are retained.',
          'Roster tokens use the existing chars/4 estimate, not a provider tokenizer.',
          'Decoded bytes sum actual RGBA decode lengths for all fixture assets resident together; excludes GPU copies, mipmaps and browser overhead.',
          'This measures fixtures, not production capacity or concurrent viewer throughput. Existing population and viewer safeguards are unchanged.',
        ],
        measurements,
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}
