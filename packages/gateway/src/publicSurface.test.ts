// WHAT A STRANGER CAN REACH. Every case here was a live hole or a live amplifier on `main`
// before the streaming lane, and each one is written so that reverting its guard fails it.
//
// The world these run against is the one `pnpm stream` serves: a real gateway, a real world db,
// a real agent-memory directory, spoken to over a real socket by a client that is not the app.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DEFAULT_CONFIG, PROTOCOL_VERSION } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { openForgeDb } from '@sj/forge'
import { createGateway, CLOSE_TOO_MANY, SCRUB_MIN_MS, type Gateway } from './server.js'
import { AGENT_ID } from './api.js'
import { makeSeqCache } from './seqCache.js'
import { resolveInRoot } from './staticSite.js'

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0 as TileId))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const dir = mkdtempSync(join(tmpdir(), 'sj-public-'))
const agentDbDir = join(dir, 'agents')
const outside = join(dir, 'outside')
mkdirSync(agentDbDir)
mkdirSync(outside)

// The file a traversal would be reaching FOR: a sqlite db outside `agentDbDir` that happens to
// carry the schema the reader selects, which is what makes the traversal an exfiltration and
// not merely an error.
const secret = new Database(join(outside, 'secret.db'))
secret.exec('CREATE TABLE journal (id INTEGER PRIMARY KEY, agent_id TEXT, tick INT, day INT, text TEXT)')
secret.prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, 1, 0, ?)')
  .run('../outside/secret', 'THE PRIVATE THING')
secret.close()

// A real agent memory db, so a legitimate read is proved to still work.
const walker = new Database(join(agentDbDir, 'walker.db'))
walker.exec('CREATE TABLE journal (id INTEGER PRIMARY KEY, agent_id TEXT, tick INT, day INT, text TEXT)')
walker.prepare('INSERT INTO journal (agent_id, tick, day, text) VALUES (?, 1, 0, ?)')
  .run('walker', 'I walked east.')
walker.close()

function makeWorld(dbPath: string) {
  const db = openDb(dbPath)
  const store = new EventStore(db)
  const loop = new TickLoop({
    store, state: genesisState(DEFAULT_CONFIG, GRASS), rng: new RngStreams('public-surface'),
    snapshotEveryTicks: 5,
    onTick: ({ tick, emit }) => {
      if (tick === 1) emit('agent_spawned', { id: 'walker', name: 'walker', x: 0, y: 0, ageDays: 7300 })
      if (tick > 1) emit('agent_moved', { id: 'walker', x: (tick - 1) % 8, y: 0 })
    },
  })
  return { db, loop }
}

const connect = (port: number): Promise<WebSocket> => new Promise((resolve, reject) => {
  const s = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  s.on('open', () => resolve(s))
  s.on('error', reject)
})

describe('the public surface a stranger reaches', () => {
  const open: Array<WebSocket | Gateway> = []
  afterAll(async () => {
    for (const o of open) { if (o instanceof WebSocket) o.close(); else await o.close() }
    rmSync(dir, { recursive: true, force: true })
  })

  const dbPath = join(dir, 'world.db')
  openForgeDb(dbPath).close()
  const { db, loop } = makeWorld(dbPath)
  for (let i = 0; i < 12; i++) loop.step()

  const gwPromise = createGateway({
    dbPath, port: 0, terrain: GRASS, pollMs: 3_600_000, db, agentDbDir, maxViewers: 3,
  })

  it('cannot read a file outside agentDbDir through a %2f in an agent id', async () => {
    const gw = await gwPromise; open.push(gw)
    const base = `http://127.0.0.1:${gw.port}`

    // The legitimate read still works, so the guard is a filter and not a wall.
    const mine = await (await fetch(`${base}/api/agent/walker/journal`)).json()
    expect(mine).toEqual([{ tick: 1, day: 0, text: 'I walked east.' }])

    // `:id` is decoded AFTER the router splits on '/', so these all arrive as one segment
    // holding a path separator. Remove `AGENT_ID.test` from readAgentRows and the first of
    // these returns THE PRIVATE THING.
    for (const id of ['..%2foutside%2fsecret', '..%2F..%2Fetc%2Fpasswd', '%2e%2e%2foutside%2fsecret']) {
      const r = await fetch(`${base}/api/agent/${id}/journal`)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual([])
    }
    const leak = await (await fetch(`${base}/api/agent/..%2foutside%2fsecret/journal`)).text()
    expect(leak).not.toContain('THE PRIVATE THING')
  })

  it('answers nothing for __proto__, which is a truthy agent that does not exist', async () => {
    const gw = await gwPromise
    const r = await fetch(`http://127.0.0.1:${gw.port}/api/agent/__proto__/profile`)
    expect(r.status).toBe(404)
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
      Array.from({ length: 25 }, async () => (await fetch(`${base}/api/society`)).text()))
    expect(new Set(bodies).size).toBe(1)
  })

  it('will not turn a 60-byte GET into megabytes via ?toTick', async () => {
    const gw = await gwPromise
    const base = `http://127.0.0.1:${gw.port}`
    const honest = await (await fetch(`${base}/api/digest`)).text()
    // Unclamped this loops once per day between 0 and toTick/1440 — on a real town it answered
    // 4.75 MB to this exact request. Clamped, an impossible window IS today's window.
    const absurd = await (await fetch(`${base}/api/digest?fromTick=0&toTick=1000000000`)).text()
    expect(absurd.length).toBeLessThan(4096)
    expect(absurd).toEqual(honest)

    // Backwards, negative and non-numeric windows are answers, not errors or loops.
    for (const q of ['?fromTick=-99999999', '?toTick=-1', '?fromTick=9e99&toTick=1e99', '?toTick=abc']) {
      const r = await fetch(`${base}/api/digest${q}`)
      expect(r.status).toBe(200)
      expect((await r.text()).length).toBeLessThan(4096)
    }
  })

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
    const sock = await connect(gw.port); open.push(sock)
    const frames: Array<{ t: string; reqId?: number; tick?: number }> = []
    sock.on('message', (d) => frames.push(JSON.parse(d.toString())))
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

describe('the guards themselves', () => {
  it('AGENT_ID admits a slug and refuses everything that could be a path', () => {
    for (const ok of ['walker', 'omar', 'agent_1', 'a-b-c', 'A9']) expect(AGENT_ID.test(ok)).toBe(true)
    for (const bad of ['../x', 'a/b', '..', '', 'a b', 'x.db', '__proto__', 'a'.repeat(65)]) {
      expect(AGENT_ID.test(bad)).toBe(false)
    }
  })

  it('resolveInRoot refuses every way out of the directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'sj-root-'))
    writeFileSync(join(root, 'index.html'), 'hi')
    expect(resolveInRoot(root, '/index.html')).toBe(join(root, 'index.html'))
    expect(resolveInRoot(root, '/sub/../index.html')).toBe(join(root, 'index.html'))
    for (const bad of ['/../secret', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/a/\0b', '/%ZZ']) {
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
    const build = () => { built++; return { seq } }

    for (let i = 0; i < 10; i++) cache.json('society', build)
    expect(built).toBe(1)

    seq = 2
    expect(JSON.parse(cache.json('society', build))).toEqual({ seq: 2 })
    expect(built).toBe(2)

    // A stranger varying the query string churns the map; it must not grow.
    for (let i = 0; i < 500; i++) cache.json(`digest?x=${i}`, build)
    expect(cache.size()).toBeLessThanOrEqual(4)
  })
})
