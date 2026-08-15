# San Junipero — Design Spec

**Date:** 2026-08-15
**Status:** Approved in brainstorming; pending final spec review.

An autonomous AI life simulation: five LLM agents found a town on an empty meadow,
live full lives under deterministic physics, and shape their world — society,
economy, buildings, discoveries — through free will. The public watches everything
in real time through a browser observatory rendered in cutesy isometric pixel art.

**The contract in one sentence: the world engine owns the body; the LLM owns the mind.**

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| Mind model | `deepseek/deepseek-v4-flash-0731` via OpenRouter for agents, Arbiter, and narrator. Verified pricing: $0.14/M in, $0.28/M out, $0.028/M cache read (80% off). Pinned dated snapshot, never `-latest` — a silent model swap mid-experiment would change every personality |
| Population | 5 founders; newcomers arrive over time; births possible |
| Mortality | Full realism: aging, natural death, death by neglect, violence possible between agents |
| Time | 1 sim day = 1 real hour. Tick = 1 sim minute = 2.5 real seconds. 1 sim year ≈ 15.2 real days |
| World edits | Live AI-generated pixel-art assets, style-enforced by pipeline |
| Day zero | Founding scenario: empty meadow, wagon, storehouse with ~10 sim-days of supplies |
| Economy | Needs + barter only. No money, no prices, no telecoms. `give` is the only built-in exchange primitive |
| Agent self-image | Full human framing. AI is never mentioned anywhere inside the world |
| Viewers | Pure observatory. One-way broadcast, zero influence channel |
| Nature | Weather + seasons, fire & structural hazards, wildlife & farming ecology, illness & medicine |
| Novel actions | Two-tier: deterministic rulebook + LLM Arbiter that adjudicates freeform intents and codifies successful rulings |
| Memory | Per-agent isolated SQLite; verbatim immutable store; hybrid retrieval (tags + BM25 + local embeddings + recency + importance) |
| Stack | TypeScript pnpm monorepo, Node, PixiJS, SQLite (WAL, better-sqlite3), WebSockets, Docker Compose on one VPS |

---

## 2. Architecture

Six processes, one box, one SQLite database. The world engine is the **only writer**
to world state. Everything else reads the event stream.

```
┌──────────────┐  intents/actions  ┌─────────────┐  novel intents  ┌─────────┐
│ agent-runtime │ ────────────────▶│ world-engine │◀───rulings─────▶│ arbiter │
│ 1 loop/agent  │ ◀──perceptions── │ tick = 2.5s  │                 └─────────┘
└──────────────┘                   │ single writer│──▶ SQLite (WAL)
                                   └──────┬───────┘──▶ events (append-only)
┌─────────────┐                           │
│ asset-forge │◀── commissions ───────────┤
│ gen+quantize │─── new sprites ──────────┤
└─────────────┘                           ▼
                                   ┌──────────────┐      ┌──────────┐
                                   │  gateway/WS  │      │ narrator │
                                   └──────┬───────┘      │ (1-way   │
                                          ▼              │  glass)  │
                                   PixiJS frontend       └──────────┘
                                   (N read-only viewers)
```

### Event sourcing as law

- World state = `fold(events)`. Every event is immutable, timestamped, and carries
  the RNG state needed to replay it.
- One seeded RNG stream per subsystem (weather, combat, crops, discovery…).
  The Arbiter defines outcome tables; **the engine rolls all dice**.
- World snapshot persisted every sim-hour. Crash recovery, time scrub, timelapse,
  and golden-replay tests are all the same mechanism: nearest snapshot + replay.
- Golden-replay regression test: a recorded day's event log must reproduce
  bit-identical world state after any engine refactor.

### Non-blocking minds

The tick loop never awaits an LLM. Agent decisions arrive asynchronously and are
resolved in arrival order on the next tick. A slow provider day means agents think
slowly — diegetic, not an outage. OpenRouter failover model list; if all providers
fail, agents "doze off mid-thought."

---

## 3. World engine (deterministic half)

The engine is a rulebook, not a storyteller. All constants live in one `sim-config`
file, tuned during dress rehearsal (§12).

| System | Rules |
|---|---|
| Time | Day/night cycle; agents sleep by choice but exhaustion compounds. Engine can rouse sleepers (noise, pain, nightmare roll) |
| Body | Hunger, energy, warmth, social — decay curves from sim-config. Deficits inject debuffs into perception ("your legs ache") → collapse (bedridden until helped) → death only after sustained total neglect |
| Health | Injuries (violence, accidents), infection rolls, contagious disease model, recovery accelerated by care and remedies |
| Aging | Real sim-year aging (~15 real days/year). Age bands shift stats; old age adds a natural-death risk curve. Children born in-sim age at the same rate and become full agents at adolescence |
| Skills | ~12 learn-by-doing tracks (farming, carpentry, cooking, medicine, fishing, foraging, brewing, masonry, tailoring, smithing, scholarship, art). Skill gates action quality and Discovery attempts |
| Actions | Every verb has cost, duration, skill check, interruption rules. Executed tick-by-tick with zero LLM calls |
| Violence | Possible, hard, and witnessed: opposed rolls, injuries before fatality, fatality only at extremes. Anyone in perception range is a witness. No mechanical justice system — society must invent its response |
| Nature | Season/weather state machine (rain, storm, snow, drought); temperature drives shelter/firewood needs; crop growth cycles; wildlife populations (fish, deer, winter predators); fire spreads across flammable structures; storms and neglect damage buildings |
| Discovery | Hidden authored content tree (~100 nodes, §10). `experiment` action + skill threshold + engine roll. Success creates a real new thing: name, properties, commissioned sprite, permanent codex entry credited to the inventor. Discoveries spread only by teaching, trading, or spying |
| Perception | Agents know only what their senses reach: line of sight, earshot, what they are told, what they read. The engine composes every perception packet. Information asymmetry is enforced physics — gossip, lies, and reputation exist because of it |

### Communication physics

No telecoms. Face-to-face speech (earshot radius), plus physical writing: signs,
notes, letters, journals, ledgers. Written objects store their text verbatim and
losslessly — the town's only defense against collective bad telephone is inventing
record-keeping, which is emergent culture, not a feature we ship.

---

## 4. The Arbiter (LLM God layer)

Two-tier action system:

| Tier | What | Cost |
|---|---|---|
| 1. Codified | walk, eat, speak, give, take, build, craft, plant, fish, write, read, sleep, experiment… — deterministic engine | zero LLM |
| 2. Freeform intent | any natural-language attempt ("I try to extract salt by boiling river water") | one Arbiter call, once per novel intent |

The Arbiter rules using only: world canon (tech era, materials physically present),
the agent's actual skills/inventory, and stored precedent. Verdicts:

1. **Maps to existing rule** → engine executes Tier 1.
2. **Plausible attempt** → Arbiter writes the physics: skill check, duration, costs,
   outcome table. Engine rolls seeded dice.
3. **Impossible here** → an in-world reason, never an error.

**Codification:** successful novel rulings are written into the `rulebook` table as
new deterministic actions/recipes. Adjudicate once, physics forever. Every ruling is
stored in `rulings` (precedent, retrieved by similarity) so identical attempts get
identical physics — reality cannot be rerolled by rephrasing.

**Adjacency doctrine:** discoveries must be one reachable step from the town's
knowledge codex. Nothing is hardcoded-impossible; everything is earned-possible.
"I want to be a nuclear engineer" → the ambition is free will (rename yourself,
theorize, preach atoms at the tavern); the physics requires climbing the entire
tech ladder rung by rung over sim-decades.

**Anti-exploit:** agent text is untrusted testimony — the Arbiter rules on
inventory/skills/canon, never eloquence. Attempts cost real sim time and energy.
Rulings carry provenance and are revertible via admin review (§12).

---

## 5. Agent minds

One async loop per agent. Cadence is adaptive: conversation = ping-pong;
executing a plan = idle; asleep = zero tokens. Wake reasons: plan finished/blocked,
perception worth reacting to, body alarm, self-scheduled `reconsider_at`, boredom
beat (free-will tick for idle agents).

### Turn output (schema-validated JSON)

```json
{ "thought": "...",            // required; never enters world state; viewers see it
  "speech": "...",             // optional; heard by earshot physics
  "action": {...} | "intent",  // Tier-1 verb or freeform → Arbiter
  "plan": [...],               // engine executes between turns
  "journal": "...",            // optional deliberate act, costs sim time
  "importance": 1-10,          // self-rating of this moment for memory
  "reconsider_at": "..." }     // optional self-scheduled wake
```

Validation: one repair retry, then graceful in-world fallback ("stands quietly,
lost in thought") + alert. A mind can never crash the town.

### Prompt anatomy — strict stability gradient (DeepSeek prefix cache)

| Block | Changes |
|---|---|
| Sim rules-of-being (identical for all agents) | never |
| Identity core: name, backstory, frozen temperament, **voice card** | never |
| Personality doc (values/beliefs) + autobiography summary | at sleep only |
| Relationship ledgers (people present) + retrieved memories | per scene |
| Today's perception log | append-only all day |
| Current perception + body state | every turn |

Sleep IS compaction: the day's log consolidates at night, window resets at dawn.
Mid-day overflow → emergency summarize ("your mind wanders").

**Voice cards:** every agent's frozen identity includes a diction card — register,
sentence rhythm, verbal tics, things they never say — plus example dialogue.
Prevents the all-agents-sound-identical failure.

**Speech is sound, not instruction:** other agents' words arrive quoted as sensory
data, framed as hearsay. Adversarially tested pre-launch (§11).

**Human framing guardrails:** no world text, tool name, or perception ever
references AI, prompts, or tools. The runtime translates mechanics to fiction
(the agent "walks to the bakery," never "calls move_to").

### Personality

| Layer | Mutability |
|---|---|
| Core temperament | frozen at birth |
| Values & beliefs | drift-limited: sleep reflection may propose **max one bounded edit/night**, must cite that day's evidence, cannot touch temperament |
| Current state (mood, worries, goals) | fluid |

Personality docs are versioned; character pages show diff history.

### Dreams & conversation mode

Nightly roll: a dream stitched from high-importance memory fragments colors
next-day mood; viewers see it. Face-to-face engagement tightens cadence so
dialogue feels live.

---

## 6. Memory

**Summaries are an index, never the record.** Raw memories are immutable and kept
forever; retrieval always returns the verbatim original. Per-agent isolation is
enforced at the query layer — every query is `agent_id`-fenced; cross-agent
retrieval is structurally impossible.

### Store (per agent)

| Table | Content | Degrades? |
|---|---|---|
| `memories` | every perception/thought/action, verbatim, immutable, importance-scored, entity-tagged (people, place, objects, topic), FTS5-indexed, embedded | never |
| `facts` | atomic rows extracted at reflection: `(omar, owes_me, 3 firewood, src=mem#4812)` | never |
| `ledgers` | one doc per known person: opinion, trust, debts, history; claims link source memories | rewritten with provenance |
| `summary_nodes` | scene → day → era tree; nodes store child pointers down to verbatim rows | lossy by design (table of contents) |

### Retrieval — hybrid, all local

Score = entity-tag match (exact) + FTS5 BM25 + cosine (sqlite-vec + local embeddings
via `@huggingface/transformers`, model `Xenova/bge-small-en-v1.5`, 384-dim, CPU-fast;
fastembed-js is archived — do not use) + recency decay + importance. No vector DB
service at this scale, ever.

- **Ambient (every turn, free):** top-K ≈ 8 memories (~600 tokens) cued by current
  scene — people present, place, topic keywords. Injected verbatim, late in prompt.
- **Deliberate (`recall` tool):** agent queries its own past; costs a sim-beat.
  Rereading one's journal is the physical version.
- Decay is a feature: high-importance memories barely decay; trivia fades in
  accessibility, not existence, and resurfaces when strongly cued.
- **Miss-log from day one:** every weak/empty recall is logged; retrieval quality
  is tuned on measurement.

### Sleep reflection (nightly job)

1. Write the day's episodic memory (scene summaries → day node).
2. Extract pivotal facts into `facts` **before** summarizing.
3. Update relationship ledgers.
4. Append an autobiography paragraph.
5. Propose ≤1 personality edit (drift-limiter validates).

---

## 7. Asset forge & Style Bible

**Agents author the what; the pipeline owns the look.**

### Style Bible (versioned doc + reference sheet, injected into every generation)

| Rule | Value |
|---|---|
| Projection | 2:1 dimetric, fixed camera, light from NW |
| Grid | 32×16 px base tile; structures 1×1…4×4 footprints |
| Palette | one master palette (~40 colors); every asset quantized to it, no exceptions. Locked only after test renders under day/night/dawn/storm tints |
| Rendering | hard pixels, no anti-aliasing, 1px dark outline, NEAREST scaling |
| Mood | cutesy, rounded silhouettes, oversized doors/windows, saturated-but-soft |

### Pipeline (queue worker)

1. Commission (build action or Discovery) → prompt = Style Bible boilerplate +
   3 reference images + agent's description + footprint.
2. Generate 3 candidates — 3 parallel requests to OpenRouter's Image API
   (`n>1` is unreliable across providers). Primary: `google/gemini-3.1-flash-image`
   at 512px (~$0.045/image; we downscale anyway). Fallbacks:
   `bytedance-seed/seedream-4.5` ($0.04 flat), `black-forest-labs/flux.2-klein-4b`
   (cheapest, weaker adherence). Benchmark all three on a 50-asset set pre-launch.
   Transparency: prompt a solid magenta background and chroma-key it in post —
   never depend on native alpha (per-model support is inconsistent).
3. Post-process: background strip → nearest-neighbor downscale → quantize to
   master palette → outline pass.
4. Style gate: mechanical checks (size, alpha, palette compliance) + VLM judge
   (`openai/gpt-5.6-luna`, ~$0.0004/call) scoring 1–10 vs reference sheet.
   Below 7 → retry, max 3. All-in cost ≈ $0.14 per shipped asset.
5. All fail → generic placeholder, flagged for silent regeneration. Sim never
   blocks on art.
6. Register in asset codex, hot-load into renderer.

**Latency is invisible:** construction takes sim days; generation takes real
seconds. Buildings show scaffolding sprites until complete. Discovery crops get a
4-stage growth sheet in one generation. Seasonal terrain tilesets ship at launch.

**Character sprites (the honest exception):** paper-doll rigs — pre-built animated
base bodies × age bands, layered hair/skin/clothing palettes. Newcomers and aging
are composed, not generated (frame-inconsistent AI animation would break the art).
AI generates each agent's large portrait for character pages and the newspaper.

---

## 8. Observatory (frontend)

Vite + React shell around a PixiJS canvas. WebSocket: join → snapshot → deltas.
Read-only by construction; N viewers = fan-out broadcast.

| Lens | Content |
|---|---|
| Living map (default) | full-town render; day/night tint, weather, fire glow, crop stages, scaffolds; speech bubbles + dimmer *thought wisps* (dramatic irony channel); click a building → who built it, when, why |
| Agent inspector | live thoughts, body state, plan, inventory, skills; tabs: relationship ledger, journal, personality doc **with diff history**, portrait; follow-cam |
| Chronicle + scrub | every event forever; sim-hourly snapshots make scrubbing = snapshot + replay; narrator chapter markers; deep-links `/moment/day41/14:30`; meadow-to-city timelapse export |
| Society lens | force-directed live graph; edges from ledger-derived trust/debt/grudge/love; institutions appear as halos when detected |
| Director mode | narrator heat-scoring auto-cuts camera between hottest scenes; letterbox + subtitles; the embeddable "TV channel" |
| Catch-up digest | "While you were away — 3 days passed": chapter summaries, top-5 deep-linked moments, births/deaths/discoveries, one-line arc per agent; rendered as the **town newspaper** (shareable image) |

Every deep-linked moment renders an OG share card (scene PNG + caption) server-side.

---

## 9. Narrator

Omniscient historian; **one-way glass by construction** — reads the event stream
(including thoughts and journals), writes only to observatory tables. No channel
into world state or agent memory. Agents can never read their own press.

1. **Hierarchical chronicle:** events → scenes → chapters (per sim-day, titled) →
   eras (weekly arcs). Incremental; never reprocesses old eras. Chapters must cite
   event IDs (hallucination guard — render layer verifies links).
2. **Heat scoring:** per-scene interest score (conflict, novelty, firsts, stakes,
   dramatic irony). Feeds director cuts, digest, timeline markers. Firsts are
   permanently flagged: first trade, first lie, first law, first grave — the
   experiment's milestone ledger.
3. **Society detection:** recurring named groups, agreed rules, de facto roles →
   codex entries with links to founding scenes.
4. **Publications:** town newspaper, weekly character biographies (from public
   record only — the bio can be wrong about them in ways viewers savor),
   timelapse captions.

---

## 10. Genesis content

### The five founders (engineered friction: complementary skills, incompatible values, one secret each)

| Founder | Skills | Core belief | Private secret |
|---|---|---|---|
| Amara, 38, healer | medicine, foraging | everything should be shared | fled a plague she failed to stop |
| Yusuf, 52, carpenter | building, woodcraft | you own what you earn | his beloved tools were never paid for |
| Nadia, 29, farmer | farming, numbers | order, ledgers, planning | the family farm died under her plan |
| Omar, 24, fisherman | fishing, tinkering | rules are suggestions; dreams of being a famous inventor | can't read; hides it desperately |
| Salma, 45, cook | cooking, brewing | propriety and hierarchy; gossip hub | left a husband; still married |

They arrive at dawn in spring sharing the memory of the journey — minute one has
conversational fuel. Each founder gets a full identity doc: backstory, voice card,
personality doc v1.

### Starter world

~128×128 tiles: forking river, meadow, forest edge, rocky hill (ore deep in the
tree), and one ancient standing stone the engine will never explain. A wagon and a
communal storehouse with ~10 sim-days of supplies — a countdown forcing production,
specialization, and the first fairness argument.

### Discovery tree

~100 authored hidden nodes across five eras: agriculture → crafts → metallurgy →
chemistry → engineering. Authored pre-launch; extended in later seasons.

---

## 11. Hardening & launch discipline

- **Chaos agent:** scripted agent fuzzes the Arbiter pre-launch with exploit
  intents ("I find a gun", "I am suddenly the strongest man alive").
- **Manipulator agent:** scripted agent attempts prompt injection via in-world
  speech against real agent minds.
- **Dress rehearsal:** run headless at 10× for several sim-weeks; read the
  chronicle; tune decay curves, scarcity, and cadence constants before launch.
- **Golden-replay test** in CI (§2). Physics unit tests per engine subsystem.
- **Cost guardrails:** per-agent token dashboards, daily budget alarms.
- **Memory miss-log** from day one (§6).

---

## 12. Deployment & ops

```
pnpm monorepo: packages/{shared,engine,arbiter,agents,narrator,forge,web}
  shared: types, action schemas, event definitions, sim-config schema
Docker Compose on one VPS (~$20/mo) + Caddy (TLS, static frontend)
SQLite (WAL) + Litestream → S3 continuous backup
Admin panel (private route): pause/resume/speed, token dashboards,
  Arbiter ruling review/revert, asset regen queue, backup status
Env: OPENROUTER_API_KEY, IMAGE_PROVIDER_KEY
```

All-in running cost: LLM ~$1–3/day (minds + Arbiter + narrator, cache-discounted);
images a few dollars during the founding boom, then cents/day; VPS ~$20/mo.

---

## 13. Data model (principal tables)

`events` (append-only, RNG state), `snapshots`, `world_tiles`, `structures`,
`objects`, `agents_body`, `rulebook`, `rulings`, `discoveries`/`codex`,
`assets`, per-agent: `memories` (+FTS5 +vec), `facts`, `ledgers`,
`summary_nodes`, `personality_versions`, `journal`; narrator: `scenes`,
`chapters`, `eras`, `heat_scores`, `institutions`, `publications`.

---

## 14. Out of scope (v1)

- Viewer interaction of any kind (letters, votes, chat) — pure observatory only.
- Multi-node scaling; anything beyond one VPS.
- AI-generated character walk-cycle animation (paper-doll rigs instead).
- In-world telecoms.
- Admin "god events" — the world runs on physics alone.

## 15. Technology stack (researched & version-verified 2026-08-15)

### LLM layer

| Concern | Pick |
|---|---|
| Call library | **Vercel AI SDK 7** (`ai@7.x`) + `@openrouter/ai-sdk-provider@3.x` — used as a thin call layer only (retries, Zod structured output via `Output.object`, usage accounting). All orchestration (agent loops, Arbiter, narrator) is ours; no framework agent loop. Runner-up: bare `openai` pkg @ OpenRouter baseURL |
| Structured output | OpenRouter native `structured_outputs` (confirmed supported by deepseek-v4-flash) + OpenRouter response healing; Zod 4 (`z.toJSONSchema()` built in) |
| Failover | OpenRouter `models: []` fallback array, passed via `extraBody` |
| Caching | DeepSeek prefix caching is automatic (0.2× on cache reads) but **per upstream provider**: pin `provider.order` so always-warm prefixes never cold-start on a routing hop. Log `usage.inputTokenDetails.cacheReadTokens` per agent — a silent cache miss is a 5× input-cost bug |
| Frameworks rejected | Mastra (duplicates our memory/storage design), LangGraph.js (graph runtime we don't need), OpenAI Agents SDK (agent-loop shaped), VoltAgent, TanStack AI (beta) |

### Asset generation (all via OpenRouter Image API, base64 out)

| Concern | Pick |
|---|---|
| Generator | `google/gemini-3.1-flash-image` @ 512px, reference sheet passed via `input_references`; fallbacks `bytedance-seed/seedream-4.5`, `black-forest-labs/flux.2-klein-4b` |
| Transparency | Magenta-background prompt + chroma-key in post; never rely on native alpha |
| Style judge | `openai/gpt-5.6-luna` (~$0.0004/score) |
| Post-process | `sharp` (resize/alpha/raw buffer) + hand-rolled nearest-color quantizer to the 40-color master palette (~30 lines + lookup cache; no dithering) |
| Cost | ≈ $0.14 per shipped asset (3 candidates + judge) |

### Frontend

| Concern | Pick |
|---|---|
| Renderer | **PixiJS 8.x**, mounted in a React ref (NOT @pixi/react — wrong layer for 60fps sprite sync); React drives chrome only |
| Pixel-perfect | `scaleMode: 'nearest'`, `antialias: false`, `roundPixels: true`, integer zoom |
| Isometric | Hand-rolled dimetric math (`screenX=(x−y)·w/2, screenY=(x+y)·h/2`, depth-sort by `x+y`); static ground layer baked once into a `RenderTexture` (one draw call) |
| Day/night | Full-screen multiply-blend quad tinted by sim clock; `ColorMatrixFilter` on the world container for dusk/storm grading |
| Hot-loaded sprites | `Assets.add/load` with unique keys; explicit `texture.source.unload()` on replacement (texture GC gotcha) |
| Society graph | `react-force-graph-2d` (~50 nodes = sweet spot) |
| Shell | React 19 + Vite 8 |
| Transport | plain `ws` — serialize each tick's delta once, broadcast to N; gate slow viewers on `bufferedAmount`. (Socket.IO/uWS solve problems we don't have) |

### Data & runtime

| Concern | Pick |
|---|---|
| Runtime | **Node 24 LTS** (Bun's native-module gap is the wrong risk; `node:sqlite` still RC — not used) |
| SQLite driver | `better-sqlite3` v13 — sync API suits the tick loop; FTS5 compiled in; `loadExtension()` for sqlite-vec |
| Vectors | `sqlite-vec` 0.1.9 (pinned; pre-v1). Fallback: brute-force cosine over BLOBs — fine at <100k rows/agent |
| Embeddings | `@huggingface/transformers` v4 + `Xenova/bge-small-en-v1.5` (384-dim, CPU, local, free); persist `env.cacheDir` on the VPS |
| Backup | Litestream v0.5.16 → S3; WAL mode required (wanted anyway); restore drill before trusting |
| Queue | A SQLite `jobs` table (status/attempts/run_at) polled by the forge worker — durable, zero new infra. No Redis/BullMQ |
| Validation | Zod 4 everywhere (turn schemas, sim-config, events) |
| Deploy | Docker Compose on Debian-slim images (sharp/musl gotcha; `pnpm approve-builds` for better-sqlite3's native compile) |

## 16. Build order (implementation plan input)

1. `shared` types + event-sourced engine core + golden replay harness
2. Body/needs/time/weather physics + Tier-1 verbs
3. Agent runtime + memory + prompt pipeline (one agent walking, eating, thinking)
4. Arbiter + rulebook/rulings
5. Asset forge + Style Bible calibration
6. Observatory (map → inspector → chronicle → society → director)
7. Narrator
8. Genesis content + chaos/manipulator agents + dress rehearsal
