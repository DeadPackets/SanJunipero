import { mkdtempSync, rmSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DEFAULT_CONFIG, ServerMsg, stateHash, PROTOCOL_VERSION } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { AssetCodex, openForgeDb } from '@sj/forge'
import { createGateway, type Gateway } from './server.js'
import { ensureObserverTables, publishThought } from './observer.js'
import { WorldMirror } from './worldMirror.js'
import { frameText } from './http.js'
import { connect } from './testutil.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))

function makeWorld(dbPath: string) {
  const db = openDb(dbPath)
  ensureObserverTables(db)
  const store = new EventStore(db)
  const loop = new TickLoop({
    store,
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('server-test'),
    snapshotEveryTicks: 5,
    onTick: ({ tick, emit }) => {
      if (tick === 1)
        emit('agent_spawned', { id: 'walker', name: 'walker', x: 0, y: 0, ageDays: 7300 })
      if (tick > 1) emit('agent_moved', { id: 'walker', x: (tick - 1) % 8, y: 0 })
    },
  })
  return { db, store, loop }
}

function nextRaw(sock: WebSocket): Promise<string> {
  return new Promise((resolve) =>
    sock.once('message', (d) => {
      resolve(frameText(d))
    }),
  )
}

async function hello(sock: WebSocket): Promise<string> {
  const first = nextRaw(sock)
  sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
  return first
}

function collect(sock: WebSocket, sink: string[]): void {
  sock.on('message', (d) => sink.push(frameText(d)))
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('gateway server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwsrv-'))
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('speaks the observatory protocol end to end', async () => {
    const dbPath = join(dir, 'world.db')
    openForgeDb(dbPath).close() // forge tables share the world db in this fixture
    const { db, loop } = makeWorld(dbPath)
    for (let i = 0; i < 6; i++) loop.step()

    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    expect(gw.port).toBeGreaterThan(0)

    // hello → snapshot, live, matching hash
    const a = await connect(gw.port)
    open.push(a)
    const snapRaw = await hello(a)
    const snap = ServerMsg.parse(JSON.parse(snapRaw))
    if (snap.t !== 'snapshot') throw new Error('expected snapshot')
    expect(snap.live).toBe(true)
    expect(snap.tick).toBe(loop.state.tick)
    expect(stateHash(snap.state)).toBe(stateHash(JSON.parse(JSON.stringify(loop.state))))

    // second client for byte-identity checks
    const b = await connect(gw.port)
    open.push(b)
    await hello(b)
    const aFrames: string[] = []
    const bFrames: string[] = []
    collect(a, aFrames)
    collect(b, bFrames)

    // two steps + pump → exactly 2 tick messages, in order, non-empty events
    loop.step()
    loop.step()
    gw.pump()
    await wait(80)
    const aTicks = aFrames.map((f) => ServerMsg.parse(JSON.parse(f))).filter((m) => m.t === 'tick')
    expect(aTicks).toHaveLength(2)
    expect(aTicks.map((m) => m.tick)).toEqual([7, 8])
    for (const m of aTicks) expect(m.events.length).toBeGreaterThan(0)
    // serialize-once observable: raw frames byte-identical across clients
    expect(bFrames).toEqual(aFrames)

    // thought push
    publishThought(db, {
      tick: loop.state.tick,
      agentId: 'walker',
      text: 'The path is clear enough.',
    })
    gw.pump()
    await wait(80)
    const thoughts = aFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'thought')
    expect(thoughts).toHaveLength(1)
    expect(thoughts[0]).toMatchObject({ agentId: 'walker', text: 'The path is clear enough.' })

    // asset push (record only — png stays on HTTP)
    const codex = new AssetCodex(db)
    codex.register({
      class: 'building',
      desc: 'house: timber dwelling',
      footprint: { w: 2, h: 2 },
      png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      widthPx: 4,
      heightPx: 4,
      status: 'placeholder',
      score: null,
      attempts: 1,
      costUsd: 0,
    })
    gw.pump()
    await wait(80)
    const assets = aFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'assets')
    expect(assets).toHaveLength(1)
    expect(assets[0]!.records[0]!.status).toBe('placeholder')

    // asset catch-up: a late joiner receives existing codex records right after its snapshot
    const late = await connect(gw.port)
    open.push(late)
    const lateFrames: string[] = []
    collect(late, lateFrames)
    await hello(late)
    await wait(80)
    const lateAssets = lateFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'assets')
    expect(lateAssets).toHaveLength(1)
    expect(lateAssets[0]!.records).toHaveLength(1)

    // scrub goes only to the requester and matches mirror.stateAt
    const mirror = new WorldMirror({ db, config: DEFAULT_CONFIG, terrain: GRASS })
    const before = bFrames.length
    a.send(JSON.stringify({ t: 'scrub', tick: 1, reqId: 7 }))
    await wait(80)
    const scrubbed = aFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'scrubbed')
    expect(scrubbed).toHaveLength(1)
    expect(scrubbed[0]!.reqId).toBe(7)
    expect(scrubbed[0]!.tick).toBe(1)
    expect(stateHash(scrubbed[0]!.state)).toBe(
      stateHash(JSON.parse(JSON.stringify(mirror.stateAt(1)))),
    )
    expect(bFrames.length).toBe(before)

    // out-of-range scrub clamps to live, never errors the socket
    a.send(JSON.stringify({ t: 'scrub', tick: 999999, reqId: 8 }))
    await wait(80)
    const clamped = aFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'scrubbed' && m.reqId === 8)
    expect(clamped).toHaveLength(1)
    if (clamped[0]!.t !== 'scrubbed') throw new Error('unreachable')
    expect(clamped[0]!.tick).toBe(loop.state.tick)

    // live message → fresh snapshot
    a.send(JSON.stringify({ t: 'live' }))
    await wait(80)
    const snaps = aFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'snapshot')
    expect(snaps).toHaveLength(1)

    // malformed first frame → close 4400
    const c = await connect(gw.port)
    open.push(c)
    const closed = new Promise<number>((resolve) =>
      c.on('close', (code) => {
        resolve(code)
      }),
    )
    c.send('not json at all')
    expect(await closed).toBe(4400)

    // wrong protocol version → close 4400
    const d = await connect(gw.port)
    open.push(d)
    const closedD = new Promise<number>((resolve) =>
      d.on('close', (code) => {
        resolve(code)
      }),
    )
    d.send(JSON.stringify({ t: 'hello', v: 999, lastSeenTick: null }))
    expect(await closedD).toBe(4400)
  }, 20000)
})

/** Every request here is one a stranger can make from the open internet, and every one of them
 *  used to reach the thread that ticks the town as an uncaughtException or as unbounded memory. */
describe('what a stranger cannot do to the town', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwhard-'))
  const open: (WebSocket | Gateway)[] = []
  let made = 0

  const gateway = async (maxViewers?: number): Promise<Gateway> => {
    const dbPath = join(dir, `world-${made++}.db`)
    const { db, loop } = makeWorld(dbPath)
    for (let i = 0; i < 6; i++) loop.step()
    const gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      maxViewers,
    })
    open.push(gw)
    return gw
  }

  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.terminate()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ answers a request target `URL` refuses with 400, and keeps serving', async () => {
    const gw = await gateway()
    const sock = netConnect(gw.port, '127.0.0.1')
    const reply = new Promise<string>((resolve, reject) => {
      let text = ''
      sock.on('data', (c: Buffer) => (text += c.toString()))
      sock.on('end', () => resolve(text))
      sock.on('error', reject)
    })
    sock.write('GET //x:99999/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    expect(await reply).toContain('400')
    expect((await fetch(`http://127.0.0.1:${gw.port}/api/heat`)).status).toBe(200)
  }, 20000)

  // Pre-fix this leaves an unhandled 'error' — the run fails on that, not on an expectation.
  it('★ survives an oversize frame on a socket it turned away at capacity', async () => {
    const gw = await gateway(1)
    open.push(await connect(gw.port)) // the one viewer this town seats
    // Sent from inside 'open': a beat later the refusal has landed and the frame never goes.
    const refused = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`)
    open.push(refused)
    refused.on('error', () => undefined)
    refused.on('open', () => {
      refused.send('x'.repeat(8192)) // twice the 4 KB frame cap
    })
    await wait(300)
    expect((await fetch(`http://127.0.0.1:${gw.port}/api/heat`)).status).toBe(200)
  }, 20000)
})
