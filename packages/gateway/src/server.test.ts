import { mkdtempSync, rmSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  MINUTES_PER_DAY,
  ServerMsg,
  stateHash,
  PROTOCOL_VERSION,
} from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { AssetCodex, openForgeDb } from '@sj/forge'
import { createGateway, type Gateway } from './server.js'
import { ensureObserverTables, publishMind, publishThought } from './observer.js'
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
        emit('agent_spawned', { id: 'walker', name: 'walker', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
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
      importance: 7,
    })
    gw.pump()
    await wait(80)
    const thoughts = aFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'thought')
    expect(thoughts).toHaveLength(1)
    // ★ The weight travels: the viewer gates the wisps on it and cannot ask the town for it.
    expect(thoughts[0]).toMatchObject({
      agentId: 'walker',
      text: 'The path is clear enough.',
      importance: 7,
    })

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
    expect(clamped[0].tick).toBe(loop.state.tick)

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

  const gateway = async (maxViewers = 500): Promise<Gateway> => {
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
      sock.on('end', () => {
        resolve(text)
      })
      sock.on('error', reject)
    })
    sock.write('GET //x:99999/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    expect(await reply).toContain('400')
    expect((await fetch(`http://127.0.0.1:${gw.port}/api/society`)).status).toBe(200)
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
    expect((await fetch(`http://127.0.0.1:${gw.port}/api/society`)).status).toBe(200)
  }, 20000)

  it('★ answers one `live` per scrub window, not one full snapshot per 40-byte frame', async () => {
    const gw = await gateway()
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    await hello(sock)
    collect(sock, frames)
    for (let i = 0; i < 20; i++) sock.send(JSON.stringify({ t: 'live' }))
    await wait(200)
    expect(frames.filter((f) => f.includes('"t":"snapshot"'))).toHaveLength(1)
  }, 20000)
})

/** The camera's own frame, off the same groups the deltas ride. */
describe('★ the director frame', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwdir-'))
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('broadcasts a cut when the answer moves, holds it while it does not, and greets with it', async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('director-test'),
      snapshotEveryTicks: 25,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['nadia', 'Nadia'],
            ['yusuf', 'Yusuf'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        if (tick === 2) {
          emit('scene_opened', {
            id: 'scene_2_abcd1234',
            kind: 'quarrel',
            participants: ['nadia', 'yusuf'],
            topic: 'Six planks.',
            stakes: 8,
          })
        }
      },
    })
    loop.step()

    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    await hello(sock)
    collect(sock, frames)
    // The town opens the scene after the gateway is watching, which is the live path.
    loop.step()
    loop.step()
    gw.pump()
    await wait(80)
    const cuts = frames.map((f) => ServerMsg.parse(JSON.parse(f))).filter((m) => m.t === 'director')
    expect(cuts).toHaveLength(1)
    expect(cuts[0]!.cut?.sceneId).toBe('scene_2_abcd1234')
    expect(cuts[0]!.cut?.agentIds).toEqual(['nadia', 'yusuf'])
    expect(cuts[0]!.cut?.why).toBe('Nadia & Yusuf: falling out')

    // Nothing has changed, so nothing is sent again.
    frames.length = 0
    gw.pump()
    gw.pump()
    await wait(80)
    expect(frames.filter((f) => f.includes('"t":"director"'))).toEqual([])

    // A late joiner is handed the shot the town is already on, right after its snapshot.
    const late = await connect(gw.port)
    open.push(late)
    const lateFrames: string[] = []
    collect(late, lateFrames)
    await hello(late)
    await wait(80)
    const greeted = lateFrames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'director')
    expect(greeted).toHaveLength(1)
    expect(greeted[0]!.cut?.sceneId).toBe('scene_2_abcd1234')
  }, 20000)

  it('sends no cut into a replay — a moment’s own cast owns that camera', async () => {
    const dbPath = join(dir, 'replay.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('director-replay'),
      snapshotEveryTicks: 5,
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          emit('agent_spawned', { id: 'nadia', name: 'Nadia', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        if (tick === 2)
          emit('scene_opened', {
            id: 'scene_2_deadbeef',
            kind: 'talk',
            participants: ['nadia'],
            topic: null,
            stakes: 5,
          })
      },
    })
    for (let i = 0; i < 10; i++) loop.step()
    const gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      replayMsPerTick: 1,
    })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    await hello(sock)
    const frames: string[] = []
    collect(sock, frames)
    sock.send(JSON.stringify({ t: 'replay', from: 1, reqId: 1 }))
    await wait(50)
    for (let i = 0; i < 6; i++) gw.pump()
    await wait(80)
    expect(frames.filter((f) => f.includes('"t":"director"'))).toEqual([])
  }, 20000)
})

describe('★ a frame goes out when the screen changes and not when a number does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwmark-'))
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('holds the board still while a decaying score moves no bar', async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('board-mark'),
      snapshotEveryTicks: 200,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['nadia', 'Nadia'],
            ['yusuf', 'Yusuf'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        if (tick === 10) emit('partnership_formed', { aId: 'nadia', bId: 'yusuf' })
      },
    })
    for (let i = 0; i < 5; i++) loop.step()

    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    await hello(sock)
    collect(sock, frames)
    // Twenty minutes of town time in which nothing happens. The marriage's score decays every
    // one of them, and the one row on the board is still the whole of the board.
    for (let i = 0; i < 25; i++) {
      loop.step()
      gw.pump()
    }
    await wait(120)
    const boards = frames.filter((f) => f.includes('"t":"board"'))
    expect(boards.length).toBeGreaterThan(0)
    expect(boards.length).toBeLessThanOrEqual(2)
  }, 30000)

  it('★ pushes both again when the words change and no bar moves', async () => {
    const dbPath = join(dir, 'words.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('board-words'),
      snapshotEveryTicks: 200,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['nadia', 'Nadia'],
            ['yusuf', 'Yusuf'],
            ['omar', 'Omar'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        if (tick === 3)
          emit('scene_opened', {
            id: 'scene_3_abcd1234',
            kind: 'talk',
            participants: ['nadia', 'yusuf'],
            topic: 'Six planks.',
            stakes: 5,
          })
        // The talk turns, with the same two people in it. The reason on the board and the words
        // on the capsule both change and no bar moves: the leader is always the whole of its
        // own denominator, so its share of itself is 100 before and after.
        if (tick === 6)
          emit('scene_turned', {
            id: 'scene_3_abcd1234',
            kind: 'quarrel',
            participants: ['nadia', 'yusuf'],
            stakes: 5,
          })
        // And then a third body walks into it, which is a cast the capsule names.
        if (tick === 9)
          emit('scene_turned', {
            id: 'scene_3_abcd1234',
            kind: 'quarrel',
            participants: ['nadia', 'yusuf', 'omar'],
            stakes: 5,
          })
      },
    })
    for (let i = 0; i < 4; i++) loop.step()

    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    await hello(sock)
    collect(sock, frames)
    for (let i = 0; i < 10; i++) {
      loop.step()
      gw.pump()
    }
    await wait(120)
    const msgs = frames.map((f) => ServerMsg.parse(JSON.parse(f)))
    // Read only the rows that still name the two, so the third body's own frame proves nothing.
    const whys = msgs.flatMap((m) =>
      m.t === 'board' ? m.rows.filter((r) => r.agentIds.length === 2).map((r) => r.why) : [],
    )
    expect(new Set(whys).size).toBeGreaterThan(1)
    const words = msgs.flatMap((m) =>
      m.t === 'threads'
        ? m.threads.filter((t) => t.members.length === 2).map((t) => t.terms.join(' '))
        : [],
    )
    expect(new Set(words).size).toBeGreaterThan(1)
    const casts = msgs.flatMap((m) =>
      m.t === 'threads' ? m.threads.map((t) => t.members.length) : [],
    )
    expect(new Set(casts).size).toBeGreaterThan(1)
  }, 30000)
})

describe('★ the story ribbon survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwthreads-'))
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ comes back knowing a story older than today, not calling it new', async () => {
    const dbPath = join(dir, 'world.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('threads-restart'),
      snapshotEveryTicks: 200,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['nadia', 'Nadia'],
            ['yusuf', 'Yusuf'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        if (tick === 20)
          emit('scene_opened', {
            id: 'scene_20_abcd1234',
            kind: 'quarrel',
            participants: ['nadia', 'yusuf'],
            topic: 'Six planks.',
            stakes: 8,
          })
      },
    })
    // Past midnight, so the quarrel is on a day the director's own prime never reads.
    for (let i = 0; i < MINUTES_PER_DAY + 60; i++) loop.step()

    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    await hello(sock)
    collect(sock, frames)
    gw.pump()
    await wait(80)
    const ribbon = frames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'threads')
    expect(ribbon.length).toBeGreaterThan(0)
    const row = ribbon[0]!.threads[0]
    expect(row?.members).toEqual(['nadia', 'yusuf'])
    expect(row?.openedTick).toBe(20)
    expect(row?.state).toBe('held')
  }, 30000)

  it('★ comes back knowing a marriage, which no scene row carries', async () => {
    const dbPath = join(dir, 'wedding.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('threads-wedding'),
      snapshotEveryTicks: 200,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['omar', 'Omar'],
            ['salma', 'Salma'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        // A birth, a death, a marriage, a parting and a law are the heaviest payments in the
        // table, and a window of scene rows alone loses every one of them on a restart.
        if (tick === 30) emit('partnership_formed', { aId: 'omar', bId: 'salma' })
      },
    })
    for (let i = 0; i < MINUTES_PER_DAY + 60; i++) loop.step()

    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    await hello(sock)
    collect(sock, frames)
    gw.pump()
    await wait(80)
    const ribbon = frames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'threads')
    expect(ribbon.length).toBeGreaterThan(0)
    expect(ribbon[0]!.threads[0]?.members).toEqual(['omar', 'salma'])
  }, 30000)

  it('★ does not strain a marriage that had not happened when the scene closed', async () => {
    const dbPath = join(dir, 'strain.db')
    const db = openDb(dbPath)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('threads-strain'),
      snapshotEveryTicks: 200,
      onTick: ({ tick, emit }) => {
        if (tick === 1) {
          for (const [id, name] of [
            ['omar', 'Omar'],
            ['salma', 'Salma'],
          ])
            emit('agent_spawned', { id, name, x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
        }
        if (tick === 100) {
          emit('scene_opened', {
            id: 'scene_100_abcd1234',
            kind: 'quarrel',
            participants: ['omar', 'salma'],
            topic: 'Six planks.',
            stakes: 3,
          })
          emit('scene_closed', {
            id: 'scene_100_abcd1234',
            summary: 'Omar walks off.',
            deltas: [{ agentId: 'omar', personId: 'salma', kind: 'slight', text: 'he walked off' }],
            closeReason: 'ended',
          })
        }
        // They marry a hundred minutes AFTER that quarrel, so the live run never strained them.
        if (tick === 200) emit('partnership_formed', { aId: 'omar', bId: 'salma' })
      },
    })
    for (let i = 0; i < MINUTES_PER_DAY + 60; i++) loop.step()

    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    await hello(sock)
    collect(sock, frames)
    gw.pump()
    await wait(80)
    const ribbon = frames
      .map((f) => ServerMsg.parse(JSON.parse(f)))
      .filter((m) => m.t === 'threads')
    expect(ribbon.length).toBeGreaterThan(0)
    const row = ribbon[0]!.threads.find((r) => r.members.includes('omar'))
    expect(row?.members).toEqual(['omar', 'salma'])
    expect(row?.terms).not.toContain('partnership_strained')
  }, 30000)
})

describe('the mind frame', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-gwmind-'))
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('★ sends both halves of a turn in order, and hands a late viewer only who is still deciding', async () => {
    const dbPath = join(dir, 'minds.db')
    const { db, loop } = makeWorld(dbPath)
    for (let i = 0; i < 3; i++) loop.step()
    // ★ A town that died mid-turn left this behind, with no idle after it. A gateway that read
    // the table back would light a caret on a body that stopped thinking in a previous process.
    publishMind(db, { tick: 1, agentId: 'ghost', state: 'deciding' })
    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const a = await connect(gw.port)
    open.push(a)
    await hello(a)
    const aFrames: string[] = []
    collect(a, aFrames)

    publishMind(db, { tick: loop.state.tick, agentId: 'walker', state: 'deciding' })
    publishMind(db, { tick: loop.state.tick, agentId: 'other', state: 'deciding' })
    publishMind(db, { tick: loop.state.tick, agentId: 'walker', state: 'idle' })
    gw.pump()
    await wait(80)
    const minds = aFrames.map((f) => ServerMsg.parse(JSON.parse(f))).filter((m) => m.t === 'mind')
    // Both halves inside one poll. Dropping the idle of a pair leaves a caret lit on a body
    // that has already answered.
    expect(minds.map((m) => `${m.agentId}:${m.state}`)).toEqual([
      'walker:deciding',
      'other:deciding',
      'walker:idle',
    ])

    const b = await connect(gw.port)
    open.push(b)
    const bFrames: string[] = []
    collect(b, bFrames)
    b.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
    await wait(120)
    const greeted = bFrames.map((f) => ServerMsg.parse(JSON.parse(f))).filter((m) => m.t === 'mind')
    expect(greeted.map((m) => `${m.agentId}:${m.state}`)).toEqual(['other:deciding'])
  })

  it('carries on when the world was written before the minds table existed', async () => {
    const dbPath = join(dir, 'old.db')
    const db = openDb(dbPath)
    db.exec(`CREATE TABLE observer_thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 5
    );
    CREATE TABLE observer_moods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL, agent_id TEXT NOT NULL, mood TEXT NOT NULL
    );`)
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('old-world'),
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          emit('agent_spawned', {
            id: 'walker',
            name: 'walker',
            x: 0,
            y: 0,
            ageDays: ADULT_AGE_DAYS,
          })
      },
    })
    for (let i = 0; i < 3; i++) loop.step()
    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const a = await connect(gw.port)
    open.push(a)
    await hello(a)
    const aFrames: string[] = []
    collect(a, aFrames)
    publishThought(db, { tick: loop.state.tick, agentId: 'walker', text: 'Still here.' })
    expect(() => {
      gw.pump()
    }).not.toThrow()
    await wait(80)
    const kinds = aFrames.map((f) => (JSON.parse(f) as { t: string }).t)
    expect(kinds).toContain('thought')
    expect(kinds).not.toContain('mind')
  })
})
