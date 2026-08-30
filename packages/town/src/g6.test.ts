import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DEFAULT_CONFIG, PROTOCOL_VERSION, ServerMsg, stateHash } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { fold, genesisState, makeFixtureMap } from '@sj/engine'
import { openForgeDb } from '@sj/forge'
import { startDevWorld } from './devWorld.js'
import { drawHouse, registerDemoHouse } from './hotswapDemo.js'
import { WorldMirror, frameText, publishThought } from '@sj/gateway'
import { until } from '@sj/gateway/testutil'

type Client = { sock: WebSocket; frames: string[] }

const connect = async (port: number): Promise<Client> => {
  const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  const frames: string[] = []
  sock.on('message', (d) => frames.push(frameText(d)))
  await new Promise((resolve, reject) => {
    sock.on('open', resolve)
    sock.on('error', reject)
  })
  sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
  await until(() => frames.length >= 1, 10_000)
  return { sock, frames }
}

// raw tick frames keyed by tick — serialize-once means byte-identical across clients
const tickFrames = (c: Client): Map<number, string> => {
  const m = new Map<number, string>()
  for (const f of c.frames) {
    const msg = ServerMsg.parse(JSON.parse(f))
    if (msg.t === 'tick') m.set(msg.tick, f)
  }
  return m
}

// tiny seeded LCG — the sweep must be reproducible run to run
const lcg = (seed: number) => (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

describe('GATE G6 — automated half', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-g6-'))
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('dual-viewer byte parity over ~3 sim days, then a scrub parity sweep', async () => {
    const dbPath = join(dir, 'g6-run.db')
    // 5 ms, not 1: the socket is compressed and zlib finishes on the event loop, so a tick loop
    // that never yields starves those callbacks and the hub reads the backlog as a lagging viewer.
    const dw = await startDevWorld({ realMsPerTick: 5, port: 0, dbPath })
    let finalTick = 0
    try {
      const a = await connect(dw.gateway.port)
      const b = await connect(dw.gateway.port)

      await until(() => dw.loop.state.tick >= 4400, 120_000)
      dw.gateway.pump()
      await until(() => {
        const ta = tickFrames(a)
        const tb = tickFrames(b)
        return (
          ta.size > 0 &&
          tb.size > 0 &&
          Math.min(Math.max(...ta.keys()), Math.max(...tb.keys())) >= 4400
        )
      }, 30_000)

      // 1. serialize-once end-to-end: every tick BOTH clients saw is byte-identical
      const ta = tickFrames(a)
      const tb = tickFrames(b)
      const shared = [...ta.keys()].filter((t) => tb.has(t))
      expect(shared.length).toBeGreaterThan(2000)
      for (const t of shared) expect(tb.get(t)).toBe(ta.get(t))

      finalTick = dw.loop.state.tick
      a.sock.close()
      b.sock.close()
    } finally {
      await dw.stop()
    }

    // 2. scrub parity sweep: 12 seeded-random ticks, mirror.stateAt(t) vs from-genesis fold
    const db = openDb(dbPath)
    try {
      const config = DEFAULT_CONFIG
      const terrain = makeFixtureMap()
      const mirror = new WorldMirror({ db, config, terrain })
      const rnd = lcg(0x6706)
      const targets = [
        ...new Set(Array.from({ length: 12 }, () => 1 + Math.floor(rnd() * finalTick))),
      ].sort((x, y) => x - y)

      let ref = genesisState(config, terrain)
      const events = new EventStore(db).readFrom(0)
      let ei = 0
      for (const t of targets) {
        while (ei < events.length && events[ei]!.tick <= t) {
          ref = fold(ref, events[ei]!, config)
          ei++
        }
        expect(stateHash(mirror.stateAt(t))).toBe(stateHash(ref))
      }
      expect(targets.length).toBeGreaterThanOrEqual(10)
    } finally {
      db.close()
    }
  }, 240_000)

  it('thought latency and sprite hot swap on a healthy pump', async () => {
    // slow world: the pump between ticks is what the 2.5s production cadence gives it
    const dbPath = join(dir, 'g6-slow.db')
    const dw = await startDevWorld({ realMsPerTick: 10_000, port: 0, dbPath })
    try {
      const a = await connect(dw.gateway.port)
      const b = await connect(dw.gateway.port)

      // 3. thought latency: published at tick T, held by clients before any T+1 delta
      const tickT = dw.loop.state.tick
      const wdb = openDb(dbPath)
      publishThought(wdb, { tick: tickT, agentId: 'farmer', text: 'The gate check begins.' })
      wdb.close()
      dw.gateway.pump()
      await until(
        () =>
          a.frames.some((f) => f.includes('"thought"')) &&
          b.frames.some((f) => f.includes('"thought"')),
        10_000,
      )
      for (const c of [a, b]) {
        const msgs = c.frames.map((f) => ServerMsg.parse(JSON.parse(f)))
        const thoughtIdx = msgs.findIndex(
          (m) => m.t === 'thought' && m.text === 'The gate check begins.',
        )
        expect(thoughtIdx).toBeGreaterThanOrEqual(0)
        const laterTickIdx = msgs.findIndex((m) => m.t === 'tick' && m.tick > tickT)
        if (laterTickIdx >= 0) expect(thoughtIdx).toBeLessThan(laterTickIdx)
      }

      // 4. hot swap: register the demo house → both clients get the push; bytes served exactly
      const fdb = openForgeDb(dbPath)
      const rec = await registerDemoHouse(fdb)
      fdb.close()
      dw.gateway.pump()
      await until(
        () => a.frames.some((f) => f.includes(rec.id)) && b.frames.some((f) => f.includes(rec.id)),
        10_000,
      )
      for (const c of [a, b]) {
        const asset = c.frames
          .map((f) => ServerMsg.parse(JSON.parse(f)))
          .find((m) => m.t === 'assets' && m.records.some((r) => r.id === rec.id))
        expect(asset).toBeDefined()
      }
      const res = await fetch(`http://127.0.0.1:${dw.gateway.port}/assets/${rec.id}.png`)
      expect(res.status).toBe(200)
      const served = new Uint8Array(await res.arrayBuffer())
      const { encodePng } = await import('@sj/forge')
      const expected = await encodePng(drawHouse())
      expect(Buffer.from(served).equals(Buffer.from(expected))).toBe(true)

      a.sock.close()
      b.sock.close()
    } finally {
      await dw.stop()
    }
  }, 60_000)
})
