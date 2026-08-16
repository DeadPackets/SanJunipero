# San Junipero — Spec Addendum: C9 "Living World"

**Date:** 2026-08-16
**Status:** DRAFT — pending user review. Extends `docs/superpowers/specs/2026-08-15-san-junipero-design.md`; nothing here overrides a locked decision in that spec except where a user ruling of 2026-08-16 explicitly says so.
**Chunk order:** C9 executes after C6/C7 and **before C8** — genesis/dress-rehearsal becomes the last pre-production chunk so it rehearses the full world.
**Code baseline:** `main` @ d0d3562 (engine + agents + arbiter + forge merged). Plan file: `2026-08-16-09-living-world.DRAFT.md`.

**The philosophy in one sentence: author physics and initial conditions; never author social outcomes.** Courtship, marriage, cheating, inheritance, religion, politics, games, barter, and justice are never written into the engine — the engine makes them *possible and witnessed*, the minds make them *happen*, the narrator merely *detects* them.

---

## 1. Structure interiors (new physics — prerequisite for §2 and §4)

Today structures are fully impassable (`isPassable` rejects every footprint tile), so no agent can ever be *inside* one. Both user rulings — earshot occlusion ("speaker+hearer in same structure") and partnership inference ("co-sleeping in the same private structure") — are unimplementable without an interior model. C9 adds the smallest one that works:

| Mechanic | Rule |
|---|---|
| Door | Derived, never stored: the tile south of the footprint's horizontal center, `(s.x + ⌊(w−1)/2⌋, s.y + h)`; if impassable, first passable perimeter tile scanning clockwise from there. No passable perimeter tile → the structure cannot be entered ("no way in"). Pure function of state — replay-safe. |
| `enter {structureId}` | Tier-1 verb. Requires: structure `complete`, kind in `config.structures.enterableKinds` (default `['hut','storehouse']`), agent within reach (Chebyshev ≤ 1) of the door tile, not already inside. Duration 1. Emits `agent_moved` (to the door tile) + `agent_entered`. |
| `exit` | Tier-1 verb. Requires inside. Duration 1. Emits `agent_exited`; agent stands on the door tile. |
| Body state | `AgentBody.insideId?: string` — absent until first use (hash-stable, same pattern as `tendedTick`). While inside, `x/y` = door tile. |
| Physical touch | `give`/`take`/`tend`/`teach`/`attack`/`stow` between two agents (or agent↔item) require *same interior*: both inside the same structure, or both outside, plus the existing adjacency. A wall stops hands. |
| Movement | `walk` while inside is refused: "you are indoors; step outside first." A structure's destruction ejects its occupants (engine emits `agent_exited` before `structure_destroyed`; fold rejects a destroy with occupants still inside). Fire does **not** eject: an occupant of a burning hut perceives the burning and chooses to `exit` — or doesn't, and the town sees what that means. |

### Sight and earshot occlusion

Perception (`composePerception`) becomes interior-aware. All rules pure; earshot radius stays 8.

- **Sight:** an agent inside a structure sees only that interior — co-occupants and items with `loc {t:'structure', id}` — plus own body/weather (rain on the roof is audible). Agents inside structures are filtered out of outsiders' `visible.agents`. The existing adjacent-peek at structure contents (75b7d06) stays: through the doorway you see what is stored.
- **Hearing (`agent_spoke`):** heard iff — both in the same interior; or both outside within earshot distance; or one inside structure *s* and the other outside within Chebyshev ≤ 1 of *s*'s door tile (the doorway rule). `agent_spoke` payload gains optional `insideId` so the check replays from the event alone.

Whispered plots inside a hut become mechanically possible; eavesdropping at the doorway becomes a choice with a position.

### `stow {itemId, structureId}`

Inverse of `take` (which already pulls from structures): put a held item into a structure you are inside or beside. Emits `item_moved` to `{t:'structure', id}`. This closes the "no way yet to shelve what you hold" gap in `CAPABILITIES`, and is required for §5 (preserving food in the storehouse) and §2 (owned items stored away from their owner at death).

---

## 2. Item ownership (user ruling, 2026-08-16)

`Item` gains two fields; both flow through event payloads, never mutation:

```ts
owner?: string        // agent id; absent = unowned
crafterMark?: string  // permanent maker's mark; expert crafts only; never changes
```

| Rule | Mechanics |
|---|---|
| Acquire | Crafting, harvesting, fishing, foraging set `owner` = acting agent in the `item_spawned` payload. Taking an **unowned** item claims it: `item_moved` + `item_owner_changed {id, owner: takerId}`. |
| Transfer | `give` transfers: `item_moved` + `item_owner_changed {id, owner: targetId}`. This is the only voluntary transfer primitive, matching the barter-only economy. |
| Theft | Taking an item **owned by someone else is not engine-blocked**. The item moves; ownership does **not** transfer; the engine emits `item_taken {itemId, kind, takerId, ownerId, x, y}` — a distinct world event anyone with the spot in sight perceives. Detection is social, enforcement is emergent: the basket in the thief's hands is still, in everyone's prose, "Rahel's basket." |
| Maker's mark | An item crafted by an agent whose relevant skill level ≥ `config.crafting.expertLevel` (default 5) carries `crafterMark` = crafter id, permanently — through gifts, thefts, and deaths. Applies to the Tier-1 `craft` verb and to arbiter-codified recipes (§8). |
| Perception | `PerceivedItem` and inventory entries gain `ownerName?` / `crafterMarkName?`; prose renders "Rahel's basket", "a chair bearing Yusuf's mark". A new `seen` channel in the perception packet carries witnessed `item_taken` entries ("Omar takes Salma's bread"). |
| Death | Held items already drop on the death tile (`dropHeldItems`, main) — ownership rides along unchanged. **Owned items anywhere persist their ownership after the owner dies.** Heirs are a social question the minds settle: taking a dead person's item still emits `item_taken` with the dead `ownerId`, witnesses still see whose it was, and what the town does about it is the town's business. (User-recommended design adopted; the alternative — engine-side inheritance — would author a family law no one voted for.) |

Deliberately NOT authored: property law, punishment, restitution, inheritance rules, "stealing is wrong."

---

## 3. Reproduction — biology only (user ruling, verbatim intent)

The engine ships a reproductive *biology*; it never ships courtship, marriage, or fidelity. All rolls through the seeded `reproduction` RNG stream, recorded in events.

| Stage | Rule |
|---|---|
| Sex | `AgentBody.sex: 'f' \| 'm'`. `AgentSpawned` payload gains optional `sex` (fold default `'f'` keeps old logs parseable; all new spawns set it explicitly). Founders: Amara f, Yusuf m, Nadia f, Omar m, Salma f. Persona sheets state pronouns (fixes the probe's Sisay drift). |
| Partnership (inferred, never declared) | At midnight, for every **private structure** (`config.structures.privateKinds`, default `['hut']`), every unordered pair of agents asleep inside it gets a `co_slept {aId, bId, day}` event. World state tracks per-pair `{nights, lastNightDay}`. A pair is *partnered* while `nights ≥ 3` with no gap > 7 days between co-slept nights (gap resets the count to 1). **N = 3 within a rolling 7-day window**: one night is a guest, two is coincidence or a storm, three inside a week is a household pattern — and the window means estrangement mechanically dissolves the inference without anyone authoring a breakup. |
| Conception | Midnight, partnered pair that co-slept tonight, one f + one m, female age within `fertileYears` (16–45), female not pregnant: roll `conceptionChancePerNight` (default 0.2) → `agent_conceived {motherId, fatherId, day}`. |
| Gestation | `gestationDays` = **72 sim-days ≈ 3 real days** (user ruling 2026-08-16; still configurable): the pregnancy is a town-scale story arc across several real days of viewing. Body state: `pregnant?: {sinceDay, byId}`. |
| Birth | **Child spawns immediately at age 12 (world law, user-fixed).** `agent_born {id, name, sex, motherId, fatherId, x, y}` at the mother's location → full `AgentBody`, `ageDays = 12 × 365`, empty skills (learns by doing), `parents: [motherId, fatherId]`. **Registry name** and sex rolled from the `reproduction` stream over an authored name list (~40/sex) at the birth tick — initial conditions, not outcomes. |
| Naming (hybrid — user ruling 2026-08-16) | The engine's rolled registry name is permanent world state. The mother's next turn is prompted with the birth ("you have borne a daughter; the town rolls will know her as X — what do you call her?"), and whatever she calls the child is recorded as its **social name** (mind/ops-side table, never world state — determinism untouched). Social name may diverge from registry name; wiki/UI surfaces show both. If the mother is dead or never answers, the social name simply stays unset — the town will call the child something eventually, or not. |
| Child mind | A **full live mind from its first tick**. Persona derived deterministically from both parents' persona docs (seeded blend keyed on child id: temperament traits interleaved from both, voice register from one parent + rhythm from the other, values/beliefs sampled from the union, templated backstory naming both parents; the persona doc carries the social name once the mother gives one). **Household memory seed = public record only**: the child's memory store is pre-seeded from world events at the household and the parents' public acts — never copied from a parent's private memory store. Per-agent memory isolation is a §6 law of the base spec; a birth does not get to break it. (Deviation from a literal reading of "household memory seed" — flagged.) |

Deliberately NOT authored: courtship, marriage, weddings, cheating, jealousy, family names, who raises the child, what a "household" means socially.

---

## 4. Population unbounded + spend alert

Population is **unbounded** — no cap, no throttle on births or newcomer arrivals (arrivals stay C8-owned). The safety valve is operational, not diegetic:

- `SpendMonitor` (`@sj/agents`): projects daily LLM spend from the `llm_calls` table — spend over the last `windowRealMinutes` (default 15) × (60/window) = $/real-hour = $/sim-day (1 sim-day = 1 real hour). Measured anchor: ≈ $0.011/mind/sim-hour while talking.
- Alert when projection > `spendAlertUsdPerSimDay` — **default $10/sim-day (user ruling 2026-08-16; still configurable)**. Alert = `alerts` row (`kind: 'spend_projection'`) + console line; C8's supervisor wires the hourly check and an admin `/api/spend` endpoint.
- The alert informs the operator; it never touches the world. Pausing or scaling is a human decision.

---

## 5. Scarcity dials (needs must bite)

Probe evidence: needs never bit; nothing was scarce; no reason to barter. Three dials, all sim-config:

1. **Food spoilage.** Items of kinds in `config.spoilage.days` carry `spoilage: {spawnDay, days}` (set in the `item_spawned` payload): fish 2, berries 3, venison 4, bread 6; wheat 60 (seed corn survives winter). Midnight check, pure: deadline = `spawnDay + days × (in a preserving structure ? storehouseMultiplier : 1)` (default ×2, kinds in `preservingKinds: ['storehouse']`); past deadline → `item_spoiled {id}` removes the item. Perception marks items within 1 day of spoiling (`spoiling: true` → "the fish has begun to turn"). Consequence at day zero: the starter bread is a real countdown, and the storehouse is worth arguing over.
2. **Harsher seasons.** `config.seasons.winter`: `hungerDecayMultiplier` 1.25, `fishCatchMultiplier` 0.5 (forage already yields 0 in winter). Winter becomes a season you must have prepared for.
3. **Tool wear.** Items may carry `durability`. Arbiter-codified recipes (§8) wear their `held_item` requirement tools by `config.tools.wearPerUse` (1) per completed use → `item_worn {id, delta}`; at 0 → `item_broke {id}` (removed, witnessed by the holder's prose). The arbiter's `spawn_item` outcome effect gains optional `durability`, so the first fishing rod the town invents is also the first thing that wears out. Tier-1 verbs stay tool-free (they have no tool inputs today); wear rides exclusively on the expert-craft economy this chunk opens.

Deliberately NOT authored: rationing, granary rules, who eats first.

---

## 6. Writing & inscription — core verb, argued

**Ruling requested:** decide whether persistent readable text is a core verb or the first arbiter-codified craft. **Decision: core verb.** Three reasons:

1. The base spec already makes writing core physics (§3, "Communication physics": signs, notes, letters, ledgers are the town's defense against bad telephone). `write`/`read` notes shipped in C2 — inscription is the same physics on a fixed surface, not a new capability class.
2. Culture's biggest lever must be **day-0 available, free, and deterministic**. Gating it behind an arbiter discovery would make the town's first written law contingent on one mind phrasing a novel intent — that is authoring an outcome by lottery.
3. The arbiter path stays open anyway: paper, ink, books, printing are exactly the expert crafts (§8) the codify pipeline exists for. Core gives the floor; the arbiter grows the ceiling.

Mechanics: `inscribe {structureId, text}` — adjacent (or inside), structure complete, text ≤ 280 chars, duration 3 ticks (a deliberate act). Emits `structure_inscribed {structureId, text, agentId}`; structure carries `inscription?: {text, by}` (overwriting allowed — the event log keeps every layer of the palimpsest). Perception: `hasInscription` visible at sight range; the text itself readable only when adjacent or inside. Any completed structure can be inscribed — including the standing stone; if they carve the stone, that is their culture.

Portable text stays `write`/`read` on notes, unchanged.

---

## 7. Mystery events (the world keeps one hand hidden)

A `mystery` RNG stream rolls once per day (`chancePerDay` default 0.08 — roughly one event per 12 sim-days). On a hit, one entry from an authored table (~10 entries, initial conditions) fires as `mystery_event {kind, x?, y?}`:

- *Global felt* (all awake minds): every flame gutters blue for a breath; a single toll of a far-off bell; all birds fall silent at noon.
- *Located seen* (within sight of the point): the standing stone hums at dusk; a ring of pressed grass by the river fork; a light beneath the water.

Fold is a no-op — mysteries are pure sensation, zero state change, zero explanation. **The world NEVER explains them**: no discovery node resolves them, no arbiter ruling may attribute a cause (adjudication canon gains one line: unexplained happenings have no known mechanism), and the narrator must present them as unexplained — chapters may describe, never attribute (C7 prompt delta, listed in the audit task). If a religion forms around the stone, the test of real emergence is the cult acquiring specific local rules nobody authored.

---

## 8. Arbiter live wiring — expansion beyond C8's baseline

C8's draft owns the base seam (`arbiterSeam.ts`, freeform → `adjudicate`, its Task 12). Since C9 now executes first, **C9 adopts that task verbatim as its own prerequisite** and C8's Task 12 becomes verify-only (audit task lists the edit). On top of the baseline, C9 adds:

1. **Unknown-verb routing from the runtime.** Today an invented verb ("inspect", "patch the roof") dies as `unknown verb: X` refusal prose. New behavior: a submit rejection whose reason starts `unknown verb:` re-enters the mind's turn as a freeform intent (verb + params flattened to a sentence) and routes to `adjudicate`. The mind's vocabulary is no longer capped by the Tier-1 list.
2. **Codify-to-global-rulebook, live.** `attempt` verdict → `arbiter.codify(recipe)` (registers the verb, queues admin review) → `bridge.submit(recipe.id)` → engine rolls the outcome table with seeded dice. The second identical intent from *any* mind resolves through the rulebook/rulings short-circuits with **zero LLM calls** (call-count asserted at the gate). Adjudicate once, physics forever — now actually wired.
3. **Skill-gated expert crafts.** Recipes whose `skillCheck.difficulty ≥ config.crafting.expertDifficulty` (default 4) are expert crafts: outputs carry the maker's mark (§2) when the crafter's level ≥ `expertLevel`, and the `insufficient_skill` refusal path teaches (§9). Specialists become legible in the world's objects.

## 9. Refusal prose teaches a path

Same pattern as the G3 walkable-tiles fix — a refusal must leave a door open:

- `experiment` fallback string (now rarely reached, since freeform routes to the arbiter): "You lack the knowledge to attempt this. Perhaps someone in the town knows how."
- Arbiter `impossible/insufficient_skill` verdicts: runtime appends " — perhaps someone nearby knows the craft." (deterministic suffix, applied at prose time, never stored in the ruling).
- `craft` unknown-recipe refusal: "no such recipe: X — perhaps someone nearby knows how, or it wants discovering."

Deliberately NOT authored: who teaches whom, apprenticeship, guilds.

## 10. Voice — humanizer rules + per-persona speech budgets

Probe evidence: minds converse but sound alike and aphorize. Two changes, both prompt-side (`packages/agents` — this chunk owns prompt work):

1. **`SPEECH_RULES` block** appended to block 1 (after `CAPABILITIES`), identical for all minds, fully diegetic, distilled from the humanizer skill: speak as people do — vary length turn to turn; a single word can answer; fragments are honest; leave a sentence unfinished if the thought is; answer what was *just said*, in its own words, not its theme; never deliver a polished saying every time you speak — most talk is plain; no lists of three; grand words less often than plain ones. (One-time block-1 change = one-time prefix-cache invalidation; acceptable pre-launch, then frozen.)
2. **Per-persona speech budgets.** `voiceCard` gains `wordBudget: {typical, burst}` rendered into the identity block ("You usually say about 10 words at a time; when truly moved, perhaps 40"). Terse and talkative minds become measurably different (gate checks median utterance spread). Founder/persona content deltas are listed in the audit task — persona content is frozen and needs a user-approved amendment, not a silent rewrite.

## 11. Aging & natural death — already landed, C9 closes the loop

`agingSystem` (C2) already ages daily and rolls old-age death past `elderFromYears` 60. C9 adds the felt half: elders decay energy faster (`aging.elderEnergyDecayMultiplier` 1.2) and walk at debuff pace; perception surfaces age bands ("Yusuf, an old man now"); `agent_died {cause:'old_age'}` gets grave prose and (per Style Bible) the renderer's tone-aware stillness. No other changes — death of old age is a C2 fact, not a C9 feature.

## 12. Probe bug fixes (constitutional: budget guard hardening)

| Bug (probe report) | Fix |
|---|---|
| BudgetGuard race — 9% overshoot: five in-flight calls all pass the check, all book after | **Pessimistic reservation**: before each call, inside one better-sqlite3 transaction, `booked + reserved + expectedCallCostUsd > budget → BudgetExceededError`, else insert a reservation row (`expectedCallCostUsd` default $0.005 ≈ 3× observed mean); release on booking. Sync transactions make it race-free; worst overshoot = one reserved call. |
| Reflection dies on exhausted budget (4 of 5 nights lost) | Reflection catches `BudgetExceededError` and degrades: mechanical day summary (verbatim day-log digest), facts skipped, diegetic autobiography line, no personality edit, `reflection_fallback` alert. A mind never loses its day because the meter ran out. |
| `bridge.submit` promises hang after the last tick | `bridge.drain(reason)`: resolves all queued submits `{ok:false, reason:'the moment passes'}`; supervisor/harness calls it on shutdown. Turn loops terminate cleanly. |

## 13. New config keys (all defaults; single source `SimConfigSchema` unless marked agents-side)

```
structures.enterableKinds: ['hut','storehouse']     structures.privateKinds: ['hut']
reproduction.coSleepNightsToPartner: 3              reproduction.partnerWindowDays: 7
reproduction.conceptionChancePerNight: 0.2          reproduction.gestationDays: 72 (user ruling 2026-08-16)
reproduction.fertileYears: {from: 16, to: 45}       (SPAWN_AGE_YEARS = 12 — world law constant, not config)
spoilage.days: {fish:2, berries:3, venison:4, bread:6, wheat:60}
spoilage.storehouseMultiplier: 2                    spoilage.preservingKinds: ['storehouse']
seasons.winter: {hungerDecayMultiplier:1.25, fishCatchMultiplier:0.5}
tools.wearPerUse: 1
crafting.expertLevel: 5                             crafting.expertDifficulty: 4
mystery.chancePerDay: 0.08
aging.elderEnergyDecayMultiplier: 1.2
agents-side: spend.alertUsdPerSimDay: 10 (user ruling 2026-08-16)   spend.windowRealMinutes: 15
agents-side: llm.expectedCallCostUsd: 0.005
feature flags, all default true (user ruling 2026-08-16, §19):
  reproduction.enabled   aging.deathOfOldAgeEnabled   spoilage.enabled   tools.wearEnabled
  mystery.enabled        occlusion.enabled            ownership.enabled  inscription.enabled
```

Every flag and dial above is settable at world creation and flippable mid-run via `config_changed` (§19); the spend threshold alone adjusts through the ops tables, not the world log.

## 14. New event vocabulary (all payloads Zod `.strict()`, fold extended)

| Event | Payload | Fold effect |
|---|---|---|
| `agent_entered` | `{agentId, structureId}` | `insideId` set |
| `agent_exited` | `{agentId, structureId}` | `insideId` cleared |
| `item_owner_changed` | `{id, owner?: string}` | owner set/cleared |
| `item_taken` | `{itemId, kind, takerId, ownerId, x, y}` | none (pure witness record; the move is its own `item_moved`) |
| `item_spoiled` | `{id}` | item removed |
| `item_worn` | `{id, delta}` | durability decremented |
| `item_broke` | `{id}` | item removed |
| `co_slept` | `{aId, bId, day}` | pair nights ledger updated |
| `agent_conceived` | `{motherId, fatherId, day}` | mother `pregnant` set |
| `agent_born` | `{id, name, sex, motherId, fatherId, x, y}` | new AgentBody @ ageDays 12×365, `parents` set, mother's `pregnant` cleared |
| `structure_inscribed` | `{structureId, text, agentId}` | inscription set |
| `mystery_event` | `{kind, x?, y?}` | none (pure sensation) |
| `config_changed` | `{path, value}` (user ruling 2026-08-16) | `laws[path] = value` after whitelist + type validation (§19) |

Payload extensions: `agent_spawned` +`sex?`; `agent_spoke` +`insideId?`; `item_spawned` +`owner?`, `crafterMark?`, `spoilage?`, `durability?`. All optional → old event logs still parse.

## 15. Determinism & replay

- All new randomness through named streams: `reproduction`, `mystery` (drawn at event creation, recorded in payloads; `fold(events)` stays pure and RNG-free).
- Spoilage, partnership, occlusion, doors, ownership: fully deterministic, zero rolls.
- World-law flips (§19, user ruling 2026-08-16): active config lives in `WorldState.laws`, covered by the state hash; mid-run changes exist only as `config_changed` events at tick boundaries, so replay reproduces every flip and every downstream difference exactly. No side-channel config mutation.
- New systems change synthetic-day event streams, so the golden fixture changes: **golden regen is one deliberate, single event** — its own plan task, one commit, replay-from-genesis and replay-from-snapshot asserted green before and after.
- Child persona/memory-seed derivation is mind-side (like reflection): outside world state, allowed to be non-replayed; the *body* (`agent_born`) is fully deterministic.
- One-way glass intact: narrator gains a rule (never explain mysteries) and loses nothing; no new write path into world or minds. Spend alert writes to ops tables only.

## 16. What is deliberately NOT authored (consolidated)

Courtship, marriage, weddings, cheating, breakups; family names, households-as-institutions, child-rearing roles, inheritance and heirs; property law, theft punishment, restitution; rationing and food politics; religion, ritual, meaning of mysteries; teaching obligations, guilds, apprenticeship; prices, money; games; politics. The narrator detects these; the engine only makes them possible, costly, and witnessed.

## 17. GATE G9 — what a 2-sim-day live run must show

Two-part gate; both green.

**G9a — deterministic scripted suite** (non-LLM actors, headless, no live spend): partnership inferred at exactly 3/7 co-slept nights and dissolved by an 8-day gap; conception → gestation → `agent_born` at age 12 under accelerated config; ownership chain craft→give→theft with `item_taken` witnessed by a third scripted actor and invisible to an out-of-sight one; occlusion — inside-hut speech unheard at distance 3 outside, heard at the doorway, heard by a co-occupant; stow + storehouse spoilage multiplier honored; a tool wears out and breaks; an inscription written and read back; mystery event perceived per scope; elder death fires under a forced config; **world-law determinism (user ruling 2026-08-16):** a scripted day flips ≥ 2 flags mid-run via `config_changed` (e.g. `spoilage.enabled` off, `mystery.chancePerDay` up), behavior changes on the very next tick, replay from genesis AND from a pre-flip snapshot reproduce the identical state hash, and a non-whitelisted path is rejected at fold; golden replay green after the single regen event.

**G9b — 2-sim-day live run** (5 minds + one staged birth; hard USD cap). Staging note (user ruling 2026-08-16): with gestation at 72 sim-days a day-zero conception can never birth inside the 2-sim-day gate window, so the birth is staged via a **seeded fixture**: the day-zero state includes a partnered couple whose pregnancy is backdated (`pregnant.sinceDay` set so the term completes on day 1 of the run). Initial conditions, fully deterministic; the default `gestationDays: 72` is untouched.
1. Runs 2 full sim-days, zero crashes; `bridge.drain` leaves zero hung promises (turn stats reconcile).
2. Child born live; child mind boots as a full mind, takes ≥ 5 turns; persona file names both parents; memory seed contains only public-record entries. The mother's next turn is prompted with the birth and her social name for the child is recorded (registry name and social name may diverge — both logged).
3. ≥ 1 novel intent adjudicated and codified live; a repeat of the same intent resolves with **0 arbiter LLM calls** (call-count assertion).
4. An `unknown verb:` rejection observed routing to the arbiter instead of surfacing as refusal prose.
5. Budget: total spend ≤ cap + one `expectedCallCostUsd` (reservation working); **0 reflections lost** (completed or fallback); spend projection logged hourly and a forced-low threshold fires the operator alert.
6. Voice: no mind averages > 35 words/utterance across the run; the tersest persona's median utterance < the most talkative persona's median (budgets visibly differentiate).
7. At least one ownership phrase ("X's …") appears in a perception prose log, and any theft that occurs produces witness prose.
8. World laws live (user ruling 2026-08-16): the operator flips ≥ 1 flag mid-run through the admin dashboard path (gateway command → `config_changed` at a tick boundary); the flip shows in the viewer "World Laws" panel with its history entry; post-run replay reproduces the run's state hash.

## 18. Interaction with C8 (boundary statement)

C8 keeps: newcomer arrivals, founder/persona content authoring, discovery tree, `@sj/supervisor` + its admin panel (pause/speed, tokens, rulings, regen queue), deploy, dress rehearsal. C9 hands C8: the arbiter seam (adopted from C8's Task 12 — becomes verify-only there), `SpendMonitor` + `watchBirths` + `bridge.drain` + the world-law command channel (`applyLaw` + gateway admin listener, §19) to wire into the supervisor, founder schema deltas (sex, pronouns, wordBudget), and a rehearsal that now includes births, spoilage, mysteries, and at least one mid-run law flip. The two admin surfaces split cleanly: C9's laws dashboard governs world physics via the event log; C8's supervisor panel governs the runtime process. The full edit list lives in the plan's audit task; this addendum changes no C8 text.

## 19. World-law toggles — runtime feature flags (user ruling 2026-08-16)

Every C9 feature is individually toggle-able and its dials adjustable — **both** at world creation (plain sim-config) **and at will mid-run** — without ever breaking determinism.

### The determinism contract (binding)

- `WorldState` gains `laws: Record<string, unknown>` (init `{}`) — the active overrides. **The state hash covers it.** Effective config = base sim-config ⊕ `laws`, derived per tick (`effectiveConfig(base, laws)`, memoized); every system, verb, and perception call reads the effective config.
- A mid-run change lands **only** as a `config_changed {path, value}` event, committed at a tick boundary through the normal event log (same queue-and-drain shape as intents: `applyLaw(path, value)` enqueues; the tick wrapper drains and emits). Fold validates `path` against an exported `TOGGLABLE_PATHS` whitelist (path → Zod type) and sets `laws[path]`. Replay of the log reproduces every flip exactly; snapshots carry `laws`. **No side-channel mutation of engine config, ever.**
- Whitelisted paths: `reproduction.enabled` + all reproduction dials (conception chance, gestation), `aging.deathOfOldAgeEnabled`, `spoilage.enabled` + rates, `tools.wearEnabled`, `seasons.winter.*` dials, `mystery.enabled` + `chancePerDay`, `occlusion.enabled`, `ownership.enabled`, `inscription.enabled`. The spend-alert threshold is **ops-side, not world physics**: it is adjustable live through the same admin UI but lands in the ops tables, never in the world event log.

### Off-state semantics (defined, not implied)

| Flag off | Behavior |
|---|---|
| `reproduction.enabled` | no `co_slept`/`agent_conceived`/`agent_born` emissions; existing pregnancy clocks are day-counted from conception, so a long off-period then re-enable can birth immediately — accepted and documented |
| `aging.deathOfOldAgeEnabled` | `agent_aged` continues (bodies still age); the old-age death roll is skipped |
| `spoilage.enabled` | no `item_spoiled`; deadlines derive from `spawnDay`, so re-enabling spoils overdue items at the next midnight — accepted |
| `tools.wearEnabled` | no `item_worn`/`item_broke` |
| `mystery.enabled` | no daily roll |
| `occlusion.enabled` | hearing reverts to plain radius-8; interiors, enter/exit, and interior *sight* remain (the flag governs the wall-blocking sound rule only) |
| `ownership.enabled` | no `item_owner_changed`/`item_taken` emissions and perception stops surfacing owner/mark names; owners already in state persist inertly |
| `inscription.enabled` | `inscribe` refused diegetically ("your hands find no way to mark this"); base-spec `write`/`read` notes are C2 physics and are NOT behind this flag |

### Operator dashboard (admin layer — not the narrator; one-way glass unaffected)

An operator-only surface in the gateway/web app: current value + edit control per flag; an edit posts a gateway→supervisor command that lands as the `config_changed` event at the next tick boundary. **Auth boundary (decided, argued):** the admin channel is a separate HTTP listener **bound to 127.0.0.1 by default** AND requires a bearer token (`SJ_ADMIN_TOKEN`) on every request. Token-only fails open when a proxy or log leaks the header; localhost-only fails operations when the operator is remote — the combination is safe by default and still operable over an SSH tunnel, and matches the C8 admin server's existing token pattern. Public exposure via Caddy is an explicit opt-in, never the default. Admin commands are operator/god-layer *ops*, not a channel into minds: no prompt, memory, or narrator table is reachable from it.

### Viewer "World Laws" panel (all viewers, read-only)

A submenu in the observatory listing every toggle's current value plus its change history, derived entirely from `config_changed` events (the ws snapshot gains a `laws` block; deltas carry flips). Viewers see the laws of their world and when they changed — they still influence nothing.

## Deviations & assumptions (logged, not silently decided)

1. Interiors (§1) are a C9 invention — the smallest mechanic that makes two user rulings implementable. Nothing in the base spec contradicts it.
2. "Household memory seed" implemented as public-record-only (§3) to preserve the per-agent memory-isolation law. A literal parent-memory copy was rejected.
3. Gestation (72 sim-days), spend alert ($10/sim-day), and hybrid naming were open taste questions — all three settled by user rulings 2026-08-16 and applied throughout.
4. Code read from `main` @ d0d3562 (the physics-verbs worktree branch lacks `@sj/agents`/`@sj/arbiter`); "items drop at death" confirmed there.
5. Newborn naming is hybrid (user ruling 2026-08-16): engine rolls the permanent registry name at the birth tick (deterministic world state); the mother's next turn is prompted with the birth and her chosen name becomes the child's social name (mind/ops-side, may diverge; wiki/UI shows both).
