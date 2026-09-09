import { createServer } from 'node:http'
import Database from 'better-sqlite3'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  ClientMsg,
  CLOSE_BAD_HELLO,
  DEFAULT_CONFIG,
  PROTOCOL_VERSION,
  TICK_REAL_MS,
  agentName,
  personAt,
  type AssetRecord,
  type SimConfig,
} from '@sj/shared'
import type { TileId } from '@sj/engine'
import { AssetCodex } from '@sj/forge'
import { WorldMirror } from './worldMirror.js'
import { MAX_BUFFERED, OPEN, SocketHub } from './hub.js'
import { latestMoods, type MoodRow, moodsSince, thoughtsSince } from './observer.js'
import { makeSceneRelay } from './scenes.js'
import { makeDirector } from './stakes.js'
import { mountAssetRoutes } from './assetsHttp.js'
import { mountDataApi } from './api.js'
import { mountNarratorApi } from './narratorApi.js'
import { makeMomentsReader } from './moments.js'
import { mountConstructsApi } from './constructs.js'
import { mountBondsApi } from './bonds.js'
import { forebears, mountLineageApi } from './lineage.js'
import { mountDiscoveryApi } from './discoveries.js'
import { makeStaticSite } from './staticSite.js'
import { mountShareCard, shareMeta } from './shareCard.js'
import { mountCrawlerRoutes } from './crawler.js'
import { adminChannelPort, makeAdminProxy } from './adminProxy.js'
import { reportOnce } from './degraded.js'
import { frameText, notFound, parseTarget, sendJson } from './http.js'
import type { RouteHandler, Router } from './router.js'

export type GatewayOpts = {
  dbPath: string
  port?: number // default 8787
  config?: SimConfig
  terrain: TileId[][]
  pollMs?: number // default 250
  db?: Database.Database // in-process override (dev world); else opened readonly
  agentDbDir?: string // per-agent memory DBs (`<id>.db`); absent → [] tab responses
  narratorDbPath?: string // C7's narrator.db; absent or unwritten → typed empties
  staticDir?: string // built @sj/web; absent → API/socket only (the dev split)
  maxViewers?: number // default DEFAULT_MAX_VIEWERS
  /** The loopback operator channel `/admin/*` is forwarded to. `null` refuses every admin path;
   *  absent, `SJ_ADMIN_TOKEN`/`SJ_ADMIN_PORT` decide. */
  adminPort?: number | null
  paused?: () => boolean // the world clock's own state; absent → the town is always running
  onViewers?: (count: number) => void // live viewer count, as one greets and as one leaves
  scrubBudgetMsPerS?: number // default SCRUB_BUDGET_MS_PER_S
  replayMsPerTick?: number // default TICK_REAL_MS — the cadence a replay plays the past back at
}
export type Gateway = { port: number; close(): Promise<void>; pump(): void } // pump exposed for tests

const DEFAULT_PORT = 8787
const DEFAULT_POLL_MS = 250
export const CLOSE_TOO_MANY = 4429

/** A viewer sends `hello` on open, so only a socket with nothing to say ever reaches this. */
export const HELLO_DEADLINE_MS = 5_000

/** A viewer only ever sends `hello`, `scrub` or `live`, none of which reach 200 bytes. ws
 *  defaults to a 100 MB frame, which is 100 MB a stranger can make the server buffer. */
const MAX_CLIENT_FRAME = 4096

/** How many viewers one world serves before it turns people away. Refusing the 501st with a
 *  code is a stream at capacity; accepting it and degrading for the other 500 is an outage. */
const DEFAULT_MAX_VIEWERS = 500

/** A 40-byte `scrub` frame costs ~120 KB of fold-and-stringify on the thread that ticks the
 *  town. Coalesced rather than rejected: only where the finger stopped is worth answering. */
export const SCRUB_MIN_MS = 100

/** 4% of one core. The floor above is per SOCKET: at a measured 6-11 ms a scrub, ten of the 500
 *  viewers dragging at once stop the town ticking. Over budget a viewer gets the live moment. */
const SCRUB_BUDGET_MS_PER_S = 40

/** Frames under this go out raw: a `thought` or an `asset` is smaller than the deflate header. */
const DEFLATE_THRESHOLD_BYTES = 512

export async function createGateway(opts: GatewayOpts): Promise<Gateway> {
  const config = opts.config ?? DEFAULT_CONFIG
  const ownsDb = opts.db === undefined
  // Read-only law: without an in-process handle the world DB is opened readonly — no write path exists.
  const db = opts.db ?? new Database(opts.dbPath, { readonly: true, fileMustExist: true })
  const mirror = new WorldMirror({ db, config, terrain: opts.terrain })
  const hub = new SocketHub()
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")

  // ── HTTP route registry (Tasks 6–7 mount here) ──
  const routes: { method: string; segs: string[]; fn: RouteHandler }[] = []
  const router: Router = {
    route(method, pattern, fn) {
      routes.push({ method, segs: pattern.split('/').filter(Boolean), fn })
    },
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

  mountAssetRoutes(router, {
    getCodex,
    knowsAgent: (id) => personAt(mirror.state().agents, id) !== undefined,
    kinOf: (id) => forebears(mirror.state().agents, id),
  })
  const closeDataApi = mountDataApi(router, { db, mirror, config, agentDbDir: opts.agentDbDir })
  mountNarratorApi(router, { db, mirror, narratorDb, agentDbDir: opts.agentDbDir })
  const moments = makeMomentsReader({ db, mirror, narratorDb })
  const closeConstructsApi = mountConstructsApi(router, { agentDbDir: opts.agentDbDir })
  mountBondsApi(router, { db, mirror, config })
  mountLineageApi(router, { db, mirror })
  mountDiscoveryApi(router, { db, mirror })
  const shareDeps = { mirror, narratorDb, getCodex, moments }
  mountShareCard(router, shareDeps)
  mountCrawlerRoutes(router, { mirror, narratorDb })

  // The built client, served from the world's own origin so the stream is one address.
  const site =
    opts.staticDir === undefined
      ? null
      : makeStaticSite(opts.staticDir, (pathname) => shareMeta(shareDeps, pathname))

  // Off the route table on purpose: the operator's channel owns its own paths, at whatever
  // depth, on whatever method, and the gateway only carries them across the origin.
  const proxyAdmin = makeAdminProxy(
    opts.adminPort === undefined ? adminChannelPort() : opts.adminPort,
  )

  const httpServer = createServer((req, res) => {
    const url = parseTarget(req.url)
    if (url === null) {
      sendJson(res, { error: 'bad request' }, 400)
      return
    }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      proxyAdmin(req, res)
      return
    }
    const segs = url.pathname.split('/').filter(Boolean)
    for (const r of routes) {
      if (r.method !== (req.method ?? 'GET') || r.segs.length !== segs.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < r.segs.length; i++) {
        const p = r.segs[i]!
        // A malformed escape is not this route's path: `decodeURIComponent` throws, and unguarded
        // that throw is an uncaughtException in the listener that ticks the town.
        if (p.startsWith(':')) {
          try {
            params[p.slice(1)] = decodeURIComponent(segs[i]!)
          } catch {
            ok = false
            break
          }
        } else if (p !== segs[i]) {
          ok = false
          break
        }
      }
      if (ok) {
        try {
          r.fn(req, res, params)
        } catch (e) {
          reportOnce(
            `route.${r.method} ${r.segs.join('/')}`,
            () =>
              `${r.method} /${r.segs.join('/')} threw — ${e instanceof Error ? e.message : String(e)}`,
          )
          if (res.headersSent) res.destroy()
          else sendJson(res, { error: 'internal error' }, 500)
        }
        return
      }
    }
    if (site?.(req, res, url.pathname)) return
    notFound(res)
  })

  // ── snapshot string, cached per pump generation ──
  let snapJson: string | null = null
  // ONE frame, not one send per record — 189 of them on the dev codex, in the connection handler.
  // Topped up from the codex's own seq, so a hello landing between two pumps sees a new sheet.
  const catchUp: AssetRecord[] = []
  let catchUpJson: string | null = null
  let catchUpSeq = 0
  // Stringified once per generation: only `reqId` differs between the sockets turned away.
  let busyHead: string | null = null
  const busyScrubJson = (reqId: number): string => {
    busyHead ??= JSON.stringify({
      t: 'scrubbed',
      tick: mirror.state().tick,
      state: mirror.state(),
    }).slice(0, -1)
    return `${busyHead},"reqId":${reqId}}`
  }
  const isPaused = opts.paused ?? ((): boolean => false)
  let wasPaused = isPaused()
  const snapshotJson = (): string => {
    snapJson ??= JSON.stringify({
      t: 'snapshot',
      tick: mirror.state().tick,
      seq: mirror.seq(),
      state: mirror.state(),
      config,
      laws: mirror.state().laws ?? {},
      live: true,
      paused: isPaused(),
    })
    return snapJson
  }

  // ── ws protocol ──
  let listening = false
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_CLIENT_FRAME,
    // Caddy's `encode` covers HTTP and never a proxied socket, so without this every frame goes
    // out raw. A shared dictionary per socket is what 500 viewers cannot afford, hence the levers.
    perMessageDeflate: {
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      threshold: DEFLATE_THRESHOLD_BYTES,
      concurrencyLimit: 10,
      zlibDeflateOptions: { level: 6, memLevel: 5, windowBits: 13 },
    },
  })
  // An EventEmitter with no 'error' listener THROWS, and ws re-emits every failure of the http
  // server it is attached to — a busy port would take the whole process down.
  wss.on('error', (e) => {
    if (listening) console.error(`gateway: socket server error — ${e.message}`)
  })
  // One bucket for every socket: scrub work is paid for out of the thread that ticks the town, and
  // a stranger's drag must not be able to spend more of it than the town can spare.
  const scrubBudgetMsPerS = opts.scrubBudgetMsPerS ?? SCRUB_BUDGET_MS_PER_S
  let scrubTokens = scrubBudgetMsPerS
  let scrubFilledAt = Date.now()
  const takeScrubBudget = (): boolean => {
    const now = Date.now()
    scrubTokens = Math.min(
      scrubBudgetMsPerS,
      scrubTokens + ((now - scrubFilledAt) * scrubBudgetMsPerS) / 1000,
    )
    scrubFilledAt = now
    return scrubTokens > 0
  }

  // ── replay cursors ──
  // A replay pays for ONE fold, at its first minute; every minute after it is a read of the log
  // forwarded in the frame shape a live delta already has. Its own scene relay, because the live
  // one holds the open scenes of the town's present.
  type Replay = { tick: number; nextAtMs: number; scenes: ReturnType<typeof makeSceneRelay> }
  const replays = new Map<WebSocket, Replay>()
  const replayMsPerTick = opts.replayMsPerTick ?? TICK_REAL_MS
  const endReplay = (sock: WebSocket): boolean => {
    if (!replays.delete(sock)) return false
    hub.setMuted(sock, false)
    return true
  }

  const removers = new Map<WebSocket, () => void>()
  const maxViewers = opts.maxViewers ?? DEFAULT_MAX_VIEWERS
  wss.on('connection', (sock: WebSocket) => {
    // Before the capacity check: a socket refused at capacity is still read from while it closes,
    // and an oversize frame on it emits an 'error' that throws out of the socket server unlistened.
    sock.on('error', () => {
      sock.terminate()
    })
    // `wss.clients` already holds the arriving socket, hence `>`. Counted here rather than off
    // the hub, which a socket joins only after a valid hello.
    if (wss.clients.size > maxViewers) {
      sock.close(CLOSE_TOO_MANY)
      return
    }
    let greeted = false
    const helloTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (!greeted) sock.close(CLOSE_BAD_HELLO)
    }, HELLO_DEADLINE_MS)
    let scrubAt = 0 // last answered scrub, for coalescing
    let liveAt = 0 // last answered `live`, on its own clock: a drag ends with one of them
    let replayAt = 0 // last opened replay: the same floor, because it pays the same fold
    let pendingScrub: { tick: number; reqId: number } | null = null
    let scrubTimer: ReturnType<typeof setTimeout> | null = null

    const answerScrub = (req: { tick: number; reqId: number }): void => {
      scrubAt = Date.now()
      // A ~120 KB reply to a viewer already a megabyte behind is memory nobody will ever read.
      if (sock.bufferedAmount > MAX_BUFFERED) return
      if (!takeScrubBudget()) {
        sock.send(busyScrubJson(req.reqId))
        return
      }
      const startedAt = performance.now()
      let tick = req.tick
      let state
      try {
        state = mirror.stateAt(tick)
      } catch {
        tick = mirror.state().tick // clamp, never error the socket
        state = mirror.state()
      }
      sock.send(JSON.stringify({ t: 'scrubbed', reqId: req.reqId, tick, state }))
      scrubTokens -= performance.now() - startedAt
    }

    const answerReplay = (req: { from: number; reqId: number }): void => {
      // First, whatever this socket was already playing: every path below leaves it somewhere
      // else, and a cursor left running would send minutes into a view that has moved on.
      endReplay(sock)
      // Nothing recorded to play: the town has not lived that minute yet, so it hands back now.
      if (req.from >= mirror.state().tick) {
        sock.send(snapshotJson())
        return
      }
      if (!takeScrubBudget()) {
        sock.send(busyScrubJson(req.reqId))
        return
      }
      const startedAt = performance.now()
      const at = mirror.snapshotAt(req.from)
      sock.send(
        JSON.stringify({
          t: 'replaying',
          reqId: req.reqId,
          tick: req.from,
          seq: at.seq,
          state: at.state,
        }),
      )
      scrubTokens -= performance.now() - startedAt
      hub.setMuted(sock, true)
      replays.set(sock, {
        tick: req.from,
        nextAtMs: Date.now() + replayMsPerTick,
        scenes: makeSceneRelay(),
      })
    }

    sock.on('message', (data) => {
      let msg: ClientMsg
      try {
        msg = ClientMsg.parse(JSON.parse(frameText(data)))
      } catch {
        sock.close(CLOSE_BAD_HELLO)
        return
      }
      if (!greeted) {
        if (msg.t !== 'hello' || msg.v !== PROTOCOL_VERSION) {
          sock.close(CLOSE_BAD_HELLO)
          return
        }
        greeted = true
        removers.set(sock, hub.add(sock, snapshotJson))
        // Ahead of the first frame, so a waking town is already at full speed inside it. Counted
        // at the hello, so the number means watchers, not sockets.
        opts.onViewers?.(hub.size())
        sock.send(snapshotJson())
        // asset catch-up: late joiners must not render placeholders the codex already replaced
        const cdx = getCodex()
        if (cdx) {
          for (const record of cdx.listSince(catchUpSeq)) {
            catchUpSeq = record.seq
            catchUp.push(record)
            catchUpJson = null
          }
          if (catchUp.length > 0) {
            catchUpJson ??= JSON.stringify({ t: 'assets', records: catchUp })
            sock.send(catchUpJson)
          }
        }
        // The word each mind holds about itself, so a late roster does not guess from the body.
        if (observerSeen) for (const m of latestMoods(db)) sock.send(moodJson(m))
        // The shot the town is already on. A replaying socket never gets one: a moment's own
        // cast owns that camera.
        if (directorJson !== null) sock.send(directorJson)
        return
      }
      if (msg.t === 'scrub') {
        const since = Date.now() - scrubAt
        if (since >= SCRUB_MIN_MS) {
          answerScrub(msg)
          return
        }
        // Inside the window: keep only the newest ask, and answer that one when it opens.
        pendingScrub = { tick: msg.tick, reqId: msg.reqId }
        scrubTimer ??= setTimeout(() => {
          scrubTimer = null
          const next = pendingScrub
          pendingScrub = null
          if (next !== null && sock.readyState === OPEN) answerScrub(next)
        }, SCRUB_MIN_MS - since)
      } else if (msg.t === 'replay') {
        const now = Date.now()
        if (now - replayAt < SCRUB_MIN_MS || sock.bufferedAmount > MAX_BUFFERED) return
        replayAt = now
        answerReplay(msg)
      } else if (msg.t === 'live') {
        // A full snapshot per 40-byte frame, otherwise: the same floor a scrub gets, on its own
        // clock so ending a drag is never the ask that gets dropped.
        const now = Date.now()
        // A replay ends on this frame and nothing follows it — the floor may drop a spare `live`,
        // never the one that hands a viewer back the live town.
        const ending = endReplay(sock)
        if (!ending && (now - liveAt < SCRUB_MIN_MS || sock.bufferedAmount > MAX_BUFFERED)) return
        liveAt = now
        sock.send(snapshotJson())
      }
    })
    sock.on('close', () => {
      clearTimeout(helloTimer)
      if (scrubTimer !== null) clearTimeout(scrubTimer)
      replays.delete(sock)
      removers.get(sock)?.()
      removers.delete(sock)
      opts.onViewers?.(hub.size())
    })
  })

  // ── poll pump ──
  const sceneFrames = makeSceneRelay()
  // What the camera is on, folded off the same groups the deltas ride. Read-only on the world:
  // the names and the partnerships come out of the mirror's own state.
  const director = makeDirector(
    (id) => agentName(mirror.state().agents, id),
    (id) => personAt(mirror.state().agents, id)?.partnerId ?? null,
  )
  director.prime(db, mirror.state().tick)
  let directorJson: string | null = null
  /** The cut, the beat and the act without the tick, which moves every minute on its own. */
  let directorMark = ''
  let lastThoughtId = 0
  let lastMoodId = 0
  const moodJson = (m: MoodRow): string =>
    JSON.stringify({ t: 'mood', agentId: m.agentId, tick: m.tick, mood: m.mood })
  let lastAssetSeq = 0
  let observerSeen = false
  /** One recorded minute per replaying socket per beat, at the live cadence. No fold and no
   *  stringify of state: the log's own rows, in the frame shape the viewer already folds. */
  const driveReplays = (now: number): void => {
    for (const [sock, cur] of replays) {
      if (sock.readyState !== OPEN) {
        replays.delete(sock)
        continue
      }
      // Held rather than dropped: a replayed minute a viewer misses is a hole in its own fold.
      if (now < cur.nextAtMs || sock.bufferedAmount > MAX_BUFFERED) continue
      if (cur.tick >= mirror.state().tick) {
        endReplay(sock)
        sock.send(snapshotJson())
        continue
      }
      // The bucket a scrub drains, and it is the whole town's: with it empty every replay holds
      // its minute rather than spending the thread that ticks. They catch up on the next beat.
      if (!takeScrubBudget()) break
      const startedAt = performance.now()
      const next = cur.tick + 1
      for (const g of mirror.eventsBetween(cur.tick, next)) {
        const seq = g.events[g.events.length - 1]!.seq
        sock.send(JSON.stringify({ t: 'tick', tick: g.tick, seq, events: g.events }))
        for (const frame of cur.scenes(g.events)) sock.send(JSON.stringify(frame))
      }
      cur.tick = next
      cur.nextAtMs = Math.max(now, cur.nextAtMs + replayMsPerTick)
      scrubTokens -= performance.now() - startedAt
    }
  }

  const pump = (): void => {
    // A stopped clock sends no deltas. Its own frame, because re-broadcasting the snapshot would
    // yank a scrubbing viewer back to the live edge.
    if (isPaused() !== wasPaused) {
      wasPaused = isPaused()
      snapJson = null
      hub.broadcast(JSON.stringify({ t: 'paused', paused: wasPaused }))
    }
    hub.resyncDrained() // before the poll folds: a snapshot must predate the deltas after it
    const groups = mirror.poll()
    if (groups.length > 0) {
      snapJson = null
      busyHead = null
    }
    for (const g of groups) {
      const seq = g.events[g.events.length - 1]?.seq ?? mirror.seq()
      hub.broadcast(JSON.stringify({ t: 'tick', tick: g.tick, seq, events: g.events }))
      for (const frame of sceneFrames(g.events)) hub.broadcast(JSON.stringify(frame))
      director.fold(g.events)
    }
    const cut = director.frame(mirror.state().tick)
    const mark = JSON.stringify([cut.cut, cut.quiet, cut.act])
    if (mark !== directorMark) {
      directorMark = mark
      directorJson = JSON.stringify(cut)
      hub.broadcast(directorJson)
    }
    if (!observerSeen) observerSeen = hasTable.get('observer_thoughts') !== undefined
    if (observerSeen) {
      for (const t of thoughtsSince(db, lastThoughtId)) {
        lastThoughtId = t.id
        hub.broadcast(
          JSON.stringify({
            t: 'thought',
            agentId: t.agentId,
            tick: t.tick,
            text: t.text,
            importance: t.importance,
          }),
        )
      }
      for (const m of moodsSince(db, lastMoodId)) {
        lastMoodId = m.id
        hub.broadcast(moodJson(m))
      }
    }
    const cdx = getCodex()
    if (cdx) {
      const fresh = cdx.listSince(lastAssetSeq)
      if (fresh.length > 0) {
        lastAssetSeq = fresh[fresh.length - 1]!.seq
        hub.broadcast(JSON.stringify({ t: 'assets', records: fresh }))
      }
    }
    driveReplays(Date.now())
  }
  const timer = setInterval(pump, opts.pollMs ?? DEFAULT_POLL_MS)

  /** The poll timer, the socket server and the http server are all built above, and `close()` —
   *  the only thing that clears them — is on the object a failed listen never returns. */
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
    closeDataApi()
    closeConstructsApi()
    if (ownsDb) db.close()
    narratorDb?.close()
    throw e
  }

  return {
    port,
    pump,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer)
        for (const client of wss.clients) client.terminate()
        wss.close(() => {
          httpServer.close(() => {
            closeDataApi()
            closeConstructsApi()
            if (ownsDb) db.close()
            narratorDb?.close()
            resolve()
          })
        })
      }),
  }
}
