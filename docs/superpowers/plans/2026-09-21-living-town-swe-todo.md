# Living Town SWE TODO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Respect the session's delegation rules. A reference to a skill is not user authorization to deploy.

**Goal:** Make San Junipero an understandable, watchable living town whose residents remember intentions, act consistently, develop relationships and leave genuine consequences.

**Architecture:** Complete the existing hybrid of generative minds and deterministic physical execution. Reuse plans, memory, the event log, arbiter, narrator and director. Repair their boundaries before introducing a bounded Jev pilot or a new venue capability.

**Tech Stack:** TypeScript, Node.js >=24, pnpm 11.7.0, SQLite/better-sqlite3, Zod, Vitest, React, Three.js, Vite, Biome and ESLint.

**Spec:** [Approved system audit](../../reviews/2026-09-21-system-audit.md). Read its [independent corrections](../../reviews/2026-09-21-audit-skeptic.md) before implementation. The owner approved the audit recommendations and requested this saved engineering plan. This document plans execution; it does not claim the changes are implemented.

## Global constraints

- “Physics, never outcomes.” Residents choose their goals, relationships, participation and responses. A reminder cannot force compliance. No fabricated events, dialogue, private knowledge or narrator-authored motives.
- Keep Three.js, the authoritative event log, deterministic execution, existing plan pump and bounded effect language. No new agent framework, parallel planner, general economy, generated executable code or worker fleet.
- Preserve approved warm-paper colors, category icons, pixel balloons and town art. New presentation choices get three throwaway previews using the same recorded events before integration.
- Work locally. Do not deploy, reset production, alter live settings, buy services or run an unbounded paid experiment as part of this plan. Do not read or print `.env` or credentials. No backup bucket is required.
- Use additive migrations and backward-compatible event decoding. Preserve historical records, including old inferred customs and ties, with their original provenance. Do not rewrite history to pretend a new interpretation was always true.

## Start here

Workspace: `/Users/deadpackets/workspace/SanJunipero/.worktrees/interiors-redesign`, branch `codex/viewer-experience`. The main checkout contains unrelated work. Current local source has uncommitted frontend, gateway and usage-meter changes from the earlier repair task. Inventory them before editing; do not recreate or discard them.

Local preview: `http://127.0.0.1:8774/`, scripted minds. Production is a separate remote town. The preview is managed by `local.sanjunipero.interiors`; its launcher lives at the main checkout's `data/local-preview/serve.mjs`. Build before a local restart because the gateway caches the page shell.

```sh
git status --short
git branch --show-current
npm run -s typecheck
```

Status vocabulary: `OPEN`, `IN PROGRESS`, `IMPLEMENTED / VERIFY`, `DONE`, `EXPERIMENT / CONDITIONAL`. Move an item to DONE only when its listed check passes and evidence is recorded beside it. Commit only the files belonging to the completed item.

## Execution board

| Component | IDs | Initial status | Depends on | Result |
|---|---|---|---|---|
| Operations and cost controls | O1–O4 | OPEN | None | Shared reservations, safe stop, recovery evidence |
| Engine and physical reach | P1–P2 | OPEN | None | Consistent walls and truthful work duration |
| Minds, memory and commitments | M1–M6 | OPEN | M2/M3 depend on M1; M3 uses P1 | Durable intentions and coherent action handoff |
| Culture, knowledge and social laws | C1–C3 | OPEN | C2 uses M1/M4 | Evidence-backed culture and voluntary agreements |
| Gateway and scene transport | G1–G2 | OPEN | None | Join, reconnect and catch-up without lost context |
| Frontend, controls and performance | V1–V4 | V1 IMPLEMENTED / VERIFY; others OPEN | V2 uses G2; V4 uses V3/N1 | Polished, readable local viewing |
| Narration, journal and keepsakes | N1–N2 | OPEN | M1, C1/C2, G2 | Return context grounded in actual events |
| Arbiter, Forge and functional venues | F1–F3 | OPEN / bounded prototype | O1/O2, P1, M1/M3 | Useful invention with matching appearance |
| Jev evaluation | J1–J2 | EXPERIMENT / CONDITIONAL | O1/O3, M3, R1 baseline | Measured model decision, default unchanged |
| Integration, rehearsal and release | R1–R3 | OPEN | Relevant components above | Verified causal loop and reviewable release |

Execution waves:

1. Inventory current changes, then O1/O2, P1, M1, M4 and G1. Check each independently; coordinate shared files.
2. M2/M3/M5/M6, C1/C2/C3, G2, P2 and V1/V2. Check state, privacy, reconnect and ordinary execution together.
3. N1, V3, V4 and N2. Compare identical history in the three presentations, then integrate the chosen composition.
4. R1 establishes the repaired baseline. F1–F3 and J1–J2 proceed as bounded experiments against it.
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

Status: OPEN. Priority: first wave.

Files: modify `packages/llm/src/callLog.ts`, `packages/llm/src/rails.ts`, `packages/live/src/liveWorld.ts`, `packages/live/src/discoveryArt.ts`, `packages/live/src/castArt.ts`. Tests: extend `packages/llm/src/rails.test.ts`, `packages/live/src/liveWorld.test.ts`; create `packages/llm/src/budgetReservations.test.ts`.

- [ ] Reproduce two callers each reserving $0.75 against one $1 town ceiling. Include a held image commission as a third caller and assert the total admitted allowance never exceeds $1.
- [ ] Check global lifetime, global rolling-day and caller allowance in the same SQLite reservation transaction. Sum unsettled reservations as well as recorded charges; make caller rails sub-limits, not separate copies of the town balance.
- [ ] Route image and text calls through that authority. Book accepted provider charges once, release failed unused reservations once, and reconcile actual price differences explicitly. Cancellation must not erase a charge already incurred.
- [ ] Verify concurrent reservation, timeout, cancellation, duplicate reconciliation, restart and UTC rolling-window boundaries using fake providers. Check that the public meter never exposes reservation internals or secrets; commit after typecheck and the listed tests pass.

Proposed additive internal contract, implemented alongside the existing ledger rather than as a second database:

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

Status: OPEN. Files: `packages/live/src/{liveWorld,discoveryArt,castArt}.ts`, `packages/forge/src/{imageClient,characterCommission}.ts`. Tests: existing `liveWorld.test.ts`, `discoveryArt.test.ts`, `castArt.test.ts`, `packages/forge/src/imageClient.test.ts`.

- [ ] Hold a fake image request open, start shutdown and attempt to enqueue another commission. Check that no new request starts.
- [ ] Pass the town stop signal through image work. Stop queue admission first; drain or cancel in-flight work within the existing shutdown deadline before closing asset, world and operations stores.
- [ ] Retain legitimate late billing and prevent late writes to closed databases. Exercise both abort-respecting and abort-ignoring fake providers.
- [ ] Verify shutdown finishes, no unhandled rejection occurs and restart can use an already completed asset. Commit the lifecycle change separately from art appearance work.

### O3 — Honest mind health and bounded art retries

Status: OPEN. Files: `packages/live/src/liveWorld.ts`, discovery/cast watchers, `packages/gateway/src/{degraded,adminOps,publicUsage}.ts`, `packages/shared/src/publicUsage.ts`, `packages/web/src/stage/UsageMeter.tsx`. Extend corresponding tests.

- [ ] Distinguish active, delayed, budget-stopped and disabled/scripted minds. A running clock and HTTP 200 must not imply active inference; test each state with fake ledgers and provider delays.
- [ ] Expose only a coarse public status and aggregate usage. Keep detailed caller failures and operator controls private. Preserve the public tracker already implemented locally.
- [ ] Retry deferred art on one bounded timer in the existing process, using capped backoff and O1/O2. Prevent duplicate jobs and retries after stop; retries must not depend on a new birth or restart.
- [ ] Verify caller rail recovery and global stop separately. Keep global hard stops latched for deliberate operator recovery; do not silently enable next-day auto-resume or raise budgets.

### O4 — Crash boundaries and growth measurement

Status: OPEN. Files: `packages/live/src/liveWorld.ts`, `packages/arbiter/src/{adjudicate,codify}.ts`, runtime checkpoint persistence, `packages/gateway/src/{hub,server}.ts`. Create `packages/live/src/recoveryBoundaries.test.ts` and `scripts/audit-town-growth.ts`; modify runtime only when a failing check proves a gap.

- [ ] Inject interruption after rule insertion, discovery publication, asset registration and runtime checkpoint writes using temporary databases. Check recovered rules, events and charges for omissions or duplicates.
- [ ] Add idempotent recovery for reproduced gaps. Preserve raw history and existing snapshots; do not introduce distributed transactions or a new database service.
- [ ] Record world cells, entities, database bytes, snapshot bytes, active rule roster tokens, path refusals and client decoded texture memory across growing local fixtures.
- [ ] Keep the current population ceiling and viewer safeguards. Record the largest exercised fixture, not an unsupported capacity claim. Document local-disk durability as the existing accepted tradeoff.

## P. Engine and physical world

### P1 — Consistent room-aware reach and transfer completion

Status: OPEN. Files: `packages/engine/src/verbs/{index,common}.ts`, `packages/engine/src/{interiors,intent}.ts`. Tests: `packages/engine/src/{interiors,survival}.test.ts`; create `packages/engine/src/roomReach.test.ts`.

- [ ] Add cases for indoor-to-outdoor giving at a doorway, taking food through a rear wall, outdoor stowing into a roofed room, and a recipient moving away before completion. Current code must fail these assertions.
- [ ] Centralize room-aware reach for take/eat/stow and direct handoffs. Require entry for roofed room storage; preserve reachable open-air containers and same-room actions. Door-side handoffs across rooms are refused initially, matching `sameInterior`.
- [ ] Recheck location and possession at completion. A remembered item ID does not bypass walls, and a previously valid target does not remain reachable after moving.
- [ ] Verify same-room and outdoor positive controls, room capacity, walk-first chaining, theft of accessible property and replay. Theft remains a social consequence, not a physical impossibility.

### P2 — Expose actual work costs and preserve deliberate abstractions

Status: OPEN. Files: `packages/agents/src/prompt/rulesOfBeing.ts`, `packages/agents/src/runtime/agentRuntime.ts`, `packages/engine/src/verbs/{build,craft}.ts`, `packages/shared/src/config.ts`, relevant perception tests.

- [ ] Include effective work duration next to recipe materials and resumable progress in perception. Derive it from effective configuration, including law overrides, not library defaults.
- [ ] Test the production-style 240-tick house versus 6,480-tick cottage, cooperative progress and interrupted work. Describe simulation time without assuming fixed wall-clock speed.
- [ ] Keep current hunger, food abundance, stockless forest fallback, aging pace, no encumbrance and room-level furniture abstraction unchanged for the first comparison. Record source, production override and observed behavior separately.
- [ ] Measure forage/farming/food use over the eight-day crop horizon in R2. Change resource balance only if evidence identifies the desired choice it prevents; do not create starvation or hauling work to fill the stream.

## M. Minds, memory and commitments

### M1 — Give commitments identity and honest resolution

Status: OPEN. Files: `packages/agents/src/memory/{schema,ties}.ts`, `packages/agents/src/scene/{scene,sceneLlm,coordinator}.ts`, `packages/agents/src/reflection.ts`, `packages/shared/src/bonds.ts`, `packages/gateway/src/bonds.ts`. Tests: ties, reflection, scene/coordinator, shared/gateway bonds tests.

- [ ] Open two promises to one person and settle only one by ID. Cross seven days with the other future promise pending. Assert it neither settles nor becomes `promise_broken`.
- [ ] Extend existing tie deltas with explicit target identity and resolution. Reject missing/foreign/ambiguous settlement IDs instead of bulk settling by person and kind. Add nullable reminder time and source-event evidence without adding a quest store.
- [ ] Stop automatic expiry of promises, debts, alliances and secrets. Preserve deliberate letting go and separately justified affect decay. Old rows stay readable; historical expiry events keep their original provenance and are not reclassified as new verified breaches.
- [ ] Update scene/reflection producers and public labels. A resident considering a promise settled is a belief unless supported by the relevant event; a timer alone proves neither fulfillment nor betrayal.
- [ ] Verify migration twice, reopen, specific settlement, duplicate restatement and legacy decoding. Commit only after affected schema, producer and consumer tests pass.

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

Status: OPEN. Depends: M1. Files: `packages/agents/src/{reflection,personality}.ts`, `packages/agents/src/runtime/agentRuntime.ts`, `packages/agents/src/prompt/assemble.ts`. Tests: reflection, personality and runtime tests.

- [ ] Test kin plus old and new promises, an absent counterpart, and a project with no progress today. Check the relevant unresolved intention reaches the next decision.
- [ ] Keep kin outside the actionable tie slots. Prioritize due/recent relevant unresolved commitments with a stable bounded selection; do not send the entire ledger every turn.
- [ ] Pass previous goals into `summarizeDay`. Return explicit retain/update/resolve decisions; an omitted goal stays pending. Validate references against the previous goal strings and preserve state on malformed output or budget failure.
- [ ] Feed optional reminders into the existing reconsideration clock. The resident may defer or abandon with a recorded decision; do not submit the promised action automatically.
- [ ] Verify an uneventful day, multiple nights, empty generated standing list and restart. Check old memories remain intact while current goals stay bounded.

Proposed reflection result addition, using exact previous text as the reference until evidence requires a goal table:

```ts
type GoalRevision =
  | { previous: string; decision: 'retain' }
  | { previous: string; decision: 'update'; text: string }
  | { previous: string; decision: 'resolve'; reason: string; evidenceSeqs: number[] }
// Unknown previous references are rejected. Unmentioned prior goals are retained.
```

### M3 — Hand off conversation to the existing physical plan

Status: OPEN. Depends: M1/M2/P1. Files: `packages/agents/src/scene/{scene,sceneLlm,coordinator}.ts`, `packages/agents/src/runtime/agentRuntime.ts`, existing turn/intent schemas and checkpoint serializers. Tests: scene LLM, coordinator and runtime suites.

- [ ] Add a scene-exit fixture where a resident chooses a legal next action and another where they decline to act. Verify both choices survive closure and restart without duplicate submission.
- [ ] Add an optional exit plan/reminder using the ordinary turn's existing intent schema. Apply it only to the authoring resident through the existing plan pump. Reject stale targets and invalid parameters through normal engine validation.
- [ ] Keep current work and queued plans running during conversation. Do not confuse the existing walking stop with a blanket work lock; explicit replacement must come from the mind.
- [ ] Make subsequent speech read the same committed plan and actual action status. A refusal or interruption becomes perceptible evidence; saying “done” does not create completion.
- [ ] Verify timeout, emergency exit, participant departure, moving target, failed action and resumed scene. No new per-tick LLM loop or second scheduler.

### M4 — Public scene summaries must exclude private asides

Status: OPEN. Files: `packages/agents/src/scene/{sceneLlm,coordinator,scene}.ts`; tests: scene LLM/coordinator tests.

- [ ] Put a unique secret only in a private aside. Capture the public closure request with a fake LLM and assert the secret is absent from its input.
- [ ] Build the public summary input from spoken text, public gestures and witnessed events only. Keep turn-level `threadFor` filtering and each resident's own private recall intact.
- [ ] Prevent shared summary memory and public events from acquiring hidden-aside content through an intermediate field. Do not add one extra summary model call per resident.
- [ ] Check public conversation summaries still reach legitimate participants and overhearers in the same room, and private asides remain available only through their existing permitted paths.

### M5 — Make stored memory useful without adding another memory layer

Status: OPEN. Files: `packages/agents/src/{reflection,personality}.ts`, `packages/agents/src/memory/{retrieve,store}.ts`, `packages/agents/src/prompt/assemble.ts`. Tests: reflection, retrieve and personality tests.

- [ ] Trace retrieval IDs for one old formative event and one unresolved obligation amid recent similar memories. Keep the default bounded context; record whether failure is candidate selection or prompt omission.
- [ ] Remove the separate paid extracted-facts pass from normal reflection while it has no defined consumer. Retain its stored rows and migration compatibility. Keep scene/day generation that already feeds autobiography and personality.
- [ ] Give unresolved obligations and selected formative source memories an explicit bounded retrieval path. Correct documentation that claims old autobiography is searched when only raw memories are queried.
- [ ] Admit consequential witnessed events such as bereavement through the existing personality-edit gate. Preserve cooldowns, cited evidence and the option to make no change.
- [ ] Verify an event older than seven days affects a later relevant decision fixture, a quiet day does not force a personality rewrite, and reflection failure still leaves the established fallback digest.

### M6 — Reconcile current identity and document inheritance

Status: OPEN. Files: `packages/agents/src/runtime/agentRuntime.ts`, `packages/agents/src/live/{liveMinds,newborn,resolveCast}.ts`, `packages/agents/src/family/{derivePersona,memorySeed}.ts`, `packages/agents/src/prompt/assemble.ts`. Extend runtime, resolveCast, newborn and memorySeed tests.

- [ ] Advance a body from age twelve through the adult threshold. Assert ordinary and scene prompts both use current body age, before and after restart.
- [ ] Derive current age from `ageDays` and the shared calendar helper; preserve authored backstory and initial persona as historical data.
- [ ] Keep age-twelve birth and inherited seed traits as explicit abstractions. Learned culture initially travels through witnessed events, teaching and memory rather than copying private parental thoughts.
- [ ] Prefer consequential dated household seed events over a window filled only by routine recent speech. Check isolation, deterministic ordering and identical birth/resume reconstruction. Do not expand the birth model into infant development.

## C. Culture, knowledge and social laws

### C1 — Detect actual co-presence and keep interpretations separate

Status: OPEN. Files: `packages/arbiter/src/constructs.ts`, `packages/live/src/liveWorld.ts`, `packages/agents/src/runtime/agentRuntime.ts`, `packages/gateway/src/constructs.ts`. Tests: arbiter constructs/g11.constructs and `packages/live/src/constructs.test.ts`.

- [ ] Reproduce the three non-overlapping daily visits from the audit. Add simultaneous positive control, separate rooms at one footprint, midnight crossing and arrival/departure cases.
- [ ] Derive gatherings from overlapping presence in the same room/place or recorded scene participation. Remove raw daily traffic and most-speech-count as proof of shared ritual or deference.
- [ ] Stop feeding observer habit assertions to every mind. Feed only witnessed/learned evidence through existing perception and memory; preserve resident-given names with their source utterance.
- [ ] Allow multiple observed uses at a place and revise tentative classification when evidence changes. Keep old classifications as legacy observations rather than silently rewriting them.
- [ ] Verify culture labels never alter authoritative world hashes, unknowing residents receive no new fact, and only evidenced shared attendance qualifies for a gathering.

### C2 — Ground voice, bonds and claims in the right evidence

Status: OPEN. Depends: M1/M4. Files: `packages/agents/src/prompt/rulesOfBeing.ts`, `packages/shared/src/bonds.ts`, `packages/gateway/src/bonds.ts`, `packages/narrator/src/institutions.ts`; extend their tests.

- [ ] Replace “healthy now means healthy yesterday” with present-state grounding plus dated historical evidence. Test recovered illness without allowing invented current symptoms.
- [ ] Remove blanket bans on invented sayings and wordplay. Retain anti-loop, factual and character grounding; compare repeated exchanges for new information, not a word-count quota.
- [ ] Label speech-frequency bonds and inferred institutions as observations. A quarrel cannot become verified friendship solely because many lines were exchanged.
- [ ] Check that residents can express a mistaken belief or lie while narration distinguishes the claim from world fact. Keep distinct character voices without inserting named plots or example sayings into all prompts.

### C3 — Voluntary councils and social enforcement

Status: OPEN, approved design direction. Files: `packages/engine/src/socialLaws.ts`, `packages/agents/src/scene/{scene,coordinator,sceneLlm}.ts`, associated law compiler and prompt paths. Tests: engine socialLaws, scene and coordinator suites.

- [ ] Replace automatic next-day council conversion with an explicit resident choice to reopen a pending proposal. The pending record remains available, but an unrelated conversation keeps its original subject.
- [ ] Require explicit support from at least one participant beyond the proposer, and more support than opposition. “Unsure” remains abstention. Record actual supporters and scope; do not call a room vote unanimous town consent.
- [ ] Convert social-only `require_before`, `common` and `tithe` constraints into observable violations when no physical mechanism prevents the act. Keep walls, possessions, resource requirements and valid consent constraints authoritative.
- [ ] Verify refusing, complying, violating and deliberately reconvening. Retain old ratification events on replay; new policy applies to new decisions. Show that no synthetic guard, punishment or relationship outcome appears automatically.

## G. Gateway and scene transport

### G1 — Complete scene state on join, restart and resync

Status: OPEN. Files: `packages/gateway/src/{scenes,server}.ts`, `packages/gateway/src/replay.test.ts`, `packages/web/src/state/worldStore.ts`. Tests: scenes/server/replay/worldStore suites.

- [ ] Join halfway through an indoor conversation and restart the gateway while it remains open. Assert the first usable scene state contains the correct cast, room context and open status.
- [ ] Extend the existing relay with snapshot/prime operations and initialize it from retained relevant events, including a scene opened before midnight. Do not scan all world history per viewer.
- [ ] Send open scene frames before the associated director context on hello and live resync. Replay restores the scene at its requested starting tick without sending later events.
- [ ] Verify close, participant changes, reconnect and return-to-live. Remove stale open scenes and avoid duplicate close notifications.

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

Status: OPEN. Depends: G1. Files: `packages/gateway/src/{scenes,server}.ts`, `packages/shared/src` existing server-frame schema, `packages/web/src/state/worldStore.ts`, `packages/web/src/stage/LivingScene.tsx`. Create `packages/gateway/src/sceneTranscript.test.ts`.

- [ ] Capture the production-shaped fixture of twelve lines in thirteen ticks. Join after line six; reconnect after line ten. Assert chronological, deduplicated delivery with no future lines in replay.
- [ ] Use event sequence IDs for identity and simulation ticks for time. Retain at most 100 recent public lines per scene in the client; hydrate a requested scene from the existing event store and disclose truncation.
- [ ] Send initial recent lines with an explicit catch-up designation, separate from a newly arriving utterance. Exclude asides and avoid duplicating `agent_spoke` plus `scene_line` for the same utterance.
- [ ] Verify room entry after speech, offscreen arrivals, bounded memory and closed-scene access. Camera anchoring controls display, never whether received dialogue is stored.

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

Status: IMPLEMENTED / VERIFY. Files already changed: `packages/web/src/{App.tsx,paper/Paper.tsx,paper/game/game.css}`, stage DayBar/UsageMeter/KeyMap/useSafeInsets/useStageKeys, render bootAssets/StageMount/three files, ui chrome/sound/storage/firstFrame, state worldStore, gateway publicUsage/server and shared publicUsage.

- [ ] Review the existing diff rather than rebuilding it. Verify desktop dock-only journal and a mobile edge-attached drawer with Close/Escape/focus return; no undocked mode or obsolete stored preference survives.
- [ ] Check exterior/interior camera attachments, journal open/close, help title “Controls”, and the public usage expansion at 390×844, 1280×800 and 1440×900. Check no overlap, hidden controls or horizontal scroll.
- [ ] Verify first load, cached load, empty asset catalog, one failed asset/retry and newly generated assets. The loading screen covers current assets only; future assets still arrive incrementally.
- [ ] Listen to dry calm, wind, rain, fire and indoor scenes. Confirm no constant static in calm dry weather, no clicks on mute/unmute and hidden tabs suspend audio. Automated audio tests do not replace this listening check.
- [ ] Build and profile the visible page. Record actual frame time, draw calls, texture memory and CPU before/after; do not label a terrain microbenchmark as measured battery savings. Commit after interaction and sound evidence is recorded.

```sh
npm --prefix packages/web run build
npx vitest run packages/web/src/render/bootAssets.test.ts packages/web/src/stage/safeInsetsObserver.test.ts packages/web/src/ui/sound.test.ts packages/gateway/src/publicUsage.test.ts --maxWorkers=2 --silent=true
```

### V2 — Moving targets and compact readable balloons

Status: OPEN. Depends: G2 for speech scheduling. Files: `packages/web/src/render/{hitShapes,pixelBubbles,StageMount}.ts`, `packages/web/src/render/three/world.ts`, `packages/web/src/stage/Nameplate.tsx`, `packages/web/src/ui/harmony.css`. Extend hitShapes tests; create `packages/web/src/render/pixelBubbles.test.ts`.

- [ ] Reproduce narrow click targets while residents move and a nameplate whose screen anchor changes. Use a generous screen-space target with deterministic nearest-person selection, stable hover and a clickable name affordance; preserve building clicks and drag-to-pan.
- [ ] Fit bubble width to measured text lines with balanced padding for short and wrapped text. Measure after fonts load and on message/size changes, not each animation frame. Keep reserved typewriter dimensions to prevent layout jumps.
- [ ] Preserve the approved thought/speech distinction. New utterances can appear immediately while older lines remain in the transcript; do not present stale queued words as live or require simulation time to wait for reading.
- [ ] Verify short, long, multiline and mobile text, crowded residents, moving selection, indoor anchors and reduced motion. Check screenshots with the actual font and town, not a DOM-size assertion alone.

### V3 — Three comparable viewing prototypes

Status: OPEN. Depends: G2/N1. Create only `packages/web/viewing-review.html` and a local recorded public-event fixture under `packages/web/public/review/`. Real UI behavior remains unchanged during this item.

- [ ] Use one ten-minute recorded event sequence for all three options: wide town with compact context, living documentary focused on a scene, and clearly labeled recorded chapters with a live-return control.
- [ ] Keep the approved palette, icons and balloons. Show who is involved, a supported present action, one relevant prior fact and an unresolved intention only when the source provides it.
- [ ] Include quiet work, a conversation, refusal/interruption, a completed consequence and no-story fallback. Fixture labels must disclose any synthetic test event; do not inject it into the actual town.
- [ ] Present the three views for selection and record the chosen component/layout mix here. Check passive 480px-wide video readability as well as interactive desktop/mobile use.

### V4 — Integrate the chosen presentation and one performance pass

Status: OPEN. Depends: V3 selection and N1. Files: `packages/web/src/{App.tsx,stage/LivingScene.tsx,stage/DirectorCue.tsx}`, existing story pocket/camera components and styles. Use existing director/threads state.

- [ ] Integrate the selected hierarchy for ordinary viewing and broadcast. A passive watcher receives enough context without opening the journal; controls remain compact for interactive use.
- [ ] Preserve camera hold/hysteresis/quiet beats. Do not add a competing director, automatic drama, repeated narration calls or forced resident activity.
- [ ] Eliminate per-frame DOM measurement and avoid rebuilding immutable world geometry for clock-only changes. Bound transcript/render work and pause hidden rendering through existing lifecycle hooks.
- [ ] Compare the same camera route, viewport and weather before/after. Record visible frame timing and interaction results; check dock/interior transitions, reconnect, replay, reduced motion and source-to-caption accuracy.

## N. Narration, journal and return value

### N1 — Source-linked context across days

Status: OPEN. Depends: M1/C1/C2/G2. Files: `packages/gateway/src/{threads,stakes}.ts`, `packages/narrator/src/{chronicle,canon,institutions}.ts`, `packages/shared/src/threads.ts`, existing web story models. Extend their tests.

- [ ] Use one pair with two unrelated promises and a later callback. Check that cast overlap does not merge the obligations into one claimed causal story.
- [ ] Attach existing commitment identity or explicit source events when available. Retain thread heat for editorial ranking, but separate an inferred thread from a verified project or obligation.
- [ ] Give daily narration the small relevant prior source packet for a real callback. Existing event IDs must support the claim, not merely exist in the database; unknown outcomes remain unknown.
- [ ] Verify quoted intention versus action, delayed versus broken promise, observed companionship versus friendship, and one cross-day consequence. No narrator interpretation enters minds as a new fact.

### N2 — Return summary, keepsakes and meaningful firsts

Status: OPEN. Depends: N1/V4/C1. Files: narrator `firsts.ts`, `semanticFirsts.ts`, `moments.ts`; web `stage/Keepsake.tsx`, journal game components and storage; gateway moments/discoveries endpoints.

- [ ] Store a local last-seen event cursor for a returning viewer and summarize supported changes since that point. Separate newly observed facts from a resident's stated intention and tentative interpretation.
- [ ] Reuse keepsakes for actual firsts, shared work and resident-named customs. Link each to events or a replay; distinguish method discovered, first successful use and building completed.
- [ ] Keep animations brief, dismissible and reduced-motion aware. Deduplicate on reconnect; replay cannot award a false “just happened” live popup.
- [ ] Verify an empty return interval, a long absence beyond retained fine-grained replay, several simultaneous milestones and a first later corrected by evidence. Do not add login streaks, mandatory chores or speculative audience voting infrastructure.

## F. Arbiter, Art Forge and useful places

### F1 — Routine action routing before expensive invention

Status: OPEN. Depends: O1/O3/P1. Files: `packages/arbiter/src/{adjudicate,expressive,sanity,codify}.ts`, `packages/agents/src/runtime/arbiterSeam.ts`, `packages/llm/src/pins.ts`; extend adjudication/codification fixtures.

- [ ] Save existing wood-stacking and bridge-repair requests as private local fixtures with their observed rulings. Check whether existing verbs/precedents should resolve them before a novel ruling.
- [ ] Improve only the demonstrated mapping or affordance gap. Preserve exact and semantic caches, effect validation, provenance and safe refusal; do not add another generic cache.
- [ ] Compare a lower-reasoning first pass on recorded cases only after offline routing checks. Escalate genuinely unresolved cases, retain a bounded timeout and show delay/failure honestly.
- [ ] Record validity, latency, cost and changed outcomes by case. Keep current model settings unless the comparison preserves useful rulings and lowers whole-path cost or delay.

### F2 — One functional venue with actual transfers

Status: EXPERIMENT / CONDITIONAL. Depends: M1/M3/P1/F1. First prototype: a shop using existing goods, ownership, storage and voluntary exchange. Use a local fixture; do not force a resident to open it in production.

Files: `packages/engine/src/verbs/index.ts`, relevant item/intent schemas, `packages/arbiter/src/{verdict,codify}.ts`, `packages/agents/src/prompt/rulesOfBeing.ts`. Create `packages/town/src/venueLoop.test.ts`.

- [ ] Exercise one offered item/quantity, an acceptance or refusal, the physical transfer and a later remembered consequence. A spoken sale alone must not move goods or settle an obligation.
- [ ] Extend the existing give/transfer path for a requested quantity if the fixture proves whole-stack transfer blocks it. Preserve stock, ownership, source identity and failure on insufficient quantity.
- [ ] Link the voluntary agreement to M1 commitment evidence. Preserve refusal, theft of accessible property and unfulfilled exchanges; do not invent currency, prices, shopkeeper schedules or guaranteed customers.
- [ ] Check a completed exchange and an interrupted one through reload/replay, then observe whether real residents choose the affordance in a bounded local run. Generalize only the repeated missing operation.

Novel consumables are a follow-on only when an observed invention needs them. Reuse bounded item-use effects and existing food/water rules; a new name or picture never grants hydration, nutrition or intoxication implicitly.

### F3 — Building design recipe and Forge lifecycle

Status: bounded prototype. Depends: O1/O2/F2. Files: `packages/forge/src/buildingMaterials.ts`, `packages/live/src/discoveryCommission.ts`, `packages/shared/src/interiorMeta.ts`, `packages/web/src/render/three/{structures,interiorRoom,materials}.ts`, corresponding tests.

- [ ] Define a small validated appearance recipe for footprint-compatible facade, roof, door and window placement. Separate it from physical affordances; the image model supplies surface maps, not authoritative geometry.
- [ ] Build three throwaway examples using the same footprint: personal home, public shop and public meeting room. Keep approved resident styles and local lighting/window occupancy behavior.
- [ ] Match visible door, collision footprint, room entrance and window emission masks from one recipe. Unknown/failed art uses a coherent fallback without changing usable physics.
- [ ] Verify generated materials, occupancy lights, day/night transitions, indoor/outdoor identity, late asset arrival and O2 shutdown. Select and integrate the bounded recipe after visual review; do not generate arbitrary mesh code.

## J. Jev evaluation and adoption decision

### J1 — Shadow evaluation of one bounded judgment

Status: EXPERIMENT / CONDITIONAL. Depends: O1/O3/M3/R1 baseline. Create `packages/llm/src/jev.ts`, `packages/llm/src/jev.test.ts`, `scripts/evaluate-jev.ts` only when starting the experiment. Keep normal runtime unchanged initially.

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

Status: CONDITIONAL on J1 evidence. Files: existing wake/runtime integration plus the adapter; no new cognition framework.

- [ ] Enable one local routing switch, default off. Preserve generative planning, invention, reflection and speech; record exactly which calls Jev replaces and which it adds.
- [ ] Supply only knowledge the resident owns. When choosing actions later, choose whole validated action/target/object candidates and preserve a deliberation escape; do not compose unrelated parameter choices.
- [ ] Compare the same scenario family with the ordinary controller. Reject adoption if it adds a net call without useful benefit, misses meaningful interruptions, flattens choices, or blocks new ideas.
- [ ] Record an adopt/reject decision with total cost and behavior evidence. A low per-token price alone is not a pass, and passing a shadow classifier does not authorize replacing the whole resident brain.

## R. Integration, evaluation and release

### R1 — One complete intention-to-consequence loop

Status: OPEN. Depends: P1, M1–M6, C1/C2, G1/G2, N1, V1/V2. Create `packages/town/src/continuityLoop.test.ts`, `scripts/audit-watchability.ts`; record results in `docs/reviews/2026-09-21-continuity-rehearsal.md`.

- [ ] Build a deterministic fake-mind fixture: resident authors an intention, another accepts or refuses, physical preparation occurs, an interruption changes the plan, and a later decision retrieves the actual consequence.
- [ ] Cross midnight and a restart; join/reconnect the viewer midway. Check exact commitment identity, grounded memories, unchanged privacy boundary, honest scene state and no duplicated charge or action.
- [ ] Instrument outcomes from existing events: time with understandable scene context, discarded/retained dialogue, repeated exchanges without new information, action refusal reasons and commitment retrieval. Do not count duplicate speech event types twice.
- [ ] Run one bounded real local day only after offline checks, using existing rehearsal isolation and explicit spend limits. Observe natural choices; do not demand the fixture's plot from real minds.
- [ ] Write measured results and failures separately from desired targets. Confirm a quiet choice, changed mind or refusal is not automatically classified as an engine failure.

### R2 — Viewer comprehension and multi-day continuity

Status: OPEN. Depends: R1, V3/V4, N2, O4. Record evidence in the same rehearsal report and approved preview selection in V3.

- [ ] Compare the same ten-minute history in the three viewing modes. Ask who interested the viewer, what that resident wanted and what changed. Compare answers against events rather than asking only which skin looks nicer.
- [ ] Measure actual return visits separately from stated willingness. Keep results descriptive until sample size supports a conclusion; no invented retention uplift.
- [ ] Exercise at least eight simulated days for crop and seven-day memory boundaries using offline fixtures first. Advance aging and birth boundaries deterministically rather than paying for years of inference.
- [ ] Run the existing broadcast readiness checks: ten unattended minutes, readable downscaled captions, identity within ten seconds, distinct consequences, responsive layout and truthful reconnect/replay. Human readability and interest require observation, not only passing CSS assertions.

### R3 — Reviewable release, migration and rollback

Status: OPEN. Depends: all selected implementation items; experiments may finish as documented rejection. Files: affected migration/tests, `deploy/` release notes and the rehearsal report. Preserve unrelated pre-existing release-document edits.

- [ ] Run full integration checks with no rehearsal competing for resources. Verify old databases, old events and a current snapshot load; archive deprecated interpretations without destructive rewriting.
- [ ] Build the viewer before starting the local rehearsal service. Verify first load, empty/failed assets, hidden-tab behavior, mobile drawer, sound, public usage and current-scene catch-up.
- [ ] Prepare a release manifest containing exact commit/image, schema changes, compatible previous version, feature defaults, measured spend and rollback procedure. For additive schema changes, verify the proposed previous binary can still read the migrated copy; otherwise do not claim binary rollback is safe.
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

Planning complete on 2026-09-21. No implementation item was completed by creating this document. V1 records existing code from the preceding task, with verification still open. All other implementation items remain unchecked.

First execution item: O1. Start with the two-caller $1 reservation reproduction. Its completion check is a passing concurrent text-plus-image budget regression with no provider calls.
