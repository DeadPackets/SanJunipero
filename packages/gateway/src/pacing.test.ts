import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { DEFAULT_CONFIG, PROTOCOL_VERSION } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { MAX_SPEED, MIN_SPEED } from './adminOps.js'
import { DEFAULT_IDLE_AFTER_MS, DEFAULT_IDLE_SPEED, createPacing } from './pacing.js'
import { createGateway, type Gateway } from './server.js'
import { connect, until } from './testutil.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))

/** A `Clock` with no world behind it — the same surface `/admin/speed` writes through. */
function dial(start = 1) {
  let speed = start
  const log: number[] = []
  return {
    get speed() {
      return speed
    },
    setSpeed: (n: number) => {
      speed = n
      log.push(n)
    },
    /** An operator's hand on the dial — a write pacing did not make. */
    admin: (n: number) => {
      speed = n
    },
    log,
  }
}

const paced = (env: Record<string, string | undefined> = {}) => {
  const d = dial()
  return { d, p: createPacing({ clock: d, env }) }
}

describe('viewer-aware pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops to idle speed after the idle window with nobody watching', () => {
    const { d, p } = paced()
    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS - 1)
    expect(d.speed).toBe(1)
    vi.advanceTimersByTime(1)
    expect(d.speed).toBe(DEFAULT_IDLE_SPEED)
  })

  it('restores full speed the moment a viewer connects, not on a timer', () => {
    const { d, p } = paced()
    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS)
    expect(d.speed).toBe(DEFAULT_IDLE_SPEED)
    p.viewers(1)
    // No timer advanced between the connect and this read: the wake is synchronous.
    expect(d.speed).toBe(1)
    expect(d.log).toEqual([DEFAULT_IDLE_SPEED, 1])
  })

  it('a viewer arriving during the countdown cancels it', () => {
    const { d, p } = paced()
    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS - 1000)
    p.viewers(1)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS * 2)
    expect(d.speed).toBe(1)
    expect(d.log).toEqual([])
  })

  it('a second departure does not restart a countdown already running', () => {
    const { d, p } = paced()
    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS - 1000)
    p.viewers(0)
    vi.advanceTimersByTime(1000)
    expect(d.speed).toBe(DEFAULT_IDLE_SPEED)
  })

  it('never steps down over a speed an operator set', () => {
    const { d, p } = paced()
    p.viewers(0)
    d.admin(3)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS * 2)
    expect(d.speed).toBe(3)
    expect(d.log).toEqual([])
  })

  it('leaves a speed an operator set during idle alone when a viewer wakes it', () => {
    const { d, p } = paced()
    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS)
    expect(d.speed).toBe(DEFAULT_IDLE_SPEED)
    d.admin(2)
    p.viewers(1)
    expect(d.speed).toBe(2)
  })

  it('SJ_IDLE_PACING=0 does nothing at all', () => {
    const { d, p } = paced({ SJ_IDLE_PACING: '0' })
    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS * 10)
    expect(d.speed).toBe(1)
    expect(d.log).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('SJ_IDLE_AFTER_MS and SJ_IDLE_SPEED override the defaults', () => {
    const { d, p } = paced({ SJ_IDLE_AFTER_MS: '1000', SJ_IDLE_SPEED: '0.5' })
    p.viewers(0)
    vi.advanceTimersByTime(1000)
    expect(d.speed).toBe(0.5)
  })

  it('★ refuses an idle speed POST /admin/speed would itself refuse', () => {
    for (const asked of [String(MIN_SPEED / 2), String(MAX_SPEED + 1), 'quarter']) {
      const { d, p } = paced({ SJ_IDLE_SPEED: asked })
      p.viewers(0)
      vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS)
      expect(d.speed).toBe(DEFAULT_IDLE_SPEED)
      p.stop()
    }
  })

  it('an idle speed equal to the full speed never announces a transition', () => {
    const { d, p } = paced({ SJ_IDLE_SPEED: '1' })
    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS)
    p.viewers(1)
    expect(d.log).toEqual([])
  })

  it('stop() drops the pending countdown', () => {
    const { p } = paced()
    p.viewers(0)
    expect(vi.getTimerCount()).toBe(1)
    p.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('pacing rides the operator clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('★ drives the same TickLoop.setSpeed that POST /admin/speed drives', () => {
    const db = openDb(':memory:')
    const loop = new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('pacing-clock'),
      onTick: () => {},
    })
    const p = createPacing({ clock: loop, env: {} })
    expect(loop.speed).toBe(1)

    p.viewers(0)
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS)
    expect(loop.speed).toBe(DEFAULT_IDLE_SPEED)
    // The beat divides by `loop.speed`, so a quarter-speed town ticks a quarter as often, and
    // pacing never touches the other dimension.
    expect(loop.paused).toBe(false)

    p.viewers(1)
    expect(loop.speed).toBe(1)
    p.stop()
    db.close()
  })
})

describe('the gateway reports its viewer count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-pacing-'))
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  const boot = async (counts: number[]): Promise<Gateway> => {
    const dbPath = join(dir, `world-${open.length}.db`)
    const db = openDb(dbPath)
    new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('pacing-test'),
      onTick: () => {},
    }).step()
    const gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      adminPort: null,
      onViewers: (n) => counts.push(n),
    })
    open.push(gw)
    return gw
  }

  it('counts up when a viewer greets and back down when it closes', async () => {
    const counts: number[] = []
    const gw = await boot(counts)

    const sock = await connect(gw.port)
    const greeted = new Promise((r) => sock.once('message', r))
    sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
    await greeted
    expect(counts).toEqual([1])

    sock.close()
    await until(() => counts.length === 2, 5_000)
    expect(counts).toEqual([1, 0])
  })

  it('★ a socket that never greets is not a viewer', async () => {
    const counts: number[] = []
    const gw = await boot(counts)

    // The count means watchers, not sockets: an unfinished handshake is not an audience, and
    // counting it would hold a town at full speed for as long as the hello deadline allows.
    const mute = await connect(gw.port)
    await new Promise((r) => setTimeout(r, 200))
    expect(counts).toEqual([])

    mute.close()
    await until(() => counts.length === 1, 5_000)
    expect(counts).toEqual([0])
  })
})
