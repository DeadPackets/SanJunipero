# San Junipero

LLM simulated life. A deterministic town simulation with a 2:1 dimetric viewer; the bodies are
scripted and free by default, and become LLM minds only when you ask for them.

```
pnpm install
pnpm stream                  # build the viewer, tick the town, serve both on http://localhost:8080
```

`pnpm test` runs the suite; `pnpm check` runs the whole gate — `typecheck`, `lint`,
`format:check`, `knip`, then `test`. To put a town on the internet, see
[deploy/README.md](deploy/README.md).

## The packages

| Package | What it holds |
|---|---|
| `@sj/shared` | Time, events, hashing, and `DEFAULT_CONFIG` — the frozen tuning every package reads. |
| `@sj/engine` | The deterministic simulation: rng streams, event store, tick loop, replay. |
| `@sj/agents` | The minds — turn schema, prompt, memory, and the LLM call with its spend guard. |
| `@sj/arbiter` | The god layer: adjudication, canon, and the codex of rulings. |
| `@sj/forge` | Asset generation and its budget, spend ledger, and vision QA. |
| `@sj/narrator` | Chronicle, newspaper, biography — the town told back to itself. |
| `@sj/gateway` | The observatory: socket hub, HTTP API, asset routes, and the built viewer. |
| `@sj/town` | The scripted composition root: world boot, founders, the `pnpm stream` entrypoint. |
| `@sj/live` | The LLM cast behind the bodies. Loaded only by `SJ_LIVE=1`, through one dynamic import. |
| `@sj/llm` | The model pin, the price table, `LlmClient`, and the `_ops.db` ledger every dollar is booked to. |
| `@sj/web` | The React + PixiJS viewer. |

`packages/*/scripts` is not part of any of them: 38 human-run one-shots — probes, art
generation, scoring. The `gen-*` and `*-live` ones spend real money.

## The rules, and the tests that hold them

The specification of this project is its tests. These six hold the rules a change is most likely
to break by accident.

| Rule | The test |
|---|---|
| The scripted path never loads the mind stack, so the default run stays free. | `packages/town/src/liveSeam.test.ts` |
| Every knob the docs promise reaches the container, and the backup covers the minds that exist. | `packages/town/src/deployEnv.test.ts` |
| Nothing Node-only reaches the browser bundle. | `packages/web/src/browserGraph.test.ts` |
| Two viewers fold the same events to the same bytes, over three sim-days. | `packages/town/src/g6.test.ts` |
| The one-way glass holds: no operator word reaches a mind. | `packages/shared/src/glassScan.test.ts` |
| `SimConfig` takes no unknown key at any depth, and its binding defaults are asserted by value. | `packages/shared/src/config.test.ts` |

A `★` in a comment or a test name marks a load-bearing line — somebody paid to learn it, so read
it before you change it. There are 836.

**One-way glass** names two mechanisms, both about what a mind may know. *Vocabulary*:
`packages/shared/src/glassScan.ts` refuses any operator word — `construct`, `milestone`,
`first_*` — in a mind-facing string. *Direction*: the observatory opens the world database
readonly, so nothing an operator reads or writes is ever folded back into the town.

## Where do I…

| | |
|---|---|
| Add a world law | A path and a zod type in `TOGGLABLE_PATHS`, `packages/engine/src/laws.ts`. |
| Follow a mind's prompt | `runtime/bridge.ts` → `prompt/prose.ts` → `runtime/agentRuntime.ts` → `prompt/assemble.ts`, all under `packages/agents/src`. |
| Import the engine from the browser | The deep paths only: `@sj/engine/state`, `/fold`, `/verbs`, `/laws`. One `from '@sj/engine'` drags in `better-sqlite3` and the page dies before React mounts. |

## The two entrypoints

| | Command | Port | Serves |
|---|---|---|---|
| Streamed town | `pnpm stream` | 8080 | The built viewer from `packages/web/dist`. |
| Frontend dev loop | `pnpm --filter @sj/town dev:world` + `pnpm --filter @sj/web dev` | 5173 | Vite HMR; `/ws`, `/api` and `/assets` proxy to the gateway on 8787. |

Both boot the same world through `startDevWorld`; they differ only in who serves the client and in
a few defaults below.

Both run inside `packages/town`, so the town on disk is `packages/town/data/dev-world.db` —
the path is relative to the working directory, and a script launched from the repo root writes a
second, different town at `data/dev-world.db`.

## Rehearsing the live cast

`pnpm rehearse` runs one short `SJ_LIVE=1` stream and `scripts/score.mjs` reads what it left
behind — spend per caller, chapters, dreams, births, alerts, and a glass scan over every
mind-facing string the run wrote. **It spends real money**, under a $2 daily budget and the
lifetime anomaly stop. It reads `OPENROUTER_API_KEY` out of `.env` through `--env-file`, so the
key is never on a command line.

```
pnpm rehearse                                   # 30 real minutes at SPEED=4 — about 2 sim-days
pnpm rehearse 10                                # shorter; Ctrl-C is safe at any point
SPEED=1 pnpm rehearse 30                        # real time: 30 real minutes is one sim-day
node --import tsx scripts/score.mjs             # what the rehearsal produced
```

A sim-day is 1440 ticks of 1250 ms, so `SPEED` x minutes / 30 is the sim-days a run buys; the
script prints that number when it starts. The rehearsal writes under `rehearsals/`, which is
gitignored, and the scorer only reads. `--import tsx` is not optional: the workspace packages are
published as TypeScript source.

## Environment

Read by `pnpm stream` and `dev:world` alike, unless the table says otherwise. Nothing here needs to be
set for a default run. Under Docker only the variables `compose.yaml` names in its `environment:`
block reach the container.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `8080` | The port `pnpm stream` listens on. |
| `SJ_RINGS` | `1` | How far the town is platted. Ring 1 is the 76-tile showcase, ring 3 a 152-tile square. Cannot change on a town that already exists — the boot refuses. |
| `SJ_MAP` | `showcase` | `scripted` asks for the frozen G6 test fixture instead of the product town. |
| `SJ_INTERIORS` | on | `0` keeps people out of doors. |
| `SJ_FRESH` | off | `1` throws the town on disk away and starts a new day 0. Never leave it set. |
| `SJ_LAMPS` | `8` | How many street lamps the lamplighter raises. `0` leaves the streets dark. `pnpm stream` only; `dev:world` raises none. |
| `SJ_LIVE` | off | **`1` puts LLM minds behind the bodies and bills a real card, continuously.** Needs `OPENROUTER_API_KEY`. `pnpm stream` only. |
| `SJ_ARBITER` | on | `0` turns the god layer off inside a live run. `pnpm stream` only. |
| `SJ_SPEND_DAILY_USD` | `3.00` | Dollars the live cast may burn in a rolling 24 real hours. A sim-day passes every 30 real minutes, so this is the stream's running cost per day. `pnpm stream` only. |
| `SJ_SPEND_CAP_USD` | `50.00` | Dollars over the town's whole life; `0` is no lifetime cap. Reaching it stops the minds and kills the process. `pnpm stream` only. |
| `SJ_MAX_MINDS` | founders x 3 (`15`) | How many minds the town may hold. A birth past it is still folded into the world — the child has a body and no mind, and an alert row says so. `pnpm stream` only. |
| `SJ_ADMIN_TOKEN` | unset | Set it to open the loopback law channel (`POST /admin/laws`) behind that bearer token. Unset, no write path into the world exists. `pnpm stream` only. |
| `SJ_ADMIN_PORT` | `8788` | The port that channel listens on, on `127.0.0.1` only. Never proxy it. `pnpm stream` only. |
| `SJ_MINDS_DIR` | `data/minds` under `packages/town` | Where per-mind memory lives, one sqlite file each. `pnpm stream` only. |
| `SJ_MODELS_DIR` | `data/models` at the repo root | Where the memory embedder's local model is cached. Nothing else lives there. Under Docker it has its own volume, `town-models`, separate from the town's — leave it unset. `pnpm stream` only. |
| `SJ_BUILDERS` | on | `0` stops the founders raising houses. |
| `SJ_BRIDGE` | on | `0` leaves the river uncrossed. |
| `SJ_JOINT` | off | `1` lets a mason lend a hand at a neighbour's walls. |
| `DEV_FAST_FORWARD` | `0` | Step the world synchronously to that tick before the real-time cadence starts. Screenshot and QA convenience — it fast-forwards a resumed town too. |

Deployment adds `SJ_SITE_ADDRESS` (the Caddy hostname) and the `LITESTREAM_*` backup credentials —
both documented in [deploy/.env.example](deploy/.env.example).

Live probe scripts under `packages/*/scripts` read a few more (`SJ_OUT`, `SJ_ARM`, `SJ_ONLY`,
`SJ_REPEAT`, `SJ_ART_ROOT`); each script's header says what it does with them.
