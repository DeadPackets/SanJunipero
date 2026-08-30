import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { ADMIN_PORT_DEFAULT, adminChannelPort } from './adminProxy.js'
import { createLawsAdmin } from './adminLaws.js'
import { sendJson } from './http.js'
import { createGateway, type Gateway } from './server.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
const TOKEN = 'a-token'

describe('adminChannelPort — where the channel is, if there is one', () => {
  it('is nowhere without a token, and 8788 unless the operator says otherwise', () => {
    expect(adminChannelPort({})).toBeNull()
    expect(adminChannelPort({ SJ_ADMIN_TOKEN: '' })).toBeNull()
    expect(adminChannelPort({ SJ_ADMIN_TOKEN: 't' })).toBe(ADMIN_PORT_DEFAULT)
    expect(adminChannelPort({ SJ_ADMIN_TOKEN: 't', SJ_ADMIN_PORT: '9090' })).toBe(9090)
    expect(adminChannelPort({ SJ_ADMIN_TOKEN: 't', SJ_ADMIN_PORT: 'soon' })).toBe(
      ADMIN_PORT_DEFAULT,
    )
  })
})

/** The whole point of ruling 10: the page's own origin answers `/admin/*`, so the browser never
 *  makes the cross-origin call it would refuse, and the channel stays on loopback behind a bearer. */
describe('/admin/* through the gateway origin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-adminproxy-'))
  let gw: Gateway
  let closed: Gateway
  let admin: Server
  let base: string
  let closedBase: string

  const world = (name: string): ReturnType<typeof openDb> => {
    const db = openDb(join(dir, `${name}.db`))
    new TickLoop({
      store: new EventStore(db),
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams(name),
      snapshotEveryTicks: 25,
      onTick: () => undefined,
    }).step()
    return db
  }

  beforeAll(async () => {
    admin = createLawsAdmin({
      submitLaw: () => undefined,
      token: TOKEN,
      routes: [
        {
          method: 'GET',
          path: '/admin/cost',
          handle: (_req, res) => {
            sendJson(res, { live: false, today: { calls: 0, usd: 0 } })
          },
        },
      ],
    })
    const adminPort = await new Promise<number>((resolve) => {
      admin.listen(0, '127.0.0.1', () => {
        const addr = admin.address()
        resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
      })
    })
    gw = await createGateway({
      dbPath: join(dir, 'open.db'),
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: world('open'),
      adminPort,
    })
    closed = await createGateway({
      dbPath: join(dir, 'shut.db'),
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db: world('shut'),
      adminPort: null,
    })
    base = `http://127.0.0.1:${gw.port}`
    closedBase = `http://127.0.0.1:${closed.port}`
  })

  afterAll(async () => {
    admin.close()
    await gw.close()
    await closed.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('carries the bearer across, and answers the operator’s read', async () => {
    const res = await fetch(`${base}/admin/cost`, {
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ live: false, today: { calls: 0, usd: 0 } })
  })

  it('is still the channel’s lock, not the proxy’s — a wrong token gets 401', async () => {
    const res = await fetch(`${base}/admin/cost`, { headers: { authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('passes a write along with its body and its method', async () => {
    const res = await fetch(`${base}/admin/laws`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'mystery.enabled', value: false }),
    })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: 'mystery.enabled', value: false })
  })

  it('is not a route at all on a town whose operator opened no channel', async () => {
    const res = await fetch(`${closedBase}/admin/cost`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(res.status).toBe(404)
  })

  it('leaves every other path where it was', async () => {
    expect((await fetch(`${base}/api/society`)).status).toBe(200)
  })
})
