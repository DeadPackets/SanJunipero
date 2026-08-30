# Putting the town on the internet

Fifteen minutes on a fresh Linux box. Everything below is run by you, on your machine and your
host — nothing in this repository provisions anything or spends anything on your behalf.

## What you need first

| | |
|---|---|
| A VPS | 2 vCPU / 4 GB, Docker installed. ~$20/mo. The image is ~500 MB and the build wants the RAM. |
| A domain | An A record for the name you will use, pointed at the box's IP, **already resolving**. |
| Ports 80 and 443 | Open to the world. Let's Encrypt validates over them; a firewall here is the most common failed first deploy. |
| An S3 bucket | Only for continuous backup. Optional, and you can add it later. |
| An OpenRouter key | **Only for `SJ_LIVE=1`.** The default town costs nothing and needs no key. |

## A box that already has a reverse proxy (this one: nginx, behind Cloudflare)

Skip Caddy. The `caddy` service sits behind `--profile edge` and never starts on a plain `up`.

1. `.env` sets `PORT=8090` (any free loopback port) — the town publishes on `127.0.0.1:$PORT` only.
2. One vhost on the box's nginx forwards the hostname to it; here `add-site
   sanjunipero.deadpackets.pw 8090 --cloudflare-only` wrote it (WebSocket upgrade included).
3. Cloudflare's proxied record terminates TLS; the origin speaks plain HTTP on :80 and only
   accepts Cloudflare's ranges. Nothing in this repo needs a certificate.
4. `docker compose up -d --build` — town only. `docker compose logs -f town` as below.

## The runbook

1. **Install Docker** on the box, if it is not there.
   ```
   curl -fsSL https://get.docker.com | sh
   ```

2. **Get the code and enter it.**
   ```
   git clone <your-fork-url> san-junipero && cd san-junipero
   ```

3. **Point DNS at the box and confirm it resolves before going further.** ACME fails on a name
   that does not yet answer, and a failed challenge leaves the site with no certificate at all.
   ```
   dig +short town.example.com     # must print this box's IP
   ```

4. **Write the environment file.** It is git-ignored; confirm that yourself before your first commit.
   ```
   cp deploy/.env.example .env
   chmod 600 .env
   nano .env                       # set SJ_SITE_ADDRESS=town.example.com
   git check-ignore -v .env        # must print a match
   ```

5. **Build and start.** First build is 5-10 minutes; it compiles nothing but downloads a lot.
   ```
   docker compose up -d --build
   ```

6. **Watch the town wake up.** This is the step that tells you whether it worked.
   ```
   docker compose logs -f town
   ```
   You are waiting for `stream: the town is open at ...`. Two lines above it say which town it is
   and what it costs — read both. See "Reading the boot" below.

7. **Open `https://town.example.com`.** Caddy gets its certificate on the first request, so the
   first load can take a few seconds. If it hangs, `docker compose logs caddy` names the reason.

8. **Turn on backup, once you have a bucket.** Put the four `LITESTREAM_*` values in `.env`, then:
   ```
   docker compose --profile backup up -d
   docker compose logs litestream    # must NOT say "NOT BACKING ANYTHING UP"
   ```

That is the whole deployment. The steps below are for running it, not standing it up.

## What `.env` can set

Every name below is enumerated in `compose.yaml`, and a test fails the build if one of them is
documented here and not passed through. Leave a knob out of `.env` and the container never sees
it at all, so the code's own default stands — an empty value is not the same as an absent one.

| In `.env` | Default | What it does |
|---|---|---|
| `SJ_SITE_ADDRESS` | `:80` | The Caddy hostname. A real name gets a real certificate. |
| `SJ_RINGS` | `1` | How far the town is platted. **Cannot change on a town that already exists.** |
| `SJ_INTERIORS` | on | `0` keeps people out of doors. |
| `SJ_MAP` | `showcase` | `scripted` serves the frozen test fixture instead of the product town. |
| `SJ_LAMPS` | `8` | Street lamps the lamplighter raises. `0` leaves the streets dark. |
| `SJ_LIVE` | off | **`1` puts LLM minds behind the bodies and bills a real card, continuously.** |
| `OPENROUTER_API_KEY` | — | Required by `SJ_LIVE=1`, ignored without it. |
| `SJ_ARBITER` | on | `0` turns the god layer off inside a live run. |
| `SJ_ADMIN_TOKEN` | unset | **The only write path into the world.** Set it to open the loopback operator channel. |
| `SJ_ADMIN_PORT` | `8788` | Where that channel listens, on `127.0.0.1` inside the container. |
| `SJ_GIT_SHA` | unset | Stamped into `/admin/export`'s manifest. Without it a replay cannot know which code folded the events. |
| `SJ_SPEND_DAILY_USD` | `3.00` | Dollars the live cast may burn in a rolling 24 real hours. |
| `SJ_SPEND_CAP_USD` | `50.00` | Dollars over the town's whole life; `0` is no lifetime cap. |
| `SJ_MAX_MINDS` | founders x 3 (`15`) | How many minds the town may hold. A birth past it is folded into the world with no mind booted for it. |
| `SJ_MINDS_DIR` | `data/minds` | Where per-mind memory lives. **Inside the volume — moving it moves it out.** |
| `SJ_MODELS_DIR` | `/app/data/models` | Where the memory embedder's model is cached. **Leave it unset.** The `Dockerfile` copies `packages/` only, so the model is not in the image — but `compose.yaml` mounts the named volume `town-models` at exactly the path the code defaults to, so the first `SJ_LIVE=1` boot pulls it from the HuggingFace CDN once and every recreate reuses it. **Never point it inside `/app/packages/town/data`**: that is the `town-data` volume, and `SJ_FRESH=1` empties it. |
| `LITESTREAM_*` | — | Continuous backup; only read under `--profile backup`. |

`SJ_FRESH` is deliberately NOT in that list — see below.

## Reading the boot

Three lines decide whether the thing that came back is the thing you had. Grep for them.

| Line | Means |
|---|---|
| `this is the town that was running, resumed at tick N` | **Correct.** Day 12 follows day 11. |
| `this is a new town` | Day 0. Right on a first deploy, **wrong on a restart** — your volume is not holding. |
| `FRESH — the world db was deleted` | Something set `SJ_FRESH=1`. It should be impossible; see below. |
| `this town is N ticks old and every mind behind it is new` | **★ The quiet one.** Live mode only. Read the volume section. |

## ★ The volume, which is the thing that can silently destroy a town

Everything the stream writes is under one directory, and one mount covers all of it:

```
/app/packages/town/data/
├── dev-world.db          the world + the forge's asset and job tables
└── minds/                ★ only exists once SJ_LIVE=1 has run
    ├── amara.db  nadia.db  salma.db  omar.db  yusuf.db     memories, journals, half-run plans
    └── _ops.db                                             the llm_calls spend ledger
```

**Scripted (the default): one file.** `dev-world.db`. No `minds/` directory is ever created,
because `serve.ts` passes `agentDbDir` only on the live path.

**Live (`SJ_LIVE=1`): seven files.** The world, five minds, and the ledger.

**Why the mount is at `data` and not at the world file.** A mount aimed at `dev-world.db` alone
looks correct for weeks — the scripted town resumes perfectly — and then loses every mind the
first time somebody streams live. `_ops.db` goes with them, and that one is the spend ledger the
spend budget is read off, so a town that loses it is handed a fresh budget to spend without
anybody deciding that.

**How you would notice, and why it is easy not to.** `liveWorld.ts` *refuses* the mirror image of
this — a new world whose minds still remember an older one throws and the boot dies. The case
here is only **announced**, on one stdout line:

```
stream: this town is N ticks old and every mind behind it is new —
        the bodies remember more than the people in them do
```

It does not error, it does not restart-loop, and nothing in the viewer shows it. The town comes
back at the right tick with the right buildings and five people who remember nothing. **That line
is your only tell.** If you see it and you did not intend a reset, stop the container before it
writes more, and restore.

### Upgrading a town deployed before the split

The package that owns the data directory was renamed, so both the mount path and the volume name
moved: `gateway-data:/app/packages/gateway/data` became `town-data:/app/packages/town/data`. A
`compose up` on the new file mounts an **empty** `town-data` and the town boots at day 0, saying
`this is a new town`. Copy the old volume across first, once, while nothing is running:

```
docker compose down
docker run --rm -v san-junipero_gateway-data:/from -v san-junipero_town-data:/to alpine cp -a /from/. /to/
docker compose up -d --build
```

Then check the boot says `resumed at tick N`. The old volume is untouched, so a wrong answer
costs nothing but the copy — `docker volume rm san-junipero_gateway-data` when you are satisfied.

## ★ The reset is deliberate and cannot be left lying around

`SJ_FRESH` is hard-coded to `0` in `compose.yaml` — never `${SJ_FRESH:-0}`, and never a bare
`- SJ_FRESH` pass-through like the knobs in the table above. That is not a style choice. Compose
auto-loads `.env` and layers the shell on top, so either of those forms would let one
`SJ_FRESH=1` left behind after a deliberate reset delete the world on **every restart from then
on**, silently, with a new day 0 as the only sign.

Verified: with `SJ_FRESH=1` sitting in `.env`, the town still resumed at tick 590, and
`docker compose config` still reports `SJ_FRESH: "0"`.

To actually reset, type it into one run:

```
docker compose run --rm -e SJ_FRESH=1 town     # one reset, no residue
docker compose down -v                          # or: end the town and its volume
```

## ★ What it costs

**One sim-day is one real hour**, so "$/sim-day" and "$/hour" are the same number.

**Expected, to be measured in rehearsal 4**: five minds, **$0.03-0.04 per sim-day**. That is
rehearsal 3's measured $0.47-0.71 recosted on the Baidu pin, with the turn's reasoning off and
the day log deduped — a 94% cut, each part of it measured, the stack of them not yet.

| | per hour | per day | per 30-day month |
|---|---|---|---|
| **Scripted** (default) | **$0.00** | **$0.00** | **$0.00** |
| **Live** (`SJ_LIVE=1`, 5 minds) | **$0.03-0.04** | **$0.65-0.96** | **$19-29** |

Add the box (~$20/mo) and S3 (a few dollars). **Scripted: ~$20-25/mo. Live: ~$40-50/mo,
forever, until you stop it.** A live town is not something to leave running.

**These ARE the numbers the code prints.** `pins.ts` books the rate this account is actually
charged — reconciled against the bill, not read off a price list — and a call whose bill
OpenRouter reports is booked at that bill. The dashboards and this page are the same dollars.

### The three guards, and where they trip

Each is calibrated against the price the ledger books, so each fires at its nominal spend.

| Guard | Set at | Reached, at the expected 5-mind rate | What it does |
|---|---|---|---|
| Daily budget | $3.00 per rolling 24 h | **never, at this rate** — 24 h costs $0.72-0.96 | Kills the process; a restart refuses until the window rolls. |
| Anomaly stop | $50 total | ~1,250-1,700 real hours, so 52-70 days | Kills the process. The town on disk is intact. |
| Rate tripwire | $0.04/mind/sim-day over 15 min | $0.20/h for five minds — 5x the expected rate | Stops every mind. The town keeps serving. |
| Operator alert | $0.40/sim-day over 15 min | 10x the expected 5-mind rate | Prints and files an alert. Stops nothing. |

**Only the tripwire still bites.** The two dollar guards were set against a bill 20x this one and
were not re-derived with it, so at the expected rate the rate tripwire is the guard that fires
first and the other two are disaster ceilings. Lower `SJ_SPEND_DAILY_USD` if you want the daily
budget back as a working limit.

Both dollar guards are **per town, not per process**: the ledger lives in `_ops.db` and resumes
with the world, so restarting does not reset either. The daily budget is the one an operator sets;
the lifetime cap is the disaster ceiling, and `SJ_SPEND_CAP_USD=0` removes it. A town over either
line refuses to boot live, before the pre-flight spends anything, and says which line it is over.
That is the intent — but it is also why `_ops.db` must be in your backup.

**Before you set `SJ_LIVE=1`:** the scripted town is not a degraded mode. It is the same world,
the same viewer, the same event log and the same port — only the deciding is scripted. Stream it
scripted first and confirm the whole stack is right before attaching a card to it.

## The operator's channel

`SJ_ADMIN_TOKEN` opens the whole channel on `127.0.0.1:${SJ_ADMIN_PORT:-8788}` inside the
container, and the served origin proxies `/admin/*` to it — so `https://<your host>/admin/cost`
is reachable from the internet, **locked only by the bearer**. Treat the token like the key.
Every route takes the same `Authorization: Bearer $SJ_ADMIN_TOKEN`, and every one of them is the
operator's: nothing here is ever rendered into a mind's prompt. The viewer's Laws page (behind the
Signpost) is the same channel with a form on it: paste the token once.

| Route | What it does |
|---|---|
| `POST /admin/laws` | Turn one world law. See below. |
| `GET /admin/clock` | Whether the world clock is running, its speed, and the tick it stands at. |
| `POST /admin/pause` · `/admin/resume` | Stop and start the world clock. The stream keeps serving; the viewer's stamp reads `PAUSED`. |
| `POST /admin/speed` `{x}` | Ticks per beat, between `0.1` and `60`. |
| `GET /admin/cost` | Today's spend and its projection, lifetime, per caller, the ten costliest minds, the cache-read share, the caps and whether either was reached, the last ten alerts — and the **answer rate**. |
| `GET /admin/rulings/pending` | Codified rulings still waiting on a person. |
| `POST /admin/rulings/:ruleId/approve` | Keep the rule. |
| `POST /admin/rulings/:ruleId/revert` `{reason}` | Tombstone the rule **and unregister the verb it minted**. |
| `GET /admin/export` | The whole run as one tar. See below. |

A scripted stream has no ledger and no god layer: `/admin/cost` answers `live: false` with zeros
and `/admin/rulings/*` answers empty rather than erroring.

**The answer rate** is the town's one motive number — criterion 18 of
[the genesis rehearsal plan](../docs/superpowers/plans/2026-08-24-03-genesis-rehearsal-v6.DRAFT.md),
the only gate that measures motive rather than activity. It is read from the world log alone: of the
acts a body STARTED (`action_started`), the share that reached `action_completed` rather than
`action_interrupted`. It costs nothing, needs no live run, and a town that begins everything and
finishes nothing reads as the rut it is.

## Replicating a run elsewhere

```
docker compose exec town node -e "fetch('http://127.0.0.1:8788/admin/export',\
  {headers:{authorization:'Bearer '+process.env.SJ_ADMIN_TOKEN}}).then(r=>r.arrayBuffer())\
  .then(b=>require('fs').writeFileSync('/app/packages/town/data/run.tar',Buffer.from(b)))"
docker compose cp town:/app/packages/town/data/run.tar ./run.tar
```

`/data` is the **litestream** container's mount, not the town's: the town's only writable path is
`/app/packages/town/data`, and writing the tar anywhere else raises ENOENT.

Every database is read with SQLite's own `serialize()` under one transaction, so the copy is
consistent against a town that is still ticking — it is not a file copy racing the WAL.

```
run/manifest.json     git sha, the world's map/rings/seed, the tick and day it was taken at,
                      the event count, and every file with its size
run/config.json       the SimConfig the world folds with
run/world.db          the event log, snapshots and rng state — the whole world
run/minds/<id>.db     one per mind: memories, and the half-run plan it stopped on
run/minds/_ops.db     the call ledger and the alerts
run/minds/_arbiter.db the rulebook, the codex and the review queue
run/minds/_narrator.db the chronicle
```

To replay it: unpack, put `world.db` where `SJ_MINDS_DIR`'s neighbour expects it, put `minds/`
at `SJ_MINDS_DIR`, and boot the same `gitSha` the manifest names. The town resumes at the tick
the manifest names.

## Turning a world law, mid-run

The law route on that same channel: It is never published to the host and Caddy never proxies it, so the only way in is
through the container itself:

```
docker compose exec town node -e "fetch('http://127.0.0.1:8788/admin/laws',{method:'POST',\
  headers:{authorization:'Bearer '+process.env.SJ_ADMIN_TOKEN,'content-type':'application/json'},\
  body:JSON.stringify({path:'mystery.enabled',value:false})}).then(r=>r.text()).then(console.log)"
```

A law is checked against the engine's whitelist — `TOGGLABLE_PATHS` in
`packages/engine/src/laws.ts` — before it is accepted, lands as one
`config_changed` at the next tick boundary, and is hashed, snapshotted and replayed like every
other fact. A path that is not on the whitelist is a 400, not a world that dies at the next tick.
**Unset the token and no write path into the world exists at all** — which is the default.

## Where the logs go, and the one signal in them

**There is no metrics endpoint. The only health signal this project has is a log line.** `SocketHub`
writes to stderr when a viewer crosses 1 MiB behind and starts having its deltas dropped. Nothing
else reports it.

```
docker compose logs -f town                     everything
docker compose logs town | grep viewers         lagging transitions — the health signal
docker compose logs town | grep 'this town'     resume / fresh / blank-minds
```

Logs are `json-file` capped at 10 MB x 5 per service, so a month of streaming cannot fill the disk
and take the town down by a route nobody was watching. **They are on the box and nowhere else** —
if you want them to survive the box, ship them somewhere yourself; nothing here does that for you.

## Restoring

Litestream restores one database at a time and **you must restore all of them or none**. A world
restored without its minds is the blank-minds case above.

The running container writes its config to `/tmp/litestream.yml`; copy it out first so a restore
uses the same S3 keys the backup was written under.

```
docker compose --profile backup cp litestream:/tmp/litestream.yml ./litestream.yml
docker compose down
docker run --rm -v san-junipero_town-data:/data \
  -e LITESTREAM_ACCESS_KEY_ID=... -e LITESTREAM_SECRET_ACCESS_KEY=... \
  -v ./litestream.yml:/etc/litestream.yml:ro \
  litestream/litestream:0.3.13 restore -config /etc/litestream.yml /data/dev-world.db
# then repeat for /data/minds/_ops.db and each /data/minds/<name>.db
docker compose up -d
```

**Why the config is generated rather than checked in.** `dbs[].path` takes no wildcard in
litestream 0.3.13 — a `/data/minds/*.db` entry is taken literally and backs up nothing while
reporting itself healthy — and a named roster puts every child born in play outside the backup
with nothing to say so. `deploy/litestream.sh` therefore writes one block per `.db` under `/data`
at boot, and exits when that set changes so `restart: unless-stopped` brings it back with the new
mind in it. A birth is outside the backup for at most one minute.

## Scaling

Don't add a replica. Each container ticks its own world from its own SQLite file, so a second
replica is a **second town**, not more capacity for this one. More viewers means a bigger box or a
CDN in front of the static bundle.

The ceiling is websocket deflate, which `serverNoContextTakeover` pays **per socket**: a measured
0.251 ms per frame per viewer, so one core saturates near **120 viewers at ×8** and **~1,000 at ×1**.
