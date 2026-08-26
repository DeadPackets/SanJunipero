# Putting the town on the internet

Fifteen minutes on a fresh Linux box. Everything below is run by you, on your machine and your
host — nothing in this repository provisions anything or spends anything on your behalf.

## What you need first

| | |
|---|---|
| A VPS | 2 vCPU / 4 GB, Docker installed. ~$20/mo. The image is ~1.2 GB and the build wants the RAM. |
| A domain | An A record for the name you will use, pointed at the box's IP, **already resolving**. |
| Ports 80 and 443 | Open to the world. Let's Encrypt validates over them; a firewall here is the most common failed first deploy. |
| An S3 bucket | Only for continuous backup. Optional, and you can add it later. |
| An OpenRouter key | **Only for `SJ_LIVE=1`.** The default town costs nothing and needs no key. |

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
| `SJ_INTERIORS` | `0` | `1` lets people go indoors and sleep. |
| `SJ_MAP` | `showcase` | `scripted` serves the frozen test fixture instead of the product town. |
| `SJ_LAMPS` | `8` | Street lamps the lamplighter raises. `0` leaves the streets dark. |
| `SJ_LIVE` | off | **`1` puts LLM minds behind the bodies and bills a real card, continuously.** |
| `OPENROUTER_API_KEY` | — | Required by `SJ_LIVE=1`, ignored without it. |
| `SJ_ARBITER` | on | `0` turns the god layer off inside a live run. |
| `SJ_MINDS_DIR` | `data/minds` | Where per-mind memory lives. **Inside the volume — moving it moves it out.** |
| `SJ_MODELS_DIR` | baked into the image | Where the memory embedder's model is cached. |
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
/app/packages/gateway/data/
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
`$5` anomaly stop reads, so a town that loses it is handed a fresh $5 to spend without anybody
deciding that.

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

| | per hour | per day | per 30-day month |
|---|---|---|---|
| **Scripted** (default) | **$0.00** | **$0.00** | **$0.00** |
| **Live** (`SJ_LIVE=1`, 5 minds) | **$0.106** | **$2.54** | **$76** |

Add the box (~$20/mo) and S3 (a few dollars). **Scripted: ~$20-25/mo. Live: ~$100/mo, forever,
until you stop it.**

**★ These are not the numbers the code prints.** `pins.ts` books input/output/cache at
`0.14/0.28/0.028` per million tokens while the serving provider charges `0.28/0.56/0.07` — 2x on
input and output, 2.5x on cache reads. **Every cost this project reports is about half the real
one.** The table above is the doubled, real figure; the dashboards are not. The `price` lane is
fixing the pin; until it lands, read every reported dollar as two.

### The two guards, and where they really trip

Both are calibrated against the booked price, so both fire at **twice** their nominal spend.

| Guard | Nominal | Actually trips at | What it does |
|---|---|---|---|
| Anomaly stop | $5 total | **$10 of real money**, after ~94 h (~3.9 days) of normal streaming | Kills the process. The town on disk is intact. |
| Rate tripwire | $0.10/mind/sim-day over 15 min | **$0.20/mind/real-hour** — $1.00/h for five minds | Stops every mind. The town keeps serving. |

The anomaly stop is **per town, not per process**: the ledger lives in `_ops.db` and resumes with
the world, so restarting does not reset it. A town that has spent its cap refuses to boot live and
says so. That is the intent — but it is also why `_ops.db` must be in your backup.

**Before you set `SJ_LIVE=1`:** the scripted town is not a degraded mode. It is the same world,
the same viewer, the same event log and the same port — only the deciding is scripted. Stream it
scripted first and confirm the whole stack is right before attaching a card to it.

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

```
docker compose down
docker run --rm -v san-junipero_town-data:/data \
  -e LITESTREAM_ACCESS_KEY_ID=... -e LITESTREAM_SECRET_ACCESS_KEY=... \
  -v ./deploy/litestream.yml:/etc/litestream.yml:ro \
  litestream/litestream:0.3.13 restore -config /etc/litestream.yml /data/dev-world.db
# then repeat for /data/minds/_ops.db and each /data/minds/<name>.db
docker compose up -d
```

**★ A mind born in play is not backed up.** Litestream's config takes one literal path per
database and has no wildcard, so `deploy/litestream.yml` names the five founders explicitly. A
child born after genesis gets a `.db` that no block covers. Add a block for it, or accept that a
restore returns the founders and not the generation after them. This is the one hole in the backup
story and it is written down rather than left to be discovered.

## Scaling

Don't add a replica. Each container ticks its own world from its own SQLite file, so a second
replica is a **second town**, not more capacity for this one. More viewers means a bigger box or a
CDN in front of the static bundle.
