# San Junipero — architecture gap analysis and proposal

Tip `eac7a178`, read-only audit, 2026-09-02. All paths are under `/home/ubuntu/workspace/SanJunipero/packages/`.

## 0. Frame

**Vision (owner, verbatim):** pleasant to watch; conversations that take turns; agents create customs, laws, rules, inventions; memories, relationships, personalities; love, hate, break up, remarry; nothing scripted; a director camera that finds the moments, a few times a day.

**Owner reweight (2026-09-02):** "Smallville and such were missing an art forge and arbitration level that allows them to invent new laws, new verbs, new ideas. No limits on the imagination and capability of these agents, not a survival island." So the forge (`arbiter/src/codify.ts`, `expressive.ts`, the `experiment` verb) and the arbiter (`adjudicate.ts`, `verdict.ts`, laws) are the centre; survival is backdrop at most.

**Accepted diagnosis, confirmed in code:** the build is a survival engine asked to be a village.

| Claim | Evidence |
|---|---|
| Minds take independent per-tick turns | `agents/src/runtime/agentRuntime.ts:353-358` every runtime registers its own `onTick`; `:478` `void this.#startTurn()` never awaited; nothing waits for another mind |
| The prompt is a task briefing | `agents/src/prompt/prose.ts:778-1001` renders calendar → needs ladders → roads → visible things → inventory; `rulesOfBeing.ts:18-85` is a 40-verb operations manual |
| Needs are survival clocks | `shared/src/config.ts:3-21` hunger 0.021/tick, energy 0.093/tick; `engine/src/worldTick.ts:87-122` collapse and death |
| Talk is an accident of proximity | `engine/src/perception.ts:541-559` hearing is a read over the last 66 ticks of `agent_spoke`; `agents/src/wake.ts:239` any heard line is `salient_perception`; no addressee, no floor |
| The director follows activity heat | `gateway/src/heat.ts:5-15` weights: died 20, fire 12, spoke 2, item moved 1; `web/src/ui/directorCut.ts:8-33` hottest agent, 1.25x hysteresis |

## 1. Inventory — what exists toward each vision element

| Vision element | What exists | How far it goes | Key files |
|---|---|---|---|
| Invention (verbs) | Freeform act → arbiter → `attempt` recipe → `registerVerb` → permanent verb; expressive words minted as `express:<word>` | Works end to end for crafts and gestures; no other mind is ever told; codex never grows; 4 effect ops | `arbiter/src/adjudicate.ts:283-416`, `codify.ts:196-242`, `expressive.ts:88-201`, `engine/src/verbs/index.ts:2321-2328` |
| Laws | 40 whitelisted config paths an operator may flip; folded as `config_changed` | No mind can propose, vote, break or remember a law | `engine/src/laws.ts:9-54`, `town/src/devWorld.ts:388-390` (only caller) |
| Ideas / shared facts | Rulings (immutable, embedded), rulebook, codex, `discovery_made` event | `discovery_made` folds to nothing (`engine/src/fold.ts:266-271`) and is not in perception; the mind's sentence behind an invention is never persisted | `arbiter/src/schema.ts:28-59`, `shared/src/discovery.ts` |
| Customs | Constructs recognizer: 5 closed types from presence clustering, daily LLM classification | Observational only; agent-invisible by design (`arbiter/src/schema.ts:60-61`); nothing drives a repeat | `arbiter/src/constructs.ts:174-393` |
| Memory | Immutable SQLite stream, hybrid BM25+vec+tag retrieval, nightly facts/scenes/day/ledgers/autobiography/edit/gists, dreams | Strong. Reflection feeds goals, ledgers and autobiography; nothing feeds plans or relationships as state | `agents/src/memory/store.ts`, `retrieve.ts:32-38`, `reflection.ts:50-181`, `dream.ts` |
| Personality | Frozen temperament + voice card + values/beliefs/mood/worries/goals; ≤1 evidence-backed edit per night | Good and drift-limited; voice card never drifts | `agents/src/personality.ts:5-10,136-177`, `live/founderMinds.ts` |
| Relationships | Gateway bonds folded from log (6 kinds, valence, half-life 2 days); engine `pairNights` (co-sleep → partner, 7-day gap → dissolved); nightly prose ledger per person; runtime `#company` warmth | Bonds reach the viewer only (`liveCast.ts:41-42`); the mind sees one prose ledger line when the person is in scene; no promises, debts, slights, attractions as state | `shared/src/bonds.ts`, `gateway/src/bonds.ts`, `engine/src/fold.ts:697-723`, `agents/src/runtime/agentRuntime.ts:1069-1076` |
| Love/hate/remarry | Partnership = 3 co-sleep nights in a `house`; breakup = 7 days apart; `first_affair`, `first_breakup` milestones | Marriage is a bed statistic; no courtship, no proposal, no jealousy signal in the prompt | `engine/src/systems/reproduction.ts:13-102`, `narrator/src/milestones/tier2.ts` |
| Conversation | `speak` is `atOnce`; earshot 8 tiles with wall occlusion; 60-tick window, 5-tick beat; SPEECH_RULES prose | No scene, no floor, no addressee, no exit; all minds in earshot wake on every line | `engine/src/earshot.ts:18-46`, `agents/src/wake.ts:131-135,177-197`, `prompt/rulesOfBeing.ts:89-126` |
| Town growth | Plot lattice, build resumes a neighbour's site, map widens one edge a night | Solid physics; who builds what is a per-mind whim, never a town decision | `engine/src/verbs/build.ts:137-292`, `systems/mapGrowth.ts:90-111` |
| Narrator | Scenes, chapters, eras, 58 milestone detectors incl. relationship firsts, 5-axis heat with a `stakes` axis | Day-late, HTTP-polled, never reaches the camera | `narrator/src/heat.ts:22-69`, `segment.ts:29-71`, `gateway/src/narratorApi.ts` |
| Director | Per-agent event-weight heat, 60-tick windows, poll 5 s, hold 8 s, caption `DIRECTOR · name` | Follows one body; cannot follow a conversation; cannot say why | `gateway/src/heat.ts`, `web/src/ui/DirectorMode.tsx:49-98`, `directorCut.ts` |
| Plans / wake | 12-step plan queue, 8 wake reasons, reconsider_at appointments | Plans are bodily errands; no motive above needs | `agents/src/wake.ts:84-144`, `turn.ts:47-51` |
| Viewer channel | Every thought bubbles verbatim; speech bubbles tinted per speaker; lower third 140 chars | No policy on which thoughts show; no aside, no act marks | `gateway/src/observer.ts:3`, `web/src/render/bubbles.ts:329`, `web/src/ui/broadcast.ts:56-64` |
| Tiers | Two-model fleet, per-caller pins, fixed at construction | No per-turn choice | `llm/src/pins.ts:113-160` |

## 2. The centre: forge and arbiter

### 2.1 What exists

The only door into invention is a verb the registry lacks. `#reroutesUnknownVerb` (`agents/src/runtime/agentRuntime.ts:618-623`) fires once per turn; `#adjudicateFreeform` (`:634-672`) calls the arbiter with the flattened intent (`humanizeIntent`, `arbiterSeam.ts:38-49`) plus the mind's thought as `saying`. The pipeline in `arbiter/src/adjudicate.ts:283-416`:

| Stage | Line | Cost | What it does |
|---|---|---|---|
| 0 debris | 284-285 | 0 | Bounces intents made only of verb/param words |
| 1 rulebook | 287-289 | 0 | Exact normalized name → existing minted verb |
| 2 precedent | 293-319 | 0 | Cosine ≥ 0.92 returns the stored ruling |
| 2b expressive | 323-336 | 1 small | Stem match → coin a word, mint `express:<word>` |
| 3 full ruling | 338-410 | 1-2 | `map` / `attempt` (a full `Recipe`) / `impossible` |
| 4 record | 413 | 0 | Immutable precedent |

An `attempt` becomes physics the same turn: `codify` (`codify.ts:196-242`) inserts the rulebook row, `registerVerb(verbFromRecipe(recipe))` (`:230`) and queues a review. `verbFromRecipe` (`:119-194`) is a full `VerbDef`: costs consumed at start, weighted outcome table with skill factor at complete, tool wear, ownership stamp, expert mark. Restart re-registers every active row (`adjudicate.ts:209-217`). A coined word emits `agent_expressed` which other minds *see* through perception (`engine/src/perception.ts:596-616`) — the one invention that is genuinely visible to the town.

Laws are a separate, unrelated machine: `engine/src/laws.ts:9-54` is a whitelist of 40 config paths; `applyLaw` (`:60-62`) is enqueue-only and its only production caller is the operator seam `town/src/devWorld.ts:388-390`.

### 2.2 What is unwired

| Item | Evidence | Consequence |
|---|---|---|
| Minted verbs never reach a prompt | `rulesOfBeing.ts:18` `CAPABILITIES` is static; `engine/src/verbs/craft.ts:66-88` `makeables(config)` reads config recipes only; `arbiter/src/prompt.ts:37-44` `VERB_ROSTER` is hand-authored | Only the inventor can use an invention, and only by saying the same words again (rulebook exact match or cosine ≥ 0.92) |
| `discovery_made` is invisible to minds | `engine/src/fold.ts:266-271` folds to nothing; `perception.ts` `perceiveSeen` handles `item_taken`, `agent_expressed`, `mystery_event` only | Nobody learns that Omar worked out smoking fish |
| The spoken reason is dropped | `DiscoveryCredit.intent` is the flattened `humanizeIntent` string (`liveWorld.ts:545-554`); `saying` reaches the prompt and is never stored; `Recipe.summary` lives only in `rulings.verdict_json` | The chronicle says "X worked out Y" with no why |
| Codex never grows | No `codex.insert` outside genesis seeding (`live/src/liveWorld.ts:455-456`); `GENESIS_CODEX` has 8 known handwork rungs + 5 unearned arrangement rungs (`arbiter/src/canon.ts:27-72`); eras `works/machinery/industry` have zero entries; `knownEra()` is dead | The frontier is the same five rungs forever — the hardest cap in the system |
| `Arbiter.sanity()`, `Arbiter.revert()`, `NarratorLlm.newspaperCopy()` | no production callers | dead surface |
| Review is not a gate | `review.ts:45-60`; a pending verb is live the whole time | fine, but approval is theatre |
| Laws have no mind-side channel | `applyLaw` operator-only; `first_law` milestone is hard-coded `() => false` and fires off rulebook count (`narrator/src/milestones/tier1.ts:129`) | "law" in the chronicle means "recipe" |
| Constructs → nothing | `constructs.ts:345-393` upserts a registry; only bridge out is a tier-3 milestone | A festival that happened twice has no tomorrow |

### 2.3 What caps invention, in the order it bites

1. **Entry gate** — only an `unknown verb:` reroute, once per turn (`agentRuntime.ts:618-623`). Speech cannot propose; a plan step cannot; a council cannot.
2. **Prompt lines that discourage** — `experiment` always refuses with "You lack the knowledge to attempt this" (`engine/src/verbs/index.ts:2269-2276`); `CAPABILITIES` closes with "What you cannot do yet, the world will show you" (`rulesOfBeing.ts:85`); a refusal is written into memory verbatim and repeated for 240 ticks with no call (`agentRuntime.ts:167-172, 639-641`). Nothing in the prompt says *you may invent*.
3. **The one-way glass** — `FORBIDDEN_FRAMING` (`shared/src/chronicle.ts:212-213`) and `scanRulingForGlassLeak` (`glassScan.ts`) scan recipe names, labels, coined words and reasons. Right in spirit; it also bans `simulation` and `prompt` as ordinary English.
4. **Adjacency** — `codex.withinAdjacency` (`codex.ts:58-70`) rewrites any `attempt` whose canon is not known-or-one-step-out to `beyond_adjacency` before recording (`adjudicate.ts:401-410`), and `codify` throws on the same (`codify.ts:209-213`). With a frozen codex this is a hard ceiling, not a ladder.
5. **Canon prose** — "each new craft must be reached from one the town already practices, one careful step at a time"; "no yard that pours metal" (`canon.ts:17-21`). The instruction adds "impossible only if the action cannot even be started" (`prompt.ts:48-62`) — the framing is good; the codex behind it is not.
6. **Effect whitelist** — `OutcomeEffectSchema` is `spawn_item | gain_skill | hp_delta | none` (`verdict.ts:6-25`). An invention can make a thing or hurt a body. It cannot name a place, mark a person, found an institution, change a rule, or leave a visible trace on the ground.
7. **Vocabulary law** — a recipe may only name item kinds on `STREAM_VOCABULARY` (25 items, 8 structures, `liveWorld.ts:98-127`) plus what the asker holds and what the rulebook already makes (`sanity.ts:111-128`). New *kinds* appear only as products of recipes; new *structure* kinds never.
8. **Schema magnitude caps** — qty ≤ 20, xp ≤ 100, hp ±50, durability ≤ 200, duration ≤ 1440, `adjacent_tile` a 7-value enum (`verdict.ts:6-77`). Reasonable rails.
9. **Params** — `IntentParamsSchema` is a 13-key `looseObject` (`engine/src/verbs/index.ts:119-133`), embedded in `VerdictSchema.map` (`verdict.ts:90`). Minted recipe verbs take `{}`; expressive verbs take `targetId` only (`expressive.ts:137`). See §2.5.
10. **Mind-side re-ask** — `REPEATED_REFUSAL` for 240 ticks (`agentRuntime.ts:169-172`), `FALLBACK_IMPOSSIBLE` after two bad calls returned but not recorded (`adjudicate.ts:53-57`).

### 2.4 What "no limits" needs

Reframe the arbiter from a *physics court* (does the town have the stuff?) to a *grounding court* (what does this act do to the world, and what does everyone else see?). Concretely:

| Need | Mechanism |
|---|---|
| Open verb minting | Any speech or act can propose; the arbiter answers with a `VerbCharter` (see §4.0) that names what the verb reads, costs, and emits — never `impossible` for want of a codex rung, only for want of a first step |
| Grounded consequences | Widen effect ops: `spawn_item`, `gain_skill`, `hp_delta`, plus `mark` (a tag on an agent/structure/item that perception renders), `witness` (a labelled event others see/hear, like `agent_expressed`), `found` (a structure kind with a footprint, art via `discoveryArt`), `name_place`, `transfer` (title), `need_delta` (energy/social/warmth) |
| Verbs everyone can use | A `Town's own words` roster block in every prompt, read from the rulebook, plus `discovery_made` in perception (`seen`) with the inventor's sentence |
| Laws enforced and remembered | A `Law` row = text + a compiled predicate from a small closed set (`forbid verb X [where/when/on whose]`, `require X before Y`, `common store S`, `tithe`) evaluated in `submitIntent` next to the night-work penalty (`engine/src/intent.ts:117-121`); violations emit `law_broken` witness events; unenforceable clauses stay as remembered text in the canon block and the tension ledger |
| Ideas that become shared facts | A `notions` store: named ideas (a saying, a story, a belief) with provenance and holders; spread by hearing; rendered as "The town holds that..." |
| A growing codex | The `attempt` verdict may `unlock` a rung (id, name, prerequisite) when the recipe sits on the frontier; the arbiter proposes the *next* frontier from what was just unlocked. Keep exactly one hard canon: nothing arrives from outside the valley |
| A prompt that invites | Replace the `experiment` refusal with an invitation; add to `CAPABILITIES`: "Anything you can name, you may try; the world answers with what it took" |

### 2.5 Strict schema vs open minting — how both hold

**The tension.** `VerdictSchema.map.params` embeds `IntentParamsSchema` (`arbiter/src/verdict.ts:88-91`), a `z.looseObject` of 13 optional keys (`engine/src/verbs/index.ts:119-133`). The Luna prep found that a strict-schema decoder needs a closed object: exactly 13 keys, each required and nullable, no additional properties (memory: bake-off 2026-09-01, "Luna 0.99 @1.8x BUT only with Intent params rewritten to closed strict schema"). A minted verb that wants a fourteenth key cannot exist under that schema.

**The resolution: keys are grammar, verbs are lexicon.**

- The *verb* is a free string in every schema already (`IntentSchema.verb: z.string()`, `turn.ts:15`; `VerdictSchema.map.verb`). Strict decoders are fine with open strings. Minting new verbs costs nothing here.
- The *param keys* become a closed grammar of 13 cases: `x y itemId structureId targetId cropId nodeId faunaId kind recipe track text description`. Every verb, minted or native, reads only these. This is already true of every minted verb today (recipe verbs read nothing, expressive verbs read `targetId`).
- A minted verb that needs something else takes it through `text` or `description` and its own `validate` parses the words (a `toast` verb reads `text` for what is toasted; a `wager` reads `targetId` + `itemId`). Free words inside a closed slot is exactly how `speak`, `write` and `inscribe` already work.
- The `VerbCharter` names which keys the verb `reads: ClosedKey[]` so the roster line can say "wager: give targetId and itemId". `autofill.ts` (`engine/src/verbs/autofill.ts:17-35`) already moves a mark from a wrong key to the one the verb reads; extend its table from the charter.
- `IntentParamsSchema` becomes `ClosedIntentParams` = strict, 13 keys, `nullable().default(null)` each. `VerdictSchema.map.params` embeds the closed schema. `TurnSchema.action` embeds it. The loose object is deleted, not flagged.

Net: the strict schema is *more* compatible with open minting than the loose one, because the decoder never has to guess a key it has never seen. The only thing lost is a verb that needs a genuinely new typed slot, and none of the 36 native verbs needs one either.

## 3. Gaps per vision element — the missing mechanism

| Element | Missing mechanism | Reuse as-is | Extend | Replace |
|---|---|---|---|---|
| Motive | No want above need. `social` decays (`needs.ts:75-78`) but only debuffs walking and prints "Loneliness settles" (`prose.ts:837`). `goals` are three nightly lines (`reflection.ts:124-126`) | personality doc, nightly `standing` | `PersonalityDoc.current` gains a want vector; morning wake reads it | — |
| Scene | No object with participants, thread, floor, exit. Window is per-mind (`wake.ts:59-72`); every earshot mind wakes per line (`wake.ts:239`) | earshot rule, `speak` atOnce, `heardLine` | wake reasons gain `floor`; `Underway` block pattern for the scene block | conversation window and beat → coordinator floor |
| Tension ledger | Ledger is one prose doc per person, rewritten nightly (`reflection.ts:262-284`), shown only when the person is in the scene (`agentRuntime.ts:1069-1076`); bonds are viewer-only | `ledgers` table, `updateLedger` prompt | ledger returns structured `ties`; bond fold gains `promise/slight` kinds | — |
| Reflection → belief → plan | Edits touch values/beliefs (`personality.ts:136-177`); nothing writes a plan or an appointment | `reconsider_at` appointments (`turn.ts:195-207`) | nightly step 4 may set one appointment ("find Nadia at dusk") | — |
| Director | Scores activity per body (`heat.ts:5-15`); narrator's `stakes` axis exists but is day-late (`narrator/src/heat.ts:22-39`) | narrator axes, `directorCut` hysteresis, `SubjectRing` | gateway scores live scenes; camera follows a scene's participants | `HEAT_WEIGHTS` |
| Thoughts | Task narration; every thought bubbles (`observer.ts`, `bubbles.ts:329`) | thought bubble art, grave-tone suppression | importance gate + scene-only | — |
| Survival surplus | Founders hold 3 loaves each, no storehouse food, houses 3/4 built (`genesis/world.ts:74-89, 58-60`); hunger kills in 5.3 sim-days | all systems | dials and genesis stock (§4.1) | — |
| Customs | Recognizer classifies; no affordance to gather, no memory of "we do this at dusk" | constructs registry, fire_pit at the square | dusk gathering wake reason; recurrence → `custom` row minds can read | — |
| Laws | Engine toggles only; no proposal, vote, breach | `applyLaw` queue, `config_changed` fold | social `Law` rows with predicates; council scene | — |
| Inventions | Minted without a spoken reason; invisible to others | codify, discoveryArt, precedent | persist `saying`; perception `seen: discovery`; roster block | — |

## 4. Proposed architecture

### 4.0 Decisions first — data models and interfaces

```ts
// ── shared/src/intent.ts ─────────────────────────────────────────────
// Keys are grammar (closed, strict, nullable); verbs are lexicon (open string).
export const CLOSED_KEYS = ['x','y','itemId','structureId','targetId','cropId','nodeId',
  'faunaId','kind','recipe','track','text','description'] as const
export const ClosedIntentParams = z.object({
  x: z.number().nullable().default(null), y: z.number().nullable().default(null),
  itemId: str, structureId: str, targetId: str, cropId: str, nodeId: str, faunaId: str,
  kind: str, recipe: str, track: str, text: str, description: str,   // str = z.string().min(1).nullable().default(null)
}).strict()
export const Intent = z.object({ verb: z.string().min(1), params: ClosedIntentParams }).strict()

// ── arbiter/src/charter.ts ───────────────────────────────────────────
export type VerbCharter = {
  id: string                      // 'recipe:smoke_fish' | 'express:toast' | 'act:wager'
  name: string; gloss: string     // "wager: stake a thing on a claim, to one person"
  reads: (typeof CLOSED_KEYS)[number][]
  durationTicks: number; energyCost: number
  requires: RecipeRequirement[]; costs: {kind, qty}[]
  outcomes: OutcomeRow[]          // effects widened below
  unlocks?: { id: string; name: string; prerequisiteId: string }   // codex growth
  inventor: { agentId: string; saying: string }                     // the spoken reason
}
export type OutcomeEffect =
  | { op:'spawn_item'; kind; qty; durability? } | { op:'gain_skill'; track; xp } | { op:'hp_delta'; delta }
  | { op:'mark'; on:'self'|'target'|'structure'|'item'; key: string; value: string }      // visible tag
  | { op:'witness'; label: string; sense:'sight'|'sound'; radius?: number }                // others see/hear it
  | { op:'found'; kind: string; footprint: {w,h}; roofed: boolean }                        // new structure kind
  | { op:'name_place'; structureId?: true; text: string }
  | { op:'transfer'; itemId: true; to:'target' }
  | { op:'need_delta'; need:'energy'|'social'|'warmth'; delta: number }
  | { op:'none' }

// ── engine: laws the town writes (engine/src/socialLaws.ts) ──────────
export type LawPredicate =
  | { kind:'forbid'; verb: string; when?: 'night'|'day'; where?: 'square'|'house'|'field'; whose?: 'other' }
  | { kind:'require_before'; verb: string; before: string }
  | { kind:'common'; itemKind: string; structureId: string }
  | { kind:'tithe'; itemKind: string; qty: number; to: string; every: 'day'|'week' }
  | { kind:'none' }                                    // remembered, not enforced
export type Law = { id: string; text: string; predicate: LawPredicate; proposedBy: string;
  ratifiedTick: number; votes: { for: string[]; against: string[] }; repealedTick: number|null }
// events: law_proposed, law_ratified, law_broken {lawId, agentId, verb, witnesses[]}, law_repealed
// state.socialLaws: Record<id, Law>; evaluated in submitIntent beside nightWork.

// ── agents/src/scene/scene.ts (runtime coordinator, one per world) ───
export type SceneKind = 'talk' | 'quarrel' | 'council' | 'gathering' | 'telling'
export type Scene = {
  id: string; kind: SceneKind; openedTick: number; lastLineTick: number
  participants: string[]; floor: string | null            // whose turn it is
  thread: { agentId: string; text: string; tick: number }[]   // last 12 lines
  topic: string | null; stakes: number                     // 0-10, from ties + wants
  proposal?: { lawText: string; predicate: LawPredicate }  // council only
  passes: number; closedTick: number | null; closeReason?: 'ended'|'left'|'night'|'capped'
}
// witness events announced through bridge.announce, folded to nothing (like discovery_made):
// scene_opened {id, kind, participants, topic, stakes}, scene_line {id, agentId, text},
// scene_closed {id, summary, deltas: TieDelta[]}

// ── agents/src/memory (per-mind sqlite) ──────────────────────────────
// wants: kind IN (belonging, affection, esteem, curiosity, rivalry, order, legacy), level 0-100, lastFedTick
// ties:  personId, kind IN (promise, debt, slight, grudge, attraction, secret, alliance),
//        text, tick, settledTick NULL, source ('scene:<id>' | 'night:<day>')
export type Want = { kind: WantKind; level: number; lastFedTick: number }
export type Tie  = { personId: string; kind: TieKind; text: string; tick: number; settledTick: number|null }

// ── turn schemas ─────────────────────────────────────────────────────
// Routine turn: TurnSchema as today, action: Intent (closed params).
// Scene turn (cheaper, no plan/action): 
export const SceneTurn = z.object({
  thought: z.string(), speech: z.string().nullable(), gesture: z.string().nullable(),  // gesture = an express:/act: verb id
  stance: z.enum(['for','against','unsure']).nullable(),                             // council only
  leave: z.boolean(), importance: z.number().int().min(1).max(10),
}).strict()

// ── gateway director ─────────────────────────────────────────────────
export type StakeScore = { sceneId: string|null; agentIds: string[]; score: number; why: string; actMark?: string }
// ServerMsg gains { t:'scene', scene: SceneWire } — streamed, not polled.

// ── llm/src/pins.ts callers ──────────────────────────────────────────
// 'turn' (cheap) | 'turn.scene' (strong) | 'scene.close' (prose pin) | 'arbiter' (strong) | 'council' (strong)
```

### 4.1 Surplus — survival as backdrop

Survival stays real; it stops being the clock every turn is set by. Deaths remain possible from violence, fire, illness, old age, poison — the dramatic ones.

| Dial | Now | Proposed | Effect |
|---|---|---|---|
| `needs.hungerDecayPerTick` (`config.ts:7`) | 0.021 | 0.010 | empty stomach in 6.9 sim-days, death ~11 days |
| `needs.deathAfterZeroHungerTicks` (`:19`) | 2880 | 5760 | four days of hungry drama before a death |
| `thirst.decayFactorOfHunger` (`:471`) | 0.6 | 0.4 | tracks hunger |
| `warmth.exposureDecayPerTick` (`:546`) | 0.15 | 0.08 | a cold night is uncomfortable, not lethal |
| `weather.harshFromDay` (`:109`) | 7 | 21 | three founding weeks |
| `mortality.drainPerTick.illness/poison` (`:436-439`) | 0.08 / 0.12 | 0.04 / 0.08 | tending matters, dying takes days |
| `needs.bodyAlarm` (`wake.ts:32`) | hunger 25 energy 15 | hunger 15 energy 10 | fewer alarm wakes; body turns become rare |
| `needs.energyDecayAwakePerTick` (`:8`) | 0.093 | keep | sleep is the day's rhythm and the bed is where marriages form |
| `structures.sleepIndoorsOnly` (`:226`) | true | keep | houses matter |
| `attack`, fire, old age, `poisonChanceSpoiled` | — | keep lethal | death stays a story |

Genesis (`engine/src/genesis/world.ts`):

| Store | Now | Proposed |
|---|---|---|
| Founder kit bread (`:74-81`) | 3 | 6 |
| Storehouse (`:84-89`) | wood 20, stone 12, rope 4, cloth 4 | wood 60, stone 24, rope 8, cloth 8, **bread 20, dried fish 10, seed_pouch 3** |
| Founder houses (`GENESIS_ROOF_STOOD = 3/4`, `:58`) | 720 ticks of roof left each | finished; cottage and farmhouse stay 3/4 as the first shared project |

Measured, not assumed: one loaf = 60 hunger = 2857 ticks of current decay (`food.ts:14-29`); at 0.010 a loaf is 6000 ticks ≈ 4 days, so 20 storehouse loaves feed five people for ~16 days without a single harvest.

### 4.2 Scene — a first-class conversation

**Where it lives.** A `SceneCoordinator` in `agents/src/scene/`, one per world, owned by the live cast (`live/src/liveWorld.ts` next to `bootMinds`). Not the engine: the engine "does not know minds exist" (`agents/src/family/watchBirths.ts` comment) and turn order is mind scheduling. The coordinator announces witness events through `bridge.announce` (`agents/src/runtime/bridge.ts:211-213`), folded to nothing exactly as `discovery_made` is, so replay, the gateway and the director all read them from the log.

**Opening.** On any `agent_spoke` with no open scene containing the speaker: the coordinator builds the participant set from `hears()` (`engine/src/earshot.ts:18-46`) and opens a scene of kind `talk`. Kind upgrades: a line naming a tie of kind `grudge/slight` → `quarrel`; `express:*` by ≥3 at the square at dusk → `gathering`; a line matching a proposal pattern ("we should all", "from now on") → `council` with a `proposal` the arbiter compiles (§4.4).

**Turn order (the floor).** After each line, the floor goes to (1) the participant the line names by first name, else (2) the participant who has spoken least, ties by warmth to the speaker (`#company`, `agentRuntime.ts:525-548`). Only the floor-holder gets a wake; `decideWake` gains `floor` above `conversation_beat` (`wake.ts:131-135`), and the old per-mind window (`rearmConversationWindow`, `wake.ts:177-197`) is retired. Listeners take no LLM turn; they receive the thread at scene close as one memory. This is the biggest single call saving in the design: a five-person chat today costs five calls per line, tomorrow one.

**The prompt inside a scene.** `#runTurnBody` (`agentRuntime.ts:757-906`) branches on `scene !== null`: system prefix unchanged (cache), then one user block instead of journal/dayLog/scene/now:

> You are talking with Nadia and Omar by the well. Between you and Nadia: she owes you the axe (day 3). What you want most today: to be reckoned with.
> Nadia said: "…"  Omar said: "…"  Nadia, to you: "…"
> It is your turn. Answer the last thing said, or say nothing and let it end.

Inventory, needs ladders and makeables are omitted unless a body alarm is ringing. Output is `SceneTurn` (`gesture` is any `express:`/`act:` id, so minted words are usable in talk). Budget 300 output tokens.

**Exit.** `leave: true`, or `speech: null` from the floor-holder counts a pass; two passes in a row close it; a participant walking out of earshot leaves; 12 lines caps it with a "wrap it up" line on the tenth; night closes it. On close, one `scene.close` call on the prose pin writes a two-sentence summary and a list of `TieDelta` (promise/slight/attraction/debt with text), which the coordinator writes into each participant's `ties` and as one memory each (importance = stakes), and announces `scene_closed`.

**How the viewer follows it.** `scene_opened/line/closed` ride the socket as `{t:'scene'}` frames (`shared/src/protocol.ts:68-75` union); the camera frames the participants' centroid at a zoom that fits them (`web/src/render/scene.ts` `setFollow` gains a multi-anchor). The lower third shows the scene topic and, on close, its summary.

### 4.3 Wants and tensions

**Wants** (per mind, mind DB): `belonging, affection, esteem, curiosity, rivalry, order, legacy`, each rising ~1/hour sim (0.017/tick) and fed by events: `belonging` by any scene, `affection` by a partner scene or `express:` targeted at you, `esteem` by being taught from, praised (a lexicon over lines addressed to you), or a `discovery_made` credit, `curiosity` by a new place (`places_seen`) or a discovery witnessed, `rivalry` by a slight or `item_taken` of yours, `order` by a `law_broken` witnessed, `legacy` by a child, a named building, a codified verb. Personality biases the rise rate (a voice card "wants to be relied on" → esteem ×1.5). The highest want renders one line in the routine prompt and seeds the morning: at `morning` wake, the prompt adds "Today you most want …; who could give you that?" and the mind may set `reconsider_at` toward a person. Wants stay in the mind DB, not the engine: they are subjective, and the engine hash must not depend on an LLM.

**Ties** (per mind, mind DB): written by `scene.close` deltas and by nightly reflection step 5, which changes from "rewrite the prose note" (`reflection.ts:262-284`) to "rewrite the note **and** list ties: promises, debts, slights, attractions, settled or open". Rendered in the routine prompt whenever the person is visible or heard (same gate as ledgers today, `agentRuntime.ts:1069-1076`) and always in a scene block. A tie older than 7 days with no scene closes as "let go" and becomes a memory.

**Bonds (viewer)** gain the tie kinds so `BondsGraph` can show a promise or a grudge; `BOND_VALENCE` (`shared/src/bonds.ts:115-122`) gets `slight: -3`, `promise_kept: +3`, `promise_broken: -6`. The gateway reads them from `scene_closed` deltas in the log — the viewer sees exactly what the minds wrote.

**Marriage and break-up** stay the engine's bed statistic (`reproduction.ts:13-102`) but gain a doorway: a `talk` scene whose close carries `attraction` on both sides and whose participants co-sleep that night raises stakes; a `quarrel` between partners followed by 3 nights apart emits `partnership_strained`; the `first_breakup` detector already exists (`tier2.ts`). A `remarry` needs no new physics — a new partner after `dissolvedTick`.

### 4.4 Culture — customs, council, laws, inventions

**Dusk gathering affordance.** At `dusk` (`shared/src/time.ts:16-22`) the fire_pit at the square (`cityTemplate.ts:187-212`) becomes a cue: the routine prompt gets "The fire at the square is lit and Omar and Salma are there" when true; a new wake reason `gathering` fires once at dusk for any mind with `belonging > 60`. The lamplighter's nightly stoke (`town/src/founders.ts:353-458`) is scripted today; make `stoke` of the fire_pit the first custom the recognizer sees.

**Constructs → customs.** When `runConstructPass` (`constructs.ts:345-393`) records a second recurrence, it writes a `custom` row the *minds* can read: `{ name|null, what: 'gather at the fire at dusk', who, when }`, rendered in the routine prompt as "The town has taken to …". A named custom (`we call it X`, `constructs.ts:149-153`) becomes a `notion`. This is the one place the recognizer stops being one-way glass: a custom the town has is a fact of the town.

**Council scene → law.** A `council` scene carries a proposal. The arbiter compiles the proposal text to a `LawPredicate` with one strong-pin call (`council` caller); unenforceable text compiles to `none` and is remembered only. Each participant's `SceneTurn.stance` is a vote; the scene closes when every participant has a stance or after 12 lines; majority `for` → `law_ratified` → `state.socialLaws[id]` (engine fold, hashed) and the predicate runs in `submitIntent` beside the night-work penalty (`engine/src/intent.ts:117-121`). A refusal reads in the town's words: "the town agreed nobody takes from the common store at night". Breaking it is not prevented for `forbid` laws — the act goes through and emits `law_broken` with witnesses within sight, which is what makes a law social: the ledger, not the wall, punishes. `require_before`, `common` and `tithe` are enforced mechanically. `law_repealed` by a later council. The chronicle's `first_law` (`tier1.ts:129`) stops being a rulebook count.

**Inventions with a spoken reason.** `VerbCharter.inventor.saying` is the mind's `#lastThought` (`agentRuntime.ts:949`) at the time of the ask; it rides the `discovery_made` payload and is what the `seen` line says: "Omar has worked out smoking fish over green wood — he said the catch would not keep past the week." The roster block ("What the town has learned to do") lists every active charter with its gloss and `reads`, so anyone can `recipe:smoke_fish` next morning. A `telling` scene kind opens when the inventor's next line names the invention.

**Codex growth.** `attempt` may carry `unlocks`; `codex.insert({known:true})` on codify and a proposed next rung `{known:false, prerequisiteId}` from the same call. The five authored `arrangement` rungs stay as seeds. The one hard canon line stays: nothing arrives from outside the valley (`canon.ts:19`).

### 4.5 Director — stakes, not heat

Replace `HEAT_WEIGHTS` (`gateway/src/heat.ts:5-15`) with a live `StakeScore` per open scene and per body, computed in the gateway from the log:

| Signal | Weight | Source |
|---|---|---|
| open scene stakes | scene.stakes × 2 | `scene_opened` |
| tie delta on close | +6 per slight/promise_broken, +4 attraction | `scene_closed.deltas` |
| bond level change | +8 | `foldBond().levelChangedTick` (`shared/src/bonds.ts:216-222`) |
| first-time event type today (per agent) | +3 | novelty over the day's log |
| `discovery_made`, `law_ratified`, `law_broken` | +10 / +12 / +9 | log |
| `agent_died`, `agent_born`, `co_slept` first night, `partnership_strained` | 20 / 18 / 8 / 10 | log |
| emotional lexicon hit in a line (love, hate, swear, sorry, never, promise, mine) | +2 per | `scene_line` |
| council in session | +6 | scene kind |

Scored per scene when one is open, per body otherwise; hysteresis and 8 s hold stay (`directorCut.ts:29-31`). Captions: `stakes.why` ("Nadia and Yusuf, the axe again") and an act mark derived per sim-day: the first scene is `I`, the highest-stakes scene of the day `II`, the day's close `III`. The narrator's `stakes` axis (`narrator/src/heat.ts:22-39`) is reused for the day-late paper; the live one is the camera's.

### 4.6 Tiered minds

| Caller | Pin | When |
|---|---|---|
| `turn` | cheap (GLM flash today) | routine turns, plan pumping, body alarms |
| `turn.scene` | strong | every floor turn in a scene with stakes ≥ 4; below that, cheap |
| `scene.close` | prose pin | one per scene |
| `council`, `arbiter` | strong | proposals and charters are permanent |
| `reflection*`, `dream`, `narrator` | as today | |

The switch lives in `AgentRuntime` (a second `LlmClient` injected as `sceneLlm`, built by `makeClient('turn.scene', id)` in `liveWorld.ts:570-572`) and in `pins.ts` `SETTINGS_BY_CALLER`. Expected calls per mind per sim-day: routine turns fall from ~35-50 (agent inventory, `idleGapTicks: 30`) to ~20 because scene listeners take no turn and body alarms ring less; scene turns ~10-15 on the strong pin; night unchanged (~10 + gists). Town of 5: ~5-8 scenes/day → 5-8 `scene.close` + 0-2 council/arbiter calls.

### 4.7 Viewer channel

| Channel | Policy |
|---|---|
| Speech | always a bubble (world fact), as today (`bubbles.ts:328`) |
| Thought | bubble only when importance ≥ 6, or the camera subject, or inside a scene; stored regardless |
| Aside | none from minds (diegesis). The viewer's aside is the `scene.close` summary in the lower third and the caption `why` |
| Act marks | `I / II / III` stamp beside the day stamp (`QuietStamp.tsx`), set by the director |
| Ticker | `scene_closed` summaries and `law_ratified`/`discovery_made` lines with the spoken reason |

## 5. Phased plan

| Phase | Files / packages | New tests | What a viewer sees in a day | Size | Risk | Extra calls / sim-day (5 minds) |
|---|---|---|---|---|---|---|
| **1 Foundation: surplus + forge contract** | `shared/src/config.ts`, `engine/src/genesis/world.ts`; `shared/src/intent.ts` (ClosedIntentParams), `engine/src/verbs/index.ts:119-133`, `arbiter/src/verdict.ts:88-91`, `agents/src/turn.ts`; `arbiter/src/charter.ts`, `codify.ts`, `codex.ts` (insert at runtime), `verdict.ts` effect ops, `engine/src/fold.ts` (`mark`, `witness`, `found`), `engine/src/perception.ts` (`seen: discovery`), `agents/src/prompt/` roster block, `rulesOfBeing.ts:85` and `verbs/index.ts:2269-2276` (invitation) | schema round-trip strict decoder; charter → VerbDef; `unlocks` grows codex; discovery seen by a neighbour; golden fold for new ops; config death-time table | Nobody starves; an invention is announced and used by a second person the next morning | 8 eng-days | strict schema regressions on GLM (run the bake-off harness); `found` needs art (`discoveryArt`) | +0 (same arbiter path), roster block ~+150 tokens/turn |
| **2 Scene** | `agents/src/scene/` (coordinator, floor, close), `wake.ts` (`floor` reason, retire window), `agentRuntime.ts` scene branch, `SceneTurn` schema, `prompt/scene.ts`; `bridge.announce` witness events; `shared/src/protocol.ts` scene frame; `gateway/src/server.ts`; `web` camera multi-anchor, lower third | floor passes to the named person; listeners take no call; two passes close; earshot exit; night close; replay reproduces scenes; snapshot/restore of an open scene | 3-6 conversations that take turns, address by name, and end; the camera frames both speakers | 10 eng-days | prompt cache split (two prompt shapes); a floor-holder that dozes stalls the scene (timeout → pass) | net −20 to −30% turn calls; +5-8 `scene.close` |
| **3 Society: wants, ties, laws, customs** | `agents/src/memory/schema.ts` (wants, ties), `reflection.ts` step 5 structured, morning want line, `prose.ts`; `engine/src/socialLaws.ts`, `intent.ts` predicate hook, `events.def.ts` (law_*), `fold.ts`; `arbiter/src/council.ts`; `constructs.ts` custom row + prompt line; dusk `gathering` wake; `shared/src/bonds.ts` tie kinds; `gateway/src/bonds.ts` | want rises and is fed; tie written on close and read next scene; council majority ratifies; `forbid` emits `law_broken` with witnesses; `common` refuses in town words; custom row renders after 2 recurrences | A dusk gathering most days; a promise made, kept or broken within a week; one council that passes a rule and one person caught breaking it | 12 eng-days | law predicates too narrow (most proposals compile to `none`) — acceptable, they are still remembered; wants tuning | +1-2 council/arbiter, +0 otherwise (ties ride `scene.close`) |
| **4 Director, tiers, viewer** | `gateway/src/heat.ts` → `stakes.ts`, `web/src/ui/DirectorMode.tsx`, `directorCut.ts`, captions/act marks, `QuietStamp.tsx`, `bubbles.ts` thought gate; `llm/src/pins.ts` callers, `liveWorld.ts` `makeClient('turn.scene')`, `agentRuntime.ts` sceneLlm; spend rails per caller | stake scorer over a fixture log picks the quarrel over the harvest; thought gate; per-caller spend | The camera is on the argument, the caption says why, and Act II reads as Act II | 7 eng-days | strong-pin cost; a scorer that over-cuts (hold stays 8 s) | scene turns move to strong pin: ~50-75 calls/day at ~2-3x price; everything else unchanged |

Total ≈ 37 engineer-days. Phase 1 stands alone and unblocks the Luna lane; phases 2 and 3 are the village; phase 4 is the show.

## 6. Cost model per sim-day (5 minds, before → after)

| Bucket | Now | After phase 4 |
|---|---|---|
| Routine turns | 175-250 (cheap) | ~100 (cheap) |
| Scene turns | inside the above | 50-75 (strong) |
| Scene close | 0 | 5-8 (prose) |
| Arbiter / council | 0-10 | 2-12 (strong) |
| Night (reflection, gists, dream) | ~50 + gists | unchanged |
| Narrator, constructs | 3-7 | 3-7 |

At today's rails (`LIVE_SPEND_DAILY_USD = 3` per real day ≈ 30 sim-days, `liveWorld.ts:73-84`) the strong-pin scene turns are the only line that moves the bill; the routine saving pays for roughly half of it.

## 7. Assumptions, deviations, open questions

- **Assumed:** the strict 13-key schema is the target for every act-emitting caller (Luna lane), so the loose `IntentParamsSchema` is removed rather than flagged. If GLM regresses on a strict nullable schema, the bake-off harness (`scratchpad/bakeoff`) is the check.
- **Assumed:** the scene coordinator belongs to the runtime, not the engine, so the engine hash never depends on an LLM. The cost is that scenes are witness records, not folded state — same as `discovery_made` today.
- **Deviation from the brief:** wants and ties live in the mind DB, not engine state (the brief left it open). Bonds stay the viewer's derived read model and gain tie kinds from the log.
- **Not proposed:** a free-text `aside` field from minds. The owner wants diegesis; the narrator writes the asides.
- **Open:** should a `forbid` law ever block an act mechanically? Proposed no — witnessed breach is the drama. Owner call.
- **Open:** how wide the effect whitelist goes (`found` in phase 1 or 3). Proposed phase 1 behind the existing art commission gate.
- **Open:** whether the five authored `arrangement` rungs stay, or the codex starts from the eight handwork rungs and grows only from rulings.
