// WHAT A STRANGER CAN REACH. Each case is written so that reverting its guard fails it, against
// the world `pnpm stream` serves — a real gateway, a real db, a real socket, and not the app.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { CLOSE_BAD_HELLO, DEFAULT_CONFIG, PROTOCOL_VERSION } from '@sj/shared'
import { EventStore, openDb } from '@sj/engine/store'
import { RngStreams, TickLoop, genesisState, type TileId } from '@sj/engine'
import { openForgeDb } from '@sj/forge'
import {
  createGateway,
  CLOSE_TOO_MANY,
  HELLO_DEADLINE_MS,
  SCRUB_MIN_MS,
  type Gateway,
} from './server.js'
import { AGENT_ID } from './api.js'
import { MAX_BYTES, MAX_KEYS, MAX_VALUES, makeSeqCache } from './seqCache.js'
import { CLIENT_ASSET_DIR, resolveInRoot } from './staticSite.js'
import { frameText } from './http.js'
import { connect } from './testutil.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const dir = mkdtempSync(join(tmpdir(), 'sj-public-'))
const agentDbDir = join(dir, 'agents')
const outside = join(dir, 'outside')
mkdirSync(agentDbDir)
mkdirSync(outside)

// The file a traversal reaches FOR: a db outside `agentDbDir` carrying the schema the reader
// selects, which is what makes it an exfiltration rather than an error.
const secret = new Database(join(outside, 'secret.db'))
secret.exec(
  'CREATE TABLE journal (id INTEGER PRIMARY KEY, agent_id TEXT, tick INT, day INT, text TEXT)',
)
secret
  .prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, 1, 0, ?)')
  .run('../outside/secret', 'THE PRIVATE THING')
secret.close()

// A real agent memory db, so a legitimate read is proved to still work.
const walker = new Database(join(agentDbDir, 'walker.db'))
walker.exec(
  'CREATE TABLE journal (id INTEGER PRIMARY KEY, agent_id TEXT, tick INT, day INT, text TEXT)',
)
walker
  .prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, 1, 0, ?)')
  .run('walker', 'I walked east.')
walker.close()

function makeWorld(dbPath: string) {
  const db = openDb(dbPath)
  const store = new EventStore(db)
  const loop = new TickLoop({
    store,
    state: genesisState(DEFAULT_CONFIG, GRASS),
    rng: new RngStreams('public-surface'),
    snapshotEveryTicks: 5,
    onTick: ({ tick, emit }) => {
      if (tick === 1)
        emit('agent_spawned', { id: 'walker', name: 'walker', x: 0, y: 0, ageDays: 7300 })
      if (tick > 1) emit('agent_moved', { id: 'walker', x: (tick - 1) % 8, y: 0 })
    },
  })
  return { db, loop }
}

/** The close code, or 'open' if the socket is still up after `ms` — so "was not closed" is an
 *  assertion rather than a timeout. */
const closeCode = (s: WebSocket, ms = 1000): Promise<number | 'open'> =>
  new Promise((resolve) => {
    const t = setTimeout(() => {
      resolve('open')
    }, ms)
    s.on('close', (code) => {
      clearTimeout(t)
      resolve(code)
    })
  })

describe('the public surface a stranger reaches', () => {
  const open: (WebSocket | Gateway)[] = []
  afterAll(async () => {
    for (const o of open) {
      if (o instanceof WebSocket) o.close()
      else await o.close()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  const dbPath = join(dir, 'world.db')
  openForgeDb(dbPath).close()
  const { db, loop } = makeWorld(dbPath)
  for (let i = 0; i < 12; i++) loop.step()

  const gwPromise = createGateway({
    dbPath,
    port: 0,
    terrain: GRASS,
    pollMs: 3_600_000,
    db,
    agentDbDir,
    maxViewers: 3,
    adminPort: null,
  })

  it('cannot read a file outside agentDbDir through a %2f in an agent id', async () => {
    const gw = await gwPromise
    open.push(gw)
    const base = `http://127.0.0.1:${gw.port}`

    // The legitimate read still works, so the guard is a filter and not a wall.
    const mine = (await (await fetch(`${base}/api/agent/walker/journal`)).json()) as unknown
    expect(mine).toEqual([{ tick: 1, day: 0, text: 'I walked east.', kind: 'journal' }])

    // `:id` is decoded AFTER the router splits on '/', so these arrive as one segment holding a
    // path separator. Remove `AGENT_ID.test` from readAgentRows and the first returns the secret.
    for (const id of [
      '..%2foutside%2fsecret',
      '..%2F..%2Fetc%2Fpasswd',
      '%2e%2e%2foutside%2fsecret',
    ]) {
      const r = await fetch(`${base}/api/agent/${id}/journal`)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual([])
    }
    const leak = await (await fetch(`${base}/api/agent/..%2foutside%2fsecret/journal`)).text()
    expect(leak).not.toContain('THE PRIVATE THING')
  })

  it('★ survives a malformed percent-escape in a routed segment', async () => {
    const gw = await gwPromise
    const base = `http://127.0.0.1:${gw.port}`
    // `decodeURIComponent('%')` throws URIError, and the router decodes inside the createServer
    // listener — unguarded this is an uncaughtException that takes the whole stream down.
    for (const path of ['/assets/%', '/api/agent/%/journal', '/assets/character/%ZZ.png']) {
      const r = await fetch(`${base}${path}`)
      expect(r.status, path).toBe(404)
      await r.text()
    }
    // The town is still serving, which is the whole point.
    expect((await fetch(`${base}/api/agent/walker/journal`)).status).toBe(200)
  })

  // Ruling 10 put `/admin/*` on the served origin. A town whose operator opened no channel must
  // not answer it at all — a 401 would tell a stranger there is a door.
  it('has no operator channel to reach when no token opened one', async () => {
    const gw = await gwPromise
    const base = `http://127.0.0.1:${gw.port}`
    for (const path of ['/admin/cost', '/admin/rulings/pending', '/admin']) {
      const r = await fetch(`${base}${path}`, { headers: { authorization: 'Bearer guessed' } })
      expect(r.status, path).toBe(404)
      await r.text()
    }
  })

  it('reads no memory for __proto__, which is a truthy agent that does not exist', async () => {
    const gw = await gwPromise
    const r = await fetch(`http://127.0.0.1:${gw.port}/api/agent/__proto__/journal`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([])
  })

  it('will not encode a sprite sheet for an agent the world does not have', async () => {
    const gw = await gwPromise
    const base = `http://127.0.0.1:${gw.port}`
    // A real founder still gets a sheet…
    expect((await fetch(`${base}/assets/character/walker.png`)).status).toBe(200)
    // …and an id a stranger invented buys no sharp encode at all.
    expect((await fetch(`${base}/assets/character/not-a-person.png`)).status).toBe(404)
    expect((await fetch(`${base}/assets/character/${'x'.repeat(200)}.png`)).status).toBe(404)
  })

  it('serves every viewer the same body without rescanning the log', async () => {
    const gw = await gwPromise
    const base = `http://127.0.0.1:${gw.port}`
    const bodies = await Promise.all(
      Array.from({ length: 25 }, async () => (await fetch(`${base}/api/society`)).text()),
    )
    expect(new Set(bodies).size).toBe(1)
  })

  it('will not turn a 60-byte GET into megabytes via ?toTick', async () => {
    const gw = await gwPromise
    const base = `http://127.0.0.1:${gw.port}`
    const honest = await (await fetch(`${base}/api/chronicle`)).text()
    // Unclamped, a stranger's window is a scan of a range the world never had, and a cache key
    // nothing else will ever hit. Clamped, an impossible window IS today's window.
    const absurd = await (await fetch(`${base}/api/chronicle?fromTick=0&toTick=1000000000`)).text()
    expect(absurd).toEqual(honest)

    // Backwards, negative and non-numeric windows are answers, not errors or loops.
    for (const q of [
      '?fromTick=-99999999',
      '?toTick=-1',
      '?fromTick=9e99&toTick=1e99',
      '?toTick=abc',
    ]) {
      const r = await fetch(`${base}/api/chronicle${q}`)
      expect(r.status).toBe(200)
      expect((await r.text()).length).toBeLessThan(4096)
    }
  })

  /** The cap used to be read off the hub, which a socket joins only after a valid `hello` — so
   *  a stranger who opens sockets and says nothing was never counted and never timed out. */
  it('★ counts sockets, not greetings, toward the viewer cap', async () => {
    const gw = await gwPromise
    const silent = await Promise.all([connect(gw.port), connect(gw.port), connect(gw.port)])
    for (const s of silent) open.push(s)
    // `wss.clients` already holds the arriving socket: counted with `>=` the cap would serve
    // maxViewers − 1, and the third honest viewer would be the one turned away.
    expect(await Promise.all(silent.map((s) => closeCode(s, 300)))).toEqual([
      'open',
      'open',
      'open',
    ])

    const extra = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`)
    open.push(extra)
    expect(await closeCode(extra)).toBe(CLOSE_TOO_MANY)

    for (const s of silent) s.close()
    await wait(120)
  })

  it(
    '★ closes a socket that opens and never says hello',
    async () => {
      const gw = await gwPromise
      const mute = await connect(gw.port)
      open.push(mute)
      expect(await closeCode(mute, HELLO_DEADLINE_MS * 2)).toBe(CLOSE_BAD_HELLO)
      await wait(120)
    },
    HELLO_DEADLINE_MS * 3,
  )

  it('turns the extra viewer away instead of degrading for the others', async () => {
    const gw = await gwPromise
    const held = await Promise.all([connect(gw.port), connect(gw.port), connect(gw.port)])
    for (const s of held) {
      open.push(s)
      s.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
    }
    await wait(120)

    const extra = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`)
    open.push(extra)
    const code = await new Promise<number>((resolve) => extra.on('close', resolve))
    expect(code).toBe(CLOSE_TOO_MANY)

    // Give the seats back, or the next test is the one turned away.
    for (const s of held) s.close()
    await wait(120)
  })

  it('coalesces a scrub flood into one answer per window, keeping the newest ask', async () => {
    const gw = await gwPromise
    const sock = await connect(gw.port)
    open.push(sock)
    type Frame = { t: string; reqId?: number; tick?: number }
    const frames: Frame[] = []
    sock.on('message', (d) => frames.push(JSON.parse(frameText(d)) as Frame))
    sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
    await wait(60)
    frames.length = 0

    // 60 scrubs as fast as the socket takes them. Unguarded, that is 60 folds and 60 full-world
    // serializations on the tick thread; guarded it is two — the first and the newest.
    for (let i = 0; i < 60; i++) sock.send(JSON.stringify({ t: 'scrub', tick: i % 10, reqId: i }))
    await wait(SCRUB_MIN_MS * 4)

    const scrubbed = frames.filter((f) => f.t === 'scrubbed')
    expect(scrubbed.length).toBeGreaterThan(0)
    expect(scrubbed.length).toBeLessThan(10)
    // The last ask is the one a dragging finger stopped on, so it must be the one answered.
    expect(scrubbed.at(-1)?.reqId).toBe(59)
  })
})

/** Caddy's `encode` covers HTTP responses and never a proxied socket, so without this every tick
 *  frame ships raw to every viewer, forever — measured 3,640 B against 514 B deflated. */
describe('★ the socket is compressed', () => {
  const open: (Gateway | WebSocket)[] = []
  const deflateDir = mkdtempSync(join(tmpdir(), 'sj-deflate-'))
  afterAll(async () => {
    for (const o of open) void o.close()
    await wait(50)
    rmSync(deflateDir, { recursive: true, force: true })
  })

  it('negotiates permessage-deflate with a viewer', async () => {
    const dbPath = join(deflateDir, 'w.db')
    const { db, loop } = makeWorld(dbPath)
    for (let i = 0; i < 12; i++) loop.step()
    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    // The memory levers — no-context-takeover, memLevel 5, windowBits 13 — are not visible to the
    // client; what is visible, and what fails if the option is dropped, is that it negotiated.
    expect(sock.extensions, 'every frame goes out raw').toContain('permessage-deflate')
  })
})

/** The per-socket floor is per SOCKET. Ten viewers dragging at once is the whole tick thread, and
 *  the cap is 500 — so the budget the scrub bar spends from has to be one budget. */
describe('★ the scrub bar spends from one budget, not one per viewer', () => {
  const open: (Gateway | WebSocket)[] = []
  const scrubDir = mkdtempSync(join(tmpdir(), 'sj-scrub-'))
  afterAll(async () => {
    for (const o of open) void o.close()
    await wait(50)
    rmSync(scrubDir, { recursive: true, force: true })
  })

  const ask = async (budgetMsPerS: number): Promise<{ t: string; tick: number; reqId: number }> => {
    const dbPath = join(scrubDir, `scrub-${budgetMsPerS}.db`)
    const { db, loop } = makeWorld(dbPath)
    for (let i = 0; i < 12; i++) loop.step()
    const gw = await createGateway({
      dbPath,
      port: 0,
      terrain: GRASS,
      pollMs: 3_600_000,
      db,
      scrubBudgetMsPerS: budgetMsPerS,
    })
    open.push(gw)
    const sock = await connect(gw.port)
    open.push(sock)
    const frames: { t: string; tick: number; reqId: number }[] = []
    sock.on('message', (d) => frames.push(JSON.parse(frameText(d)) as (typeof frames)[number]))
    sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null }))
    await wait(60)
    sock.send(JSON.stringify({ t: 'scrub', tick: 3, reqId: 7 }))
    await wait(120)
    return frames.filter((f) => f.t === 'scrubbed').at(-1)!
  }

  it('answers an over-budget ask at the live moment rather than folding for it', async () => {
    const spent = await ask(0)
    // The SAME frame shape, so nothing about the viewer changes but the moment it is shown.
    expect(spent.t).toBe('scrubbed')
    expect(spent.reqId, 'the answer must be to the ask that was made').toBe(7)
    expect(spent.tick, 'an over-budget ask was folded anyway').toBe(12)
  })

  it('and answers the asked tick while there is budget for it', async () => {
    expect((await ask(1000)).tick).toBe(3)
  })
})

describe('a route handler that throws', () => {
  const open: Gateway[] = []
  const brokenDir = mkdtempSync(join(tmpdir(), 'sj-broken-'))
  afterAll(async () => {
    for (const gw of open) await gw.close()
    rmSync(brokenDir, { recursive: true, force: true })
  })

  it('★ answers 500 without a stack, and the next request still lands', async () => {
    const dbPath = join(brokenDir, 'broken.db')
    openForgeDb(dbPath).close()
    const { db, loop } = makeWorld(dbPath)
    for (let i = 0; i < 4; i++) loop.step()
    const gw = await createGateway({ dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db })
    open.push(gw)
    const base = `http://127.0.0.1:${gw.port}`
    expect((await fetch(`${base}/api/chapters`)).status).toBe(200)

    // The world db changing under a mounted read path: the prepared SELECT now throws when it
    // runs, straight out of the handler and into the listener that ticks the town.
    db.exec('DROP TABLE events')
    const r = await fetch(`${base}/api/chronicle`)
    expect(r.status).toBe(500)
    const body = await r.text()
    expect(body).not.toContain('at ')
    expect(body).not.toContain('.ts:')
    expect((await fetch(`${base}/api/chapters`)).status).toBe(200)
  })
})

describe('the guards themselves', () => {
  it('AGENT_ID admits a slug and refuses everything that could be a path', () => {
    for (const ok of ['walker', 'omar', 'agent_1', 'a-b-c', 'A9'])
      expect(AGENT_ID.test(ok)).toBe(true)
    for (const bad of ['../x', 'a/b', '..', '', 'a b', 'x.db', '__proto__', 'a'.repeat(65)]) {
      expect(AGENT_ID.test(bad)).toBe(false)
    }
  })

  it('resolveInRoot refuses every way out of the directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'sj-root-'))
    writeFileSync(join(root, 'index.html'), 'hi')
    expect(resolveInRoot(root, '/index.html')).toBe(join(root, 'index.html'))
    expect(resolveInRoot(root, '/sub/../index.html')).toBe(join(root, 'index.html'))
    for (const bad of [
      '/../secret',
      '/../../etc/passwd',
      '/%2e%2e/%2e%2e/etc/passwd',
      '/a/\0b',
      '/%ZZ',
    ]) {
      const hit = resolveInRoot(root, bad)
      expect(hit === null || hit.startsWith(root)).toBe(true)
    }
    // A leading `..` is CLAMPED to the root rather than refused — `/../secret` names
    // `<root>/secret`, which does not exist, and never the sibling of root that it spells.
    expect(resolveInRoot(root, '/../secret')).toBe(join(root, 'secret'))
    expect(resolveInRoot(root, '/a/\0b')).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })

  it('the seq cache builds once per generation and never grows past its cap', () => {
    let seq = 1
    let built = 0
    const cache = makeSeqCache(() => seq, 4)
    const build = () => {
      built++
      return { seq }
    }

    for (let i = 0; i < 10; i++) cache.json('society', build)
    expect(built).toBe(1)

    seq = 2
    expect(JSON.parse(cache.json('society', build))).toEqual({ seq: 2 })
    expect(built).toBe(2)

    // A stranger varying the query string churns the map; it must not grow.
    for (let i = 0; i < 500; i++) cache.json(`digest?x=${i}`, build)
    expect(cache.size()).toBeLessThanOrEqual(4)
  })

  /** MUTATION-PROVED: deleting the `held + body.length > maxBytes` eviction loop takes the held
   *  bytes below from 4 008 to 15 030 — four times its budget, on fifteen keys under the key cap. */
  it('★ the seq cache holds a budget of BYTES, not a number of bodies', () => {
    let seq = 1
    const cache = makeSeqCache(() => seq, MAX_KEYS, 4096)
    const kb = 'x'.repeat(1000)
    for (let i = 0; i < 15; i++) cache.json(`big?x=${i}`, () => kb)
    expect(cache.size(), 'well under the key cap, and still evicting').toBeLessThan(MAX_KEYS)
    expect(cache.bytes(), 'the budget is the ceiling').toBeLessThanOrEqual(4096)

    // A single body larger than the whole budget is admitted, alone: refusing it would mean
    // rebuilding it per request, which is the amplification the cache exists to stop.
    seq = 2
    const huge = 'y'.repeat(9000)
    expect(cache.json('huge', () => huge)).toBe(JSON.stringify(huge))
    expect(cache.size()).toBe(1)
    expect(
      cache.json('huge', () => {
        throw new Error('rebuilt a body it was holding')
      }),
    ).toBe(JSON.stringify(huge))

    // and the shipped budget is a real number rather than "whatever the biggest answer is"
    expect(MAX_BYTES).toBeGreaterThan(0)
    expect(MAX_BYTES).toBeLessThan(64 * 1024 * 1024)
  })

  it('★ the seq cache holds a couple of intermediates, not a key cap of unmeasured ones', () => {
    const cache = makeSeqCache(() => 1)
    const built: string[] = []
    const build = (k: string) => () => {
      built.push(k)
      return { k }
    }
    // A stranger's window is the memo key and the value is a full entry array — 32 of those
    // resident at once is 144 MB against a body budget of 4 MiB.
    for (const k of ['a', 'b', 'c', 'd']) cache.value(k, build(k))
    cache.value('a', build('a'))
    expect(built.filter((k) => k === 'a').length, 'the oldest window was evicted').toBe(2)

    // and the pair a real viewer asks for — panel then badge on one window — still shares a scan
    cache.value('a', build('a'))
    expect(built.filter((k) => k === 'a').length).toBe(2)
    expect(MAX_VALUES).toBeLessThanOrEqual(4)
  })

  /** `/assets/:file` is the codex PNG route and 404s anything that is not a png, so a bundle
   *  emitted to vite's default `assets/` serves a blank page. This is that pact, enforced. */
  it('★ the built client is not served from under /assets, and the two halves agree', () => {
    const vite = readFileSync(new URL('../../web/vite.config.ts', import.meta.url), 'utf8')
    const declared = /assetsDir:\s*'([^']+)'/.exec(vite)?.[1]
    expect(declared, 'vite must name an assetsDir at all').toBeDefined()
    expect(declared, 'the gateway serves the bundle from CLIENT_ASSET_DIR').toBe(CLIENT_ASSET_DIR)
    expect(CLIENT_ASSET_DIR, 'the codex PNG route owns /assets and 404s a script').not.toBe(
      'assets',
    )
  })
})
