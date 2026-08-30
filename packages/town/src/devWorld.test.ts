import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { PROTOCOL_VERSION, ServerMsg } from '@sj/shared'
import { openDb } from '@sj/engine/store'
import { RngStreams, createWorldTick, genesisState } from '@sj/engine'
import {
  DEV_MAP_DEFAULT,
  SHOWCASE_CONFIG,
  THOUGHT_LINES,
  devTerrain,
  startDevWorld,
} from './devWorld.js'
import { DEV_MAP_HUMAN } from './worldEnv.js'
import { townStructuresFor } from './founders.js'
import { frameText, publishThought } from '@sj/gateway'
import { until } from '@sj/gateway/testutil'

describe('showcase weather', () => {
  it('freezes the weather system so the town never greys out', () => {
    expect(SHOWCASE_CONFIG.weather.hourlyChangeChance).toBe(0)
    expect(genesisState(SHOWCASE_CONFIG).weather).toEqual({ kind: 'sunny', temperatureC: 14 })

    // A full day of world ticks under seed g6 never rolls the kind off sunny.
    const rng = new RngStreams('g6')
    const worldTick = createWorldTick(SHOWCASE_CONFIG, rng)
    let s = genesisState(SHOWCASE_CONFIG)
    const kinds = new Set<string>()
    for (let tick = 0; tick < 24 * 60; tick++) {
      s = worldTick(s).state
      kinds.add(s.weather.kind)
    }
    expect([...kinds]).toEqual(['sunny'])
  })
})

// The two defaults must differ, and the difference must not be a silence: the gates hash the
// fixture world, so the LIBRARY default cannot become the product town.
describe('★ the fixture world must be asked for by name, never received by silence', () => {
  const CLI = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'worldEnv.ts'), 'utf8')

  it('keeps the LIBRARY default on the fixture, because the gates hash that world', () => {
    expect(DEV_MAP_DEFAULT).toBe('scripted')
    expect(devTerrain()).toEqual(devTerrain('scripted'))
  })

  it('★ points the HUMAN path at the product town instead', () => {
    expect(DEV_MAP_HUMAN).toBe('showcase')
    expect(DEV_MAP_HUMAN).not.toBe(DEV_MAP_DEFAULT)
    // and the one env parse both entrypoints call reads the human one, with the fixture opt-IN
    expect(CLI).toMatch(/SJ_MAP === 'scripted' \? 'scripted' : DEV_MAP_HUMAN/)
  })

  it('the two worlds really are different towns, and the fixture is the one with no art', () => {
    const fixture = townStructuresFor('scripted').map((s) => s.kind)
    const product = townStructuresFor('showcase').map((s) => s.kind)
    // the four kinds the art ingest reports NO ART for
    const noArt = ['wagon', 'shed', 'scaffolding', 'standing_stone']
    expect(
      fixture.filter((k) => noArt.includes(k)).length,
      'the fixture is meant to be the one full of placeholders',
    ).toBeGreaterThanOrEqual(4)
    expect(product.filter((k) => noArt.includes(k))).toEqual([])
    expect(product.length).toBeGreaterThan(fixture.length)
  })
})

describe('dev world server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-devworld-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ says which map it loaded, on every boot, in every path', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    // startDevWorld, not the CLI block: a library caller sees the line too
    const dw = await startDevWorld({
      port: 0,
      dbPath: join(dir, 'boot.db'),
      world: { map: 'showcase' },
    })
    const said = log.mock.calls.map((c) => String(c[0])).join('\n')
    log.mockRestore()
    try {
      expect(said).toContain('map=showcase')
    } finally {
      await dw.stop()
    }
  })

  it('serves the founders town live with observer thoughts', async () => {
    // 5 ms, not 1: the socket is compressed and zlib finishes on the event loop, so a tick loop
    // that never yields starves those callbacks and the hub reads the backlog as a lagging viewer.
    const dw = await startDevWorld({ realMsPerTick: 5, port: 0, dbPath: join(dir, 'dev.db') })
    try {
      await until(() => dw.loop.state.tick >= 2, 12_000)
      dw.gateway.pump() // fold the first ticks into the mirror before the snapshot

      const sock = new WebSocket(`ws://127.0.0.1:${dw.gateway.port}/ws`)
      const frames: string[] = []
      sock.on('message', (d) => frames.push(frameText(d)))
      await new Promise((resolve, reject) => {
        sock.on('open', resolve)
        sock.on('error', reject)
      })
      sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))

      await until(() => frames.length >= 1, 12_000)
      const snap = ServerMsg.parse(JSON.parse(frames[0]!))
      if (snap.t !== 'snapshot') throw new Error('expected snapshot first')
      expect(snap.live).toBe(true)
      const state = snap.state as {
        agents: Record<string, { name: string }>
        structures: Record<string, { kind: string; stage: string }>
      }
      // the five founders by name, the six approved buildings complete on day 0
      expect(Object.keys(state.agents).sort()).toEqual(['amara', 'nadia', 'omar', 'salma', 'yusuf'])
      expect(state.agents.omar?.name).toBe('Omar')
      const kinds = Object.values(state.structures)
        .map((s) => s.kind)
        .sort()
      expect(kinds).toEqual([
        'house',
        'scaffolding',
        'shed',
        'standing_stone',
        'storehouse',
        'wagon',
      ])
      for (const s of Object.values(state.structures)) expect(s.stage).toBe('complete')

      await until(() => dw.loop.state.tick >= 40, 12_000)
      // Published AFTER the socket joined: the pump above already consumed every thought the
      // world had said, and a viewer is only ever sent what is published while it is listening.
      const wdb = openDb(join(dir, 'dev.db'))
      publishThought(wdb, {
        tick: dw.loop.state.tick,
        agentId: 'farmer',
        text: THOUGHT_LINES.walk!,
      })
      wdb.close()
      dw.gateway.pump()

      const parsed = (): ServerMsg[] => frames.map((f) => ServerMsg.parse(JSON.parse(f)))
      await until(
        () =>
          parsed().filter((m) => m.t === 'tick').length >= 2 &&
          parsed().some((m) => m.t === 'thought'),
        12_000,
      )

      const ticks = parsed().filter((m) => m.t === 'tick')
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      for (const m of ticks) expect(m.events.length).toBeGreaterThan(0)

      const thought = parsed().find((m) => m.t === 'thought')!
      expect(Object.values(THOUGHT_LINES)).toContain(thought.text)

      sock.close()
    } finally {
      await dw.stop()
    }
  }, 15_000)
})
