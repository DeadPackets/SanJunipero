import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type WebSocket from 'ws'
import { ADULT_AGE_DAYS, DEFAULT_CONFIG, PROTOCOL_VERSION, ServerMsg } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { createGateway, type Gateway } from './server.js'
import { frameText } from './http.js'
import { connect, nextFrame, until } from './testutil.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))

/** 4% of one core, the floor the gateway's own comment measures a scrub against. */
const SCRUB_BUDGET_MS_PER_S = 40
/** The live cadence a replay matches, so one minute has this many milliseconds of budget. */
const TICK_REAL_MS = 2000

function makeWorld(dbPath: string, ticks: number) {
  const db = openDb(dbPath)
  const loop = new TickLoop({
    store: new EventStore(db),
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('replay-test'),
    snapshotEveryTicks: 5,
    onTick: ({ tick, emit }) => {
      if (tick === 1)
        emit('agent_spawned', { id: 'walker', name: 'walker', x: 0, y: 0, ageDays: ADULT_AGE_DAYS })
      if (tick > 1) emit('agent_moved', { id: 'walker', x: (tick - 1) % 8, y: 0 })
    },
  })
  for (let i = 0; i < ticks; i++) loop.step()
  return { db, loop }
}

const parse = (frames: string[]) => frames.map((f) => ServerMsg.parse(JSON.parse(f)))
const collect = (sock: WebSocket, sink: string[]): void => {
  sock.on('message', (d) => sink.push(frameText(d)))
}

describe('a replay replays', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-replay-'))
  const open: (WebSocket | Gateway)[] = []
  let made = 0

  afterAll(async () => {
    for (const o of open) {
      if ('terminate' in o) o.terminate()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  /** A town with `ticks` minutes recorded, and a gateway whose replay beat is one pump — the
   *  cadence is a wall clock in the product and a knob here, exactly as the poll interval is. */
  const boot = async (ticks: number, scrubBudgetMsPerS = SCRUB_BUDGET_MS_PER_S) => {
    const dbPath = join(dir, `world-${made++}.db`)
    const { db, loop } = makeWorld(dbPath, ticks)
    const gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      adminPort: null,
      replayMsPerTick: 0,
      scrubBudgetMsPerS,
    })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: string[] = []
    const greeted = nextFrame(sock)
    sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
    await greeted
    collect(sock, frames)
    return { gw, db, loop, sock, frames }
  }

  it('★ opens on ONE fold and then walks the log forward in ordinary tick frames', async () => {
    const { gw, sock, frames } = await boot(12)
    sock.send(JSON.stringify({ t: 'replay', from: 3, reqId: 1 }))
    await until(() => frames.length > 0, 5_000)

    const opened = parse(frames)[0]!
    if (opened.t !== 'replaying') throw new Error(`expected replaying, got ${opened.t}`)
    expect(opened.reqId).toBe(1)
    expect(opened.tick).toBe(3)
    expect((opened.state as { tick: number }).tick).toBe(3)

    for (let i = 0; i < 4; i++) gw.pump()
    await until(() => parse(frames).filter((m) => m.t === 'tick').length >= 4, 5_000)
    const ticks = parse(frames).filter((m) => m.t === 'tick')
    expect(ticks.slice(0, 4).map((m) => m.tick)).toEqual([4, 5, 6, 7])
    // ★ the seq the viewer adopted, then a strict rise: the live guard reads a replay as a rise
    let seq = opened.seq
    for (const m of ticks) {
      expect(m.seq).toBeGreaterThan(seq)
      seq = m.seq
    }
  })

  it('★ hands a replaying viewer no live deltas, and joins it back up on `live`', async () => {
    const { gw, loop, sock, frames } = await boot(6)
    sock.send(JSON.stringify({ t: 'replay', from: 1, reqId: 1 }))
    await until(() => frames.length > 0, 5_000)
    frames.length = 0

    // the live town moves on while this viewer is in the past
    loop.step()
    loop.step()
    gw.pump()
    await new Promise((r) => setTimeout(r, 120))
    // one replayed minute out of that pump, and not one frame of the live edge
    expect(
      parse(frames)
        .filter((m) => m.t === 'tick')
        .map((m) => m.tick),
    ).toEqual([2])

    frames.length = 0
    sock.send(JSON.stringify({ t: 'live' }))
    await until(() => parse(frames).some((m) => m.t === 'snapshot'), 5_000)
    frames.length = 0
    loop.step()
    gw.pump()
    await until(() => parse(frames).some((m) => m.t === 'tick'), 5_000)
    expect(parse(frames).find((m) => m.t === 'tick')?.tick).toBe(loop.state.tick)
  })

  it('★ a replay that catches the live tick becomes the live town', async () => {
    const { gw, loop, sock, frames } = await boot(4)
    sock.send(JSON.stringify({ t: 'replay', from: 2, reqId: 1 }))
    await until(() => frames.length > 0, 5_000)
    frames.length = 0
    for (let i = 0; i < 4; i++) gw.pump()
    await until(() => parse(frames).some((m) => m.t === 'snapshot'), 5_000)
    const seen = parse(frames)
    expect(seen.filter((m) => m.t === 'tick').map((m) => m.tick)).toEqual([3, 4])
    expect(seen.find((m) => m.t === 'snapshot')?.tick).toBe(loop.state.tick)

    // and it is a member of the live town again: the next delta reaches it
    frames.length = 0
    loop.step()
    gw.pump()
    await until(() => parse(frames).some((m) => m.t === 'tick'), 5_000)
  })

  it('★ a minute the town has not lived is answered with now, not with a hung socket', async () => {
    const { sock, frames } = await boot(4)
    sock.send(JSON.stringify({ t: 'replay', from: 9_999, reqId: 1 }))
    await until(() => frames.length > 0, 5_000)
    expect(parse(frames)[0]!.t).toBe('snapshot')
  })

  it('★ holds its minute when the town has no thread to spare, rather than taking it', async () => {
    const { gw, sock, frames } = await boot(20, 0.0001)
    sock.send(JSON.stringify({ t: 'replay', from: 1, reqId: 1 }))
    await until(() => frames.length > 0, 5_000)
    expect(parse(frames)[0]!.t).toBe('replaying') // the opening fold had the last of the bucket
    frames.length = 0

    for (let i = 0; i < 5; i++) gw.pump()
    await new Promise((r) => setTimeout(r, 120))
    expect(parse(frames).filter((m) => m.t === 'tick')).toHaveLength(0)
  })

  /** The number the design has to answer for. A scrub is a measured 6-11 ms of fold-and-stringify
   *  on the thread that ticks the town, rate-limited to 40 ms/s per socket. A replayed minute pays
   *  for that fold ONCE and then reads the log forward, so its per-minute cost must be a rounding
   *  error against the 80 ms one minute of live cadence is worth. */
  it('★ one replayed minute costs a fraction of the scrub budget for the same second', async () => {
    const MINUTES = 60
    const { gw, sock, frames } = await boot(120)
    const beat = (): number => {
      const t0 = performance.now()
      for (let i = 0; i < MINUTES; i++) gw.pump()
      return (performance.now() - t0) / MINUTES
    }
    beat() // warm the prepared statements and the JIT
    const idleMs = beat() // the same beat with nobody replaying

    sock.send(JSON.stringify({ t: 'replay', from: 1, reqId: 1 }))
    await until(() => frames.length > 0, 5_000)
    const withReplayMs = beat()
    const perMinuteMs = withReplayMs - idleMs

    // non-vacuous: sixty minutes really were streamed by those sixty beats
    await until(() => parse(frames).filter((m) => m.t === 'tick').length >= MINUTES, 10_000)

    // One minute of live cadence is 2 s, so 2 s of the scrub budget — 80 ms — is what a replayed
    // minute may spend. The ceiling here is a tenth of it, which still seats 500 viewers
    // replaying at once; the measured cost is two orders of magnitude under that.
    const budgetMs = (SCRUB_BUDGET_MS_PER_S * TICK_REAL_MS) / 1000
    expect(
      perMinuteMs,
      `one replayed minute cost ${perMinuteMs.toFixed(3)} ms (beat ${withReplayMs.toFixed(3)} ms, idle ${idleMs.toFixed(3)} ms)`,
    ).toBeLessThan(budgetMs * 0.1)
  })
})
