# C6 — Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The public window into the town: a `@sj/gateway` WebSocket fan-out (snapshot + delta, serialize-once, slow-viewer gating) and a `@sj/web` React 19 + PixiJS 8 observatory with six lenses — gated by G6 (2 browsers watch the C2 scripted world at 60fps, scrub renders any past moment, agent click shows a live thought within a tick, a sprite hot-load visibly swaps a placeholder).

**Architecture:** The gateway is a read-only observer process: it opens `data/*.db` (WAL), boots its mirror state from the latest snapshot (or genesis + replay), polls the append-only `events` table, folds new ticks with the engine's own pure `fold`, and broadcasts each tick's events as one pre-serialized string to N sockets. The browser holds a `WorldState` too — it applies the same `fold` (imported via a new pure subpath export), so live view and scrub are bit-identical to the engine by construction. Scrub is server-side snapshot + replay returning a full state. Thoughts never enter world state (spec law): they travel on a separate observer feed table + push message. All rendering runs against forge's placeholder path; real sprites hot-swap via `onAssetReady` → codex → gateway push → `Assets` reload with explicit `texture.source.unload()`.

**Tech Stack:** Node 24, TS ESM, Vitest; `ws@^8` (gateway); React 19 + Vite 8, `pixi.js@^8`, `react-force-graph-2d@^1` (web). No other new runtime dependencies. Zero LLM calls in this chunk ($0 API budget).

**Spec:** `docs/superpowers/specs/2026-08-15-san-junipero-design.md` §7 (Style Bible: ambient motion, tone rule, observatory UI chrome), §8 (Observatory lenses), §15 Frontend table (binding tech picks). Roadmap: `docs/superpowers/plans/2026-08-15-00-master-roadmap.md` C6 block. Renderer notes: `packages/forge/content/style-bible.md` "Character standard v2" (walk loop contact-A → passing-A → contact-B → passing-B at 8fps; 1px bob on passing frames, render-time only; blob shadow; sleep pose row; portraits drive inspector/dialogue; emotes as 16×16 overlay above the head; cells 96×96 feet-anchored at y=88).

## Global Constraints

- Spec §8 verbatim: "Read-only by construction; N viewers = fan-out broadcast." No client message may mutate world state; the gateway opens SQLite read-only and exposes no write path from sockets. Viewer interaction of any kind is out of scope (spec §14).
- Spec §15 verbatim: renderer is "PixiJS 8.x, mounted in a React ref (NOT @pixi/react — wrong layer for 60fps sprite sync); React drives chrome only."
- Spec §15 pixel-perfect verbatim: `scaleMode: 'nearest'`, `antialias: false`, `roundPixels: true`, integer zoom.
- Spec §15 isometric verbatim: hand-rolled dimetric math (`screenX=(x−y)·w/2, screenY=(x+y)·h/2`, depth-sort by `x+y`); static ground layer baked once into a `RenderTexture`.
- Spec §15 transport verbatim: plain `ws` — serialize each tick's delta once, broadcast to N; gate slow viewers on `bufferedAmount`.
- Spec §15 hot-load verbatim: `Assets.add/load` with unique keys; explicit `texture.source.unload()` on replacement.
- Spec §7 tone rule verbatim: "grave scenes (death, funerals, violence aftermath) suppress all cartoon effects — the renderer goes still."
- Spec §5 human framing: no viewer-facing text references AI/tools/prompts. Chrome copy speaks about townsfolk, never models.
- Asset independence (roadmap C5→C6 contract): every rendering task in this plan runs and is gate-checkable against PLACEHOLDER sprites (forge `makePlaceholder` checkerboard, `status: 'placeholder'`). No task blocks on generated art; real assets only ever hot-swap in.
- Determinism law untouched: the gateway and web never write to `events`/world tables and never draw RNG that the engine records. Golden replay (G1/G2) stays green — CI proof in the gate task.
- Thoughts are observer-side only (spec §5: thought "never enters world state; viewers see it"): they live in `observer_thoughts`, never in `events`.
- Roadmap globals: TypeScript ESM, strict tsconfig, Vitest TDD per task, commit per task, Zod 4 for every schema (`.strict()` payloads), monorepo layout `packages/{...,web,gateway}`.
- Every render tunable (tint stops, particle counts, bob px, fps, gating thresholds) lives in an exported `const` block in its module — no magic numbers inline; unit tests reference the consts.
- Worktree gotcha: EnterWorktree branches from stale origin/main — first action after creating the worktree is `git merge main --ff`.
- (controller ruling) Base = `c6-work`: branched from main (d0d3562) plus a `--no-ff` merge of `asset-v2` — C6 builds on the forge phase-b CODE (emotes, guides, sheet v2 constants); the generated art's human approval is a separate track and nothing in this plan depends on it.

## Interfaces produced (C7/C8 consume — binding)

```ts
// @sj/shared (new module protocol.ts, re-exported from index)
PROTOCOL_VERSION = 1
ClientMsg  = Hello {t:'hello', v, lastSeenTick: number|null} | Scrub {t:'scrub', tick, reqId} | Live {t:'live'}
ServerMsg  = Snapshot {t:'snapshot', tick, seq, state, config, live} | Tick {t:'tick', tick, events: SimEvent[]}
           | Scrubbed {t:'scrubbed', reqId, tick, state} | Thought {t:'thought', agentId, tick, text}
           | Asset {t:'asset', record: AssetRecord}
momentToTick(day: number, time: string): number   // '/moment/:day/:time' ↔ tick
tickToMoment(tick: number): { day: number; time: string }

// @sj/engine package.json — additive subpath exports (browser-safe pure modules)
"./fold": "./src/fold.ts", "./state": "./src/state.ts"

// @sj/gateway
createGateway(opts: GatewayOpts): Promise<Gateway>      // ws + http on one port (default 8787)
publishThought(db, {tick, agentId, text}): void          // C3 runtime + C7 narrator call this
AgentRuntime opts gains onThought?: (t: {tick, agentId, text}) => void   // 4-line hook, Task 3
HTTP: /assets/:id.png /assets/placeholder/:class.png /assets/character/:agentId.png
      /assets/emotes.png /assets/emotes.json
      /api/agent/:id/{profile,journal,ledgers,personality}
      /api/structure/:id/provenance  /api/society  /api/chapters  /api/heat  /api/digest
      (/api/chapters returns [] and /api/heat returns the stub until C7 replaces their readers)

// @sj/web
Route /moment/:day/:time (deep link, roadmap-promised)
```

## Deferred spec items (explicit — see Open Questions)

1. **OG share cards rendered server-side** (spec §8 last line) — needs headless scene rendering + narrator captions; deferred to C7. The deep-link route ships now so the URLs are stable.
2. **Meadow-to-city timelapse export** (spec §8 chronicle row) — scrub is the mechanism; the export tool is deferred to C7/C8. No UI stub pretends otherwise.
3. **Society edges from ledger-derived trust/debt/grudge/love** — C3 ledgers are prose docs with no numeric fields on main; C6 ships a deterministic interaction proxy (speak/give/teach/attack counts from events) behind the same `/api/society` contract; C7 upgrades the reader.
4. **Newspaper-rendered digest** — C7; C6 ships the digest shell per roadmap wording.

---

### Task 1: Delta protocol schema in @sj/shared + pure engine subpath exports

**Files:**
- Create: `packages/shared/src/protocol.ts`, `packages/shared/src/protocol.test.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './protocol.js'`)
- Modify: `packages/engine/package.json` (exports map only)

**Interfaces:**
- Consumes: `EventEnvelope` (`@sj/shared/events`), `AssetRecordSchema` (`@sj/shared/assetCodex`), `MINUTES_PER_DAY` (`@sj/shared/time`).
- Produces: everything in the binding block above; later tasks import `ServerMsg`/`ClientMsg`/`momentToTick` — names are load-bearing.

- [ ] **Step 1: failing test** — `protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ClientMsg, ServerMsg, momentToTick, tickToMoment, PROTOCOL_VERSION } from './protocol.js'

describe('protocol', () => {
  it('round-trips a tick message', () => {
    const msg = { t: 'tick', tick: 42, events: [{ seq: 7, tick: 42, type: 'agent_moved', payload: { id: 'a', x: 1, y: 2 } }] }
    expect(ServerMsg.parse(msg)).toEqual(msg)
  })
  it('rejects unknown keys and unknown discriminants', () => {
    expect(() => ClientMsg.parse({ t: 'hello', v: PROTOCOL_VERSION, lastSeenTick: null, extra: 1 })).toThrow()
    expect(() => ServerMsg.parse({ t: 'mutate_world' })).toThrow()
  })
  it('moment math: day 41 14:30 ↔ tick', () => {
    expect(momentToTick(41, '14:30')).toBe(41 * 1440 + 14 * 60 + 30)
    expect(tickToMoment(41 * 1440 + 870)).toEqual({ day: 41, time: '14:30' })
    expect(momentToTick(41, '24:00')).toBeNaN() // invalid time → NaN, caller rejects
  })
})
```

- [ ] **Step 2: RED** — `pnpm vitest run packages/shared/src/protocol.test.ts` fails (module missing).
- [ ] **Step 3: implement** `protocol.ts`:

```ts
import { z } from 'zod'
import { EventEnvelope } from './events.js'
import { AssetRecordSchema } from './assetCodex.js'
import { MINUTES_PER_DAY } from './time.js'

export const PROTOCOL_VERSION = 1
const tick = z.number().int().nonnegative()

export const ClientHello = z.object({ t: z.literal('hello'), v: z.number().int(), lastSeenTick: tick.nullable() }).strict()
export const ClientScrub = z.object({ t: z.literal('scrub'), tick, reqId: z.number().int().nonnegative() }).strict()
export const ClientLive  = z.object({ t: z.literal('live') }).strict()
export const ClientMsg = z.discriminatedUnion('t', [ClientHello, ClientScrub, ClientLive])
export type ClientMsg = z.infer<typeof ClientMsg>

export const ServerSnapshot = z.object({ t: z.literal('snapshot'), tick, seq: z.number().int().nonnegative(), state: z.unknown(), config: z.unknown(), live: z.boolean() }).strict()
// config = the sim's SimConfig: the client folds deltas with the SAME config as the engine, or live view drifts from truth
export const ServerTick    = z.object({ t: z.literal('tick'), tick, events: z.array(EventEnvelope) }).strict()
export const ServerScrubbed = z.object({ t: z.literal('scrubbed'), reqId: z.number().int().nonnegative(), tick, state: z.unknown() }).strict()
export const ServerThought = z.object({ t: z.literal('thought'), agentId: z.string().min(1), tick, text: z.string() }).strict()
export const ServerAsset   = z.object({ t: z.literal('asset'), record: AssetRecordSchema }).strict() // png travels over HTTP, never the socket
export const ServerMsg = z.discriminatedUnion('t', [ServerSnapshot, ServerTick, ServerScrubbed, ServerThought, ServerAsset])
export type ServerMsg = z.infer<typeof ServerMsg>

export function momentToTick(day: number, time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m || day < 0 || !Number.isInteger(day)) return NaN
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return day * MINUTES_PER_DAY + h * 60 + min
}
export function tickToMoment(t: number): { day: number; time: string } {
  const day = Math.floor(t / MINUTES_PER_DAY), rem = t % MINUTES_PER_DAY
  const pad = (n: number) => String(n).padStart(2, '0')
  return { day, time: `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}` }
}
```

- [ ] **Step 4: engine subpath exports** — `packages/engine/package.json` exports becomes:

```json
"exports": { ".": "./src/index.ts", "./fold": "./src/fold.ts", "./state": "./src/state.ts" }
```

(`fold.ts`'s whole import graph — `state.ts`, `events.def.ts`, `path.ts`, `verbs.ts`, `rng.ts`, `@sj/shared` — is pure TS + zod; `better-sqlite3` is only reachable via `./src/index.ts` → `db.ts`. This is what lets Vite bundle the reducer.)

- [ ] **Step 5: GREEN** — protocol test passes; full suite + `pnpm typecheck` green (subpath addition is additive).
- [ ] **Step 6: Commit** — `feat(shared): observatory delta protocol + pure engine subpath exports`

---

### Task 2: @sj/gateway scaffold + WorldMirror (boot, poll, stateAt)

**Files:**
- Create: `packages/gateway/package.json`, `packages/gateway/tsconfig.json`, `packages/gateway/src/index.ts`, `packages/gateway/src/worldMirror.ts`
- Test: `packages/gateway/src/worldMirror.test.ts`
- Modify: root `package.json` typecheck script (append `packages/gateway`)

**Interfaces:**
- Consumes: `openDb`, `EventStore`, `fold`, `replayFromGenesis`, `genesisState`, `TileId`, `WorldState` from `@sj/engine`; `SimConfig`, `DEFAULT_CONFIG`, `SimEvent`, `stateHash` from `@sj/shared`.
- Produces (binding for Tasks 5, 7, 8):

```ts
export class WorldMirror {
  constructor(opts: { db: Database.Database; config: SimConfig; terrain: TileId[][] })
  state(): WorldState                                   // current folded state
  seq(): number                                         // last folded event seq
  poll(): Array<{ tick: number; events: SimEvent[] }>   // complete new ticks since last poll, grouped
  stateAt(tick: number): WorldState                     // nearest snapshot ≤ tick, fold forward — scrub
}
```

`package.json`:

```json
{ "name": "@sj/gateway", "version": "0.0.1", "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "dev:world": "tsx src/devWorld.ts", "demo:hotswap": "tsx src/hotswapDemo.ts" },
  "dependencies": { "@sj/shared": "workspace:*", "@sj/engine": "workspace:*", "@sj/forge": "workspace:*",
    "ws": "^8.18.0", "better-sqlite3": "^13.0.0", "zod": "^4.4.0" },
  "devDependencies": { "@types/better-sqlite3": "^7.6.0", "@types/ws": "^8.5.0" } }
```

(`dev:world`/`demo:hotswap` scripts land in Tasks 8/11; declaring them now keeps this file single-touch.)

Implementation rules (exact):
- Boot: read latest snapshot row (own prepared statement `SELECT tick, seq, state FROM snapshots ORDER BY id DESC LIMIT 1`); if present, `state = JSON.parse(row.state)`, `seq = row.seq`, then fold every event with `seq > row.seq`. If absent, `state = genesisState(config, terrain)` folded from seq 0. (TickLoop commits each tick in one transaction, so a WAL reader never sees a torn tick.)
- `poll()`: `store.readFrom(lastSeq)` → group by `ev.tick` preserving order → fold each event into `state` → return groups. Empty array when nothing new.
- `stateAt(tick)`: prepared `SELECT tick, seq, state FROM snapshots WHERE tick <= ? ORDER BY tick DESC, id DESC LIMIT 1`; base = that state (or genesis); then prepared `SELECT seq, tick, type, payload FROM events WHERE seq > ? AND tick <= ? ORDER BY seq` folded forward. Throws `RangeError` if `tick` exceeds the live tick.
- The mirror NEVER writes — it only prepares SELECTs. Read-only enforcement lives where the DB is opened: `createGateway` (Task 5) opens by path with `{ readonly: true }`; the dev world hands in its own in-process handle.

- [ ] **Step 1: failing tests** — build a temp-file DB, drive a real `TickLoop` (fast: `realMsPerTick` irrelevant, call `step()` directly) over a 8×8 grass map with one spawned agent walking; `snapshotEveryTicks: 5`; run 12 ticks. Assert:
  - `new WorldMirror(...)` on the finished DB boots to `stateHash(mirror.state()) === stateHash(loop.state)`.
  - A mirror created after tick 7 (snapshot at 5 exists) boots from the snapshot: verify by asserting it equals a from-genesis fold (`replayFromGenesis`) — same hash.
  - `poll()` after 3 more `step()`s returns exactly 3 groups with strictly increasing `tick`, and mirror hash tracks `loop.state`.
  - `stateAt(6)` hash equals a reference fold of all events with `tick ≤ 6` from genesis; `stateAt(0)` returns genesis; `stateAt(9999)` throws `RangeError`.
- [ ] **Step 2: RED.**
- [ ] **Step 3: implement** per the rules above (~90 lines).
- [ ] **Step 4: GREEN** + full suite + typecheck (root script now includes gateway).
- [ ] **Step 5: Commit** — `feat(gateway): package scaffold + WorldMirror (boot, poll, scrub stateAt)`

---

### Task 3: Observer thought feed + AgentRuntime onThought hook

**Files:**
- Create: `packages/gateway/src/observer.ts`, test `packages/gateway/src/observer.test.ts`
- Modify: `packages/agents/src/runtime/agentRuntime.ts` (constructor opts + one call site next to the existing `insertMemory({ kind: 'thought', ... })` around line 408), test appended to `packages/agents/src/runtime/agentRuntime.test.ts`

(controller ruling) The 4-line optional `onThought` hook is APPROVED. `packages/agents` is otherwise FROZEN to this chunk — nothing else in that package may change.

**Interfaces:**
- Produces (binding — C3 wiring in C8, C7 narrator reads the same table):

```ts
export function ensureObserverTables(db: Database.Database): void   // CREATE TABLE IF NOT EXISTS observer_thoughts
export function publishThought(db: Database.Database, t: { tick: number; agentId: string; text: string }): void
export function thoughtsSince(db: Database.Database, idExclusive: number): Array<{ id: number; tick: number; agentId: string; text: string }>
export function latestThought(db: Database.Database, agentId: string): { tick: number; text: string } | null
// @sj/agents
AgentRuntime opts: onThought?: (t: { tick: number; agentId: string; text: string }) => void
```

Table (in the world DB — observer-side, narrator-style; never read by fold):

```sql
CREATE TABLE IF NOT EXISTS observer_thoughts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tick INTEGER NOT NULL, agent_id TEXT NOT NULL, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observer_thoughts_id ON observer_thoughts(id);
```

- [ ] **Step 1: failing tests** — observer: publish 3 thoughts for 2 agents; `thoughtsSince(0)` returns 3 in id order; `thoughtsSince(2)` returns 1; `latestThought` per agent correct; `ensureObserverTables` idempotent (call twice). AgentRuntime: construct with a fake model turn `{ thought: 'I rest.', importance: 1 }` (existing `BENIGN_TURN` fixture pattern) and `onThought: t => seen.push(t)`; after one turn, `seen` contains `{ tick, agentId, text: 'I rest.' }`; omitting the hook changes nothing (existing tests untouched prove it).
- [ ] **Step 2: RED.**
- [ ] **Step 3: implement** — observer.ts is 4 prepared statements; agentRuntime.ts adds the optional opt and calls `this.#onThought?.({ tick, agentId: this.#agentId, text: turn.thought })` immediately after the thought memory insert. No other agents-package changes.
- [ ] **Step 4: GREEN** + full suite (agents suite must stay green — the hook is optional).
- [ ] **Step 5: Commit** — `feat(gateway): observer thought feed + AgentRuntime onThought hook`

---

### Task 4: SocketHub — serialize-once broadcast + bufferedAmount gating

**Files:**
- Create: `packages/gateway/src/hub.ts`, test `packages/gateway/src/hub.test.ts`

**Interfaces:**
- Produces (binding for Task 5):

```ts
export const MAX_BUFFERED = 1_048_576      // 1 MiB: beyond this a viewer is lagging
export const RESUME_BELOW = 65_536         // drained enough to resync
export type HubSocket = { send(data: string): void; readonly bufferedAmount: number; readonly readyState: number }
export const OPEN = 1
export class SocketHub {
  add(sock: HubSocket, onResync: () => string): () => void   // returns remove()
  broadcast(json: string): void
  size(): number
  laggingCount(): number
}
```

Gating law (exact): `broadcast` serializes NOTHING — callers pass one pre-built string (serialize-once lives at the call site, Task 5). Per socket: skip if `readyState !== OPEN`. If not lagging and `bufferedAmount > MAX_BUFFERED` → mark lagging, do not send (deltas are droppable because resync replaces them). If lagging and `bufferedAmount < RESUME_BELOW` → send `onResync()` (a fresh full snapshot string), clear lagging, then send the current json. Otherwise lagging → drop.

- [ ] **Step 1: failing tests** — fake sockets with a settable `bufferedAmount` and a `sent: string[]` log:
  - healthy socket receives every broadcast in order;
  - socket with buffered = 2 MiB receives nothing and `laggingCount() === 1`;
  - after buffered drops to 0, next broadcast delivers `onResync()` result FIRST then the delta, lagging cleared;
  - closed socket (`readyState 3`) is skipped and removed on next broadcast;
  - `remove()` unsubscribes.
- [ ] **Step 2: RED.** **Step 3: implement (~50 lines).** **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** — `feat(gateway): SocketHub with bufferedAmount lag gating`

---

### Task 5: Gateway server — ws protocol + poll pump

**Files:**
- Create: `packages/gateway/src/server.ts`, test `packages/gateway/src/server.test.ts`
- Modify: `packages/gateway/src/index.ts` (re-exports)

**Interfaces:**
- Consumes: `WorldMirror` (T2), `thoughtsSince` (T3), `SocketHub` (T4), `ClientMsg`/`ServerMsg` (T1), `AssetCodex.listSince` (forge).
- Produces (binding):

```ts
export type GatewayOpts = {
  dbPath: string; port?: number                 // default 8787
  config?: SimConfig; terrain: TileId[][]
  pollMs?: number                               // default 250
  db?: Database.Database                        // in-process override (dev world); else opened readonly
}
export type Gateway = { port: number; close(): Promise<void>; pump(): void }  // pump exposed for tests
export async function createGateway(opts: GatewayOpts): Promise<Gateway>
```

Behavior (exact):
- One `node:http` server + `ws.WebSocketServer({ server })` on `path: '/ws'`; HTTP routes arrive in Tasks 6–7 via a handler registry `route(method, pattern, fn)` created here.
- On ws connection: wait for `hello` (validate `ClientMsg`; wrong `v` or parse failure → close code 4400). Reply `snapshot {tick, seq, state, config, live: true}` (JSON.stringify once per pump generation — cache the latest snapshot string, invalidate on each pump).
- Pump loop (`setInterval(pollMs)`, also callable directly as `pump()` for tests): `mirror.poll()` → for each tick group, `const json = JSON.stringify(ServerTick-shaped object)` ONCE → `hub.broadcast(json)`. Then `thoughtsSince(lastThoughtId)` → one `thought` message each (serialize once, broadcast). Then assets: the `assets` table may not exist yet (forge tables are separate) — per pump, until first seen, check `SELECT 1 FROM sqlite_master WHERE name='assets'`; once present, construct `AssetCodex` and `listSince(lastAssetSeq)` → `asset` messages (record only — `AssetRecord` has no png field; bytes travel over HTTP).
- `scrub` message: `mirror.stateAt(tick)` → reply only to the requesting socket `{t:'scrubbed', reqId, tick, state}`; out-of-range → `{t:'scrubbed', reqId, tick: liveTick, state: current}` (clamp, never error the socket). `live` message: reply with a fresh `snapshot` (live: true).
- Read-only law: `opts.db` absent → `new Database(dbPath, { readonly: true, fileMustExist: true })`.

- [ ] **Step 1: failing integration test** (real ws, port 0 = ephemeral): build a temp world DB with a `TickLoop` (as in T2's fixture), create gateway with `pollMs: 3600_000` (manual pump), connect a real `ws` client:
  - after `hello {v: 1, lastSeenTick: null}` → first message parses as `ServerMsg` snapshot with `live: true` and `stateHash(state)` equal to the loop's;
  - `loop.step()` ×2 then `gateway.pump()` → exactly 2 `tick` messages, in tick order, `events` arrays non-empty, every message parses under `ServerMsg`;
  - two clients connected → both receive the same delta and `JSON.parse` of the raw frames is byte-identical (serialize-once observable: compare raw strings);
  - `publishThought` + pump → `thought` message arrives;
  - codex `register` (placeholder record, tiny png buffer; the test migrates forge tables first with `openForgeDb(dbPath).close()`) + pump → `asset` message arrives with `record.status === 'placeholder'`;
  - `scrub {tick: 1}` → `scrubbed` reply whose state hash equals `mirror.stateAt(1)`; clients other than the requester receive nothing;
  - malformed first frame → socket closes with code 4400.
- [ ] **Step 2: RED.** **Step 3: implement (~150 lines).** **Step 4: GREEN + suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(gateway): ws server — hello/snapshot/tick deltas/scrub/thought/asset push`

---

### Task 6: Asset HTTP — codex PNGs, placeholders, character sheets, emote atlas

**Files:**
- Create: `packages/gateway/src/assetsHttp.ts`, test `packages/gateway/src/assetsHttp.test.ts`
- Modify: `packages/gateway/src/server.ts` (mount routes)

**Interfaces:**
- Consumes: `AssetCodex.get(id)` (forge), `makePlaceholder(klass, {w,h})`, `encodePng(RawImage)` (forge `post/raw`), `renderEmote(kind)`, `EMOTE_KINDS`, `EMOTE_SIZE` (forge emotes — (controller ruling) imported from `@sj/forge` directly, no vendoring), Character standard v2 geometry consts.
- Produces (binding for web Tasks 11–13):

```ts
GET /assets/:id.png                → codex png, Content-Type image/png, Cache-Control immutable (codex rows never mutate; replacements get new ids)
GET /assets/placeholder/:class.png → encodePng(makePlaceholder(class, PLACEHOLDER_PX[class]))
     PLACEHOLDER_PX = { building: {w:64,h:64}, item: {w:24,h:24}, crop: {w:32,h:32},
                        terrain: {w:32,h:16}, 'rig-part': {w:96,h:96}, portrait: {w:128,h:128} }
GET /assets/character/:agentId.png → codex sheet if a ready asset with desc `character:<agentId>` exists, else buildPlaceholderSheet(agentId)
GET /assets/emotes.png + /assets/emotes.json  → 12 glyphs in one row (192×16); json = { size: 16, order: EMOTE_KINDS }
export function buildPlaceholderSheet(agentId: string): RawImage   // v2 geometry: 4 cols (sw,se,ne,nw) × 6 rows (idle,contact-a,passing-a,contact-b,passing-b,sleep), 96×96 cells → 384×576
```

`buildPlaceholderSheet` (exact, so walk animation is VISIBLE on placeholders): each cell = `makePlaceholder('rig-part', {w:96,h:96})` cropped to a 40×64 body rect anchored feet-at-y=88, with per-pose distinguishers baked deterministically — contact poses draw a 4px-wide dark foot bar at y=86 offset ±6px left/right (A left, B right); passing poses draw it centered; sleep pose lays the rect sideways (64×40, wider than tall — matches the v2 lying-silhouette sanity rule); each facing column gets a 6×6 corner marker in a distinct palette ramp (sw honey, se sage, ne water, nw rose). Deterministic per agentId: body fill alternates two warm-grey ramp entries by `agentId` char-code sum parity.

- [ ] **Step 1: failing tests** — via `fetch` against a test gateway: `/assets/placeholder/building.png` decodes (forge `decodePng`) to 64×64 with the checkerboard border color at (0,0); `/assets/character/farmer.png` decodes to 384×576; sleep-row cell opaque bbox is wider than tall; contact-a vs contact-b cells differ (byte compare of cell crops); unknown id → 404; codex-registered png round-trips byte-identical; `/assets/emotes.png` decodes to 192×16 and `/assets/emotes.json` lists 12 kinds in order.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** — `feat(gateway): asset http — codex pngs, placeholder sheets, emote atlas`

---

### Task 7: Data APIs — agent tabs, provenance, society proxy, C7 stubs, digest

**Files:**
- Create: `packages/gateway/src/api.ts`, `packages/gateway/src/heatStub.ts`, tests `packages/gateway/src/api.test.ts`, `packages/gateway/src/heatStub.test.ts`
- Modify: `packages/gateway/src/server.ts` (mount), `GatewayOpts` gains `agentDbDir?: string`

**Interfaces:**
- Consumes: agent memory DBs (`journal`, `ledgers`, `personality_versions` tables per `packages/agents/src/memory/schema.ts`), events table, `WorldMirror.state()`.
- Produces (binding JSON shapes — C7 swaps the readers, shapes stay):

```ts
GET /api/agent/:id/profile     → { id, name, alive, asleep, x, y, needs, hp, injuries, ill, ageDays, skills, activity } // straight from WorldState; 404 unknown id
GET /api/agent/:id/journal     → Array<{ tick, day, text }>            // [] when no agent DB (scripted world)
GET /api/agent/:id/ledgers     → Array<{ personId, doc, updatedDay }>  // [] fallback likewise
GET /api/agent/:id/personality → Array<{ version, day, doc, edit }>    // [] fallback likewise
GET /api/structure/:id/provenance → { id, kind, plannedTick, builderId, completedTick: number|null } // events scan
GET /api/society  → { nodes: [{ id, name, alive }], links: [{ source, target, kind: 'talk'|'give'|'teach'|'attack', weight }] }
GET /api/chapters → []                                                  // C7 fills
GET /api/heat     → Array<{ fromTick, toTick, agentId, score }>        // stub scorer until C7
GET /api/digest?fromTick=&toTick= → { days, deaths: [{agentId, tick, cause}], births: [], structuresCompleted: [{id, kind, tick}], topMoments: [{tick, agentId, score, moment: {day, time}}], agentLines: [{agentId, line}] }
```

Deterministic rules (exact):
- Provenance: scan `events` rows of type `structure_planned` / `structure_completed`, match `payload.id` in JS (fine at this scale; one prepared statement per type filtered by `type`).
- Society proxy: over all events — `agent_spoke` A heard-range of B is unknowable cheaply, so link on conversation adjacency: two `agent_spoke` events by different agents within 20 ticks and within earshot distance (positions in payloads) → `talk` weight +1; `action_completed {verb:'give'|'teach'|'attack'}` events → link that verb using `payload.agentId` and `params.targetId` captured from the matching `action_started`. Weights accumulate; links sorted by weight desc.
- `heatStub.ts` — pure, exported for the director lens contract test: window = 60 ticks; `score(events) = Σ weight[type]` with `weight = { agent_died: 20, fire_ignited: 12, fire_spread: 10, agent_injured: 8, structure_completed: 6, agent_collapsed: 6, crop_harvested: 3, agent_spoke: 2, item_moved: 1 }` (unlisted types 0); attribute each event to `payload.agentId ?? payload.builderId ?? null`, skip unattributed; emit per-agent windows with score > 0.
- Digest: deaths from `agent_died`, completions from `structure_completed`, topMoments = top 5 heat windows via the stub, `agentLines` = `"<name> was last seen <verb>-ing"` from current state activity (or "resting"). Human framing — no mechanics vocabulary beyond verbs.
- Agent DB path convention: `join(agentDbDir, `${agentId}.db`)`, opened readonly, missing file → `[]` responses (never 500).

- [ ] **Step 1: failing tests** — seed a temp world DB with a scripted event sequence (spawns, spoke pairs in/out of the 20-tick window, a give with started/completed pair, structure planned+completed, a death) and one real agent memory DB (via `openAgentDb`/`migrateAgentTables` from `@sj/agents`, inserting 2 journal rows + 2 personality versions). Assert every shape above with exact values: talk weight 1 only for the in-window pair; provenance ticks exact; heat stub window scores computed by hand in the test; digest topMoments ordering; missing agent DB → `[]`; unknown agent → 404.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** — `feat(gateway): observer data apis, society proxy, heat stub, digest`

---

### Task 8: Dev world server — the C2 scripted town, live

**Files:**
- Create: `packages/gateway/src/devWorld.ts` (also exported as `startDevWorld(opts)` for tests), test `packages/gateway/src/devWorld.test.ts`

**Interfaces:**
- Consumes: `makeFixtureMap`, `ACTORS`, `makeFarmerPolicy`/`makeFisherPolicy`/`makeIdlerPolicy`/`makeBuilderPolicy`, `STOREHOUSE`, `SHED` fixtures (`@sj/engine` scripted module — the G2 world verbatim), `createWorldTick`, `TickLoop`, `submitIntent`, `composePerception`, `RngStreams`, `openDb`; `createGateway` (in-process db handle), `publishThought`, `ensureObserverTables`.
- Produces:

```ts
export async function startDevWorld(opts?: { dbPath?: string; port?: number; realMsPerTick?: number; seed?: string }):
  Promise<{ gateway: Gateway; loop: TickLoop; stop(): Promise<void> }>
// CLI: pnpm --filter @sj/gateway dev:world   (defaults: data/dev-world.db recreated fresh, port 8787, 2500ms/tick, seed 'g6')
```

Assembly (exact — mirrors `g2.test.ts` setup): fresh DB (unlink first), `openDb(dbPath)` for world tables plus one `openForgeDb(dbPath).close()` call to migrate the forge `assets`/`jobs` tables (so the asset push loop and hot-swap demo have their table), fixture map, genesis + storehouse/shed structures + starter items + 4 actor spawns folded through an initial transaction of appended events (reuse the G2 seeding exactly so behavior is the known-good scripted 3 days), `createWorldTick(DEFAULT_CONFIG, rng)` inside a `TickLoop` `onTick` handler that first drains each actor's policy: `policy(composePerception(state, config, id, recentEvents)) → submitIntent → emit events` (same drain order as g2: ACTORS order). `snapshotEveryTicks: 60`.

Scripted thoughts (the G6 "live thought" source — human framing, no AI vocabulary):

```ts
const THOUGHT_LINES: Record<string, string> = {
  walk: 'The path is clear enough.',        till: 'This earth wants turning.',
  plant: 'Wheat in, before the season slips.', harvest: 'Ready at last.',
  fish: 'The river owes me a dinner.',      eat: 'That settles the stomach.',
  sleep: 'My eyes are heavy.',              give: 'They need it more than I do.',
  take: 'The storehouse can spare this.',   build: 'Beam by beam it rises.',
}
```

When an actor's chosen intent verb differs from its previous one, `publishThought(db, { tick, agentId, text: THOUGHT_LINES[verb] ?? 'Hm.' })`.

- [ ] **Step 1: failing test** — `startDevWorld({ realMsPerTick: 1, port: 0, dbPath: tmp })`; drive 40 ticks by awaiting; connect a ws client: snapshot arrives with 4 agents and 2 structures; at least 2 tick deltas arrive; at least one `thought` message arrives with text drawn from `THOUGHT_LINES`; `stop()` closes cleanly (test exits without open handles).
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite** (keep the test under 15s wall clock — 40 ticks at 1ms).
- [ ] **Step 5: Commit** — `feat(gateway): dev world server — scripted C2 town with observer thoughts`

---

### Task 9: @sj/web scaffold — Vite 8 + React 19 shell, socket client, world store

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.tsx`, `packages/web/src/App.tsx`, `packages/web/src/ui/chrome.css`, `packages/web/src/ui/route.ts`, `packages/web/src/net/socket.ts`, `packages/web/src/state/worldStore.ts`
- Tests: `packages/web/src/state/worldStore.test.ts`, `packages/web/src/ui/route.test.ts`
- Modify: root `package.json` typecheck script (append `packages/web`)

**Interfaces:**
- Consumes: `fold` (`@sj/engine/fold`), `WorldState` (`@sj/engine/state`), `ServerMsg`/`ClientMsg`/`PROTOCOL_VERSION`/`momentToTick`/`tickToMoment` (`@sj/shared`).
- Produces (binding for every later web task):

```ts
// state/worldStore.ts — framework-free store; Pixi reads it directly at 60fps, React chrome via useSyncExternalStore
export type ViewMode = { live: true } | { live: false; tick: number }
export type WorldStore = {
  getState(): WorldState | null
  getMode(): ViewMode
  getTick(): number
  latestThought(agentId: string): { tick: number; text: string } | null
  thoughtsLog(): Array<{ agentId: string; tick: number; text: string }>   // capped ring, 200 entries
  recentEvents(): SimEvent[]            // last 400 events, for chronicle/bubbles/tone
  assetsSeq(): number                   // bumps on every asset push — TextureResolver watches
  assetRecords(): AssetRecord[]
  applyServer(msg: ServerMsg): void     // the only mutator: snapshot replaces state AND adopts its config
                                        // (SimConfigSchema.parse(msg.config)); tick folds via engine fold WITH that
                                        // config; scrubbed enters {live:false}
  subscribe(fn: () => void): () => void
  onEvents(fn: (evts: SimEvent[]) => void): () => void   // per-delta hook (bubbles, bounce, tone)
}
export function createWorldStore(): WorldStore     // config arrives inside the snapshot message — never assumed

// net/socket.ts
export function connectObservatory(opts: { url: string; store: WorldStore;
  onGap?: (missedTicks: number) => void }): { scrub(tick: number): void; goLive(): void; close(): void }
// hello carries lastSeenTick from localStorage['sj:lastSeenTick']; on snapshot, if stored gap > 1440 ticks → onGap fires (digest trigger); store updates localStorage each delta. Reconnect with 1s→30s backoff.

// ui/route.ts
export type Route = { lens: 'map'|'inspector'|'chronicle'|'society'|'director'; moment: { day: number; time: string } | null; agentId: string | null }
export function parseRoute(pathname: string, search: string): Route   // '/moment/41/14:30' and '/moment/day41/14:30' both accepted; lens/agent via ?lens=&agent=
export function routeToPath(r: Route): string
```

`package.json`:

```json
{ "name": "@sj/web", "version": "0.0.1", "type": "module", "private": true,
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": { "@sj/shared": "workspace:*", "@sj/engine": "workspace:*",
    "react": "^19.0.0", "react-dom": "^19.0.0", "pixi.js": "^8.6.0", "react-force-graph-2d": "^1.25.0", "zod": "^4.4.0" },
  "devDependencies": { "vite": "^8.0.0", "@vitejs/plugin-react": "^5.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0" } }
```

`vite.config.ts` proxies `/ws` (ws: true), `/api`, `/assets` → `http://localhost:8787`. `tsconfig.json` extends base with `"module": "ESNext", "moduleResolution": "bundler", "jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": ["vite/client"]`.

Hybrid chrome (Style Bible "Observatory UI": modern layout/typography for data-dense views, pixel-art headers/iconography for warmth; only the world canvas is fully pixel): `chrome.css` defines tokens from the master palette — `--cream:#FFF6E9 --panel:#F6E8D5 --ink:#43394A --accent:#E8785A --sage:#93B573 --night:#322B38`; system-ui type for data panels; headers set in a pixel font rendered as CSS `image-rendering: pixelated` sprite text later (Task 16 portraits) — for now a `.px-title` class using letter-spaced small-caps stands in. Lens tab bar top, world canvas fills, right-hand slide-over panel slot.

`App.tsx`: mounts store + socket, renders lens tabs + `<div id="stage-root">` (Pixi target, Task 10) + panel outlet; route drives lens; `/moment/...` route triggers `scrub(momentToTick(day, time))` once the socket is open.

- [ ] **Step 1: failing tests** (pure — no DOM): worldStore: `applyServer(snapshot)` sets state and adopts the carried config (`SimConfigSchema` strict — a snapshot with an unknown config key throws); `applyServer(tick)` folds — feed a real `agent_moved` event and assert the store's `stateHash` equals a reference `fold(state, ev, sameConfig)` computed in the test; scrubbed sets `{live:false, tick}` and a following live snapshot returns to live; thought messages populate `latestThought` and the capped log; asset push bumps `assetsSeq`; `onEvents` fires with the delta's events. route: `parseRoute('/moment/41/14:30','?lens=inspector&agent=farmer')` exact; `routeToPath` round-trips; bad time → `moment: null`.
- [ ] **Step 2: RED.** **Step 3: implement** (worldStore ~120 lines; socket ~80; route ~40; shell components minimal but real — the app must boot against the Task 8 dev world). **Step 4: GREEN + typecheck; manual boot check:** `dev:world` + `pnpm --filter @sj/web dev` → browser shows lens tabs and a live tick counter (temporary `<TickBadge>` reading the store — kept, it becomes the status bar).
- [ ] **Step 5: Commit** — `feat(web): vite8/react19 shell, ws client, fold-backed world store, deep-link routes`

---

### Task 10: Dimetric math, depth sort, facing, day/night LUT, weather grading (pure)

**Files:**
- Create: `packages/web/src/render/iso.ts`, `packages/web/src/render/tints.ts`
- Tests: `packages/web/src/render/iso.test.ts`, `packages/web/src/render/tints.test.ts`

**Interfaces:**
- Produces (binding for Tasks 11–15):

```ts
// iso.ts — 32×16 base tile (Style Bible grid)
export const TILE_W = 32, TILE_H = 16
export function tileToScreen(x: number, y: number): { sx: number; sy: number }   // sx=(x−y)·16, sy=(x+y)·8  (spec §15 formula, w=32 h=16)
export function screenToTile(sx: number, sy: number): { x: number; y: number }   // inverse, rounded
export function depthKey(x: number, y: number): number                            // (x+y)*1000 + x  — stable within a diagonal
export type Facing = 'sw' | 'se' | 'ne' | 'nw'
export function facingFrom(dx: number, dy: number): Facing   // +x→'se', −x→'nw', +y→'sw', −y→'ne'; |dx|≥|dy| wins ties
// tints.ts — LUT reuses forge's calibrated atmosphere TINTS (palette was locked under these)
export const CLOCK_STOPS: Array<{ minute: number; tint: [number, number, number] }> = [
  { minute: 0,    tint: [0.45, 0.52, 0.95] },   // deep night   (forge TINTS.night)
  { minute: 300,  tint: [0.45, 0.52, 0.95] },   // 05:00 still night
  { minute: 390,  tint: [1.00, 0.94, 0.78] },   // 06:30 golden dawn (TINTS.dawn clamped ≤1)
  { minute: 480,  tint: [1.00, 1.00, 1.00] },   // 08:00 full day
  { minute: 1050, tint: [1.00, 1.00, 1.00] },   // 17:30 day holds
  { minute: 1140, tint: [1.00, 0.94, 0.78] },   // 19:00 golden dusk
  { minute: 1230, tint: [0.45, 0.52, 0.95] },   // 20:30 night
  { minute: 1440, tint: [0.45, 0.52, 0.95] },
]
export function clockTint(minuteOfDay: number): number            // lerp between stops → 0xRRGGBB for the multiply quad
export function gradingMatrix(weatherKind: string, season: Season): Float32Array | null
//   storm/rain → diag(0.72, 0.82, 0.76) grey-green (TINTS.storm); winter+(snow|clear) → diag(0.86, 0.93, 1.00) snow-blue
//   (TINTS.winter blue 1.10 exceeds ColorMatrix-safe 1.0 headroom on lit pixels — clamped; ratio preserved via r/g)
//   null = identity (no filter attached)
```

- [ ] **Step 1: failing tests** — exact values: `tileToScreen(3,1)` = `{sx:32, sy:32}`; `screenToTile` inverts a lattice sweep of 0≤x,y<8; `depthKey` strictly increases along +x+y and orders (2,3) before (3,2) deterministically; `facingFrom(1,0)==='se'`, `(0,1)==='sw'`, `(-1,0)==='nw'`, `(0,-1)==='ne'`, tie `(1,1)` → `'se'`; `clockTint(240)` = packed 0x7385F2 (0.45,0.52,0.95), `clockTint(435)` is the exact midpoint lerp between dawn and day stops (assert channel math, not a magic hex); `gradingMatrix('storm','spring')` diag values exact; `gradingMatrix('sunny','summer')` null.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite.**
- [ ] **Step 5: Commit** — `feat(web): dimetric math, depth keys, facing, clock/weather tint tables`

---

### Task 11: Pixi stage in a ref — pixel-perfect app, camera, ground RenderTexture bake

**Files:**
- Create: `packages/web/src/render/scene.ts` (Pixi assembly), `packages/web/src/render/ground.ts`, `packages/web/src/render/StageMount.tsx` (the React ref wrapper — the ONLY React/Pixi contact point)
- Test: `packages/web/src/render/ground.test.ts` (pure parts)

**Interfaces:**
- Consumes: `TILE_W/H`, `tileToScreen` (T10), `WorldStore` (T9), `TileId` (`@sj/engine/state`).
- Produces (binding):

```ts
export const TILE_COLORS: Record<TileId, number> = {
  0: 0x93B573 /*grass*/, 1: 0xC68A48 /*dirt*/, 2: 0x7FB0C9 /*water*/, 3: 0x4F7040 /*forest*/,
  4: 0xABA198 /*rock*/, 5: 0xE8D5BC /*sand*/, 6: 0xA66E38 /*farmland*/,
}   // master-palette hexes — the placeholder terrain IS palette-true
export function groundPlan(terrain: TileId[][]): Array<{ sx: number; sy: number; color: number; shade: boolean }>
//  pure: one diamond per tile, shade=true when (x+y)%2 (drawn one ramp step darker for subtle texture)
export type Scene = {
  app: Application; world: Container; entities: Container
  rebakeGround(terrain: TileId[][]): void
  centerOn(x: number, y: number): void; setZoom(z: 1|2|3|4): void
  onTilePointer(cb: (t: { x: number; y: number }) => void): void
  destroy(): void
}
export async function createScene(rootEl: HTMLElement, store: WorldStore): Promise<Scene>
```

Implementation rules (exact):
- `new Application(); await app.init({ antialias: false, roundPixels: true, background: 0x322B38, resizeTo: rootEl })`; `TextureSource.defaultOptions.scaleMode = 'nearest'` before any texture is created (global NEAREST law).
- Ground bake: draw `groundPlan` diamonds into ONE `Graphics`, `renderer.render({ container: g, target: renderTexture })` sized `(W+H)·16 × (W+H)·8`, shown as a single Sprite — one draw call, per spec. `rebakeGround` re-renders into the same RenderTexture on any `terrain_changed` event (store `onEvents` hook; full re-bake is fine — 128×128 is a one-off Graphics pass).
- `world` container holds ground sprite + `entities` (with `sortableChildren = true`; children set `zIndex = depthKey(x,y)`); camera = `world.position/scale`; zoom clamps to integers 1–4 (wheel), drag to pan; `centerOn` uses `tileToScreen`.
- `StageMount.tsx`: `useRef<HTMLDivElement>`, `useEffect` creates the scene once, cleanup calls `destroy()`. React renders NOTHING inside the canvas — chrome only (spec §15 law).

- [ ] **Step 1: failing test (pure part)** — `groundPlan` on a 2×2 map returns 4 entries with exact `sx/sy` from `tileToScreen` and alternating `shade`; water tile color exact.
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: manual check against the dev world** (Task 8 running): map renders colored diamond terrain of the 64×64 fixture (river strip west, forest east), pans, zooms 1–4 with hard pixels.
- [ ] **Step 4: full suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(web): pixi stage in a ref, pixel-perfect settings, ground rendertexture bake`

---

### Task 12: Entity layers + TextureResolver + sprite hot-load with explicit unload

**Files:**
- Create: `packages/web/src/render/textures.ts`, `packages/web/src/render/entities.ts`
- Create: `packages/gateway/src/hotswapDemo.ts` (the G6 swap driver)
- Modify: forge codex schema — (controller ruling) ADD a nullable `kind` column to the `assets` table (small `ALTER TABLE ... ADD COLUMN` migration guarded by a pragma check, + test); backfill existing rows by the desc-prefix convention (`kind = desc up to the first ':'` when present); `register` accepts an optional `kind`. The renderer resolves by `kind`, never by desc parsing.
- Tests: `packages/web/src/render/textures.test.ts` (pure resolution logic), `packages/gateway/src/hotswapDemo.test.ts`, forge codex migration test

**Interfaces:**
- Consumes: `WorldStore.assetRecords()/assetsSeq()`, Scene (T11), `depthKey`, `AssetRecord`.
- Produces (binding):

```ts
// textures.ts
export function resolveAssetId(records: AssetRecord[], klass: AssetClass, kind: string): string | null
//  (controller ruling) resolves by the codex's `kind` column: newest ready record with
//  record.kind === kind; else null → placeholder URL. The desc-prefix convention
//  (`${kind}: ...`) is ONLY the backfill rule for pre-existing rows, applied in the migration.
export function textureUrlFor(records: AssetRecord[], klass: AssetClass, kind: string): string
//  `/assets/<id>.png` or `/assets/placeholder/<class>.png`
export class TextureBook {
  get(url: string): Promise<Texture>            // Assets.add({alias:url,src:url}) + load, cached
  swap(oldUrl: string, newUrl: string): Promise<Texture>
  //  loads new FIRST, then for the old: texture.source.unload() + Assets.unload(alias)  (texture GC gotcha — spec §15)
}
// entities.ts — diff-based sync, called once per store change
export function syncEntities(scene: Scene, book: TextureBook, store: WorldStore): void
//  structures: sprite per structure, anchor (0.5, 1.0) at tileToScreen(x + w/2 − 0.5, y + h/2 − 0.5) ground point,
//    zIndex depthKey(x+w−1, y+h−1); stage 'construction' → placeholder tinted 0xCFC6BC + progress pip row;
//    burning → fire glow handled in Task 15
//  items on tiles: 24px sprites, anchor (0.5, 1.0); crops: stage pips 1..4 as growing sprite scale 0.4+0.15·stage,
//    withered → tint 0x857D75
//  every sprite records its current texture url; when store.assetsSeq() advances, re-resolve and
//  book.swap changed urls in place (THE hot-load path — no scene rebuild)
//  structure pointertap → provenance popover (spec §8 "click a building → who built it, when, why"):
//  fetch /api/structure/:id/provenance → "Begun by <name> on Day N HH:MM — finished Day M / still rising";
//  the "why" line shows the builder's journal entry nearest plannedTick via /api/agent/:builderId/journal,
//  or is omitted when the journal is empty (scripted world)
```

Anchor convention (Character standard v2 / manifest law): all world sprites anchor at origin **(0.5, 1.0)** — bottom-center pinned to the tile's ground point. Character cells refine this in Task 13 (feet line y=88 of 96 → anchorY 88/96).

`hotswapDemo.ts`: connects to the dev world DB (NOT readonly — it plays the forge), draws a deterministic 64×64 "hut" RawImage in code (honey-wood gable on cream, from `paletteRgb()` — ~30 lines of rect fills, no generation), `encodePng`, `codex.register({ class:'building', desc:'hut: timber dwelling', status:'ready', score: 9, attempts: 1, costUsd: 0, footprint {w:2,h:2}, ... })` → gateway pump pushes the asset → viewers swap. Test (gateway-side, no web import): register runs, record parses, png round-trips, and `record.desc.startsWith('hut:')` — the exact convention `resolveAssetId` matches on.

- [ ] **Step 1: failing tests** — `resolveAssetId`: picks newest ready 'hut: …' over older; ignores `status:'placeholder'` records; whole-word match ('shut door' desc does NOT match kind 'hut'); null → placeholder URL exact string. hotswapDemo test as above.
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: manual check:** dev world + web: storehouse/shed/hut-under-construction render as placeholder checkerboards at correct depths (walk behind/in front reads correctly); run `demo:hotswap` → hut visibly swaps within a second, no reload, no WebGL texture-count growth after 10 repeated swaps (devtools check — proves the explicit unload).
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): entity layers, texture resolver, hot sprite swap with explicit unload`

---

### Task 13: Character layer — v2 walk anim, bob, shadow, sleep, interpolation, emotes, click

**Files:**
- Create: `packages/web/src/render/charAnim.ts` (pure state machine), `packages/web/src/render/characters.ts` (Pixi adapter)
- Test: `packages/web/src/render/charAnim.test.ts`

**Interfaces:**
- Consumes: character sheet URL `/assets/character/:agentId.png` (T6, v2 384×576 layout), emote atlas (T6), `facingFrom` (T10), `WorldStore`, Scene.
- Produces (binding):

```ts
export const SHEET_COLS: Facing[] = ['sw', 'se', 'ne', 'nw']
export const SHEET_ROWS = ['idle', 'contact-a', 'passing-a', 'contact-b', 'passing-b', 'sleep'] as const
export const CELL = 96, FEET_Y = 88, WALK_FPS = 8
export const WALK_LOOP = ['contact-a', 'passing-a', 'contact-b', 'passing-b'] as const   // Character standard v2, 8fps
export const BOB_PX = 1                       // passing frames render 1px lower — render-time only, never baked
export const CHAR_TARGET_PX = 52              // ≈1.6 tiles of 32px; art height 64 in cell → scale 52/64
export type CharPose = { row: typeof SHEET_ROWS[number]; facing: Facing; bobY: number }
export function charPose(a: { asleep: boolean; collapsed: boolean; walking: boolean;
  facing: Facing; nowMs: number }): CharPose
//  asleep|collapsed → 'sleep' row, bob 0; walking → WALK_LOOP[floor(nowMs / (1000/WALK_FPS)) % 4],
//  bob = BOB_PX on passing-a/passing-b else 0; otherwise 'idle'
export function interpolatePos(prev: {x,y,atMs}, next: {x,y,atMs}, nowMs: number): { x: number; y: number }
//  linear, clamped to [0,1] over (next.atMs − prev.atMs) — agents glide between agent_moved deltas
export const EMOTE_KINDS = ['exclaim', 'question', 'heart', 'star', 'sleep', 'hunger',
  'cold', 'rain', 'hurt', 'talk', 'idea', 'anger'] as const   // mirrors /assets/emotes.json order — the atlas is the runtime truth
export type EmoteKind = typeof EMOTE_KINDS[number]
export function emoteFor(a: AgentBody, recent: SimEvent[]): EmoteKind | null
//  priority order (first hit wins): you-died→null (renderer removes sprite handling is Task 15 tone),
//  injured this window→'hurt', collapsed→'exclaim', asleep→'sleep', hunger<30→'hunger',
//  warmth<30→'cold', spoke this window→'talk', rain|storm started→'rain'; else null
```

Pixi adapter rules: one Sprite per agent from the sheet texture with a per-pose `Texture` slice (`new Texture({ source, frame: new Rectangle(col*96, row*96, 96, 96) })` — 24 slices per sheet, cached); anchor `(0.5, FEET_Y / CELL)`; scale `CHAR_TARGET_PX / 64`; position from `interpolatePos` + `bobY`; zIndex `depthKey(round(x), round(y)) + 1`. Blob shadow: shared 20×8 black ellipse texture (Graphics-generated once), alpha 0.25, anchored under the feet, skipped while asleep-in-bed? No — always drawn (v2 note is unconditional). Emote: 16×16 sprite from the atlas 12px above the head, shown 2000ms per trigger. `eventMode: 'static'` + pointertap → route `?lens=inspector&agent=<id>` (click-to-inspect — the G6 check). Facing derives from the last nonzero move delta; default `'sw'`.

- [ ] **Step 1: failing tests** — `charPose`: asleep beats walking; walking at nowMs 0/125/250/375 yields the 4-frame loop in v2 order and bobY 1 exactly on the two passing frames; idle at rest. `interpolatePos` midpoint exact; clamp beyond next.atMs. `emoteFor` priority: injured beats hunger; talk fires on own agent_spoke in window; null when calm.
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: manual check:** dev world: 4 actors glide (no teleporting), placeholder sheets animate visibly at 8fps with the passing-frame dip, facing flips with direction, shadows sit under feet, the farmer shows 'hunger' when starving, click opens the inspector route.
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): character layer — v2 walk loop, bob, blob shadow, sleep pose, emotes, click-select`

---

### Task 14: Bubbles, day/night multiply quad, ColorMatrix grading, weather particles

**Files:**
- Create: `packages/web/src/render/bubbles.ts`, `packages/web/src/render/atmosphere.ts`, `packages/web/src/render/weatherFx.ts`
- Test: `packages/web/src/render/bubbles.test.ts` (pure lifetime/wrap logic)

**Interfaces:**
- Consumes: `clockTint`/`gradingMatrix` (T10), `WorldStore.onEvents`, `latestThought`, Scene.
- Produces (binding for Task 15's tone gate):

```ts
// bubbles.ts
export const SPEECH_MS_BASE = 2500, SPEECH_MS_PER_CHAR = 40, SPEECH_MAX_CHARS = 140
export const THOUGHT_ALPHA = 0.55            // wisps are dimmer — the dramatic-irony channel
export function bubbleLife(text: string): number   // base + perChar·min(len, max)
export function wrapBubble(text: string, maxChars = 24): string[]
export type BubbleLayer = { spawnSpeech(agentId, text): void; spawnThought(agentId, text): void; setSuppressed(v: boolean): void; tick(nowMs): void }
// atmosphere.ts
export type Atmosphere = { update(state: WorldState): void }   // quad tint = clockTint(minuteOfDay); world.filters = gradingMatrix(...) or null
// weatherFx.ts
export const PARTICLES = { rain: { n: 220, vy: 380, vx: -60, len: 6, color: 0x7FB0C9, alpha: 0.7 },
                           snow: { n: 140, vy: 40,  vx: -12, len: 2, color: 0xFFF6E9, alpha: 0.9 },
                           storm: { n: 320, vy: 480, vx: -110, len: 8, color: 0x5A8CAB, alpha: 0.8 } }
export type WeatherLayer = { setKind(kind: string): void; setSuppressed(v: boolean): void; tick(dtMs): void }
//  storm adds a 90ms full-screen 0xF4E289 flash at random 6–14s intervals (viewer-side Math.random is FINE:
//  presentation only, never simulation — determinism law untouched)
```

Rules: speech bubbles spawn from `agent_spoke` events (`onEvents`); pixel-art 9-slice look via Graphics rounded-rect (cream fill 0xFFF6E9, ink border 0x43394A, tail triangle) + `BitmapText`; thought wisps spawn from `thought` feed pushes for VISIBLE agents only, alpha `THOUGHT_ALPHA`, no border, drifting +2px up over life. Quad = screen-sized white Sprite, `blendMode: 'multiply'`, `tint = clockTint(state.tick % 1440)` — the deep-blue night IS the multiply quad; `ColorMatrixFilter` on the world container only when `gradingMatrix` returns non-null. Night window glow arrives in Task 15 (ambient package). `setSuppressed(true)` clears live particles and blocks spawns (consumed by Task 15's tone director; bubbles: speech stays — speech is world fact — thought wisps and the storm flash stop).

- [ ] **Step 1: failing tests** — `bubbleLife('hi')` exact; long text clamps at `SPEECH_MAX_CHARS`; `wrapBubble` breaks on word boundaries at 24 chars and never emits an empty line.
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: manual check:** dev world at ~19:00 sim shows golden dusk sliding into deep-blue night with readable warm chrome; scripted `speak` (fisher/farmer exchange) pops bubbles; wait for scripted rain → rain streaks fall, storm grades grey-green.
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): speech/thought bubbles, day-night multiply quad, weather grading and particles`

---

### Task 15: Ambient motion package + tone-aware suppression

**Files:**
- Create: `packages/web/src/render/tone.ts` (pure), `packages/web/src/render/ambient.ts` (Pixi animators)
- Test: `packages/web/src/render/tone.test.ts`

**Interfaces:**
- Consumes: `WorldStore.onEvents`, Scene, WeatherLayer/BubbleLayer `setSuppressed` (T14).
- Produces (binding):

```ts
// tone.ts — THE Style Bible rule, mechanized
export const GRAVE_EVENTS = ['agent_died'] as const
export const GRAVE_AFTERMATH = ['agent_injured'] as const   // violence aftermath
export const GRAVE_HOLD_TICKS = 60          // one sim-hour of stillness after a death — (controller ruling) confirmed
export const AFTERMATH_HOLD_TICKS = 15      // a beat after violence — (controller ruling) confirmed
export function toneReducer(prev: { graveUntil: number }, evts: SimEvent[], tick: number): { graveUntil: number }
//  agent_died → graveUntil = max(prev, tick + GRAVE_HOLD_TICKS); agent_injured → tick + AFTERMATH_HOLD_TICKS
export function isGrave(t: { graveUntil: number }, tick: number): boolean
// ambient.ts — one Ticker-driven director owning every cartoon effect
export type AmbientDirector = { tick(dtMs): void; setTone(grave: boolean): void }
export function createAmbient(scene: Scene, store: WorldStore, layers: { weather: WeatherLayer; bubbles: BubbleLayer }): AmbientDirector
```

Animators (each a small closure registered with the director; ALL freeze under grave tone — "the renderer goes still", including weather particles per the Style Bible's ambient-motion list; the day/night quad and ColorMatrix stay, light is not cartoon):
- chimney smoke: 3-puff looping sprites (8px cream circles, alpha fade, +14px rise over 2.4s) above each COMPLETE structure;
- water shimmer: up to 60 sampled water tiles get a 2px highlight sprite oscillating alpha 0.15↔0.45 at ~0.5Hz with per-tile phase = `(x·7+y·13)%628/100` (deterministic phase, no RNG);
- swaying trees: forest tiles (sampled ≤80) draw a 12×20 canopy sprite with `skew.x = 0.06·sin(t+phase)`;
- night window glow: when `isNight`, complete structures get a 6×6 additive gold 0xF4E289 sprite at their door face, alpha breathing 0.5↔0.8 (this is the "deep blue night with warm window glow" pairing);
- placement bounce: on `structure_completed`/`item_spawned` events, target sprite scale-pops 1.0→1.18→1.0 over 260ms;
- squash-and-stretch: on `action_started {verb: build|till|harvest|fish}`, actor sprite `scale.y` dips 0.92 with 0.3Hz work rhythm while the activity persists;
- birds: every 20–45s (viewer-side random — presentation only) a 3-sprite V glides across the sky band;
- fire glow: burning structures get an additive 0xF7A66B glow sprite flickering alpha 0.4↔0.8 at ~7Hz (the living-map "fire glow" spec row); under grave tone the flicker freezes at alpha 0.6 — the fire is world fact and stays visible, only its animation stills.
- Tone wiring: store `onEvents` → `toneReducer`; on transition to grave: `setTone(true)` freezes every animator mid-frame (no removal — stillness, not blankness), `weather.setSuppressed(true)`, `bubbles.setSuppressed(true)`, emote overlays hidden; on expiry everything resumes.

- [ ] **Step 1: failing tests** — `toneReducer`: a death at tick 100 → graveUntil 160; overlapping death extends to the max, never shortens; injury alone → 115; `isGrave` boundary exact (159 grave, 160 not); no grave events → unchanged.
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: manual check:** dev world: smoke/shimmer/sway/glow visible and cheap (fps overlay steady); when the scripted Idler dies (day ~2–3), the whole canvas goes still for one sim-hour, then life resumes.
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): ambient motion package with tone-aware suppression`

---

### Task 16: Agent inspector lens

**Files:**
- Create: `packages/web/src/ui/InspectorPanel.tsx`, `packages/web/src/ui/diffLines.ts`, test `packages/web/src/ui/diffLines.test.ts`

**Interfaces:**
- Consumes: `/api/agent/:id/*` (T7), `WorldStore.latestThought`, portrait URL convention `/assets/:id.png` via `resolveAssetId(records,'portrait', agentId)` else a pixel-silhouette placeholder (24×24 ink rounded shape, CSS), Scene `centerOn` (follow-cam).
- Produces:

```ts
export function diffLines(a: string, b: string): Array<{ kind: 'same'|'add'|'del'; text: string }>  // line-wise LCS, pure
```

Panel spec (exact): slide-over right panel, chrome-styled (Task 9 tokens). Header: portrait slot + name + age band + alive/asleep badges. Live blocks re-render per store tick: **Thought** (latest observer thought, wisp-styled quote — updates within one delta, i.e. within a tick: the G6 check), **Body** (four need bars 0–100 tinted sage→rose below 30, hp, injuries list, ill flag), **Doing** (activity verb + ticksRemaining, or "resting"), **Carrying** (inventory kinds × qty), **Skills** (tracks with xp → level via `floor(sqrt(xp/100))`). Tabs (fetch-on-open, cached 30s): Ledger (per-person docs), Journal (tick-stamped entries), Personality (version list; selecting two versions renders `diffLines` with add/del coloring — "diff history" per spec §8). Follow-cam toggle: while on, every store change calls `centerOn(agent.x, agent.y)`. Empty tabs render "Nothing written yet." (scripted world) — never an error.

- [ ] **Step 1: failing test** — `diffLines`: exact output on a 3-line doc with one changed line (same/del/add/same sequence); identical docs → all same; empty→doc all add.
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: manual check:** click farmer on canvas → panel opens via route, thought line matches the latest `THOUGHT_LINES` entry and changes when the actor switches verbs; bars move as hunger decays; tabs show the empty-state copy.
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): agent inspector lens with live thought, body, tabs, personality diffs, follow-cam`

---

### Task 17: Chronicle lens — event feed, timeline scrub, deep links

**Files:**
- Create: `packages/web/src/ui/ChroniclePanel.tsx`, `packages/web/src/ui/Timeline.tsx`, `packages/web/src/ui/chronicleFormat.ts`, test `packages/web/src/ui/chronicleFormat.test.ts`

**Interfaces:**
- Consumes: `WorldStore.recentEvents/getMode`, socket `scrub()/goLive()` (T9), `momentToTick/tickToMoment`, `/api/chapters` (T7, empty until C7).
- Produces: the `/moment/:day/:time` behavior contract — loading that route scrubs on connect; scrubbing updates the address bar via `history.replaceState(routeToPath(...))` so every viewed moment is shareable.

`chronicleFormat.ts` (pure, tested): `describeEvent(ev: SimEvent, state: WorldState | null): string | null` — human-framed one-liners for the viewer-worthy subset, null hides plumbing:

```ts
agent_spoke → '<Name>: "<text>"'            agent_died → '<Name> has died (<cause>).'
structure_completed → 'The <kind> is finished.'    structure_planned → '<Builder> began a <kind>.'
crop_planted → '<kind> was planted.'        crop_harvested → 'The <kind> came in.'
fire_ignited → 'Fire! The <kind> is burning.'      weather_changed → 'The weather turned <kind>.'
agent_collapsed → '<Name> collapsed.'       agent_tended → '<Name> was tended.'
give (action_completed verb) → '<Name> gave something away.'
tick_advanced, need_changed, action_progressed, agent_moved, ... → null
```

Timeline: horizontal bar spanning day 0 → live tick; day gridlines labeled "Day N"; markers: deaths (ink dot), completions (honey dot), chapter markers from `/api/chapters` (accent diamonds — appear when C7 lands, shell renders [] silently); drag/click → `scrub(tick)`; a LIVE pill returns via `goLive()`. While scrubbed (`mode.live === false`): canvas renders `scrubbed` state (worldStore already handles it), chrome shows "Viewing Day N HH:MM — the town has moved on" banner, delta ticks continue updating only the live-tick edge of the bar (deltas are ignored by the frozen view — store rule from Task 9).

- [ ] **Step 1: failing tests** — `describeEvent` exact strings for spoke/died/completed with a fixture state (names resolve); returns null for `tick_advanced` and `agent_moved`; unknown future event types → null (forward-compatible).
- [ ] **Step 2: RED → implement → GREEN.**
- [ ] **Step 3: manual check:** dev world running ≥ 2 sim-hours: feed scrolls speech and weather lines; drag to Day 0 08:00 → canvas snaps to that morning (structures/agents where they were); address bar shows `/moment/0/08:00`; hard-reload that URL reproduces the view; LIVE returns to now.
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): chronicle lens — readable feed, timeline scrub, shareable moments`

---

### Task 18: Society lens

**Files:**
- Create: `packages/web/src/ui/SocietyLens.tsx`, `packages/web/src/ui/societyModel.ts`, test `packages/web/src/ui/societyModel.test.ts`

**Interfaces:**
- Consumes: `/api/society` (T7), `react-force-graph-2d`.
- Produces: `toGraphData(api: SocietyResponse): { nodes, links }` (pure) — node size 6+2·degree, node color sage (alive) / warm-grey (dead); link color by kind `{talk: 0x7FB0C9, give: 0x93B573, teach: 0xF2C879, attack: 0xE8785A}`, width `1+log2(weight)`; institution halos: when `/api/society` grows an `institutions` array (C7), nodes listed in one render a 0xF4E289 ring — the shell draws rings for an empty array today (i.e., never), so C7 needs zero web changes.

Panel: full-pane graph replacing the canvas when lens=society (Pixi ticker paused while hidden — `app.ticker.stop()/start()` on lens switch, keeps 60fps budget honest); refetch every 30s; node click → inspector route.

- [ ] **Step 1: failing test** — `toGraphData` on a fixture response: exact node sizes/colors, link widths (weight 4 → 3), attack link color; dead agent grey.
- [ ] **Step 2: RED → implement → GREEN.** **Step 3: manual check:** dev world after the fisher's rescue `give` → give-edge fisher↔idler appears; talk edges among actors near the storehouse.
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): society lens on force graph with interaction-proxy edges`

---

### Task 19: Director mode + catch-up digest shell

**Files:**
- Create: `packages/web/src/ui/DirectorMode.tsx`, `packages/web/src/ui/directorCut.ts`, `packages/web/src/ui/DigestModal.tsx`, tests `packages/web/src/ui/directorCut.test.ts`

**Interfaces:**
- Consumes: `/api/heat` (T7 stub — same shape C7 will serve), `/api/digest` (T7), Scene `centerOn/setZoom`, `WorldStore`, `onGap` (T9 socket).
- Produces:

```ts
export const CUT_MIN_MS = 8000               // never cut faster — letterboxed TV pacing
export function pickCut(heat: HeatWindow[], currentAgent: string | null, nowTick: number): string | null
//  hottest window overlapping [nowTick−120, nowTick]; sticky: keep current unless a rival beats it by ≥25%;
//  null when no scored window (camera holds)
```

Director mode (lens=director): letterbox bars (12% top/bottom, ink 0x171420), chrome hidden except a subtitle strip showing the followed agent's latest speech (from events) else latest thought (wisp-styled); camera eases (`lerp 0.08/frame`) to `pickCut`'s agent at zoom 3; poll `/api/heat` every 5s. This is the embeddable "TV channel" shell — C7's real heat replaces the stub server-side, zero web changes.

Digest shell: `onGap(missedTicks)` (gap > 1440) opens the modal: "While you were away — N days passed", sections from `/api/digest`: chapter summaries slot (renders chapter titles when C7 fills `/api/chapters`, else the day list), top-5 moments deep-linked via `routeToPath({moment: tickToMoment(tick), ...})` (click → scrub), deaths/completions, one line per agent. Footer: "The town newspaper arrives with the narrator." Dismiss stores `lastSeenTick`.

- [ ] **Step 1: failing tests** — `pickCut`: hottest wins; sticky rule exact at the 25% boundary (24% better → keep, 26% → cut); stale windows (older than 120 ticks) ignored; empty → null.
- [ ] **Step 2: RED → implement → GREEN.** **Step 3: manual check:** director lens letterboxes and glides between actors as the stub heat shifts (e.g., toward the builder on completion); relaunch the web app after 1+ sim-day of dev-world uptime with an old `lastSeenTick` seeded in localStorage → digest modal lists the gap; a top moment click scrubs there.
- [ ] **Step 4: suite + typecheck.** **Step 5: Commit** — `feat(web): director mode on stub heat + catch-up digest shell`

---

### Task 20: GATE G6 — two browsers, 60fps, scrub, live thought, hot swap

(controller ruling) Evidence protocol confirmed as written: the automated parity/scrub/latency/swap suite plus human two-browser screenshots. No Playwright dependency is added.

**Files:**
- Create: `packages/web/src/ui/FpsOverlay.tsx` (rAF counter: current + 60s rolling avg, toggle with `f` key — ships, it is the town's own health meter)
- Create: `packages/gateway/src/g6.test.ts` (the automated half)
- Modify: none elsewhere — this task PROVES, it does not build.

**Automated half** (`g6.test.ts`, CI-green required):
1. `startDevWorld({ realMsPerTick: 1, port: 0 })`, run ~4400 ticks (3 sim days, ≈ the G2 corpus) — assert: two ws clients receive byte-identical delta frames throughout (serialize-once, observed end-to-end; the bufferedAmount gating itself is already unit-proven in Task 4 with fake sockets);
2. scrub parity sweep: for 12 random ticks (seeded PRNG in-test), `stateHash(mirror.stateAt(t))` equals `stateHash` of a from-genesis reference fold — snapshot+replay law;
3. thought latency: `publishThought` at tick T → healthy client holds the message before tick T+1's delta (pump order guarantees it);
4. hot swap: register the demo hut → both clients receive the `asset` push and `/assets/<id>.png` serves the exact bytes;
5. FULL repo suite green: goldens (G1, G2) untouched — `pnpm test` output attached to the report.

**Human-evidenced half** (protocol, evidence pasted into the gate report — screenshots + numbers):
1. `pnpm --filter @sj/gateway dev:world` (real 2.5s ticks) + `pnpm --filter @sj/web dev`; open TWO different browsers (e.g. Chrome + Firefox) at `localhost:5173`.
2. **60fps:** FpsOverlay 60s rolling average ≥ 58 in BOTH browsers on the map lens with ambient motion running and weather active. Screenshot both overlays.
3. **Scrub:** after ≥ 2 sim-hours uptime, drag to Day 0 08:00 — terrain, structures, and agent positions match that morning; deep-link `/moment/0/08:00` cold-reload reproduces it. Screenshot.
4. **Live thought within a tick:** click an actor the moment its verb changes (watch the canvas); the inspector thought line shows the new `THOUGHT_LINES` entry before the next tick badge increments (≤ 2.5s). Screen recording or paired screenshots.
5. **Sprite hot-load:** `pnpm --filter @sj/gateway demo:hotswap` — the hut checkerboard visibly becomes the drawn timber hut in both browsers without reload. Before/after screenshots.
6. Bonus evidence (not gate-blocking): grave stillness observed at the Idler's scripted death.

- [ ] **Step 1: write `g6.test.ts` (RED where meaningful), implement FpsOverlay.**
- [ ] **Step 2: automated half GREEN; full suite + typecheck GREEN.**
- [ ] **Step 3: run the human protocol; collect evidence into the gate report.**
- [ ] **Step 4: Commit** — `test(observatory): GATE G6 — dual-viewer parity, scrub sweep, thought latency, hot swap` + tag `gate-g6`.

---

## Self-review notes (done at authoring)

- Spec §8 lens table: living map incl. fire glow + building-click provenance (T11–15, T12), inspector incl. personality diff history + follow-cam (T16), chronicle + scrub + deep links (T17), society (T18), director + letterbox/subtitles (T19), digest (T19). Deferred items are declared, not silently dropped: OG cards, timelapse export, ledger-sentiment edges, newspaper render.
- Config travels in the snapshot message (T1/T5/T9) so the browser folds with the engine's real SimConfig — live view cannot drift from a tuned sim.
- Spec §15 frontend table: every row has a binding home — ref-mounted Pixi (T11), pixel-perfect consts (T11), dimetric formula + bake (T10/11), multiply quad + ColorMatrix (T14), hot-load with `texture.source.unload()` (T12), react-force-graph-2d (T18), React 19 + Vite 8 (T9), plain ws + serialize-once + bufferedAmount (T4/5).
- Character standard v2 renderer notes all land: 8fps 4-frame loop, 1px passing bob (render-only), blob shadow, sleep row, portraits slot, emote overlay, feet-anchor/origin (0.5, 1.0) convention (T6 placeholder sheet geometry + T12 anchor law + T13).
- Asset independence: T6 placeholder endpoints exist before any web task; T11 terrain, T12 entities, T13 characters explicitly render placeholder-first; the gate's hot-swap proves the upgrade path, not the baseline.
- Type consistency pass: `WorldMirror.stateAt` (T2) is what T5 scrub and T20 sweep call; `SocketHub.add(sock, onResync)` matches T5 usage; `charPose`/`WALK_LOOP` names consistent T13↔T20; `momentToTick` signature identical in T1/T9/T17; store method names (`applyServer`, `onEvents`, `assetsSeq`) consistent across T9/T12/T14/T15/T17.
- Placeholder-language scan: no TBDs; every algorithm has exact constants or exact rules; the two C7-shaped endpoints return typed empties by design, documented as such.
- Interfaces blocks: every task lists consumes/produces; no task references a later task's exports.
