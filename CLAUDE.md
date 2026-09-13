# CLAUDE.md

Resuming the v2 drive? Read `docs/HANDOVER-2026-09-13.md` first. It carries the state, the
laws, the owner's rulings and what is still open.

San Junipero is a simulated town. Every fact of it is an event in a log that replays
byte-for-byte, and the bodies in it are driven by LLM minds when a live run asks for them.

## The one design law

**Physics, never outcomes.** The engine says what wood, rain, hunger and walls *do*. It never
says what anybody should do about them. A want is made in the world, not in a prompt: when a
mind was told it was cold but the doors did not work, building went to zero.

The same law covers people. Nothing steers who likes whom, who marries, who strays. The world
holds the facts (who is married, who is blood) and refuses only what a body cannot do (hold two
marriages, court its own child). Everything else emerges, and our job is to notice it and show
it. If a run misbehaves socially, build the lens, not the rule.

## Commands

```
pnpm install
pnpm stream                 # scripted town, $0.00, no key, http://localhost:8080
pnpm check                  # the whole gate: typecheck, lint, format:check, knip, test
pnpm test                   # vitest across every package
pnpm rehearse [minutes]     # one scored live hour under a budget; spends real money
```

Targeted runs: `npx vitest run <paths> --poolOptions.forks.maxForks=2 --silent=true`.

## Toolchain facts that cost somebody an afternoon

- Formatting is **Biome** (`npx biome format --write <files>`), never Prettier. `npx biome check`
  reports hundreds of pre-existing import-order assists and is **not** the gate.
- Linting is eslint: `node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js packages/<p>`.
  The bar is **0 errors**; warnings are pre-existing.
- Typecheck with `npm run -s typecheck`. Per-package `npx tsc --noEmit -p packages/<p>` is
  unreliable for a newly exported symbol crossing a package line.
- knip flags exported-but-unused symbols. A test does not count as a use.
- Deep imports only from the browser: `@sj/engine/state`, `/fold`, `/verbs`, `/laws`. One bare
  `from '@sj/engine'` drags in better-sqlite3 and the page dies before React mounts.
- The viewer builds with `pnpm --filter @sj/web build`, not `npx vite build`.

## The tests that hold the rules

The specification of this project is its tests. A `★` in a name or comment marks a load-bearing
line: somebody paid to learn it, so read it before changing it.

| Rule | Test |
|---|---|
| The scripted path never loads the mind stack, so the default run stays free | `packages/town/src/liveSeam.test.ts` |
| Two viewers fold the same events to the same bytes over three sim-days | `packages/town/src/g6.test.ts` |
| No operator word reaches a mind | `packages/shared/src/glassScan.test.ts` |
| Nothing Node-only reaches the browser bundle | `packages/web/src/browserGraph.test.ts` |
| Every documented knob reaches the container | `packages/town/src/deployEnv.test.ts` |
| `SimConfig` takes no unknown key at any depth | `packages/shared/src/config.test.ts` |

A full gate must name `packages/live` and `packages/town`. Both catch seams unit tests cannot,
and both have shipped red tips.

## Running a live rehearsal

- Build the viewer **before** launching. `rehearse.sh` serves `packages/web/dist` as it finds it
  and the gateway caches index.html at first read, so a build during a run reaches nobody.
- **Never run a test suite while a rehearsal is running.** They fight for the box and the run is
  then not evidence of anything.
- A rehearsal watcher must call a stall when `max(tick)` has not moved in fifteen minutes. A
  frozen world keeps answering 200, and one sat dead for two hours forty minutes because the
  watchers only asked whether the port was up.
- Read the dialogue against the world's own snapshot at each checkpoint. Cost, talk length and
  speech quality all looked excellent on the run that spent a day nursing a woman at full health.

## Money and secrets

- **Never read, print, cat or log `.env` or `OPENROUTER_API_KEY`.** A live script runs as
  `node --env-file=<repo>/.env --import tsx <script>`, and its output is filtered with `grep -v sk-`.
- Every call is booked to `_ops.db` at the rate the account is charged. The ledger resumes with
  the town, so a restart never resets a budget.
- Guards: daily budget, lifetime cap, rate tripwire, projection alert, provider mix. Three stop
  the minds and leave the town serving; two only speak.

## Production

The box this repo sits on **is** production: nginx fronts `127.0.0.1:8090`, container `town`.
It is read-only to you. **Never start, stop or rebuild the production town without the owner
saying go.** Rehearsals run on 8099 with admin on 8799.

## Writing

Plain modern English everywhere a person will read it, including a mind's prompt and the town's
own paper. No captions, no semicolons, no em dashes. Comments default to none and cap at two
lines; write one only for a constraint the code cannot show.
