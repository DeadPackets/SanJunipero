# San Junipero

LLM simulated life. A deterministic town simulation with a 2:1 dimetric viewer; the bodies are
scripted and free by default, and become LLM minds only when you ask for them.

```
pnpm install
pnpm stream                  # build the viewer, tick the town, serve both on http://localhost:8080
```

`pnpm test` runs the suite, `pnpm typecheck` runs both TypeScript projects. To put a town on the
internet, see [deploy/README.md](deploy/README.md).

## The packages

| Package | What it holds |
|---|---|
| `@sj/shared` | Time, events, hashing, and `DEFAULT_CONFIG` — the frozen tuning every package reads. |
| `@sj/engine` | The deterministic simulation: rng streams, event store, tick loop, replay. |
| `@sj/agents` | The minds — turn schema, prompt, memory, and the LLM call with its spend guard. |
| `@sj/arbiter` | The god layer: adjudication, canon, and the codex of rulings. |
| `@sj/forge` | Asset generation and its budget, spend ledger, and vision QA. |
| `@sj/narrator` | Chronicle, newspaper, biography — the town told back to itself. |
| `@sj/gateway` | The server: world boot, socket hub, HTTP API, and the built viewer. |
| `@sj/web` | The React + PixiJS viewer. |

## The two entrypoints

| | Command | Port | Serves |
|---|---|---|---|
| Streamed town | `pnpm stream` | 8080 | The built viewer from `packages/web/dist`. |
| Frontend dev loop | `pnpm --filter @sj/gateway dev:world` + `pnpm --filter @sj/web dev` | 5173 | Vite HMR; `/ws`, `/api` and `/assets` proxy to the gateway on 8787. |

Both boot the same world through `startDevWorld`; they differ only in who serves the client and in
a few defaults below.

## Environment

Read by `pnpm stream` and `dev:world` alike, unless the table says otherwise. Nothing here needs to be
set for a default run. Under Docker only the variables `compose.yaml` names in its `environment:`
block reach the container.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `8080` | The port `pnpm stream` listens on. |
| `SJ_RINGS` | `1` | How far the town is platted. Ring 1 is the 76-tile showcase, ring 3 a 152-tile square. Cannot change on a town that already exists — the boot refuses. |
| `SJ_MAP` | `showcase` | `scripted` asks for the frozen G6 test fixture instead of the product town. |
| `SJ_INTERIORS` | off on `pnpm stream`, on in `dev:world` | Let people go indoors and sleep. |
| `SJ_FRESH` | off | `1` throws the town on disk away and starts a new day 0. Never leave it set. |
| `SJ_LAMPS` | `8` | How many street lamps the lamplighter raises. `0` leaves the streets dark. `pnpm stream` only; `dev:world` raises none. |
| `SJ_LIVE` | off | **`1` puts LLM minds behind the bodies and bills a real card, continuously.** Needs `OPENROUTER_API_KEY`. `pnpm stream` only. |
| `SJ_ARBITER` | on | `0` turns the god layer off inside a live run. `pnpm stream` only. |
| `SJ_SPEND_DAILY_USD` | `3.00` | Dollars the live cast may burn in a rolling 24 real hours. One sim-day is one real hour, so this is the stream's running cost per day. `pnpm stream` only. |
| `SJ_SPEND_CAP_USD` | `50.00` | Dollars over the town's whole life; `0` is no lifetime cap. Reaching it stops the minds and kills the process. `pnpm stream` only. |
| `SJ_MAX_MINDS` | founders x 3 (`15`) | How many minds the town may hold. A birth past it is still folded into the world — the child has a body and no mind, and an alert row says so. `pnpm stream` only. |
| `SJ_ADMIN_TOKEN` | unset | Set it to open the loopback law channel (`POST /admin/laws`) behind that bearer token. Unset, no write path into the world exists. `pnpm stream` only. |
| `SJ_ADMIN_PORT` | `8788` | The port that channel listens on, on `127.0.0.1` only. Never proxy it. `pnpm stream` only. |
| `SJ_MINDS_DIR` | `data/minds` under `packages/gateway` | Where per-mind memory lives, one sqlite file each. `pnpm stream` only. |
| `SJ_MODELS_DIR` | `data/models` at the repo root | Where the memory embedder's local model is cached. Outside the container volume, unlike `SJ_MINDS_DIR`. `pnpm stream` only. |
| `SJ_BUILDERS` | on | `0` stops the founders raising houses. |
| `SJ_BRIDGE` | off on `pnpm stream`, on in `dev:world` | `1` lets one founder deck the ford. |
| `SJ_JOINT` | off | `1` lets a mason lend a hand at a neighbour's walls. |
| `DEV_FAST_FORWARD` | `0` | Step the world synchronously to that tick before the real-time cadence starts. Screenshot and QA convenience — it fast-forwards a resumed town too. |

Deployment adds `SJ_SITE_ADDRESS` (the Caddy hostname) and the `LITESTREAM_*` backup credentials —
both documented in [deploy/.env.example](deploy/.env.example).

Live probe scripts under `packages/*/scripts` read a few more (`SJ_OUT`, `SJ_ARM`, `SJ_ONLY`,
`SJ_REPEAT`, `SJ_ART_ROOT`); each script's header says what it does with them.
