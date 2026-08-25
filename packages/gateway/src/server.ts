import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import { WebSocketServer, type WebSocket } from 'ws'
import { ClientMsg, DEFAULT_CONFIG, PROTOCOL_VERSION, type SimConfig } from '@sj/shared'
import type { TileId } from '@sj/engine'
import { AssetCodex } from '@sj/forge'
import { WorldMirror } from './worldMirror.js'
import { OPEN, SocketHub } from './hub.js'
import { thoughtsSince } from './observer.js'
import { mountAssetRoutes } from './assetsHttp.js'
import { mountDataApi } from './api.js'
import { mountNarratorApi } from './narratorApi.js'
import { mountBondsApi } from './bonds.js'
import { mountLineageApi } from './lineage.js'
import { mountDiscoveryApi } from './discoveries.js'
import { makeStaticSite } from './staticSite.js'

export type GatewayOpts = {
  dbPath: string; port?: number                 // default 8787
  config?: SimConfig; terrain: TileId[][]
  pollMs?: number                               // default 250
  db?: Database.Database                        // in-process override (dev world); else opened readonly
  agentDbDir?: string                           // per-agent memory DBs (`<id>.db`); absent → [] tab responses
  narratorDbPath?: string                       // C7's narrator.db; absent or unwritten → typed empties
  staticDir?: string                            // built @sj/web; absent → API/socket only (the dev split)
  maxViewers?: number                           // default DEFAULT_MAX_VIEWERS
}
export type Gateway = { port: number; close(): Promise<void>; pump(): void }  // pump exposed for tests

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void
export type Router = { route(method: string, pattern: string, fn: RouteHandler): void }

const DEFAULT_PORT = 8787
const DEFAULT_POLL_MS = 250
const CLOSE_BAD_HELLO = 4400
export const CLOSE_TOO_MANY = 4429

/** A viewer only ever sends `hello`, `scrub` or `live`, none of which reach 200 bytes. ws
 *  defaults to a 100 MB frame, which is 100 MB a stranger can make the server buffer. */
export const MAX_CLIENT_FRAME = 4096

/** How many viewers one world serves before it turns people away. Refusing the 501st with a
 *  code is a stream at capacity; accepting it and degrading for the other 500 is an outage. */
export const DEFAULT_MAX_VIEWERS = 500

/**
 * ★ SCRUB IS THE ONE EXPENSIVE THING A STRANGER CAN ASK FOR, AND IT WAS FREE AND UNLIMITED.
 *
 * A 40-byte `scrub` frame makes the gateway load a snapshot, `JSON.parse` it, fold every event
 * up to the asked tick and `JSON.stringify` the whole world back out — ~120 KB of work per
 * request, on the thread that ticks the town. Nothing rate-limited it, so one socket in a loop
 * was a denial of service against every other viewer.
 *
 * Coalescing rather than rejecting is also what the scrub BAR wants: a drag fires continuously
 * and only the position the finger stopped at is worth answering.
 */
export const SCRUB_MIN_MS = 100

export async function createGateway(opts: GatewayOpts): Promise<Gateway> {
  const config = opts.config ?? DEFAULT_CONFIG
  const ownsDb = opts.db === undefined
  // Read-only law: without an in-process handle the world DB is opened readonly — no write path exists.
  const db = opts.db ?? new Database(opts.dbPath, { readonly: true, fileMustExist: true })
  const mirror = new WorldMirror({ db, config, terrain: opts.terrain })
  const hub = new SocketHub()
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")

  // ── HTTP route registry (Tasks 6–7 mount here) ──
  const routes: Array<{ method: string; segs: string[]; fn: RouteHandler }> = []
  const router: Router = {
    route(method, pattern, fn) { routes.push({ method, segs: pattern.split('/').filter(Boolean), fn }) },
  }

  // lazy codex: the forge `assets` table may not exist yet on a bare world DB
  let assetsSeen = false
  let codex: AssetCodex | null = null
  const getCodex = (): AssetCodex | null => {
    if (!assetsSeen) assetsSeen = hasTable.get('assets') !== undefined
    if (!assetsSeen) return null
    codex ??= new AssetCodex(db)
    return codex
  }
  // C7's narrator.db, opened readonly and never created: the observatory is one-way glass,
  // and a town whose first day is still unwritten simply has nothing to read.
  let narratorDb: Database.Database | null = null
  if (opts.narratorDbPath !== undefined) {
    try {
      narratorDb = new Database(opts.narratorDbPath, { readonly: true, fileMustExist: true })
    } catch {
      narratorDb = null
    }
  }

  mountAssetRoutes(router, { getCodex, knowsAgent: (id) => mirror.state().agents[id] !== undefined })
  mountDataApi(router, { db, mirror, config, agentDbDir: opts.agentDbDir })
  mountNarratorApi(router, { db, mirror, narratorDb, agentDbDir: opts.agentDbDir })
  mountBondsApi(router, { db, mirror, config })
  mountLineageApi(router, { db, mirror })
  mountDiscoveryApi(router, { db, mirror })

  // The built client, served from the world's own origin so the stream is one address.
  const site = opts.staticDir === undefined ? null : makeStaticSite(opts.staticDir)

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const segs = url.pathname.split('/').filter(Boolean)
    for (const r of routes) {
      if (r.method !== (req.method ?? 'GET') || r.segs.length !== segs.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < r.segs.length; i++) {
        const p = r.segs[i]!
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]!)
        else if (p !== segs[i]) { ok = false; break }
      }
      if (ok) { r.fn(req, res, params); return }
    }
    if (site !== null && site(req, res, url.pathname)) return
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":"not found"}')
  })

  // ── snapshot string, cached per pump generation ──
  let snapJson: string | null = null
  const snapshotJson = (): string => {
    if (snapJson === null) {
      snapJson = JSON.stringify({ t: 'snapshot', tick: mirror.state().tick, seq: mirror.seq(), state: mirror.state(), config, laws: mirror.state().laws ?? {}, live: true })
    }
    return snapJson
  }

  // ── ws protocol ──
  let listening = false
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_CLIENT_FRAME })
  // An EventEmitter with no 'error' listener THROWS, and ws re-emits every failure of the http
  // server it is attached to. A busy port took the whole process down with an unhandled
  // EADDRINUSE trace even though `httpServer.once('error')` below already reports it, and any
  // socket-layer error would do the same to a stream that had been up for a week.
  wss.on('error', (e) => { if (listening) console.error(`gateway: socket server error — ${e.message}`) })
  const removers = new Map<WebSocket, () => void>()
  const maxViewers = opts.maxViewers ?? DEFAULT_MAX_VIEWERS
  wss.on('connection', (sock: WebSocket) => {
    if (hub.size() >= maxViewers) { sock.close(CLOSE_TOO_MANY); return }
    let greeted = false
    let scrubAt = 0                       // last answered scrub, for coalescing
    let pendingScrub: { tick: number; reqId: number } | null = null
    let scrubTimer: ReturnType<typeof setTimeout> | null = null

    const answerScrub = (req: { tick: number; reqId: number }): void => {
      scrubAt = Date.now()
      let tick = req.tick
      let state
      try {
        state = mirror.stateAt(tick)
      } catch {
        tick = mirror.state().tick   // clamp, never error the socket
        state = mirror.state()
      }
      sock.send(JSON.stringify({ t: 'scrubbed', reqId: req.reqId, tick, state }))
    }

    sock.on('message', (data) => {
      let msg: ClientMsg
      try {
        msg = ClientMsg.parse(JSON.parse(data.toString()))
      } catch {
        sock.close(CLOSE_BAD_HELLO)
        return
      }
      if (!greeted) {
        if (msg.t !== 'hello' || msg.v !== PROTOCOL_VERSION) { sock.close(CLOSE_BAD_HELLO); return }
        greeted = true
        removers.set(sock, hub.add(sock, snapshotJson))
        sock.send(snapshotJson())
        // asset catch-up: late joiners must not render placeholders the codex already replaced
        const cdx = getCodex()
        if (cdx) for (const record of cdx.listSince(0)) sock.send(JSON.stringify({ t: 'asset', record }))
        return
      }
      if (msg.t === 'scrub') {
        const since = Date.now() - scrubAt
        if (since >= SCRUB_MIN_MS) { answerScrub(msg); return }
        // Inside the window: keep only the newest ask, and answer that one when it opens.
        pendingScrub = { tick: msg.tick, reqId: msg.reqId }
        scrubTimer ??= setTimeout(() => {
          scrubTimer = null
          const next = pendingScrub
          pendingScrub = null
          if (next !== null && sock.readyState === OPEN) answerScrub(next)
        }, SCRUB_MIN_MS - since)
      } else if (msg.t === 'live') {
        sock.send(snapshotJson())
      }
    })
    sock.on('close', () => {
      if (scrubTimer !== null) clearTimeout(scrubTimer)
      removers.get(sock)?.()
      removers.delete(sock)
    })
    // A viewer's connection dying mid-frame must not throw out of the socket server.
    sock.on('error', () => sock.terminate())
  })

  // ── poll pump ──
  let lastThoughtId = 0
  let lastAssetSeq = 0
  let observerSeen = false
  const pump = (): void => {
    const groups = mirror.poll()
    if (groups.length > 0) snapJson = null
    for (const g of groups) {
      hub.broadcast(JSON.stringify({ t: 'tick', tick: g.tick, events: g.events }))
    }
    if (!observerSeen) observerSeen = hasTable.get('observer_thoughts') !== undefined
    if (observerSeen) {
      for (const t of thoughtsSince(db, lastThoughtId)) {
        lastThoughtId = t.id
        hub.broadcast(JSON.stringify({ t: 'thought', agentId: t.agentId, tick: t.tick, text: t.text }))
      }
    }
    const cdx = getCodex()
    if (cdx) {
      for (const record of cdx.listSince(lastAssetSeq)) {
        lastAssetSeq = record.seq
        hub.broadcast(JSON.stringify({ t: 'asset', record }))
      }
    }
  }
  const timer = setInterval(pump, opts.pollMs ?? DEFAULT_POLL_MS)

  /**
   * ★ A GATEWAY THAT CANNOT TAKE ITS PORT USED TO LEAVE ITS PUMP RUNNING FOR EVER.
   *
   * The poll timer, the socket server and the http server are all built above, and `close()` —
   * the only thing that clears them — is on the object this function never gets to return. So
   * an `EADDRINUSE` left a `setInterval` polling a `WorldMirror` every 250 ms in a process that
   * had already given up, and the caller's `db.close()` then turned that into an UNCAUGHT
   * `TypeError: The database connection is not open` out of a timer nobody owns.
   *
   * Found by the live seam: `startDevWorld` learned to close the world db on a failed boot, and
   * the orphan pump started shouting about it. It was always leaking; it was just quiet.
   */
  let port: number
  try {
    port = await new Promise<number>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(opts.port ?? DEFAULT_PORT, () => {
        listening = true
        const addr = httpServer.address()
        resolve(typeof addr === 'object' && addr !== null ? addr.port : (opts.port ?? DEFAULT_PORT))
      })
    })
  } catch (e) {
    clearInterval(timer)
    wss.close()
    httpServer.close()
    if (ownsDb) db.close()
    narratorDb?.close()
    throw e
  }

  return {
    port,
    pump,
    close: () => new Promise<void>((resolve) => {
      clearInterval(timer)
      for (const client of wss.clients) client.terminate()
      wss.close(() => {
        httpServer.close(() => {
          if (ownsDb) db.close()
          narratorDb?.close()
          resolve()
        })
      })
    }),
  }
}
