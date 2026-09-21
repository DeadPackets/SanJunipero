# Living Town SWE TODO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Respect the session's delegation rules. A reference to a skill is not user authorization to deploy.

**Goal:** Make San Junipero an understandable, watchable living town whose residents remember intentions, act consistently, develop relationships and leave genuine consequences.

**Architecture:** Complete the existing hybrid of generative minds and deterministic physical execution. Reuse plans, memory, the event log, arbiter, narrator and director. Repair their boundaries and verify a bounded venue prototype. Jev adoption and new viewing designs are deferred.

**Tech Stack:** TypeScript, Node.js >=24, pnpm 11.7.0, SQLite/better-sqlite3, Zod, Vitest, React, Three.js, Vite, Biome and ESLint.

**Spec:** [Approved system audit](../../reviews/2026-09-21-system-audit.md). Read its [independent corrections](../../reviews/2026-09-21-audit-skeptic.md) before implementation. The owner approved the audit recommendations and requested this saved engineering plan. Implementation and bounded experiments are recorded below. Final integration checks and release preparation remain open.

## V3 execution override — 2026-09-21

The owner now authorizes local end-to-end implementation and refactoring, with tests and measured results taking priority over backward compatibility. Production must remain unchanged. New OpenRouter spending across all local runs and agents has a hard combined ceiling of $100.

- Branch: `codex/sanjunipero-v3`, existing isolated worktree. Baseline checkpoint: `dc1df669`.
- Backward compatibility, legacy schema adapters and binary rollback requirements are removed. Preserve source audit evidence and live production data, but prefer a clean v3 local state over migration scaffolding.
- V3 viewing prototypes, V4's new presentation integration, R2's comparative viewing experiment, J1 and J2 are DEFERRED. Existing UI fixes, truthful current-scene context, transcript delivery, keepsakes and frontend performance remain in scope. Jev is available through OpenRouter; adoption is still deferred.
- Add S1: investigate Halim's current production inactivity read-only, reproduce the responsible behavior locally, and repair a confirmed cause. Standing still alone is not evidence of a model stall.
- Add S2: measure whether streaming improves time to useful visible output. Evaluate complete validated fields and provider timing before changing the request contract; never execute partial JSON or turn unvalidated tokens into world facts.
- Paid calls are root-controlled only. Workers use fake providers unless assigned a written sub-budget. Five completed root-controlled local runs booked $1.1424164895 in total, with no unsettled holds. The $100 ceiling was not approached. No further paid run is queued. Provider-invoice finality is not inferred from the local ledger.

## Global constraints

- “Physics, never outcomes.” Residents choose their goals, relationships, participation and responses. A reminder cannot force compliance. No fabricated events, dialogue, private knowledge or narrator-authored motives.
- Keep Three.js, the authoritative event log, deterministic execution, existing plan pump and bounded effect language. No new agent framework, parallel planner, general economy, generated executable code or worker fleet.
- Preserve approved warm-paper colors, category icons, pixel balloons and town art. New presentation choices get three throwaway previews using the same recorded events before integration.
- Work locally. Do not deploy, reset production, alter live settings, buy services or run an unbounded paid experiment as part of this plan. Do not read or print `.env` or credentials. No backup bucket is required.
- V3 may replace local schemas and contracts. Production history is read-only; do not rewrite it to imply that a new interpretation was always true. Historical compatibility is not a release requirement.

## Start here

Workspace: `/Users/deadpackets/workspace/SanJunipero/.worktrees/interiors-redesign`, branch `codex/sanjunipero-v3`. The main checkout contains unrelated work. Baseline `dc1df669` preserves earlier frontend, gateway and usage-meter changes.

Local preview: `http://127.0.0.1:8774/`, scripted minds. Production is a separate remote town. The preview is managed by `local.sanjunipero.interiors`; its launcher lives at the main checkout's `data/local-preview/serve.mjs`. Build before a local restart because the gateway caches the page shell.

```sh
git status --short
git branch --show-current
npm run -s typecheck
```

Status vocabulary: `OPEN`, `IN PROGRESS`, `IMPLEMENTED / VERIFY`, `DONE`, `EXPERIMENT / CONDITIONAL`. Move an item to DONE only when its listed check passes and evidence is recorded beside it. Commit only the files belonging to the completed item.

## Execution board

| Component | IDs | Current status | Depends on | Result |
|---|---|---|---|---|
| Operations and cost controls | O1–O4 | LOCALLY VERIFIED | None | Shared reservations, safe stop, recovery evidence |
| Engine and physical reach | P1–P2 | LOCALLY VERIFIED | None | Room reach, work duration and scripted food baseline |
| Minds, memory and commitments | M1–M6 | LOCALLY VERIFIED | M2/M3 depend on M1; M3 uses P1 | Offline continuity plus successful copy-only reflection probe |
| Culture, knowledge and social laws | C1–C3 | DONE | C2 uses M1/M4 | Evidence-backed culture and voluntary agreements |
| Gateway and scene transport | G1–G2 | LOCALLY VERIFIED | None | Scene/transcript join, reconnect and historical cutoff |
| Frontend, controls and performance | V1–V4 | V1/V2 IMPLEMENTED, PARTLY OBSERVED; V3/V4 DEFERRED | V2 uses G2 | Layout verified; listening and paired performance remain unmeasured |
| Narration, journal and keepsakes | N1–N2 | IMPLEMENTED / LOCAL CHECKS | M1, C1/C2, G2 | Source-linked context and run-scoped return cursor |
| Arbiter, Forge and functional venues | F1–F3 | F1 REJECTED TRIAL; F2 PROTOTYPE VERIFIED; F3 VISUALLY VERIFIED | O1/O2, P1, M1/M3 | Existing reasoning retained; autonomous shop adoption unproven |
| Jev evaluation | J1–J2 | DEFERRED | O1/O3, M3, R1 baseline | No adapter/adoption trial; default unchanged |
| Integration, rehearsal and release | R1–R3 | R1 VERIFIED; R2 OFFLINE ONLY; R3 OPEN | Relevant components above | Real local day complete; final suite/release and human checks pending |

Execution waves:

1. Inventory current changes, then O1/O2, P1, M1, M4 and G1. Check each independently; coordinate shared files.
2. M2/M3/M5/M6, C1/C2/C3, G2, P2 and V1/V2. Check state, privacy, reconnect and ordinary execution together.
3. N1 and N2 within the approved presentation. V3/V4 presentation comparisons and integration are deferred.
4. R1 establishes the repaired baseline. F1–F3 use bounded experiments; J1/J2 remain deferred.
5. O3/O4 and R2/R3 finish lifecycle, growth and release readiness. Production promotion remains a separate concrete action.

Do not run a test suite concurrently with a live rehearsal. O1 and G1 both touch `gateway/server.ts` or `liveWorld.ts` through integration; M1–M6 share runtime/reflection files. Assign one owner at a time to each shared file, even when independent tests run in parallel.

## Engineering workflow for each item

1. Add the listed regression or fixture and run it before changing behavior. Confirm it fails for the diagnosed reason, not a missing dependency.
2. Implement the smallest change in the named files. Update only affected callers and contracts.
3. Run that item's tests plus root typecheck when crossing package boundaries. Record commands and results in this document.
4. Review the diff against the approved audit, then make one focused commit. For visual work, record browser evidence before marking DONE.

Commands, from the worktree root:

```sh
npx vitest run <the-test-paths-listed-under-the-item> --maxWorkers=2 --silent=true
npm run -s typecheck
npx biome format --write <changed-source-files>
node --max-old-space-size=6144 node_modules/eslint/bin/eslint.js <changed-package>
git diff --check
```

The angle-bracket arguments above denote the explicit paths under each item, not a shell command to paste unchanged. Full integration uses `pnpm check`, which includes `packages/live` and `packages/town`.

## O. Operations and cost controls

### O1 — Atomic town-wide spending reservations

Status: IMPLEMENTED / VERIFIED LOCALLY. Integration commit deferred to root. Priority: first wave.

Files: modify `packages/llm/src/callLog.ts`, `packages/llm/src/rails.ts`, `packages/live/src/liveWorld.ts`, `packages/live/src/discoveryArt.ts`, `packages/live/src/castArt.ts`. Tests: extend `packages/llm/src/rails.test.ts`, `packages/live/src/liveWorld.test.ts`; create `packages/llm/src/budgetReservations.test.ts`.

- [x] Reproduce two callers each reserving $0.75 against one $1 town ceiling. Include a held image commission as a third caller and assert the total admitted allowance never exceeds $1.
- [x] Check global lifetime, global rolling-day and caller allowance in the same SQLite reservation transaction. Sum unsettled reservations as well as recorded charges; make caller rails sub-limits, not separate copies of the town balance.
- [x] Route image and text calls through that authority. Book accepted provider charges once, release failed unused reservations once, and reconcile actual price differences explicitly. Cancellation must not erase a charge already incurred.
- [x] Verify concurrent reservation, timeout, cancellation, duplicate reconciliation, restart and UTC rolling-window boundaries using fake providers. Check that the public meter never exposes reservation internals or secrets (root-owned DTO regressions).

Evidence: O1–O3 combined fake-provider run: 268 tests passed in 11 files. Subsequent admission-price follow-up: 140 LLM tests passed in four files. Full typecheck and focused lint passed; later concurrent integration errors are tracked by root. Private reports are in `.superpowers/sdd/2026-09-21-living-town-swe-todo/O1-report.md`.

Post-rehearsal follow-up: 224 tests passed in eight files, including all 14 new budget/status/startup regressions and the strict response-schema gate. Invalid schemas now fail before reservation/dispatch, keyed by schema identity rather than caller. Root owns the current workspace typecheck.

The operations database is the sole town authority. Unknown dispatched charges retain uncertain reservations across restart; only authoritative reconciliation can clear them. Luna admission bounds use serialized prompt/schema UTF-8 bytes plus 1024, enforced output caps, and $1/M input + $3.6/M output across current listed tiers. Historical actual rows and billing estimates are unchanged. Image/review reservations are estimates ($0.045/$0.0055), and unexpected actual overruns remain recorded and alerted; no provider-invoice guarantee is claimed.

- [ ] Root integration commit after final checks. Worker commits were explicitly prohibited.

Original proposed internal contract, implemented alongside the existing ledger rather than as a second database:

```ts
type SpendAllowance = {
  caller: string
  estimatedUsd: number
  lifetimeLimitUsd: number
  rollingDayLimitUsd: number
  callerRollingDayLimitUsd: number
}
// One transaction: recorded spend + outstanding reservations + estimate <= every limit.
// Reconciliation is keyed by the reservation's existing stable database ID.
```

### O2 — Forge cancellation and database lifetime

Status: IMPLEMENTED / VERIFIED LOCALLY. Integration commit deferred to root. Files: `packages/live/src/{liveWorld,discoveryArt,castArt}.ts`, `packages/forge/src/{imageClient,characterCommission}.ts`. Tests: existing `liveWorld.test.ts`, `discoveryArt.test.ts`, `castArt.test.ts`, `packages/forge/src/imageClient.test.ts`.

- [x] Hold a fake image request open, start shutdown and attempt to enqueue another commission. Check that no new request starts.
- [x] Pass the town stop signal through image work. Stop queue admission first; drain or cancel in-flight work within the existing shutdown deadline before closing asset, world and operations stores.
- [x] Retain legitimate late billing and prevent late writes to closed databases. Exercise both abort-respecting and abort-ignoring fake providers.
- [x] Verify shutdown finishes, no unhandled rejection occurs and restart can use an already completed asset.

Evidence: abort-respecting and abort-ignoring fake image calls, late charge before store close, closed queue admission, no late codex writes, and existing-asset reuse are covered in the combined run. If a provider ignores cancellation forever, the existing bounded stop reports failure and keeps stores open; it does not erase unknown billing or force-close a live writer. Report: `O2-report.md` in the private execution ledger.

- [x] Verify startup cleanup: preflight/embedder failure closes live initialization handles; cast-factory/attachment failure stops pacing and closes the world store/database. Four regressions pass in the post-rehearsal 224-test run. If cast cancellation fails to settle, stores remain open for live writers; root owns the standalone runner's 20-second exit grace.

- [ ] Root integration commit after final checks. Lifecycle and art appearance are documented separately; shared worker files remain uncommitted.

### O3 — Honest mind health and bounded art retries

Status: IMPLEMENTED / VERIFIED LOCALLY, including the admission-status follow-up. Files: `packages/live/src/liveWorld.ts`, discovery/cast watchers, `packages/gateway/src/{degraded,adminOps,publicUsage}.ts`, `packages/shared/src/publicUsage.ts`, `packages/web/src/stage/UsageMeter.tsx`. Extend corresponding tests.

- [x] Distinguish active, delayed, budget-stopped and disabled/scripted minds. A running clock and HTTP 200 must not imply active inference; test each state with fake ledgers and provider delays.
- [x] Expose only a coarse public status and aggregate usage. Keep detailed caller failures and operator controls private. Preserve the public tracker already implemented locally.
- [x] Retry deferred art on one bounded timer in the existing process, using capped backoff and O1/O2. Prevent duplicate jobs and retries after stop; retries must not depend on a new birth or restart.
- [x] Verify caller rail recovery and global stop separately. Keep global hard stops latched for deliberate operator recovery; do not silently enable next-day auto-resume or raise budgets.

Evidence: healthy completed minds remain active while sleeping or doing long work. No completed call, latest failed call, or a pending mind request at least 60 seconds old means delayed. One 60-second art timer uses 60/120/240/480/960/1920/3600-second retry delays, capped at one hour. Recorded-spend global stops latch; caller rails recover independently. Root owns and verified public/gateway/web coarse status. Report: `O3-report.md`.

- [x] Verify admission status: the shared transaction emits a private global-refusal alert; status reports budget-stopped immediately and the first bridge callback latches cancellation before mind tick callbacks. Caller holds report delayed and recover through their existing cache; explicit client budget overrides do not latch a town stop. Uncertain exposure remains reserved. Disabled discovery art skips admission. All 14 guard/status/startup/rail/art follow-up regressions pass in the post-rehearsal run: 224 tests, eight files, 35.07 seconds.

### O4 — Crash boundaries and growth measurement

Status: IMPLEMENTED / VERIFIED WITH LOCAL FIXTURES. Files: `packages/live/src/liveWorld.ts`, `packages/arbiter/src/{adjudicate,codify}.ts`, runtime checkpoint persistence, `packages/gateway/src/{hub,server}.ts`. Create `packages/live/src/recoveryBoundaries.test.ts` and `scripts/audit-town-growth.ts`; modify runtime only when a failing check proves a gap.

- [x] Inject interruption after rule insertion, discovery publication, asset registration and runtime checkpoint writes using temporary databases. Check recovered rules, events and charges for omissions or duplicates.
- [x] Add idempotent recovery for reproduced gaps. Preserve raw history and existing snapshots; do not introduce distributed transactions or a new database service.
- [x] Record world cells, entities, database bytes, snapshot bytes, active rule roster tokens, path refusals and client decoded texture memory across growing local fixtures.
- [x] Keep the current population ceiling and viewer safeguards. Record the largest exercised fixture, not an unsupported capacity claim. Document local-disk durability as the existing accepted tradeoff.

Evidence: seven new crash-boundary tests plus all 63 liveWorld tests pass (70 total); recovery plus arbiter codify/adjudicate passes 109 tests. Tests reproduce lost discovery publication and missed art after restart, then verify durable pending payloads, direct world commit before acknowledgement, recipeId deduplication, expressive and craft recovery, one asset/charge, and rejection of runtime checkpoints ahead of the committed world. Existing history/snapshots remain intact; no runtime persistence change was needed.

Growth command: `pnpm exec tsx scripts/audit-town-growth.ts`. Four synthetic fixtures: 1,024–65,536 cells, 136–1,076 entities, at most 20 agents. Largest: world DB 462,848 bytes; arbiter DB 151,552 bytes; snapshot 230,303 JSON / 10,743 gzip bytes; 128 active rules ≈1,879 roster tokens; 64 image decodes total 67,108,864 RGBA bytes. Of 64 path queries, 49 returned capped partial routes and none returned null under the unchanged 6,000-node bound. Raw results: private `O4-growth.json`; assumptions and limitations: `O4-report.md`.

Decoded bytes measure RGBA storage for fixture assets resident together, excluding GPU copies, mipmaps and browser/Pixi overhead. This is not production-art browser-heap or viewer capacity evidence. Exception injection plus database reopen is not host power-failure testing. Existing local WAL/synchronous-NORMAL durability remains an accepted tradeoff; recent commits can be lost on power failure. Root integration commit remains deferred.

## P. Engine and physical world

### P1 — Consistent room-aware reach and transfer completion

Status: LOCAL VERIFIED / UNCOMMITTED. Files: `packages/engine/src/verbs/{index,common}.ts`, `packages/engine/src/{interiors,intent}.ts`. Tests: `packages/engine/src/{interiors,survival}.test.ts`; create `packages/engine/src/roomReach.test.ts`.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/P1-report.md`; 334 engine tests passed. Subsequent town/workspace typechecks passed after concurrent seams were resolved.


- [x] Add cases for indoor-to-outdoor giving at a doorway, taking food through a rear wall, outdoor stowing into a roofed room, and a recipient moving away before completion. Current code must fail these assertions.
- [x] Centralize room-aware reach for take/eat/stow and direct handoffs. Require entry for roofed room storage; preserve reachable open-air containers and same-room actions. Door-side handoffs across rooms are refused initially, matching `sameInterior`.
- [x] Recheck location and possession at completion. A remembered item ID does not bypass walls, and a previously valid target does not remain reachable after moving.
- [x] Verify same-room and outdoor positive controls, room capacity, walk-first chaining, theft of accessible property and replay. Theft remains a social consequence, not a physical impossibility.

### P2 — Expose actual work costs and preserve deliberate abstractions

Status: LOCAL VERIFIED; SCRIPTED FOOD BASELINE VERIFIED. Files: `packages/agents/src/prompt/rulesOfBeing.ts`, `packages/agents/src/runtime/agentRuntime.ts`, `packages/engine/src/verbs/{build,craft}.ts`, `packages/shared/src/config.ts`, relevant perception tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/P2-report.md`; 161 duration/reach tests passed. `foodHorizon.test.ts` adds two scripted residents over eight days: eight forage actions yield 25 berries; one planted crop yields three wheat; 17 meals consume eight berries, eight starter bread and one wheat. Needs decay is disabled in this arithmetic fixture; yields and crop growth use normal configuration. This is a measured workload baseline, not an autonomous food-policy comparison or survival-balance evidence. No resource balance changed.


- [x] Include effective work duration next to recipe materials and resumable progress in perception. Derive it from effective configuration, including law overrides, not library defaults.
- [x] Test the production-style 240-tick house versus 6,480-tick cottage, cooperative progress and interrupted work. Describe simulation time without assuming fixed wall-clock speed.
- [x] Keep current hunger, food abundance, stockless forest fallback, aging pace, no encumbrance and room-level furniture abstraction unchanged for the first comparison. Record source, production override and observed behavior separately.
- [x] Measure forage/farming/food use over the eight-day crop horizon in R2 (scripted arithmetic baseline; autonomous choice unmeasured). Change resource balance only if evidence identifies the desired choice it prevents; do not create starvation or hauling work to fill the stream.

## M. Minds, memory and commitments

### M1 — Give commitments identity and honest resolution

Status: LOCAL VERIFIED / UNCOMMITTED. Files: `packages/agents/src/memory/{schema,ties}.ts`, `packages/agents/src/scene/{scene,sceneLlm,coordinator}.ts`, `packages/agents/src/reflection.ts`, `packages/shared/src/bonds.ts`, `packages/gateway/src/bonds.ts`. Tests: ties, reflection, scene/coordinator, shared/gateway bonds tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/M1-report.md`; 287 focused tests and independently run gateway bond tests passed. M4 supersedes the early producer contract: only private reflection receives existing private tie IDs; shared closure cannot resolve them. No commit or public verified-fulfillment mechanism is claimed.


- [x] Open two promises to one person and settle only one by ID. Cross seven days with the other future promise pending. Assert it neither settles nor becomes `promise_broken`.
- [x] Extend existing tie deltas with explicit target identity and resolution. Reject missing/foreign/ambiguous settlement IDs instead of bulk settling by person and kind. Add nullable reminder time and source-event evidence without adding a quest store.
- [x] Stop automatic expiry of promises, debts, alliances and secrets. Preserve deliberate letting go and separately justified affect decay. Old rows stay readable; historical expiry events keep their original provenance and are not reclassified as new verified breaches.
- [x] Update scene/reflection producers and public labels. A resident considering a promise settled is a belief unless supported by the relevant event; a timer alone proves neither fulfillment nor betrayal.
- [x] Verify migration twice, reopen, specific settlement, duplicate restatement and legacy decoding. Commit only after affected schema, producer and consumer tests pass.

Proposed addition to the existing mutation schema; reuse the existing person/kind/text fields:

```ts
type TieResolution = 'fulfilled' | 'released' | 'broken'
type TieResolutionFields = {
  tieId?: number
  resolution?: TieResolution
  evidenceSeqs?: number[]
  remindAtTick?: number | null
}
// resolution requires a tieId owned by the acting mind.
// Legacy settled:true without an unambiguous target does not bulk-update rows.
```

Regression body for `ties.test.ts`, using its existing `store()` helper and the extended delta:

```ts
const ties = store()
ties.apply([
  { agentId: AMARA, personId: YUSUF, kind: 'promise', text: 'Bring a chair tomorrow.' },
  { agentId: AMARA, personId: YUSUF, kind: 'promise', text: 'Help with harvest next month.' },
], 0)
const chair = ties.open()[0]!
ties.apply([{
  agentId: AMARA, personId: YUSUF, kind: 'promise', text: chair.text,
  tieId: chair.id, resolution: 'fulfilled',
}], 1)
expect(ties.open().map(t => t.text)).toEqual(['Help with harvest next month.'])
expect(ties.letGo(7 * MINUTES_PER_DAY)).toEqual([])
```

### M2 — Preserve intentions through ordinary turns and night reflection

Status: LOCAL VERIFIED / UNCOMMITTED. Depends: M1. Files: `packages/agents/src/{reflection,personality}.ts`, `packages/agents/src/runtime/agentRuntime.ts`, `packages/agents/src/prompt/assemble.ts`. Tests: reflection, personality and runtime tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/M2-report.md`; 187 focused tests passed, including two quiet nights, reopened storage, absent counterparts, bounded selection and voluntary reminder reconsideration. The real day exposed a provider rejection of nested `oneOf`; revisions now serialize as supported `anyOf`. A copy-only production reflection probe then completed all ten reached calls without fallback. Conditional personality edits and new gist generation were not reached and are not claimed as live-tested; see `docs/reviews/2026-09-21-v3-model-probes.md`.


- [x] Test kin plus old and new promises, an absent counterpart, and a project with no progress today. Check the relevant unresolved intention reaches the next decision.
- [x] Keep kin outside the actionable tie slots. Prioritize due/recent relevant unresolved commitments with a stable bounded selection; do not send the entire ledger every turn.
- [x] Pass previous goals into `summarizeDay`. Return explicit retain/update/resolve decisions; an omitted goal stays pending. Validate references against the previous goal strings and preserve state on malformed output or budget failure.
- [x] Feed optional reminders into the existing reconsideration clock. The resident may defer or abandon with a recorded decision; do not submit the promised action automatically.
- [x] Verify an uneventful day, multiple nights, empty generated standing list and restart. Check old memories remain intact while current goals stay bounded.

Proposed reflection result addition, using exact previous text as the reference until evidence requires a goal table:

```ts
type GoalRevision =
  | { previous: string; decision: 'retain' }
  | { previous: string; decision: 'update'; text: string }
  | { previous: string; decision: 'resolve'; reason: string; evidenceSeqs: number[] }
// Unknown previous references are rejected. Unmentioned prior goals are retained.
```

### M3 — Hand off conversation to the existing physical plan

Status: LOCAL VERIFIED / UNCOMMITTED. Depends: M1/M2/P1. Files: `packages/agents/src/scene/{scene,sceneLlm,coordinator}.ts`, `packages/agents/src/runtime/agentRuntime.ts`, existing turn/intent schemas and checkpoint serializers. Tests: scene LLM, coordinator and runtime suites.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/M3-report.md`; 452 affected tests passed. Later R1 found and fixed the running-plan restart marker; both queued-before-start and already-running restart checks pass. Interleaved speech no longer overwrites a physical completion target. See `docs/reviews/2026-09-21-continuity-rehearsal.md`.

- [x] Add a scene-exit fixture where a resident chooses a legal next action and another where they decline to act. Verify both choices survive closure and restart without duplicate submission.
- [x] Add an optional exit plan/reminder using the ordinary turn's existing intent schema. Apply it only to the authoring resident through the existing plan pump. Reject stale targets and invalid parameters through normal engine validation.
- [x] Keep current work and queued plans running during conversation. Do not confuse the existing walking stop with a blanket work lock; explicit replacement must come from the mind.
- [x] Make subsequent speech read the same committed plan and actual action status. A refusal or interruption becomes perceptible evidence; saying “done” does not create completion.
- [x] Verify timeout, emergency exit, participant departure, moving target, failed action and resumed scene. No new per-tick LLM loop or second scheduler.

### M4 — Public scene summaries must exclude private asides

Status: LOCAL VERIFIED / UNCOMMITTED. Files: `packages/agents/src/scene/{sceneLlm,coordinator,scene}.ts`; tests: scene LLM/coordinator tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/M4-report.md`; 197 tests passed. R1 additionally checks the private-aside sentinel is absent from public closure input and reconnect transcripts.


- [x] Put a unique secret only in a private aside. Capture the public closure request with a fake LLM and assert the secret is absent from its input.
- [x] Build the public summary input from spoken text, public gestures and witnessed events only. Keep turn-level `threadFor` filtering and each resident's own private recall intact.
- [x] Prevent shared summary memory and public events from acquiring hidden-aside content through an intermediate field. Do not add one extra summary model call per resident.
- [x] Check public conversation summaries still reach legitimate participants and overhearers in the same room, and private asides remain available only through their existing permitted paths.

### M5 — Make stored memory useful without adding another memory layer

Status: LOCAL VERIFIED; DETERMINISTIC DECISION FIXTURE VERIFIED. Files: `packages/agents/src/{reflection,personality}.ts`, `packages/agents/src/memory/{retrieve,store}.ts`, `packages/agents/src/prompt/assemble.ts`. Tests: reflection, retrieve and personality tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/M5-report.md`; 195 focused tests passed, followed by the combined 287-test run. The old source ID reaches an actual assembled prompt, quiet days do not force edits, and fallback survives. A later retrieval fixture now feeds an 18-day source through the assembled prompt and real strict turn decoder to a deliberate fake decision: it chooses the requested bench with that memory and the river when only that source is removed. Its 20-test suite passes. This verifies conditional decision plumbing, not autonomous model behavior.

- [x] Trace retrieval IDs for one old formative event and one unresolved obligation amid recent similar memories. Keep the default bounded context; record whether failure is candidate selection or prompt omission.
- [x] Remove the separate paid extracted-facts pass from normal reflection while it has no defined consumer. Retain its stored rows and migration compatibility. Keep scene/day generation that already feeds autobiography and personality.
- [x] Give unresolved obligations and selected formative source memories an explicit bounded retrieval path. Correct documentation that claims old autobiography is searched when only raw memories are queried.
- [x] Admit consequential witnessed events such as bereavement through the existing personality-edit gate. Preserve cooldowns, cited evidence and the option to make no change.
- [x] Verify an event older than seven days affects a later relevant decision fixture, a quiet day does not force a personality rewrite, and reflection failure still leaves the established fallback digest.

### M6 — Reconcile current identity and document inheritance

Status: LOCAL VERIFIED / UNCOMMITTED. Files: `packages/agents/src/runtime/agentRuntime.ts`, `packages/agents/src/live/{liveMinds,newborn,resolveCast}.ts`, `packages/agents/src/family/{derivePersona,memorySeed}.ts`, `packages/agents/src/prompt/assemble.ts`. Extend runtime, resolveCast, newborn and memorySeed tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/M6-report.md` and `docs/reviews/2026-09-21-identity-and-inheritance.md`. The final combined 287-test run and town typecheck passed. Both prompt types read body age across the configured adulthood boundary and runtime restart; newborn repair tests retain deterministic isolated seeding.

- [x] Advance a body from age twelve through the adult threshold. Assert ordinary and scene prompts both use current body age, before and after restart.
- [x] Derive current age from `ageDays` and the shared calendar helper; preserve authored backstory and initial persona as historical data.
- [x] Keep age-twelve birth and inherited seed traits as explicit abstractions. Learned culture initially travels through witnessed events, teaching and memory rather than copying private parental thoughts.
- [x] Prefer consequential dated household seed events over a window filled only by routine recent speech. Check isolation, deterministic ordering and identical birth/resume reconstruction. Do not expand the birth model into infant development.

## C. Culture, knowledge and social laws

### C1 — Detect actual co-presence and keep interpretations separate

Status: DONE, local and uncommitted. Files: `packages/arbiter/src/constructs.ts`, `packages/live/src/liveWorld.ts`, `packages/agents/src/runtime/agentRuntime.ts`, `packages/gateway/src/constructs.ts`. Tests: arbiter constructs/g11.constructs and `packages/live/src/constructs.test.ts`.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/C1-report.md`. The current six-file focused run passed 126 tests, including non-overlapping 06:00/10:00/14:00 visits, simultaneous controls, separate rooms, midnight, departure, scene evidence, stable legacy observations and unchanged world hash. Observer habit/custom prompt injection was removed; ordinary witnessed memory and resident-given names remain.

- [x] Reproduce the three non-overlapping daily visits from the audit. Add simultaneous positive control, separate rooms at one footprint, midnight crossing and arrival/departure cases.
- [x] Derive gatherings from overlapping presence in the same room/place or recorded scene participation. Remove raw daily traffic and most-speech-count as proof of shared ritual or deference.
- [x] Stop feeding observer habit assertions to every mind. Feed only witnessed/learned evidence through existing perception and memory; preserve resident-given names with their source utterance.
- [x] Allow multiple observed uses at a place and revise tentative classification when evidence changes. Keep old classifications as legacy observations rather than silently rewriting them.
- [x] Verify culture labels never alter authoritative world hashes, unknowing residents receive no new fact, and only evidenced shared attendance qualifies for a gathering.

### C2 — Ground voice, bonds and claims in the right evidence

Status: DONE, local and uncommitted. Depends: M1/M4. Files: `packages/agents/src/prompt/rulesOfBeing.ts`, `packages/shared/src/bonds.ts`, `packages/gateway/src/bonds.ts`, `packages/narrator/src/institutions.ts`; extend their tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/C2-report.md`. The current combined C2/C3 run passed 392 tests in 11 files. Present health, dated history, resident claims, speech-only bonds and inferred institutions now retain their distinct evidence status.

- [x] Replace “healthy now means healthy yesterday” with present-state grounding plus dated historical evidence. Test recovered illness without allowing invented current symptoms.
- [x] Remove blanket bans on invented sayings and wordplay. Retain anti-loop, factual and character grounding; compare repeated exchanges for new information, not a word-count quota.
- [x] Label speech-frequency bonds and inferred institutions as observations. A quarrel cannot become verified friendship solely because many lines were exchanged.
- [x] Check that residents can express a mistaken belief or lie while narration distinguishes the claim from world fact. Keep distinct character voices without inserting named plots or example sayings into all prompts.

### C3 — Voluntary councils and social enforcement

Status: DONE, local and uncommitted. Files: `packages/engine/src/socialLaws.ts`, `packages/agents/src/scene/{scene,coordinator,sceneLlm}.ts`, associated law compiler and prompt paths. Tests: engine socialLaws, scene and coordinator suites.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/C3-report.md`. The current combined 392-test run covers explicit reconvening, stale and guessed proposal rejection, support thresholds, abstention and social-rule compliance/violation. Replay retains past ratifications; the engine adds no automatic guard, punishment or relationship result.

- [x] Replace automatic next-day council conversion with an explicit resident choice to reopen a pending proposal. The pending record remains available, but an unrelated conversation keeps its original subject.
- [x] Require explicit support from at least one participant beyond the proposer, and more support than opposition. “Unsure” remains abstention. Record actual supporters and scope; do not call a room vote unanimous town consent.
- [x] Convert social-only `require_before`, `common` and `tithe` constraints into observable violations when no physical mechanism prevents the act. Keep walls, possessions, resource requirements and valid consent constraints authoritative.
- [x] Verify refusing, complying, violating and deliberately reconvening. Retain old ratification events on replay; new policy applies to new decisions. Show that no synthetic guard, punishment or relationship outcome appears automatically.

## G. Gateway and scene transport

### G1 — Complete scene state on join, restart and resync

Status: LOCALLY VERIFIED; final integration suite pending. Files: `packages/gateway/src/{scenes,server}.ts`, `packages/gateway/src/replay.test.ts`, `packages/web/src/state/worldStore.ts`. Tests: scenes/server/replay/worldStore suites.

Execution evidence: Implemented in 800bbddf and 155417f7. Join/restart/replay/live/static scrub restore scene context; independent review found and fixed future-scene leakage and pending-scrub races. Latest root gateway/replay/hub: 31 tests pass.

- [x] Join halfway through an indoor conversation and restart the gateway while it remains open. Assert the first usable scene state contains the correct cast, room context and open status.
- [x] Extend the existing relay with snapshot/prime operations and initialize it from retained relevant events, including a scene opened before midnight. Do not scan all world history per viewer.
- [x] Send open scene frames before the associated director context on hello and live resync. Replay restores the scene at its requested starting tick without sending later events.
- [x] Verify close, participant changes, reconnect and return-to-live. Remove stale open scenes and avoid duplicate close notifications.

Proposed relay API, replacing the callable return with one small state owner:

```ts
type SceneRelay = {
  fold(events: readonly SimEvent[]): ServerScene[]
  snapshot(): ServerScene[]
  prime(events: readonly SimEvent[]): void
}
// prime is side-effect-free outside the relay; it never rebroadcasts historical events.
```

### G2 — Bounded transcript independent of camera visibility

Status: LOCALLY VERIFIED; final integration suite pending. Depends: G1. Files: `packages/gateway/src/{scenes,server}.ts`, `packages/shared/src` existing server-frame schema, `packages/web/src/state/worldStore.ts`, `packages/web/src/stage/LivingScene.tsx`. Create `packages/gateway/src/sceneTranscript.test.ts`.

Execution evidence: Implemented in 800bbddf. Public transcripts use seq IDs, 100 lines per scene and 8 client scenes, explicit catch-up, historical cutoff, closed-scene endpoint. Gateway/store tests pass. Root observed an 11-line conversation after late camera arrival in the isolated real-day viewer; see `docs/reviews/2026-09-21-v3-viewer-verification.md`.

- [x] Capture the production-shaped fixture of twelve lines in thirteen ticks. Join after line six; reconnect after line ten. Assert chronological, deduplicated delivery with no future lines in replay.
- [x] Use event sequence IDs for identity and simulation ticks for time. Retain at most 100 recent public lines per scene in the client; hydrate a requested scene from the existing event store and disclose truncation.
- [x] Send initial recent lines with an explicit catch-up designation, separate from a newly arriving utterance. Exclude asides and avoid duplicating `agent_spoke` plus `scene_line` for the same utterance.
- [x] Verify room entry after speech, offscreen arrivals, bounded memory and closed-scene access. Camera anchoring controls display, never whether received dialogue is stored.

Proposed shared display record:

```ts
type SceneTranscriptLine = {
  seq: number
  tick: number
  sceneId: string
  speakerId: string
  text: string
}
type TranscriptDelivery = {
  lines: SceneTranscriptLine[]
  catchup: boolean
  truncated: boolean
}
```

## V. Frontend, controls and performance

### V1 — Finish verification of existing local changes

Status: IMPLEMENTED; layout and automated lifecycle verified; listening/paired profiling pending. Files already changed: `packages/web/src/{App.tsx,paper/Paper.tsx,paper/game/game.css}`, stage DayBar/UsageMeter/KeyMap/useSafeInsets/useStageKeys, render bootAssets/StageMount/three files, ui chrome/sound/storage/firstFrame, state worldStore, gateway publicUsage/server and shared publicUsage.

- [x] Review the existing diff rather than rebuilding it. Verify desktop dock-only journal and a mobile edge-attached drawer with Close/Escape/focus return; no undocked mode or obsolete stored preference survives.
- [x] Check exterior/interior camera attachments, journal open/close, help title “Controls”, and the public usage expansion at 390×844, 1280×800 and 1440×900. Check no overlap, hidden controls or horizontal scroll.
- [x] Verify first load in the browser and cached load, empty catalog, failed asset/retry and late assets in focused boot/lifecycle tests. The loading screen covers current assets only; future assets still arrive incrementally.
- [ ] Listen to dry calm, wind, rain, fire and indoor scenes. Confirm no constant static in calm dry weather, no clicks on mute/unmute and hidden tabs suspend audio. Automated audio tests do not replace this listening check.
- [x] Build and inspect the visible page. A desktop sample showed 1,697 Three.js draw calls and about 82 FPS on the animation-cadence overlay; this is not GPU frame time.
- [ ] Measure matched before/after frame timing, CPU, texture memory and power. No paired battery or battery-life improvement was measured; structural work removal alone is not that evidence.

Evidence: `docs/reviews/2026-09-21-v3-viewer-verification.md`. Browser checks cover desktop dock, mobile close/focus return, no horizontal overflow, Controls, interior camera attachment and public usage. Automated tests cover the asset failure/hidden lifecycle and sound gating; those do not substitute for listening.

```sh
npm --prefix packages/web run build
npx vitest run packages/web/src/render/bootAssets.test.ts packages/web/src/stage/safeInsetsObserver.test.ts packages/web/src/ui/sound.test.ts packages/gateway/src/publicUsage.test.ts --maxWorkers=2 --silent=true
```

### V2 — Moving targets and compact readable balloons

Status: IMPLEMENTED / AUTOMATED CHECKS VERIFIED; final visual details remain open. Depends: G2 for speech scheduling. Files: `packages/web/src/render/{hitShapes,pixelBubbles,StageMount}.ts`, `packages/web/src/render/three/world.ts`, `packages/web/src/stage/Nameplate.tsx`, `packages/web/src/ui/harmony.css`. Extend hitShapes tests; create `packages/web/src/render/pixelBubbles.test.ts`.

- [x] Reproduce narrow click targets while residents move and a nameplate whose screen anchor changes. Use a generous screen-space target with deterministic nearest-person selection, stable hover and a clickable name affordance; preserve building clicks and drag-to-pan.
- [x] Fit bubble width to measured text lines with balanced padding for short and wrapped text. Measure after fonts load and on message/size changes, not each animation frame. Keep reserved typewriter dimensions to prevent layout jumps.
- [x] Preserve the approved thought/speech distinction. New utterances can appear immediately while older lines remain in the transcript; do not present stale queued words as live or require simulation time to wait for reading.
- [ ] Verify short, long, multiline and mobile text, crowded residents, moving selection, indoor anchors and reduced motion. Check screenshots with the actual font and town, not a DOM-size assertion alone.

Evidence: hit selection and bubble layout/preemption regressions pass. Moving residents have a 44 px minimum target, stable pointer-down identity and clickable name affordance. Width is measured before entrance scaling and only after relevant changes; reveal is capped at 300 ms. See `docs/reviews/2026-09-21-v3-viewer-verification.md` for rebuilt desktop moving-selection, multiline balloon, interior and mobile observations. The complete visual matrix above is not claimed.

### V3 — Three comparable viewing prototypes

Status: DEFERRED by the v3 execution override. The original experiment below is retained for later; it is not a current completion gate.

- [ ] Use one ten-minute recorded event sequence for all three options: wide town with compact context, living documentary focused on a scene, and clearly labeled recorded chapters with a live-return control.
- [ ] Keep the approved palette, icons and balloons. Show who is involved, a supported present action, one relevant prior fact and an unresolved intention only when the source provides it.
- [ ] Include quiet work, a conversation, refusal/interruption, a completed consequence and no-story fallback. Fixture labels must disclose any synthetic test event; do not inject it into the actual town.
- [ ] Present the three views for selection and record the chosen component/layout mix here. Check passive 480px-wide video readability as well as interactive desktop/mobile use.

### V4 — Integrate the chosen presentation and one performance pass

Status: DEFERRED by the v3 execution override. The original experiment below is retained for later; it is not a current completion gate.

- [ ] Integrate the selected hierarchy for ordinary viewing and broadcast. A passive watcher receives enough context without opening the journal; controls remain compact for interactive use.
- [ ] Preserve camera hold/hysteresis/quiet beats. Do not add a competing director, automatic drama, repeated narration calls or forced resident activity.
- [ ] Eliminate per-frame DOM measurement and avoid rebuilding immutable world geometry for clock-only changes. Bound transcript/render work and pause hidden rendering through existing lifecycle hooks.
- [ ] Compare the same camera route, viewport and weather before/after. Record visible frame timing and interaction results; check dock/interior transitions, reconnect, replay, reduced motion and source-to-caption accuracy.

## N. Narration, journal and return value

### N1 — Source-linked context across days

Status: LOCALLY VERIFIED; final integration suite pending. Depends: M1/C1/C2/G2. Files: `packages/gateway/src/{threads,stakes}.ts`, `packages/narrator/src/{chronicle,canon,institutions}.ts`, `packages/shared/src/threads.ts`, existing web story models. Extend their tests.

- [x] Use one pair with two unrelated promises and a later callback. Check that cast overlap does not merge the obligations into one claimed causal story.
- [x] Attach existing commitment identity or explicit source events when available. Retain thread heat for editorial ranking, but separate an inferred thread from a verified project or obligation.
- [x] Give daily narration the small relevant prior source packet for a real callback. Existing event IDs must support the claim, not merely exist in the database; unknown outcomes remain unknown.
- [x] Verify quoted intention versus action, delayed versus broken promise, observed companionship versus friendship, and one cross-day consequence. No narrator interpretation enters minds as a new fact.

### N2 — Return summary, keepsakes and meaningful firsts

Status: IMPLEMENTED / VERIFIED LOCALLY; simultaneous-popup observation remains open. Depends: N1/C1; uses existing approved presentation while V4 is deferred. Files: narrator `firsts.ts`, `semanticFirsts.ts`, `moments.ts`; web `stage/Keepsake.tsx`, journal game components and storage; gateway moments/discoveries endpoints.

- [x] Store a local last-seen event cursor for a returning viewer and summarize supported changes since that point. Separate newly observed facts from a resident's stated intention and tentative interpretation.
- [x] Reuse keepsakes for actual firsts, shared work and resident-named customs. Link each to events or a replay; distinguish method discovered, first successful use and building completed.
- [x] Keep animations brief, dismissible and reduced-motion aware. Deduplicate on reconnect; replay cannot award a false “just happened” live popup.
- [x] Verify empty return intervals, bounded long-absence summaries and fresh-world cursor invalidation even when the new world sequence is higher.
- [ ] Observe several simultaneous queued milestones in the browser; queue behavior must remain bounded and dismissible. No login streaks, mandatory chores or audience voting were added.

Deviation: the proposed “first later corrected” acceptance is dropped from current scope. No correction-event protocol or implemented popup retraction is claimed; adding a speculative correction framework is not justified by this run. Source validation and seeded-event filtering remain required.

Evidence: run identity persists in observer metadata and the existing snapshot. Local visit cursors include that identity; unknown/different runs start fresh while same-run reconnect preserves the visit boundary. Catch-up, storage, socket, observer and world-store regressions pass. Firsts retain source/replay links; seeded buildings no longer become new construction achievements. Keepsakes retain bounded, dismissible, reduced-motion-aware live notices. Browser layout/transcript evidence is in `docs/reviews/2026-09-21-v3-viewer-verification.md`; human return behavior is unmeasured.

## F. Arbiter, Art Forge and useful places

### F1 — Routine action routing before expensive invention

Status: DONE; lower-reasoning trial rejected, existing routing corrected. Depends: O1/O3/P1. Files: `packages/arbiter/src/{adjudicate,expressive,sanity,codify}.ts`, `packages/agents/src/runtime/arbiterSeam.ts`, `packages/llm/src/pins.ts`; extend adjudication/codification fixtures.

- [x] Save existing wood-stacking and bridge-repair requests as private local fixtures with their observed rulings. Check whether existing verbs/precedents should resolve them before a novel ruling.
- [x] Improve only the demonstrated mapping or affordance gap. Preserve exact and semantic caches, effect validation, provenance and safe refusal; do not add another generic cache.
- [x] Compare a lower-reasoning first pass on recorded cases only after offline routing checks. Escalate genuinely unresolved cases, retain a bounded timeout and show delay/failure honestly.
- [x] Record validity, latency, cost and changed outcomes by case. Keep current model settings unless the comparison preserves useful rulings and lowers whole-path cost or delay.

Evidence: `docs/reviews/2026-09-21-v3-model-probes.md`. Six real paired calls cost $0.0125340336; all parsed, but low reasoning lost one useful stock-transfer ruling. Current xhigh remains. Source-target mapping/cache regressions and the real-day arbiter path pass. Cosmetic repair is not counted as physical repair.

### F2 — One functional venue with actual transfers

Status: PROTOTYPE VERIFIED; autonomous adoption remains unproven. Depends: M1/M3/P1/F1. First prototype: a shop using existing goods, ownership, storage and voluntary exchange. Use a local fixture; do not force a resident to open it in production.

Files: `packages/engine/src/verbs/index.ts`, relevant item/intent schemas, `packages/arbiter/src/{verdict,codify}.ts`, `packages/agents/src/prompt/rulesOfBeing.ts`. Create `packages/town/src/venueLoop.test.ts`.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/F2-report.md`. Three fake-only venue tests passed. They prove spoken agreement versus physical transfer, fulfillment evidence, refusal, accessible theft, interruption and replay/reload. **Real residents have not yet voluntarily chosen the shop affordance.** The fixture scripts choices and cannot support an adoption claim.

- [x] Exercise one offered item/quantity, an acceptance or refusal, the physical transfer and a later remembered consequence. A spoken sale alone must not move goods or settle an obligation.
- [x] Extend the existing give/transfer path for a requested quantity if the fixture proves whole-stack transfer blocks it. Preserve stock, ownership, source identity and failure on insufficient quantity. The quantity-one fixture did not prove a verb change was needed.
- [x] Link the voluntary agreement to M1 commitment evidence. Preserve refusal, theft of accessible property and unfulfilled exchanges; do not invent currency, prices, shopkeeper schedules or guaranteed customers.
- [x] Check completed and interrupted exchanges through reload/replay with the scripted venue fixture.
- [ ] Observe voluntary shop adoption by real residents in a future bounded run. No autonomous shop choice was established by the completed day; generalize only a demonstrated missing operation.

Novel consumables are a follow-on only when an observed invention needs them. Reuse bounded item-use effects and existing food/water rules; a new name or picture never grants hydration, nutrition or intoxication implicitly.

### F3 — Building design recipe and Forge lifecycle

Status: VERIFIED LOCALLY AND VISUALLY; final integration suite pending. Depends: O1/O2/F2. Files: `packages/forge/src/buildingMaterials.ts`, `packages/live/src/discoveryCommission.ts`, `packages/shared/src/interiorMeta.ts`, `packages/web/src/render/three/{structures,interiorRoom,materials}.ts`, corresponding tests.

Evidence: `.superpowers/sdd/2026-09-21-living-town-swe-todo/F3-report.md`. Six focused files pass 71 tests, including the southeast-facing door/window-mask regression. `packages/web/building-review.html` is the smallest existing-preview-style fixture: it renders the three real 3 × 3 exteriors and their `buildInteriorRoom` results with day/night lighting. Interior mode is explicitly labeled as an awake, occupied lighting state; it does not render resident sprites or test occupancy detection. Root visually checked all three home, bakery/shop and civic/meeting recipes in day/night and exterior/interior modes, with zero console errors.

- [x] Define a small validated appearance recipe for footprint-compatible facade, roof, door and window placement. Separate it from physical affordances; the image model supplies surface maps, not authoritative geometry.
- [x] Build three throwaway examples using the same footprint: personal home, public shop and public meeting room. Keep approved resident styles and local lighting/window occupancy behavior.
- [x] Match visible door, collision footprint, room entrance and window emission masks from one recipe. Unknown/failed art uses a coherent fallback without changing usable physics.
- [x] Verify generated materials, occupancy lights, day/night transitions, indoor/outdoor identity, late asset arrival and O2 shutdown. Select and integrate the bounded recipe after visual review; do not generate arbitrary mesh code.

Root visual evidence: same 3×3 home/shop/meeting recipes checked in exterior and interior at noon and night; no browser console errors. Night fixture explicitly assumes awake occupants and reuses actual room-light values. Runtime occupancy, late assets and shutdown are covered separately by tests; no new paid image-generation campaign was run.

## J. Jev evaluation and adoption decision

### J1 — Shadow evaluation of one bounded judgment

Status: DEFERRED by the v3 execution override. The original experiment below is retained for later; it is not a current completion gate.

- [ ] Use recorded resident-local states to ask whether an existing plan needs reconsideration. Include routine continuation, urgent interruption, ambiguity, unavailable targets, omitted opportunities and quoted hostile instructions.
- [ ] Implement a separate typed adapter with version pinning, deadline, cancellation and the shared ledger. Keep arithmetic, time, reach and legality in code; do not point the existing free-form turn contract at Jev.
- [ ] Run mocked adapter tests first. A real provider comparison requires available credentials and an explicit run manifest with model version, fixture count and a dollar ceiling within existing project budgets. No silent paid default.
- [ ] Compare against the current deterministic wake decision and ordinary model baseline. Measure incorrect continuation, unnecessary reconsideration, latency from the deployment region, input/candidate generation cost and fallback behavior.

Proposed narrow output:

```ts
type ReconsiderDecision = {
  choice: 'continue' | 'reconsider' | 'uncertain'
  modelVersion: string
  probabilities: Record<'continue' | 'reconsider' | 'uncertain', number>
}
// Uncertain/error uses the existing path. Provider scores do not bypass physical validation.
```

### J2 — Local hybrid trial, with explicit rejection criteria

Status: DEFERRED by the v3 execution override. The original experiment below is retained for later; it is not a current completion gate.

- [ ] Enable one local routing switch, default off. Preserve generative planning, invention, reflection and speech; record exactly which calls Jev replaces and which it adds.
- [ ] Supply only knowledge the resident owns. When choosing actions later, choose whole validated action/target/object candidates and preserve a deliberation escape; do not compose unrelated parameter choices.
- [ ] Compare the same scenario family with the ordinary controller. Reject adoption if it adds a net call without useful benefit, misses meaningful interruptions, flattens choices, or blocks new ideas.
- [ ] Record an adopt/reject decision with total cost and behavior evidence. A low per-token price alone is not a pass, and passing a shadow classifier does not authorize replacing the whole resident brain.

## R. Integration, evaluation and release

### R1 — One complete intention-to-consequence loop

Status: OFFLINE LOOP AND BOUNDED REAL-DAY RUN VERIFIED; human engagement unmeasured. Depends: P1, M1–M6, C1/C2, G1/G2, N1, V1/V2. Create `packages/town/src/continuityLoop.test.ts`, `scripts/audit-watchability.ts`; record results in `docs/reviews/2026-09-21-continuity-rehearsal.md`.

Offline evidence: `packages/town/src/continuityLoop.test.ts` and `docs/reviews/2026-09-21-continuity-rehearsal.md`. Real coordinator/runtime/engine/database/relay fixture passes: a recipient accepts, the speaker starts physical preparation, a seeded body-need event causes an actual action interruption, and the next fake ordinary decision chooses breakfast before delivery. A mid-walk restart preserves that revised plan, and the later prompt contains the actual transfer. The intermediate target-arrival memory is stored but need not win bounded retrieval. These are scripted decisions, not evidence that real models choose this plot. Relay checks do not replace browser/socket observation. Latest bridge/eventStore/continuity/food run: 54 tests passed across four files.

- [x] Build a deterministic fake-mind fixture: resident authors an intention, another accepts or refuses, physical preparation occurs, an interruption changes the plan, and a later decision retrieves the actual consequence.
- [x] Cross midnight and a restart; join/reconnect the viewer midway. Check exact commitment identity, grounded memories, unchanged privacy boundary, honest scene state and no duplicated charge or action.
- [x] Instrument event-grounded scene availability, transcript counts, exact repeated utterances, actions/refusals and resident-authored commitment resolutions. Remove paired speech mirrors one-to-one. Coverage is not measured comprehension, exact repetition is not semantic assessment, and a resident resolution is not independently proved fulfillment.
- [ ] Evaluate human understanding and semantic novelty of repeated exchanges; aggregate event counts do not establish either.
- [x] Run one bounded real local day only after offline checks, using existing rehearsal isolation and explicit spend limits. Observe natural choices; do not demand the fixture's plot from real minds.
- [x] Write measured results and failures separately from desired targets. Confirm a quiet choice, changed mind or refusal is not automatically classified as an engine failure.

Real-run evidence: `docs/reviews/2026-09-21-continuity-rehearsal.md` records 1,560 ticks, 26 min 19 s, 12 real minds, 485 deduplicated public utterances, 37 scenes and 407 completed non-speech actions. The first day failed nightly reflections (24 rejected attempts); the repaired copy-only probe succeeded separately. Neither a subsequent source fix nor a successful probe retroactively makes that first run failure-free.

### R2 — Viewer comprehension and multi-day continuity

Status: OFFLINE BOUNDARIES VERIFIED; HUMAN REVIEW OPEN. Depends: R1, V3/V4, N2, O4. Record evidence in the same rehearsal report and approved preview selection in V3.

Offline evidence: `docs/reviews/2026-09-21-continuity-rehearsal.md`; 11,880 actual world ticks cover eight days plus 06:00, wheat stages 1/2/3, durable promises beyond seven days and old formative recall within eight slots. M6/newborn fixtures cover deterministic age/birth boundaries. No viewing-mode preference, human comprehension, broadcast readability or return-visit outcome is inferred from these checks.

- [ ] DEFERRED viewing experiment: compare the same ten-minute history in three viewing modes and measure comprehension against events.
- [ ] DEFERRED audience experiment: measure actual return visits separately from stated willingness. No retention uplift is claimed from an engineering rehearsal.
- [x] Exercise at least eight simulated days for crop and seven-day memory boundaries using offline fixtures first. Advance aging and birth boundaries deterministically rather than paying for years of inference.
- [ ] Run the existing broadcast readiness checks: ten unattended minutes, readable downscaled captions, identity within ten seconds, distinct consequences, responsive layout and truthful reconnect/replay. Human readability and interest require observation, not only passing CSS assertions.

### R3 — Reviewable local release and recovery

Status: OPEN. Depends: all selected implementation items; experiments may finish as documented rejection. Files: affected migration/tests, `deploy/` release notes and the rehearsal report. Preserve unrelated pre-existing release-document edits.

- [ ] Run full integration checks with no rehearsal competing for resources. Verify a fresh v3 database, current snapshots, persisted v3 restart and replay. Keep production history untouched; old-binary compatibility is explicitly out of scope.
- [ ] Build the viewer before starting the local rehearsal service. Verify first load, empty/failed assets, hidden-tab behavior, mobile drawer, sound, public usage and current-scene catch-up.
- [ ] Prepare a local release manifest containing the exact implementation commit, schema/protocol changes, feature defaults, measured spend and recovery procedure. Recover by checking out the recorded baseline with a separate local database; do not claim old binaries can consume v3 state. No production image or deployment is part of this task.
- [ ] Review the completed checklist and unproven areas. Merge/push/deploy only when separately requested for the concrete release; this planning request makes no production change.

```sh
pnpm check
npm --prefix packages/web run build
git diff --check
```

## Deliberate exclusions and retained policies

| Topic | Decision for this plan |
|---|---|
| Engine or renderer replacement | Excluded. Repair and measure the existing hybrid. |
| Full place/activity graph | Excluded unless recorded navigation/coordination evidence later justifies it. |
| New survival detail or forced scarcity | Excluded. Keep current balance for the initial comparison. |
| Currency, general business/institution engine | Excluded. One venue and a demonstrated missing primitive first. |
| Automatic drama or audience control of residents | Excluded. Observation and predictions cannot change resident choices implicitly. |
| Social law forcefields | Replace with witnessed violations unless physical constraints independently prevent the act. |
| Baby simulation or copying parents' private minds | Excluded. Keep explicit birth abstraction; culture can travel through interaction. |
| Global hard-stop auto-resume | Excluded. Expose the reason and retain operator-controlled recovery. |
| Backup bucket | Not a requirement, following the owner's decision. |
| Jev replacing every mind | Excluded. Adopt only the measured bounded role, if it passes. |

## Audit coverage map

| Audit finding or recommendation | Work item |
|---|---|
| Wall bypasses, effective durations, food abundance | P1/P2 |
| Promise identity, premature breach, old-tie priority | M1/M2 |
| Nightly goal loss and action handoff | M2/M3 |
| Private-aside closure risk | M4 |
| Write-only extraction, old memory, personality growth | M5 |
| Prompt/body age, seed inheritance | M6 |
| False gatherings, authority proxies, global habit assertions | C1/C2 |
| Speech restrictions and historical health contradiction | C2 |
| Automatic councils and hard social enforcement | C3 |
| Missing open scene, transcript loss, late join/replay | G1/G2/V2 |
| Existing local UI repairs, sounds, cost meter, battery concerns | V1/V2/V4 |
| Same-history presentation comparison and passive Twitch use | V3/V4/R2 |
| Causal stories, return context, verified keepsakes | N1/N2 |
| Slow arbiter, venue function and generic new-building art | F1/F2/F3 |
| Jev capability, cost and creativity boundaries | J1/J2 |
| Shared budgets, image stop/retry, degraded state | O1/O2/O3 |
| Crash consistency, growth and boundedness | O4/R3 |
| Full-day causal loop, long-term continuity and engagement | R1/R2 |

## Progress and evidence log

Execution evidence reconciled on 2026-09-21. O/P/M/C/G/N changes have local checks recorded above. The final whole-workspace suite, release manifest and integration commit remain open under R3; production is unchanged. V3/V4/J1/J2 and comparative audience research remain deferred. Human listening, retention and paired battery measurements were not performed.

Five root-controlled local runs booked **$1.1424164895**, with zero unsettled holds: streaming, the real local day, arbiter reasoning, scene-ending cue and copy-only reflection. See `docs/reviews/2026-09-21-v3-streaming.md`, `docs/reviews/2026-09-21-v3-model-probes.md` and `docs/reviews/2026-09-21-continuity-rehearsal.md`. No further paid experiment is needed to finish the current local verification.

## S. Added execution investigations

### S1 — Halim completion grounding and delayed continuation

Status: LOCAL CAUSAL FIXTURES VERIFIED; no claim that every repeated conversation is solved.

- [x] Read production without mutation and distinguish an absent request from provider latency. The clock was explicitly set to 0.25 speed; that operator choice was preserved.
- [x] Fix grounded action completion, one-step plan continuation and running-plan restart behavior with production-shaped fake fixtures. Preserve independent resident choice.
- [x] Observe the bounded real day: Halim eventually took wood and completed work after repeated capped conversations. This was delay, not permanent deadlock.
- [x] Report the paired final-cue result honestly: revised cue 0/3 voluntary leaves versus baseline 1/3, with 0/6 new plans. Retain optional wording only as contract clarity and neutral cap closure as a factual correction; no behavioral benefit is established.

Evidence: `docs/reviews/2026-09-21-v3-halim-trace.md`, `docs/reviews/2026-09-21-scene-wrap-handoff.md` and `docs/reviews/2026-09-21-v3-model-probes.md`. Long-action parameters now survive the 44-tick perception window through a targeted source-event lookup, including restart; focused regression failed before the fix and passed after it.

### S2 — Complete-response versus streaming measurement

Status: EXPERIMENT COMPLETE; streaming adoption rejected for now.

- [x] Compare three situations in paired buffered/streamed calls through the real strict turn contract. All six complete outputs validated; partial JSON was never executed or published.
- [x] Record first-text and complete-response timing, cost and holds. Buffered median completion was 2,010 ms; streamed median was 2,666 ms. Earlier partial bytes did not establish faster usable decisions.
- [x] Keep complete-response execution and current provider defaults. Do not treat streaming as a fix for time before the request begins.

Evidence: `docs/reviews/2026-09-21-v3-streaming.md`. The separate lower-reasoning arbiter experiment also finished as rejection because it lost one useful ruling; F1 records that decision.
