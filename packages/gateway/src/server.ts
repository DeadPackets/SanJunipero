import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import Database from 'better-sqlite3'
import { WebSocketServer, type WebSocket } from 'ws'
import { ClientMsg, DEFAULT_CONFIG, PROTOCOL_VERSION, type SimConfig } from '@sj/shared'
import type { TileId } from '@sj/engine'
import { AssetCodex } from '@sj/forge'
import { WorldMirror } from './worldMirror.js'
import { SocketHub } from './hub.js'
import { thoughtsSince } from './observer.js'
import { mountAssetRoutes } from './assetsHttp.js'
import { mountDataApi } from './api.js'
import { mountNarratorApi } from './narratorApi.js'
import { mountBondsApi } from './bonds.js'
import { mountLineageApi } from './lineage.js'
import { mountDiscoveryApi } from './discoveries.js'

export type GatewayOpts = {
  dbPath: string; port?: number                 // default 8787
  config?: SimConfig; terrain: TileId[][]
  pollMs?: number                               // default 250
  db?: Database.Database                        // in-process override (dev world); else opened readonly
  agentDbDir?: string                           // per-agent memory DBs (`<id>.db`); absent → [] tab responses
  narratorDbPath?: string                       // C7's narrator.db; absent or unwritten → typed empties
}
export type Gateway = { port: number; close(): Promise<void>; pump(): void }  // pump exposed for tests

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void
export type Router = { route(method: string, pattern: string, fn: RouteHandler): void }

const DEFAULT_PORT = 8787
const DEFAULT_POLL_MS = 250
const CLOSE_BAD_HELLO = 4400

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

  mountAssetRoutes(router, { getCodex })
  mountDataApi(router, { db, mirror, config, agentDbDir: opts.agentDbDir })
  mountNarratorApi(router, { db, mirror, narratorDb, agentDbDir: opts.agentDbDir })
  mountBondsApi(router, { db, mirror, config })
  mountLineageApi(router, { db, mirror })
  mountDiscoveryApi(router, { db, mirror })

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
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  const removers = new Map<WebSocket, () => void>()
  wss.on('connection', (sock: WebSocket) => {
    let greeted = false
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
        let tick = msg.tick
        let state
        try {
          state = mirror.stateAt(tick)
        } catch {
          tick = mirror.state().tick   // clamp, never error the socket
          state = mirror.state()
        }
        sock.send(JSON.stringify({ t: 'scrubbed', reqId: msg.reqId, tick, state }))
      } else if (msg.t === 'live') {
        sock.send(snapshotJson())
      }
    })
    sock.on('close', () => { removers.get(sock)?.(); removers.delete(sock) })
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

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(opts.port ?? DEFAULT_PORT, () => {
      const addr = httpServer.address()
      resolve(typeof addr === 'object' && addr !== null ? addr.port : (opts.port ?? DEFAULT_PORT))
    })
  })

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
