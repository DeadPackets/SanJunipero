# San Junipero v2: the Village Turn

Spec: the reconciliation report (artifact "The Village Turn", 2026-09-02) and its sources under the session scratchpad `docs/superpowers/specs/v2/` (architecture-gap.md §4 carries the data models this plan adopts; research-sota.md the literature; evidence.md the baseline; scene-proto/transcripts.md the prototype). The owner approved every decision D1-D9 on 2026-09-02 and ruled: "disregard v1 as a failed survival village; go for v2 as the true vision."

Branch: `v2` (cut from `519b8f27`). Every task runs in its own worktree on a branch `v2/<slug>` cut from the current `v2` tip; the controller merges. `main` fast-forwards at phase gates only.

## Global Constraints (binding on every task)

1. **Simplicity.** Build the simplest thing that solves the task. No speculative features, no configurability nobody asked for, no abstraction for single-use code, no handling for impossible states. If a senior engineer would call it overcomplicated, rewrite it.
2. **Comments: default none, cap two lines.** Only for a constraint the code cannot show (why this value, why not the obvious way, an external gotcha). Never what the next line does, never what changed.
3. **Surgical diffs.** Every changed line traces to the task. Match existing style. Do not refactor or improve adjacent code. Remove what your own change orphaned.
4. **TDD and focused tests.** Write the failing test first. Iterate with `pnpm vitest run <file>`; run the touched packages' suites once before committing (`pnpm vitest run packages/<a> packages/<b>`). Never run the whole repo suite or a 40-minute rehearsal inside a task. Determinism tests exist (golden folds, hashes); update goldens only when the task intends the change and say so in the report.
5. **Cost and performance.** Every prompt line must earn its tokens; measure a prompt's token delta when you add to it and report it. No new LLM call paths beyond what the task names. Hot paths (per-tick, per-turn) stay allocation-light.
6. **Strict schema law.** Every act-emitting LLM caller uses `ClosedIntentParams`: exactly 13 keys (`x y itemId structureId targetId cropId nodeId faunaId kind recipe track text description`), each nullable with default null, `.strict()`. The verb is an open string. No loose objects.
7. **Engine hash law.** The engine's folded state never depends on an LLM output except through events the engine already folds plus the new `law_*` and `partnership_*` events. Scenes, wants, ties and stakes live in the runtime or the gateway and are witness records in the log.
8. **Live calls and secrets.** Never read, cat, echo, grep-print or log `.env` or any API key. Live LLM or image calls only as `node --env-file=<repo-root>/.env --import tsx <script>`. Report every dollar spent. Never touch the production container, port 8090, or admin port 8788. Rehearsals use ports 8095 and up.
9. **Process hygiene.** Kill by PID, never `pkill -f`. Never `git pull`, never bare `git stash`. Worktrees are sometimes cut from stale commits: first compare `git log -1` with `git -C /home/ubuntu/workspace/SanJunipero rev-parse v2` and `git checkout --detach` the v2 tip if they differ, then create your branch.
10. **Commits.** Read `git log --oneline -15` and match the voice (a sentence about what the town gains, not a changelog). End every message with:
    `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
    `Claude-Session: https://claude.ai/code/session_01Fv7TMdGbp6aijJ41zaaSTX`
11. **Skills.** Frontend tasks invoke `impeccable`, `frontend-design`, `make-interfaces-feel-better` and `vercel-react-best-practices` before editing UI. Every task reads `docs/GLOSSARY.md` for the town's words.
12. **Reports.** Write the full report to the report file named in your dispatch. Return only: status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED), branch and commits, one-line test summary, spend, concerns.

## Contract: shared data models and interfaces

Adopted from the gap audit §4.0 with the owner's rulings folded in. A task that needs one of these creates it exactly as written; a later task consumes it.

```ts
// packages/shared/src/intent.ts
export const CLOSED_KEYS = ['x','y','itemId','structureId','targetId','cropId','nodeId','faunaId','kind','recipe','track','text','description'] as const
export type ClosedKey = (typeof CLOSED_KEYS)[number]
export const ClosedIntentParams = z.object({ x: num, y: num, itemId: str, ... description: str }).strict()
//   num = z.number().nullable().default(null); str = z.string().min(1).nullable().default(null)
export const Intent = z.object({ verb: z.string().min(1), params: ClosedIntentParams }).strict()

// packages/arbiter/src/charter.ts
export type VerbCharter = {
  id: string                       // 'recipe:smoke_fish' | 'express:toast' | 'act:wager'
  name: string; gloss: string      // "wager: stake a thing on a claim, to one person"
  reads: ClosedKey[]
  durationTicks: number; energyCost: number
  requires: RecipeRequirement[]; costs: { kind: string; qty: number }[]
  outcomes: OutcomeRow[]
  unlocks?: { id: string; name: string; prerequisiteId: string }
  inventor: { agentId: string; saying: string }
}
export type OutcomeEffect =
  | { op: 'spawn_item'; kind: string; qty: number; durability?: number }
  | { op: 'gain_skill'; track: string; xp: number }
  | { op: 'hp_delta'; delta: number }
  | { op: 'mark'; on: 'self' | 'target' | 'structure' | 'item'; key: string; value: string }
  | { op: 'witness'; label: string; sense: 'sight' | 'sound'; radius?: number }
  | { op: 'name_place'; text: string }
  | { op: 'transfer'; to: 'target' }
  | { op: 'need_delta'; need: 'energy' | 'social' | 'warmth'; delta: number }
  | { op: 'none' }
// 'found' (a new structure kind) is deferred to phase 3 behind the art commission gate.

// packages/engine/src/socialLaws.ts
export type LawPredicate =
  | { kind: 'forbid'; verb: string; when?: 'night' | 'day'; where?: 'square' | 'house' | 'field'; whose?: 'other' }
  | { kind: 'require_before'; verb: string; before: string }
  | { kind: 'common'; itemKind: string; structureId: string }
  | { kind: 'tithe'; itemKind: string; qty: number; to: string; every: 'day' | 'week' }
  | { kind: 'none' }
export type Law = { id: string; text: string; predicate: LawPredicate; proposedBy: string; ratifiedTick: number;
  votes: { for: string[]; against: string[] }; repealedTick: number | null; why: string }
// events: law_proposed, law_ratified, law_broken { lawId, agentId, verb, witnesses: string[] }, law_repealed
// state.socialLaws: Record<id, Law>. forbid never blocks: the act goes through and law_broken is emitted.

// packages/agents/src/scene/scene.ts  (runtime coordinator, one per world)
export type SceneKind = 'talk' | 'quarrel' | 'council' | 'gathering' | 'telling' | 'invitation'
export type Move = 'press' | 'give_way' | 'deflect' | 'tease' | 'none'
export type Scene = {
  id: string; kind: SceneKind; openedTick: number; lastLineTick: number
  participants: string[]; floor: string | null
  thread: { agentId: string; text: string; aside: string; move: Move; tick: number }[]   // last 12
  topic: string | null; stakes: number                                                  // 0-10
  proposal?: { lawText: string; predicate: LawPredicate }                               // council only
  invitation?: { verb: 'court' | 'propose' | 'lie_with'; from: string; to: string }     // invitation only
  passes: number; closedTick: number | null; closeReason?: 'ended' | 'left' | 'night' | 'capped' | 'timeout'
}
export const SceneTurn = z.object({
  thought: z.string(), speech: z.string().nullable(), gesture: z.string().nullable(),
  move: z.enum(['press','give_way','deflect','tease','none']),
  stance: z.enum(['for','against','unsure']).nullable(),          // council only
  answer: z.enum(['accept','refuse']).nullable(),                 // invitation only, the invitee
  leave: z.boolean(), importance: z.number().int().min(1).max(10),
}).strict()
// witness events announced through bridge.announce and folded to nothing (like discovery_made):
// scene_opened { id, kind, participants, topic, stakes }, scene_line { id, agentId, text, move },
// scene_closed { id, summary, deltas: TieDelta[], closeReason }

// packages/shared/src/protocol.ts  (socket frame, streamed not polled)
{ t: 'scene', scene: { id, kind, participants, topic, stakes, open: boolean, summary?: string } }

// packages/agents/src/memory (per-mind sqlite)
type WantKind = 'belonging' | 'affection' | 'esteem' | 'curiosity' | 'rivalry' | 'order' | 'legacy'
type TieKind = 'promise' | 'debt' | 'slight' | 'grudge' | 'attraction' | 'secret' | 'alliance' | 'kin'
export type Want = { kind: WantKind; level: number; lastFedTick: number }
export type Tie = { personId: string; kind: TieKind; text: string; tick: number; settledTick: number | null; source: string }
export type TieDelta = { agentId: string; personId: string; kind: TieKind; text: string; settled?: true }

// engine relationship events (phase 3)
// partnership_formed { a, b, tick }, partnership_dissolved { a, b, by, tick }, conceived { mother, father }
// co_slept stays as a signal only; it no longer forms a partnership.

// gateway director (phase 4)
export type StakeScore = { sceneId: string | null; agentIds: string[]; score: number; why: string; act?: 'I' | 'II' | 'III' }

// llm/src/pins.ts callers: 'turn' | 'scene' | 'scene.close' (prose pin) | 'arbiter' | 'council' | 'law.compile'
```

## Rehearsal targets (measured per sim-day on a spare port, never on production)

| Target | Baseline | Phase 2 gate | Phase 4 gate |
|---|---|---|---|
| Idle hours per mind per day | 12.7 | under 8 | under 6 |
| Speech about people or wonder | 47% | over 55% | over 60% |
| Exchanges with an alternating run of 4 or more | rare | 3 per day | 5 per day |
| Invention attempts per mind-day | 0.12 | 0.5 | 1 |
| Laws ratified per week | 0 | n/a | 1 or more |
| Identifiable moments in the director's top five | 1 of 15 | n/a | 3 of 5 |
| Cost per watched day, 12 minds | $10.4 projected | under $9 | under $9 |
| Cast hallucinations per 100 scene lines | unmeasured | 0 | 0 |

---

## Phase 0 · viewer do-now (parallel with phase 1)

### Task 1: Viewer do-now pass

Packages: `web`, plus `gateway/src/heat.ts`. Invoke the four UI skills first. Build in this order, one commit each, focused tests per row:

1. Auto-director on at a desk: `App.tsx` arms `useAutoCut(true)` for every route; the director hands back 20 s after any pan, zoom or click; `DIRECTOR_ZOOM` 3 → 2 at viewports 1280 px and wider so two speakers fit. Test: the cut hook fires without `?broadcast=1`; input suspends it for 20 s.
2. Heat re-weighting in `gateway/src/heat.ts`: `agent_spoke` 2 → 6; add `discovery_made` 12, `law_ratified` 12, `law_broken` 9, `agent_expressed` 4, `co_slept` 8; add a scene bonus of +8 when two different speakers spoke within earshot inside one window. Test: a two-person exchange outranks a lone harvester; a storm no longer outranks a talk.
3. Idle breath: `render/charAnim.ts` returns `bobY` from a 2-step clock (1 px, 450 ms hold) with a per-body phase from `gaitOf`. Test: two standing bodies differ in phase; a walking body is unchanged.
4. Labels: toponyms full only at zoom ≥ 2, otherwise hover-only; one label per picked thing (nameplate wins, toponym hides, hover plate drops the kind line). Test: at zoom 1 no toponym is drawn; a picked building renders exactly one label.
5. Defects: the phone sky-bar collision (`chrome.css` grid under 900 px: gap + space-between); the "…" bubble (find why `bubbleShown` is false at zoom 1 and fix the cause, not the symptom); the emote-atlas checkerboard over a talker (map every `OVERHEAD_PRIORITY` glyph to a real atlas cell; a missing cell draws nothing, never the placeholder). Tests for each.
6. A conversation looks like one: talkers face their partner while `talking`; the current line types in at 28 chars/s; the previous speaker's bubble dims to 60% and stays until the reply lands or 6 s pass. Test: facing flips toward the last heard speaker; the typed reveal advances with time.
7. "What just happened" cue: the stage cue slot prints `discovery_made`, `law_*`, `custom` and bond-change events for 6 s with a 16 px pixel icon, then fades; the two involved bodies bounce (reuse the finished-structure bounce). Test: the cue text appears within one frame of the event and clears after 6 s.
8. Cloud shadows: `render/clouds.ts`, 3 to 5 multiply blobs drifting with `windNow()`. Test: blob positions advance with the wind vector; the layer draws nothing when the town is indoors-only at night (no visible ground).

Report the measured pixel-change figure from a 60 s headless watch of your dev build if Playwright is available (`ls node_modules/.bin | grep -i playwright`); otherwise say it was not measured.

---

## Phase 1 · foundation: surplus and the forge contract

### Task 2: Closed strict params everywhere

Packages: `shared`, `engine`, `arbiter`, `agents`, `llm`, `live`. Start from what branch `luna-prep` (commit `781c094f`) already built: `StrictTurnSchema`, `fromClosed`, `MIND_TURN_SCHEMA`. Merge that branch into your branch first (`git merge luna-prep`), then:

1. Create `packages/shared/src/intent.ts` per the contract (`CLOSED_KEYS`, `ClosedIntentParams`, `Intent`). Export from `@sj/shared`.
2. Replace `IntentParamsSchema` (`engine/src/verbs/index.ts:119-133`, the loose object) with `ClosedIntentParams`. Delete the loose object; delete the `MIND_TURN_SCHEMA` flag so strict is the only path (`llm/src/pins.ts`, `agents/src/turn.ts`, `agents/src/runtime/agentRuntime.ts`, `live/src/providerPreflight.ts`). Every verb's `validate` reads only closed keys; `autofill.ts` keeps working.
3. `arbiter/src/verdict.ts:88-91`: `VerdictSchema.map.params` embeds `ClosedIntentParams`. Fix the same in `agents/scripts/manipulator-live.ts` and `arbiter/scripts/probe.ts`.
4. Tests: a strict round-trip for every registered verb (`turn.test.ts:131` already proves the 13 keys cover them; extend to the verdict schema); `strictModeFaults` on `VerdictSchema` is 0; decoding a turn with an unknown key fails; a null-filled params object autofills correctly.
5. Live check, ≤ $0.10: run the bake-off harness at `docs/superpowers/specs/v2/bakeoff/bakeoff2.ts` (copy it into your worktree's scratch dir) for 10 GLM calls on the new schema and report valid%, act%, p50.

Report the count of files still mentioning `looseObject` (must be 0 in src).

### Task 3: Surplus dials, time, alarms

Packages: `shared`, `engine`, `agents`. Dials in `packages/shared/src/config.ts` and constants:

| Dial | From | To |
|---|---|---|
| `needs.hungerDecayPerTick` | 0.021 | 0.010 |
| `needs.deathAfterZeroHungerTicks` | 2880 | 5760 |
| `thirst.decayFactorOfHunger` | 0.6 | 0.4 |
| `warmth.exposureDecayPerTick` | 0.15 | 0.08 |
| `weather.harshFromDay` | 7 | 21 |
| `mortality.drainPerTick.illness` / `.poison` | 0.08 / 0.12 | 0.04 / 0.08 |
| body alarm thresholds (`agents/src/wake.ts:32`) | hunger 25, energy 15 | hunger 15, energy 10 |
| `DAYS_PER_YEAR` (`shared/src/time.ts`) | 364 | 28 |
| `reproduction.gestationDays` | 72 | 20 |

Genesis (`engine/src/genesis/world.ts`): founder kit bread 3 → 6; storehouse wood 60, stone 24, rope 8, cloth 8, plus bread 20, fish 10 (dried if the kind exists, else `fish`), seed_pouch 3; founder houses finished (`GENESIS_ROOF_STOOD` applies only to the shared cottage and farmhouse). Keep `structures.sleepIndoorsOnly`, keep attack, fire, old age and `poisonChanceSpoiled` lethal.

Tests: a death-time table test that pins hunger-to-empty ≈ 6.9 sim-days and empty-to-death 4 days at the new dials; the aging tests re-pinned for a 28-day year (child until 16 years = 448 sim-days; elder from 60 years = 1,680; natural-death chance per day unchanged); the golden genesis manifest updated deliberately; the G11 mortality fixtures re-run. Report every golden you changed and why.

### Task 4: Twelve founders and four travellers

Packages: `live`, `town`, `forge`, `engine/genesis`. Read `docs/superpowers/content/c8-founders.md` and `packages/live/src/founderMinds.ts` for the persona format and `packages/town/src/founders.ts` for the founder roster, then:

1. Write 7 new founders so the cast is 12: four households (two couples, one with a grown child; one single parent with a grown child; two singles; one elder). Each persona has the same fields as the five existing (temperament, voice card, values, beliefs, worries, goals) and a distinct voice a reader can tell apart in two lines. Nobody shares a first initial with another founder. Kin are declared in the persona (`kin: [{ id, relation: 'partner' | 'parent' | 'child' }]`) so phase 3 can seed kin ties.
2. Write 4 travellers in the same format with a one-line `arrival` note (why they came up the valley road). They are not in the founding cast; phase 3's arrivals draw from this pool in order.
3. Generate cast art for all 11 through the same pipeline as the existing five (`packages/forge/scripts/gen-cast-v5.ts`; read `cast-v5.ts` and `character.ts`). Vision QA every sheet; report spend per character and total. If a sheet fails QA twice, keep the best and say so.
4. Genesis: the founding layout seats 12 (extend `cityTemplate.ts` households and `world.ts` founder houses: each household gets a finished house; singles and the elder share the cottage row). `SJ_MAX_MINDS` default 20 (`LIVE_MAX_MINDS_PER_FOUNDER` becomes a flat cap).
5. Tests: the roster has 12 with unique initials; every founder and traveller has art in the codex (extend the cast coverage gate); genesis seats 12 and the golden manifest is updated deliberately; the live cast boots 12 minds under the cap in the boot test.

Report spend and the list of names with their household.

### Task 5: The forge contract

Packages: `arbiter`, `engine`, `agents`, `live`. Depends on Task 2 (closed params). Build in order:

1. `arbiter/src/charter.ts`: `VerbCharter` per the contract; `codify.ts` produces a charter from an `attempt` verdict and `verbFromRecipe` reads the charter (costs, outcomes, duration, `reads`). `inventor.saying` is the mind's last thought at the time of the ask, persisted on the rulebook row and carried on the `discovery_made` payload.
2. `verdict.ts` effect ops widen to the contract's set (no `found`). `engine/src/fold.ts` folds `mark` (a tag map on agents, structures and items, rendered by perception as "marked: <key> <value>"), `witness` (emits an `agent_expressed`-style event with `label` others see or hear within `radius`), `name_place` (sets `structure.name`), `transfer` (item owner to target), `need_delta`. Golden folds for each.
3. Discovery in perception: `perceiveSeen` renders `discovery_made` within earshot as "Omar has worked out <name>: he said <saying>". Test: a neighbour's packet carries it; a mind across the map does not.
4. Roster block: a "What the town has learned to do" block in the system prefix, listing every active charter as `<name>: <gloss>` and which keys it reads; ≤ 40 tokens per verb; cached prefix so the block sits after the static rules. Test: a minted verb appears in the next prompt for every mind; the block is empty text when nothing is minted.
5. Invitation: delete the `experiment` refusal (`engine/src/verbs/index.ts:2269-2276`) so `experiment` reroutes to the arbiter like any unknown verb; replace the closing line of `CAPABILITIES` with "Anything you can name, you may try; the world answers with what it took." Arbiter refusals are no longer written into memory as a repeated line (`agentRuntime.ts:167-172, 639-641`); one memory, importance 3.
6. Codex growth: an `attempt` verdict may carry `unlocks`; `codify` inserts the unlocked rung as known and the proposed next rung as unknown with its prerequisite; `withinAdjacency` reads the live codex. The canon prose keeps the single hard line: nothing arrives from outside the valley.
7. Retirement and merge: a minted verb unused for 14 sim-days is retired (row kept, verb unregistered); a new ruling whose canon matches an existing charter at cosine ≥ 0.92 reuses that charter (precedent path already does this; extend to charters).
8. Tests for each step; the arbiter prompt test asserts the roster and invitation lines; the token delta of the roster block per verb is measured and reported.

Report: the measured prompt token delta with 0, 5 and 20 minted verbs.

### Task 6: A strong pin for rulings

Packages: `llm`, plus a scratch script. Depends on Task 2. Bake off three candidates for the `arbiter` caller on 12 real arbiter prompts taken from world two's rulings table (`~/handoff/backups/town-data-20260902T0823.tgz` → `arbiter.db` `rulings`): GLM 5.3 flash on DeepInfra, GPT 5.6 Luna (strict schema), and one DeepInfra-hosted frontier model you pick from the provider list. Score each ruling on: valid schema, verdict kind agrees with a hand-labelled expectation, the amended text keeps both sides' terms (as the prototype's well-order ruling did), latency p50, cost. Budget ≤ $1.50. Then pin `arbiter`, `council` and `law.compile` callers in `pins.ts` to the winner, add its price row if missing, and keep `turn`, `scene` on GLM two-homed. Tests: pins test updated; a caller table test asserts the three ruling callers share a pin.

Report the score table.

### Task 7: Phase 1 gate

Controller task. Merge Tasks 1-6 into `v2`. Dispatch a lint lane to clear the pre-existing red (3 eslint errors in `engine/src/genesis/founding.test.ts:39`, `engine/src/survival.test.ts:234,293`; `format:check` on 11 files; knip `rateStopRefusal` in `live/src/liveWorld.ts:272`) so `pnpm check` is green. Run one short rehearsal on port 8099: `SPEED=2 SJ_MAX_MINDS=20 pnpm rehearse 25` (about one sim-day) and record: 12 minds boot, every sprite loads (no placeholder route hits in the log), no death, cost per sim-day, invention attempts per mind-day, roster block present in a sampled prompt. Fast-forward `main` when green.

---

## Phase 2 · scenes

### Task 8: The scene coordinator

Packages: `agents`, `shared`, `gateway`, `live`. The centre of v2. Read `agents/src/runtime/agentRuntime.ts` (turn loop, `#runTurnBody`, wake), `agents/src/wake.ts`, `engine/src/earshot.ts`, `agents/src/runtime/bridge.ts` (`announce`), and the prototype's scene prompt in `docs/superpowers/specs/v2/scene-proto/scene.ts`. Build:

1. `agents/src/scene/coordinator.ts`: one per world, owned by the live cast next to `bootMinds`. Opens a `talk` scene on any `agent_spoke` whose speaker is in no open scene, participants from `hears()`. Kind upgrades: a line naming an open grudge or slight tie → `quarrel`; three or more `express:*` at the square at dusk → `gathering`; a line matching a proposal pattern ("from now on", "call it", "we should all", "new rule") → `council` with `proposal.lawText` (the predicate is compiled by Task 13; until then `{ kind: 'none' }`).
2. The floor: after each line the floor goes to the participant named by first name, else the one who has spoken least, ties by warmth. `decideWake` gains `floor` above `conversation_beat`; the old per-mind conversation window is retired. Only the floor-holder gets a turn. Listeners take no call and receive the thread as one memory at close.
3. The scene prompt: the cached system prefix unchanged, then one user block replacing journal, day log and inventory: the living cast by name (closed roster), who is here, open ties between you and each of them, your highest want line (empty until phase 3), the last six lines with your own asides, and "It is your turn. Answer the last thing said, or say nothing and let it end." Output `SceneTurn` per the contract; `maxOutputTokens` 300. Speech is capped at the persona's burst length (the prototype saw Nadia at 77 words against a 45-word card).
4. Exits: `leave: true`; `speech: null` from the floor-holder counts a pass, two passes close; a participant out of earshot leaves; 12 lines caps with a "wrap it up" cue on the tenth; night closes; a floor-holder that does not answer in 30 s counts as a pass (`closeReason: 'timeout'` if it happens twice).
5. Close: one `scene.close` call on the prose pin writes a two-sentence summary and `TieDelta[]`; the coordinator stores one memory per participant (importance = stakes) and writes the deltas to a `ties` table in each mind DB (create the table per the contract; Task 11 fills it from reflection too). Announce `scene_closed`.
6. Witness events `scene_opened`, `scene_line`, `scene_closed` via `bridge.announce`, folded to nothing (like `discovery_made`), relayed by the gateway as the `{ t: 'scene' }` frame per the contract.
7. Snapshot: an open scene survives a runtime snapshot and restore.
8. Tests: floor passes to the named person; listeners take no LLM call (count calls with the fake client); two passes close; earshot exit; night close; the cap; timeout as pass; replay reproduces scene events from the log; snapshot round-trip; the cast line lists exactly the living minds; a thread shows the mind its own asides.
9. Live check ≤ $0.50: one real scene between two founders through the coordinator using the real client, transcript in the report.

Report: calls per scene line (must be 1), the prompt token count of a scene turn, and the transcript.

### Task 9: Scenes on the stage

Packages: `web`. Depends only on the `{ t: 'scene' }` frame shape in the contract (build against a fixture until Task 8 merges). Invoke the four UI skills first.

1. `render/scene.ts`: `setFollow` gains a multi-anchor; on an open scene the camera frames the participants' centroid at a zoom that fits them all with 1.5 tiles of margin; on close it releases after the summary shows.
2. Lower third: on `scene_opened` the cue slot shows the topic and participants ("At the well · Amara & Salma"); on close it shows the summary for 8 s.
3. Turn-taking on stage: the floor-holder's body gets a 1 px honey ring under its feet; the last line dims to 60% until the reply; bodies face each other while the scene is open.
4. Tests: a fixture frame with two participants yields a zoom that fits both; the cue text follows the frame; the ring follows the floor.

### Task 10: Phase 2 gate

Controller task. Merge Tasks 8-9. Rehearsal on port 8099: `SPEED=2 SJ_MAX_MINDS=20 pnpm rehearse 25`. Measure with the evidence scripts (`docs/superpowers/specs/v2/evidence/analyze.py` and `classify.mts`, copied into the rehearsal dir): idle hours, people-or-wonder share, exchanges with alternating runs ≥ 4, calls per scene line, cast hallucinations per 100 scene lines, cost per sim-day. Compare against the phase 2 column. If a target misses, open a fix task with the measured numbers rather than re-running blind. Fast-forward `main` when green.

---

## Phase 3 · society

### Task 11: Wants and ties

Packages: `agents`, `shared`, `gateway`. Depends on Task 8 (the `ties` table).

1. `agents/src/memory/schema.ts`: `wants` and `ties` per the contract (ties exists from Task 8; add `wants`). Wants rise 0.017 per tick and are fed by events: belonging by any scene; affection by a partner scene or an `express:*` targeted at you; esteem by being taught from, praised (a small lexicon over lines addressed to you), or a discovery credit; curiosity by a new place or a discovery witnessed; rivalry by a slight or an `item_taken` of yours; order by a `law_broken` witnessed; legacy by a child, a named building, a codified verb. Personality biases the rise (a voice card "wants to be relied on" → esteem ×1.5; encode as a small table per founder in the persona, default 1).
2. The morning line: at `morning` wake the routine prompt adds "Today you most want <want>; who could give you that?" and the mind may set a `reconsider_at` appointment toward a person.
3. Reflection step 5 changes from "rewrite the prose note" to "rewrite the note and list ties: promises, debts, slights, attractions, settled or open" and writes rows to `ties`. A tie untouched for 7 sim-days closes as "let go" and becomes a memory.
4. Kin ties seeded at boot from the persona's `kin` field (Task 4). The scene block and the routine "people here" line render open ties for anyone in view.
5. Bonds (viewer): `shared/src/bonds.ts` gains tie kinds with valences (`slight` −3, `promise_kept` +3, `promise_broken` −6, `attraction` +2, `kin` 0); `gateway/src/bonds.ts` folds them from `scene_closed` deltas.
6. Tests: a want rises and is fed; the morning line names the highest want; reflection writes ties; a 7-day tie lets go; kin seeded; bonds fold a slight from a scene close.

Report the token delta of the want line and the ties rendering.

### Task 12: Relationships as chosen acts

Packages: `engine`, `agents`, `narrator`, `web`. Depends on Tasks 8 and 11.

1. Verbs `court`, `propose`, `lie_with`, `leave_partner` in the engine registry with `targetId`. Each of the first three opens an `invitation` scene through the coordinator instead of acting: the invitee's next scene turn carries `answer`. `accept` on `court` writes an attraction tie both ways; on `propose` emits `partnership_formed`; on `lie_with` rolls 1 in 5 for `conceived` (adults only, both in fertile years, both awake, inside a house either may use). `refuse` writes a slight if any third mind is in earshot, otherwise nothing but the memory. `leave_partner` needs no consent: emits `partnership_dissolved` and a grudge tie on the left partner.
2. `engine/src/systems/reproduction.ts`: co-sleeping no longer forms a partnership (it stays a signal event); conception only from `lie_with`; gestation from Task 3's dial; a birth under the cap gets a mind (already true).
3. A `lie_with` outside a partnership writes a `secret` tie to both; if a partner learns of it (a scene line names it, or a witness within sight at the door) the partner gets a slight and a grudge. Keep this to the ties layer; no new engine state.
4. Narrator: milestones `first_courtship`, `first_proposal_refused`, `first_wedding`, `first_breakup` read the new events; the old bed-statistic detectors are deleted.
5. Web: on `lie_with` accepted, the house door closes and the window light dims for the act's duration; the camera cuts away; the chronicle gets one line.
6. Tests: each verb opens an invitation; accept and refuse write the right ties and events; the 1-in-5 roll with a seeded RNG; adults-only and awake guards; co-sleep forms no partnership; the milestones fire once.

### Task 13: Laws the town writes

Packages: `engine`, `arbiter`, `gateway`, `web`, `narrator`. Depends on Task 8 (council scenes) and Task 6 (the ruling pin).

1. `engine/src/socialLaws.ts` per the contract; `state.socialLaws` folded from `law_ratified` and `law_repealed`; the predicate runs in `submitIntent` beside the night-work penalty. `forbid` never blocks: the act proceeds and `law_broken` is emitted with witnesses within sight. `require_before`, `common` and `tithe` refuse in the town's words ("the town agreed nobody takes from the common store at night"). Golden folds.
2. `arbiter/src/council.ts`: compiles `proposal.lawText` to a `LawPredicate` with one `law.compile` call on the ruling pin; unenforceable text compiles to `none` with a `why`. The council scene closes when every participant has a stance or at the cap; majority `for` → `law_ratified` with `why`; a later council with "repeal" → `law_repealed`.
3. The canon block in every prompt lists ratified laws by id and text (≤ 30 tokens each); memories cite law ids.
4. Gateway `/api/laws` returns social laws; the operator physics knobs stay on `/admin/laws` only.
5. Web: `paper/pages/Laws.tsx` rebuilt to read social laws, newest first, with author, day, votes, breach count and the arbiter's `why`; the three prototype laws (slate rule, fire tax, well-order) are the fixture. Invoke the four UI skills. The physics-knob rendering and `lawCopy.ts` are deleted from the viewer bundle.
6. `first_law` milestone reads `law_ratified`.
7. Tests: compile of the three prototype proposals; ratify by majority; `forbid` emits a breach with witnesses; `common` refuses in town words; repeal; the paper renders the fixture; the physics knobs never reach the viewer.

### Task 14: Customs, the dusk gathering, arrivals by road

Packages: `arbiter`, `agents`, `live`, `engine`. Depends on Task 8.

1. Constructs → customs: when `runConstructPass` records a second recurrence it writes a `custom` row minds can read (`{ name | null, what, who, when }`), rendered in the routine prompt as "The town has taken to <what>". A named custom ("we call it X") becomes a notion in the canon block.
2. Dusk gathering: at dusk the lit fire pit at the square is a cue line in the routine prompt naming who is there; a `gathering` wake reason fires once at dusk for any mind whose belonging want is over 60 (until Task 11 merges, over 60 of a stub that returns 70 on days with no scene yet). The lamplighter's scripted stoke becomes the first custom the recognizer sees.
3. Arrivals: `live/src/arrivals.ts` brings one traveller from Task 4's pool up the valley road every 3 to 5 sim-days while the cast is under the cap; the traveller spawns at the road edge with a kit, an `arrival` memory, and a `stranger_arrived` event other minds see; the first mind to open a scene with them gets a `telling` scene kind. When the pool is empty, no arrivals.
4. Tests: a custom row after two recurrences; the dusk cue names the people present; the gathering wake fires once; an arrival every 3 to 5 days under the cap and none at the cap; the event reaches perception.

### Task 15: Phase 3 gate

Controller task. Merge Tasks 11-14. Rehearsal on port 8099: `SPEED=2 SJ_MAX_MINDS=20 pnpm rehearse 50` (about two sim-days). Measure: promises made and kept or broken, invitations and their answers, council scenes and laws ratified, customs written, arrivals, plus the phase 2 metrics again. Fast-forward `main` when green.

---

## Phase 4 · director and viewer

### Task 16: A director that follows stakes

Packages: `gateway`, `web`, `llm`, `agents`. Depends on Tasks 8, 11, 13.

1. `gateway/src/stakes.ts` replaces `heat.ts`: `StakeScore` per open scene and per body from the log, weights per the spec (scene stakes ×2; slight or broken promise +6; attraction +4; bond level change +8; discovery +10, law ratified +12, law broken +9; death 20, birth 18, first co-slept 8, partnership strained 10; a give-way after three presses +6; emotional lexicon +2 each; council +6; first-time event type today +3). After a peak the director forces a 20 s quiet beat. `why` is a short sentence. Act marks per sim-day: first scene I, highest-stakes scene II, the day's close III.
2. Web: the director follows the top score's participants; captions show `why`; the act mark sits beside the quiet stamp.
3. Thought gate: a thought bubbles only when importance ≥ 6, or its mind is the camera subject, or inside a scene; stored regardless. The T toggle still hides all.
4. Spend rails per caller in `llm`: a per-caller daily ceiling with the existing daily cap as the total.
5. Tests: the scorer over a fixture log picks the quarrel over the harvest and the council over the storm; the quiet beat; act marks; the thought gate; per-caller rails.

### Task 17: The story surface

Packages: `web`, `gateway`, `narrator`. Depends on Task 16.

1. Broadcast pieces at the desk (from mock B): a scene card on a cut ("At the fire pit · Amara & Yusuf"), a lower-third caption with a 28 px bust and the current line typing in, kept only while its subject is the shot.
2. The chronicle feed carries `scene_closed` summaries, `law_*`, `discovery_made` with the spoken reason, `partnership_*`, and `stranger_arrived`; the ticker and the Chronicle arm read it.
3. First frame: two lines that fade on the first cut ("Twelve people. Watch them make a town. The camera finds the moments; drag to take it.") and an honest "The town sleeps until 06:00" card at night with the director skipping ahead to the first waking scene.
4. Tests: the card and caption follow frames; the feed carries each event kind; the first-frame lines fade on a cut; the sleep card shows only at night.

### Task 18: Night and sound

Packages: `web`. Depends on nothing; can run with Tasks 16-17. Invoke the four UI skills.

1. Night worth watching (from mock C): raise the night tint floor toward `[0.5, 0.58, 0.95]`, warm window glow on every hearth house, fireflies over grass on clear nights, the moon on the arc lighting roofs; golden-hour long shadows at dusk.
2. Sound, opt-in, diegetic: `ui/sound.ts` with a synthesized WebAudio soundscape (wind, fire, rain, crickets at night, a bell when a law is ratified, a low murmur near an open scene) behind a "♪" toggle; text cue chips ("♪ crickets") so the signal survives muted; muted by default; every sound has a visible source on screen.
3. Tests: the night floor value; glow only when a hearth is lit; fireflies only on clear nights; the toggle persists in `localStorage`; a cue chip appears with every sound start.

### Task 19: Final gate and handover

Controller task. Merge Tasks 16-18. `pnpm check` green. Rehearsal on port 8099: `SPEED=2 SJ_MAX_MINDS=20 pnpm rehearse 50`, measured against the phase 4 column, plus a 5-minute headless desk watch (cuts ≥ 3, pixel change ≥ 5% per 30 s). Fast-forward `main`. Present the owner with the measured table, the rehearsal transcript highlights, a K24 backup plan for the v1 world, and ask for the go to deploy v2 as a fresh Day 0 world.
