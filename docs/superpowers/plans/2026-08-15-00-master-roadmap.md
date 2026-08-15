# San Junipero — Master Implementation Roadmap

> **For agentic workers:** This roadmap is the one-approval contract for the whole build.
> Each chunk below gets its own detailed plan file (same directory, numbered) authored
> when its predecessor's gate passes, using superpowers:writing-plans discipline
> (bite-sized TDD tasks, no placeholders). Execute chunk plans with
> superpowers:subagent-driven-development or superpowers:executing-plans.
> A gate failure or spec deviation STOPS the pipeline and goes back to the human.

**Goal:** Build the complete San Junipero AI life simulation per
`docs/superpowers/specs/2026-08-15-san-junipero-design.md`.

**Execution protocol:** 8 chunks, strictly sequential. A chunk is done only when its
named gate check passes with observed evidence (test output, screenshot, logged
metric). Detailed plans: `2026-08-15-0N-<chunk>.md`.

## Global constraints (apply to every chunk)

- TypeScript, ESM (`"type": "module"`), Node 24 LTS, pnpm workspaces, strict tsconfig.
- Test runner: Vitest. TDD per task. Commit per task minimum.
- SQLite via `better-sqlite3` v13, WAL mode, one DB file `data/town.db`.
- All LLM calls: Vercel AI SDK 7 (`ai@^7`) + `@openrouter/ai-sdk-provider@^3`,
  model `deepseek/deepseek-v4-flash-0731` (pinned; never `-latest`).
- All image calls: OpenRouter Image API, primary `google/gemini-3.1-flash-image`.
- Zod 4 for every schema (events, turn output, sim-config); `z.toJSONSchema()` only.
- Determinism law: randomness is drawn ONLY at event-creation time by named RNG
  streams and recorded in event payloads; `fold(events)` is pure and RNG-free.
- No world text ever references AI/tools/prompts (human framing, spec §5).
- Monorepo layout (created in Chunk 1):
  `packages/{shared,engine,arbiter,agents,narrator,forge,web,gateway}`.

## Chunks & gates

### C1 — Engine core & golden replay  → plan `01-engine-core.md` (written)
Scaffold monorepo; sim clock/calendar; Zod event envelope; seeded serializable RNG
streams; SQLite event store + snapshots; pure `fold`; tick loop (2.5s, drift-free,
pausable, speed multiplier); golden-replay harness.
**Produces (later chunks consume):** `@sj/shared` (SimTime, EventEnvelope, zod
schemas, stableStringify, stateHash), `@sj/engine` (`EventStore`, `RngStreams`,
`fold(state, event): WorldState`, `TickLoop`, `snapshot()/restore()/replay()`).
**GATE G1:** golden-replay Vitest suite green — a scripted synthetic day replays to a
bit-identical state hash from snapshot and from genesis; crash-kill mid-day recovers.

### C2 — Physics & Tier-1 verbs → plan `02-physics-verbs.md`
Terrain grid + A* movement; needs decay (hunger/energy/warmth/social) with debuff
thresholds; health (injury/infection/contagion/recovery); aging; 12 skill tracks with
learn-by-doing XP; weather/season state machine; crops; wildlife; fire spread;
structures + construction; inventory/objects; all Tier-1 verbs (walk, eat, speak,
give, take, build, craft, plant, harvest, fish, forage, write, read, sleep, wake,
experiment-stub, attack [opposed rolls, injury-first], tend, teach); perception
composer (LOS, earshot, told, read) emitting perception packets; `submitIntent` API.
**Produces:** `Verb` registry with cost/duration/skill-check/interruption metadata;
`PerceptionPacket` type; `submitIntent(agentId, intent): Promise<Receipt>`;
sim-config file with every tunable constant.
**GATE G2:** physics unit suites green + a 3-sim-day headless run of scripted
(non-LLM) actors shows: needs kill only after sustained neglect, fire spreads and
stops, crops mature per season, golden replay still green.

### C3 — One living agent → plan `03-agent-mind.md`
`@sj/agents`: OpenRouter client wrapper (retries, `models` fallback via extraBody,
provider.order pinning, cacheReadTokens logging); prompt assembler with strict
stability gradient; turn Zod schema + one repair retry + in-world fallback; wake
scheduler (perception triggers, body alarms, reconsider_at, boredom beat,
conversation mode cadence); memory store per agent (memories w/ entity tags +
FTS5 + sqlite-vec embeddings via bge-small-en-v1.5, facts, ledgers, summary_nodes);
ambient retrieval (tag+BM25+cosine+recency+importance) + `recall`; sleep reflection
job (episodic summary, fact extraction, ledger update, autobiography, ≤1 personality
edit via drift-limiter); dreams; journal; miss-log.
**Produces:** `AgentRuntime.start(agentId)`; `MemoryStore` API; `PersonalityDoc`
versioning; prompt block contract documented for C4/C7 reuse.
**GATE G3:** one agent (test persona) lives 2 full sim days against real DeepSeek:
sleeps, wakes, eats, plans, journals, reflects; `cacheReadTokens > 0` observed on
consecutive turns; memory retrieval returns tagged verbatim rows; token cost logged.

### C4 — Arbiter → plan `04-arbiter.md`
`@sj/arbiter`: freeform-intent adjudication prompt (canon + skills/inventory +
precedent retrieval); verdict schema (map/attempt/impossible); outcome-table format
the engine can roll; codification into `rulebook` table; `rulings` precedent store
with similarity retrieval; adjacency doctrine against knowledge codex; admin
review/revert queue; chaos-agent fuzz suite (scripted exploit intents corpus).
**Produces:** `adjudicate(intent, agentCtx): Verdict`; rulebook hot-registration of
new verbs into C2's registry.
**GATE G4:** chaos suite: 0 physics-breaking rulings across the exploit corpus;
"boil river water for salt" style novel intent → ruling → codified → second attempt
resolves Tier-1 without an Arbiter call (verified by call-count assertion).

### C5 — Asset forge & Style Bible calibration → plan `05-forge.md`
`@sj/forge`: Style Bible doc + reference sheet + 40-color warm-pastel master palette
(calibration script renders palette under night/dawn/storm tints for human sign-off);
OpenRouter Image API client (3 parallel candidates, `input_references`, magenta-bg
prompt); post-process (sharp → chroma-key → NEAREST downscale → nearest-color
quantizer ~30 lines w/ lookup cache → selective outline pass); mechanical gate +
VLM judge (`openai/gpt-5.6-luna`) scoring vs reference sheet, <7 retry ≤3, placeholder
fallback; SQLite `jobs` queue table + worker; asset codex + hot-load notification;
paper-doll character rig assets (base bodies × 3 age bands × palette layers) and
seasonal terrain tilesets (authored/generated in calibration, committed as content).
**Produces:** `commission(desc, footprint, class): Promise<AssetRecord>`; codex table.
**GATE G5:** 50-asset benchmark run: ≥80% pass the style gate ≤3 attempts; visual
contact sheet approved by human (the one taste gate a human must eyeball).

### C6 — Observatory → plan `06-observatory.md`
`@sj/gateway` (ws broadcast, snapshot+delta protocol, serialize-once,
bufferedAmount gating) + `@sj/web` (React 19 + Vite 8; PixiJS 8 in a ref; ground
RenderTexture bake; dimetric math + depth sort; pixel-perfect settings; day/night
multiply quad + ColorMatrix grading; weather particles; ambient motion package with
tone-aware suppression; speech/thought bubbles; hot sprite loading with explicit
unload). Lenses: living map, agent inspector (thoughts/body/plan/ledgers/journal/
personality diffs), chronicle + timeline scrub (snapshot+replay), society graph
(react-force-graph-2d), director mode (consumes C7 heat, ships with stub scorer),
catch-up digest shell. Hybrid UI chrome per Style Bible.
**Produces:** delta protocol schema shared in `@sj/shared`; deep-link routes
`/moment/:day/:time`.
**GATE G6:** 2 browsers watch the C2 scripted world live at 60fps; scrub to any past
moment renders correctly; agent click shows live thought within one tick; sprite
hot-load visibly swaps a placeholder.

### C7 — Narrator → plan `07-narrator.md`
`@sj/narrator`: scene segmentation; chapter/era hierarchical summaries (event-ID
citations, render-layer verification); heat scoring feeding director + digest +
timeline markers; firsts/milestone ledger; institution detection; publications
(newspaper render, weekly biographies from public record only, timelapse captions);
OG share-card renderer. One-way glass enforced: narrator DB user has no write grant
on world tables.
**Produces:** `chapters`, `heat_scores`, `institutions`, `publications` tables
consumed by C6 views.
**GATE G7:** replaying a recorded eventful day yields chapters whose every event-ID
citation resolves; digest renders "while you were away" for a 3-day absence;
director cam follows a scripted argument over a scripted idle scene.

### C8 — Genesis & dress rehearsal → plan `08-genesis-rehearsal.md`
Founder content (5 identity docs: backstory, voice card, personality v1, secret);
world map authoring (128×128, river fork, standing stone); storehouse inventory;
discovery tree data (~100 nodes, 5 eras); manipulator-agent injection test vs real
minds; admin panel (pause/speed, token dashboards, ruling review, regen queue);
Docker Compose + Caddy + Litestream deploy; 10× headless dress rehearsal (several
sim-weeks), chronicle read-through, sim-config tuning pass; launch checklist.
**GATE G8 (LAUNCH):** rehearsal completes with zero crashes and zero unhandled
starvation-spirals; tuning signed off from chronicle evidence; restore drill from
Litestream backup succeeds; public URL serves the observatory.

## Cross-chunk rules

- Golden replay (G1) runs in CI forever; every later chunk keeps it green.
- Each chunk's plan lists exact Produces/Consumes signatures; interface drift
  requires updating this roadmap in the same commit.
- Live-API tasks (C3, C4, C5) each start with a $5 budget cap experiment task that
  verifies API mechanics before building on them.
