import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  ADULT_AGE_DAYS,
  BondsResponseSchema,
  DEFAULT_CONFIG,
  MomentsResponseSchema,
  ROAD_AUTOTILE_KEYS,
  TERRAIN_TILE_KINDS,
  momentToTick,
  parseTerrainTileManifest,
  roadAutotileKind,
  tickToMoment,
  T_ROAD,
  type ChronicleEntry,
} from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { AssetCodex, openForgeDb, registerTerrainTiles } from '@sj/forge'
import { NARRATOR_DDL } from '@sj/shared/narratorSchema'
import { WorldMirror, createGateway, type Gateway } from '@sj/gateway'
import {
  PLAZA_TILE,
  makeShowcaseMap,
  roadReach,
  showcaseDoorTile,
  showcaseTerrain,
} from './showcaseMap.js'
import { ingestTerrainArt } from './ingestArt.js'

// The renderer-side half lives in packages/web/src/render/g10.test.ts: the web package is
// DOM-typed and bundler-resolved, so a gateway test cannot import from it without breaking `tsc -b`.

const GRASS: TileId[][] = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => 0))

function openNarratorFixtureDb(path: string): Database.Database {
  const db = new Database(path)
  db.exec(NARRATOR_DDL)
  return db
}

// One scripted day the whole read surface can be measured against.
function scriptedWorld(dbPath: string): Database.Database {
  const db = openDb(dbPath)
  const loop = new TickLoop({
    store: new EventStore(db),
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('g10'),
    snapshotEveryTicks: 25,
    onTick: ({ tick, emit }) => {
      if (tick === 1) {
        emit('agent_spawned', { id: 'amara', name: 'Amara', x: 2, y: 2, ageDays: ADULT_AGE_DAYS })
        emit('agent_spawned', { id: 'yusuf', name: 'Yusuf', x: 2, y: 3, ageDays: ADULT_AGE_DAYS })
        emit('agent_spawned', { id: 'nadia', name: 'Nadia', x: 9, y: 9, ageDays: ADULT_AGE_DAYS })
      }
      if (tick === 4) {
        emit('structure_planned', {
          id: 'house1',
          kind: 'house',
          x: 2,
          y: 2,
          w: 2,
          h: 2,
          maxHp: 50,
          flammable: true,
          builderId: 'yusuf',
        })
      }
      if (tick === 8) emit('structure_completed', { id: 'house1' })
      if (tick === 12)
        emit('item_spawned', {
          id: 'i1',
          kind: 'bread',
          qty: 2,
          loc: { t: 'structure', id: 'house1' },
        })
      if (tick === 16) emit('agent_entered', { agentId: 'amara', structureId: 'house1' })
      if (tick === 17) emit('agent_entered', { agentId: 'yusuf', structureId: 'house1' })
      if (tick === 20) emit('agent_slept', { agentId: 'amara' })
      if (tick === 24) emit('co_slept', { aId: 'amara', bId: 'yusuf', day: 0 })
      if (tick === 30) emit('agent_died', { agentId: 'nadia', cause: 'hunger' })
    },
  })
  for (let i = 0; i < 40; i++) loop.step()
  return db
}

describe('GATE G10 — automated half, gateway side', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-g10-'))
  let gw: Gateway
  let bare: Gateway // the same world with no narrator.db behind it
  let base: string
  let bareBase: string

  beforeAll(async () => {
    const dbPath = join(dir, 'world.db')
    const db = scriptedWorld(dbPath)

    const narratorPath = join(dir, 'narrator.db')
    const ndb = openNarratorFixtureDb(narratorPath)
    ndb
      .prepare(
        'INSERT INTO chapters (day, title, text, citations, scene_ids) VALUES (?, ?, ?, ?, ?)',
      )
      .run(0, 'The First Morning', 'They woke.', '[]', '[]')
    ndb
      .prepare('INSERT INTO milestones (kind, label, event_seq, day, tick) VALUES (?, ?, ?, ?, ?)')
      .run('first_death', 'The first death', 9000, 0, 30)
    ndb
      .prepare(
        'INSERT INTO scenes (day, start_tick, end_tick, event_ids, "cast", location) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(0, 8, 30, '[1,2]', '["amara","yusuf"]', 'the house')
    ndb.close()

    gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      narratorDbPath: narratorPath,
    })
    base = `http://127.0.0.1:${gw.port}`

    const bareDbPath = join(dir, 'bare.db')
    const bareDb = scriptedWorld(bareDbPath)
    bare = await createGateway({
      dbPath: bareDbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: bareDb,
      narratorDbPath: join(dir, 'no-such-narrator.db'),
    })
    bareBase = `http://127.0.0.1:${bare.port}`
  }, 60_000)

  afterAll(async () => {
    await gw.close()
    await bare.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('1. tileset + map', () => {
    it('lays a road-connected showcase town the engine can walk', () => {
      const map = makeShowcaseMap()
      const reach = roadReach(map)
      expect(reach.size).toBeGreaterThan(0)
      const roads = map.terrain.flat().filter((t) => t === T_ROAD).length
      expect(reach.size).toBe(roads) // every road tile, one lattice
      for (const s of map.structures) {
        const d = showcaseDoorTile(s)
        const touchesRoad = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, 0],
        ].some(([dx, dy]) => map.terrain[d.y + dy!]?.[d.x + dx!] === T_ROAD)
        expect(touchesRoad, `${s.kind} at ${d.x},${d.y} has no road at its door`).toBe(true)
      }
    })

    it('has a codex record for every tile the showcase map actually uses', async () => {
      const fdb = openForgeDb(':memory:')
      try {
        const recs = await registerTerrainTiles(new AssetCodex(fdb))
        const kinds = new Set(recs.filter((r) => r.status === 'ready').map((r) => r.kind))
        for (const k of TERRAIN_TILE_KINDS) expect(kinds).toContain(k)
        // every junction shape a road lattice can ask for
        for (const key of ROAD_AUTOTILE_KEYS) expect(kinds).toContain(roadAutotileKind(key))
        for (const r of recs) {
          if (r.kind!.startsWith('road:')) continue
          expect(parseTerrainTileManifest(r.meta)).not.toBeNull()
        }
      } finally {
        fdb.close()
      }
    })

    it('serves those records to a viewer, so the ground can stop being flat', async () => {
      const fdb = openForgeDb(join(dir, 'tiles.db'))
      try {
        await ingestTerrainArt(fdb)
        const ready = new AssetCodex(fdb).listSince(0).filter((r) => r.class === 'terrain')
        // one continuous material per ground — what the bake samples in world space — plus the
        // calm ribbon surface, on top of the flat per-tile fallback set and the road strip
        const materials = ready.filter((r) => r.kind!.startsWith('material:'))
        expect(materials).toHaveLength(TERRAIN_TILE_KINDS.length + 1)
        expect(materials.map((r) => r.kind)).toContain('material:road-calm')
        expect(ready).toHaveLength(
          TERRAIN_TILE_KINDS.length + 1 + TERRAIN_TILE_KINDS.length * 4 + ROAD_AUTOTILE_KEYS.length,
        )
      } finally {
        fdb.close()
      }
    })
  })

  describe('2. determinism', () => {
    it('paints byte-identical tiles across two fresh codexes', async () => {
      const a = openForgeDb(':memory:'),
        b = openForgeDb(':memory:')
      try {
        const ca = new AssetCodex(a),
          cb = new AssetCodex(b)
        const ra = await registerTerrainTiles(ca),
          rb = await registerTerrainTiles(cb)
        expect(ra.map((r) => r.kind)).toEqual(rb.map((r) => r.kind))
        for (let i = 0; i < ra.length; i++) {
          expect(ca.get(ra[i]!.id)!.png.equals(cb.get(rb[i]!.id)!.png), ra[i]!.kind ?? '?').toBe(
            true,
          )
        }
      } finally {
        a.close()
        b.close()
      }
    })

    it('builds the same showcase town twice', () => {
      expect(makeShowcaseMap()).toEqual(makeShowcaseMap())
      expect(showcaseTerrain()).toEqual(showcaseTerrain())
    })

    it('round-trips every deep-linkable moment', () => {
      for (const tick of [0, 1, 59, 60, 1439, 1440, 4321]) {
        const m = tickToMoment(tick)
        expect(momentToTick(m.day, m.time)).toBeLessThanOrEqual(tick)
        expect(tickToMoment(momentToTick(m.day, m.time))).toEqual(m)
      }
      expect(momentToTick(tickToMoment(1440).day, tickToMoment(1440).time)).toBe(1440)
    })
  })

  describe('3. chronicle, bonds and moments over one scripted day', () => {
    const get = async <T>(path: string, root = base): Promise<T> => {
      const res = await fetch(`${root}${path}`)
      expect(res.status, path).toBe(200)
      return (await res.json()) as T
    }

    it('remembers only what a town would, in the order it happened', async () => {
      const { entries } = await get<{ entries: ChronicleEntry[] }>('/api/chronicle')
      expect(entries.map((e) => e.type)).toEqual([
        'structure_completed',
        'co_slept',
        'agent_died',
        'first',
      ])
      const ticks = entries.map((e) => e.tick)
      expect([...ticks].sort((p, q) => p - q)).toEqual(ticks)
      for (const e of entries) expect(e.label.length).toBeGreaterThan(0)
    })

    it('reads the pair who kept house as a partnership, and nobody else', async () => {
      const body = BondsResponseSchema.parse(await get('/api/bonds'))
      const partners = body.bonds.filter((b) => b.kind === 'partner')
      expect(partners).toHaveLength(1)
      expect([partners[0]!.aId, partners[0]!.bId].sort()).toEqual(['amara', 'yusuf'])
      expect(body.bonds.every((b) => b.aId < b.bId)).toBe(true) // one bond per pair, ordered
      expect(body.asOfTick).toBeGreaterThan(0)
    })

    it("turns the narrator's recorded scene into an openable moment", async () => {
      const body = MomentsResponseSchema.parse(await get('/api/moments'))
      expect(body.moments).toHaveLength(1)
      expect(body.moments[0]).toMatchObject({
        day: 0,
        startTick: 8,
        endTick: 30,
        location: 'the house',
      })
      expect(body.moments[0]!.cast).toEqual(['amara', 'yusuf'])
    })

    it('answers with typed empties when no day has been narrated', async () => {
      expect(MomentsResponseSchema.parse(await get('/api/moments', bareBase)).moments).toEqual([])
      expect(await get('/api/chapters', bareBase)).toEqual([])
      expect(await get('/api/milestones', bareBase)).toEqual([])
      // the chronicle is the town's own record, so it survives a missing narrator
      const { entries } = await get<{ entries: ChronicleEntry[] }>('/api/chronicle', bareBase)
      expect(entries.map((e) => e.type)).toEqual(['structure_completed', 'co_slept', 'agent_died'])
    })
  })

  describe('4. interiors are engine truth, never a viewer write', () => {
    it('folds two occupants and a stored item into the house, and reads them back', () => {
      const db = openDb(join(dir, 'world.db'))
      try {
        const state = new WorldMirror({ db, config: DEFAULT_CONFIG, terrain: GRASS }).state()
        expect(state.structures.house1!.kind).toBe('house')
        expect(state.agents.amara!.insideId).toBe('house1')
        expect(state.agents.yusuf!.insideId).toBe('house1')
        expect(state.agents.nadia!.insideId).toBeUndefined()
        expect(state.items.i1!.loc).toEqual({ t: 'structure', id: 'house1' })
        // this is the fixture the web-side g10 file re-asserts interiorOf/bedSlots against
        expect(state.agents.amara!.asleep).toBe(true)
      } finally {
        db.close()
      }
    })

    it('leaves the plaza standing — the showcase map is genesis input, not a runtime edit', () => {
      expect(makeShowcaseMap().terrain[PLAZA_TILE.y]![PLAZA_TILE.x]).toBe(T_ROAD)
    })
  })
})
