import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DEFAULT_CONFIG, PROTOCOL_VERSION, ServerMsg } from '@sj/shared'
import {
  EventStore,
  RngStreams,
  TickLoop,
  createWorldTick,
  genesisState,
  openDb,
  type TileId,
} from '@sj/engine'
import { createLawsAdmin } from './adminLaws.js'
import { createGateway, type Gateway } from './server.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
const TOKEN = 'a-shared-secret'

type Submitted = { path: string; value: unknown }[]

async function listen(server: Server, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, host, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
    })
  })
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve) =>
    server.close(() => {
      resolve()
    }),
  )
}

async function post(
  port: number,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
  path = '/admin/laws',
): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status, body: await res.text() }
}

describe('createLawsAdmin (T25b)', () => {
  const servers: Server[] = []
  afterAll(async () => {
    for (const s of servers) await shut(s)
  })

  async function admin(host?: string): Promise<{ port: number; submitted: Submitted }> {
    const submitted: Submitted = []
    const server = createLawsAdmin({
      submitLaw: (path, value) => submitted.push({ path, value }),
      token: TOKEN,
      ...(host === undefined ? {} : { host }),
    })
    servers.push(server)
    return { port: await listen(server), submitted }
  }

  it('202 on a whitelisted path with the bearer token, and the law is enqueued', async () => {
    const { port, submitted } = await admin()
    const r = await post(port, { path: 'mystery.enabled', value: false })
    expect(r.status).toBe(202)
    expect(submitted).toEqual([{ path: 'mystery.enabled', value: false }])
  })

  it('401 without a token, and 401 with the wrong one — nothing is enqueued', async () => {
    const { port, submitted } = await admin()
    expect((await post(port, { path: 'mystery.enabled', value: false }, {})).status).toBe(401)
    expect(
      (
        await post(
          port,
          { path: 'mystery.enabled', value: false },
          { authorization: 'Bearer nope' },
        )
      ).status,
    ).toBe(401)
    expect(
      (await post(port, { path: 'mystery.enabled', value: false }, { authorization: TOKEN }))
        .status,
    ).toBe(401)
    expect(submitted).toEqual([])
  })

  it('400 on a path that is not a world law, naming the path', async () => {
    const { port, submitted } = await admin()
    const r = await post(port, { path: 'needs.hungerDecayPerTick', value: 9 })
    expect(r.status).toBe(400)
    expect(r.body).toContain('needs.hungerDecayPerTick')
    expect(submitted).toEqual([])
  })

  it('400 on a value the law would refuse at the tick boundary', async () => {
    const { port, submitted } = await admin()
    // `mystery.chancePerDay` is a probability; the fold throws on 4, which would
    // take the world down a quarter-second after a cheerful 202.
    const r = await post(port, { path: 'mystery.chancePerDay', value: 4 })
    expect(r.status).toBe(400)
    expect(r.body).toContain('mystery.chancePerDay')
    expect(submitted).toEqual([])
  })

  it('400 on a malformed body or a missing path', async () => {
    const { port, submitted } = await admin()
    expect((await post(port, 'not json at all')).status).toBe(400)
    expect((await post(port, { value: true })).status).toBe(400)
    expect(submitted).toEqual([])
  })

  it('nothing but POST /admin/laws exists on this listener', async () => {
    const { port } = await admin()
    expect(
      (await post(port, { path: 'mystery.enabled', value: false }, undefined, '/admin/anything'))
        .status,
    ).toBe(404)
    const get = await fetch(`http://127.0.0.1:${port}/admin/laws`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(get.status).toBe(405)
  })

  it('a request arriving on an address the channel was not meant for is refused', async () => {
    // Configured for an address this box does not answer on, then reached over loopback: a
    // listener bound to 0.0.0.0 must not become the town's public control panel.
    const { port, submitted } = await admin('10.255.255.1')
    const r = await post(port, { path: 'mystery.enabled', value: false })
    expect(r.status).toBe(403)
    expect(submitted).toEqual([])
  })

  it('explicit exposure is an opt-in, and then any local address is accepted', async () => {
    const { port, submitted } = await admin('0.0.0.0')
    expect((await post(port, { path: 'mystery.enabled', value: false })).status).toBe(202)
    expect(submitted).toHaveLength(1)
  })
})

describe('laws in the viewer protocol (T25b)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-adminlaws-'))
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  function connect(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(`ws://127.0.0.1:${port}/ws`)
      sock.on('open', () => {
        resolve(sock)
      })
      sock.on('error', reject)
    })
  }
  const nextRaw = (sock: WebSocket): Promise<string> =>
    new Promise((resolve) =>
      sock.once('message', (d) => {
        resolve(d.toString())
      }),
    )

  async function hello(sock: WebSocket): Promise<string> {
    const first = nextRaw(sock)
    sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
    return first
  }

  it('the snapshot carries the laws in force, and a flip reaches a viewer as a delta', async () => {
    const db = openDb(join(dir, 'laws.db'))
    const store = new EventStore(db)
    const rng = new RngStreams('admin-laws')
    const laws: { path: string; value: unknown }[] = []
    const worldTick = createWorldTick(DEFAULT_CONFIG, rng, laws)
    const loop = new TickLoop({
      store,
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng,
      config: DEFAULT_CONFIG,
      onTick: ({ emit }) => {
        for (const e of worldTick(loop.state).events) emit(e.type, e.payload)
      },
    })

    loop.step()
    const gw = await createGateway({
      dbPath: join(dir, 'laws.db'),
      db,
      port: 0,
      terrain: GRASS,
      pollMs: 100_000,
    })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)

    const first = ServerMsg.parse(JSON.parse(await hello(sock)))
    expect(first.t).toBe('snapshot')
    if (first.t !== 'snapshot') throw new Error('unreachable')
    expect(first.laws).toEqual({})

    // An operator flips a law through the admin channel's injected submitLaw.
    const admin = createLawsAdmin({
      submitLaw: (path, value) => laws.push({ path, value }),
      token: TOKEN,
    })
    const port = await listen(admin)
    expect((await post(port, { path: 'mystery.enabled', value: false })).status).toBe(202)
    await shut(admin)

    const delta = nextRaw(sock)
    loop.step()
    gw.pump()
    const msg = ServerMsg.parse(JSON.parse(await delta))
    expect(msg.t).toBe('tick')
    if (msg.t !== 'tick') throw new Error('unreachable')
    expect(msg.events.some((e) => e.type === 'config_changed')).toBe(true)

    // A viewer joining after the flip is told the law is in force without replaying.
    const late = await connect(gw.port)
    open.push(late)
    const snap = ServerMsg.parse(JSON.parse(await hello(late)))
    if (snap.t !== 'snapshot') throw new Error('unreachable')
    expect(snap.laws).toEqual({ 'mystery.enabled': false })
  })
})
