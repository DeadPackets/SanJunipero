# The Discovery Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT. Written on branch `discovery-plan`, forked from local `main` @ **`bbc6f05`**
("guard: the four-pin proof read the file, not the pin"). Every claim below was re-verified in
source at that commit; the verification table is §0.

**Goal:** When a mind in San Junipero works something out that nobody wrote down in advance, the
town remembers **who** worked it out, **when**, **from what words**, and **what it unlocked** —
and a viewer can watch it happen, scrub back to it, and read the whole run's worth of it at the
end.

**Architecture:** A discovery is a **world fact**, not an ops fact, so codification emits a
`discovery_made` **world event** through the tick loop; the arbiter's `rulebook` stays exactly
where it is and the gateway never opens the arbiter's database. The event log **is** the archive:
the fold case is a validating passthrough, so no `WorldState` field is added and no golden hash
can move. Three planes, none crossed: the **engine** owns the event and its words; the
**gateway** serves the archive read-only over the world DB; the **viewer** renders it. Art is
commissioned off the tick, into the `assets` table, and therefore cannot touch replay at all.

**Tech Stack:** TypeScript ESM, Node 24, pnpm workspaces, Vitest (node environment — **no
jsdom**), Zod 4, better-sqlite3 v13, React 19, Pixi v8, `sharp` via `@sj/forge` (server-side
only).

**Spec:** `cleanup/discovery-record-plan-brief.md` (the controller brief this plan answers), plus
the user's own words quoted in §1.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Branch/base.** `main` @ `bbc6f05`. **NEVER `git pull`.** Never bare `git stash`. Never read
  `.env` or `OPENROUTER_API_KEY`. **Zero live LLM calls** in any test this plan adds.
- **The four pins do not move.** `G1 f487a26bd9dfba5d6d0d04f41b57f8e85dc9afe7f9ae1caf608de8c182effeac`,
  `G2 00d724345c37104d6c93f10398b96eded080b58db78108746e2a037fce836a10`,
  `forge config 02f295ad603483998c2e85a641f6aa35372ddf630614a46648cd1f95b284ba5b`,
  `BLOCK1 28c1fce0781ec9019416c234a9eae47401ff4b9dc4a96b91c371335fbad97bd6`.
  **No task in this plan re-pins any of them.** If a task moves one, the task is wrong — STOP and
  report. Task 14 proves all four unmoved by running `packages/gateway/src/g12c.test.ts`
  unmodified.
- **Goldens show EMPTY DIFFS.** `git diff main...HEAD -- packages/engine/src/golden.test.ts
  packages/engine/src/g2.test.ts packages/forge/src/forgeConfig.test.ts
  packages/agents/src/prompt/rulesOfBeing.test.ts` must be empty at every commit.
- **A test that passes against the broken code has measured nothing.** Every task's Step 2 runs
  the new test against the before-state and records the exact failure text. A step whose Step 2
  passes is a plan failure: stop and report it rather than proceeding.
- **MEASUREMENT LAW.** No number from a live browser; a backgrounded tab does not paint. Every
  number in this plan came from a pure function or a shipped file, and every number a task claims
  must come from the same.
- **LOOKING LAW.** Eyes in a **foregrounded** browser before every visual commit (Tasks 9, 10, 11).
- **The one-way glass.** Nothing an agent can perceive may name `custom`, `market`, `council`,
  `festival` or `faith`, and `FORBIDDEN_FRAMING` (`arbiter/src/prompt.ts:62`) bans
  `AI|A.I.|artificial intelligence|language models?|LLMs?|neural|prompts?|context windows?|tokens?|chatbots?|simulations?|models?|tools?`.
  **A chronicle line is agent-visible; the gateway's JSON is not.** This plan puts the agent's
  own quoted intent text ONLY in the gateway JSON, never in a chronicle line. See Task 2.
- **Per-task discipline.** One commit per task. Every commit: `pnpm vitest run` (whole repo) green,
  `pnpm typecheck` 0 errors, `pnpm -C packages/web build` green, `git status --porcelain` empty.
- **UI QUALITY MANDATE.** `tints.ts`/`chrome.css` palette only; WCAG AA in BOTH day and night
  bands; 12px/14px type floors; ≥24px hit targets; motion 150–300 ms from the `--t-*` tokens;
  `prefers-reduced-motion` honoured; keyboard reachable. **Opacity is not a contrast strategy.**
- **`worldLabel.ts` is the ONLY place a `BitmapText`/`Text` is constructed.** No task here adds
  another; every glyph this plan draws is palette pixels on a grid.

---

## §0 — WHAT I RE-VERIFIED AT `bbc6f05`

The brief's ten measured rows, each checked against source. **All ten hold.** Three carry a
correction or an addition that changes how a task must be written; those are marked ★.

| # | Brief's claim | Verdict at `bbc6f05` |
|---|---|---|
| 1 | Free-form intent adjudicated to `map`/`attempt`/`impossible`; an `attempt` mints a Recipe at runtime | **Holds.** `adjudicate.ts:154–249`; `VerdictSchema` `verdict.ts:53–58`. |
| 2 | A minted recipe becomes a permanent engine verb via `codify.ts` → `verbFromRecipe` → `registerVerb` | **Holds.** `codify.ts:168–197`, `registerVerb` at `:194`. |
| 3 | Identical physics for a rephrased intent, no LLM call, cosine ≥ 0.92 | **Holds.** `SIMILARITY_SHORT_CIRCUIT = 0.92` `adjudicate.ts:21`; short-circuit `:163–186`. |
| 4 | `rulebook` has NO inventor column | **Holds.** `schema.ts:47–58`. ★ **Correction:** the column list also has a leading `id INTEGER PRIMARY KEY`; the brief's list starts at `recipe_id`. Immaterial to the design. |
| 5 | `codex` has NO inventor and NO tick — `id, era, name, prerequisite_id, known` | **Holds exactly.** `schema.ts:15–21`. |
| 6 | No discovery event exists; 19 chronicle types, none an invention | **Holds.** `CHRONICLE_WEIGHTS` `chronicle.ts:6–25` — counted, exactly 19 keys. |
| 7 | `commission()` is never called from outside `packages/forge` | **Holds.** Only callers are `forge/scripts/gen-rigs.ts:37` and `forge/scripts/gen-terrain.ts:31`. ★ **Addition:** the forge is not wired into the live run at all — `g11-deepworld.ts` contains no `createForge`/`AssetCodex`. Task 12 therefore builds the wiring, not just the call. |
| 8 | A timeline exists with 8 mark kinds | **Holds.** `timelineMarks.ts:13–15`, and `MARK_WEIGHT` `:21–23` reads `changed 16, first 16, death 14, birth 14, joined 12, quarrel 12, chapter 10, built 8`. |
| 9 | Marks come from the RECORD, not a 400-entry live ring | **Holds.** `timelineMarks.ts:1–11`; the record is served by `GET /api/timeline/marks` (`narratorApi.ts:178–189`) and fetched in `Timeline.tsx:147`. |
| 10 | No discovery tree is read by any code | **Holds.** `grep -rn "discoveryTree\|TECH_TREE" packages` → nothing. The 103-node tree exists only as `docs/superpowers/content/c8-discovery-tree.md` on `content-contemporary`. **It stays unwired.** |

**★ Three findings of my own that the brief does not contain, and that shape the plan:**

- **F-A. `arbiter.codify()` takes no agent context**, so the inventor is not available where the
  recipe becomes law (`adjudicate.ts:77`, `:251–253`). But the inventor **is** in hand one frame
  up, at the only call site: `agentRuntime.ts:376` calls `this.#codify(verdict.recipe)` inside a
  method that owns `this.#agentId` and the `description` string. Task 6 threads it.
- **F-B. There is a SECOND codification path the brief does not mention.** `codifyExpressive`
  (`adjudicate.ts:103–117`) mints a permanent verb **inside `adjudicate`**, never through
  `codify()`. A coined word — the town inventing *dancing* — is a discovery by the user's
  definition and would have been silently missed by a design that only hooked `codify()`.
  Task 5 hooks **both** paths.
- **F-C. A BUG. The coined word is never framing-checked.** `framingTainted`
  (`adjudicate.ts:44–48`) returns `false` immediately unless `v.kind === 'attempt'`, so the
  expressive path at `:190–199` never sees it. `ExpressiveRulingSchema.word` is
  `/^[a-z]{2,24}$/`, which admits `ai`, `model`, `token`, `tool`, `prompt`, `neural`,
  `simulation`. Such a word becomes a permanent verb **and** an agent-visible chronicle line
  (`chronicle.ts:204–211`: "Maret was seen to model."). This plan adds a second agent-visible
  surface for the same string, so Task 4 closes it first.

---

## §1 — WHAT THE USER ASKED FOR

> *"I want all 'discoveries' to be archived in a timeline, so that we can see it in the UI (and at
> the end of the experiment) and take a nice look over what our AI people came up with over the
> course of the experiment."*

> *"I wanted the AI agents to naturally discover things with their own creativity, and let the
> arbiter handle if that is allowed or not. Then, the forge needs to create art (if needed) and it
> gets created, and all agents get information of this creation."*

The invention half already works. The remembering half does not exist. This plan is the
remembering half, and nothing in it changes how adjudication decides.

---

## §2 — THE ARCHITECTURAL RULING: WORLD EVENT, NOT OPS PLANE

**The controller's ruling stands, and the evidence is stronger than the brief states.** A
discovery is a world fact. Codification emits a world event carrying the credit; the ops-plane
rulebook stays where it is; the gateway is never taught to read the arbiter's database.

Four pieces of evidence, all from source at `bbc6f05`:

1. **`schema.ts:59–60` states the seam as law:** *"The construct registry and its ops-plane
   record. Agent-invisible by construction: these tables live in the arbiter's database, never in
   the world's."* Reading the rulebook from the gateway would put a `verdict_json`, a
   `reverted_reason` and an LLM's recipe internals on the viewer's wire.
2. **The world log already carries an invention.** `agent_expressed` (`fold.ts:158–161`) is a
   coined verb, minted by the arbiter at runtime, recorded as a world event with a validating
   passthrough fold. A discovery is the same shape of fact one rung up. The precedent exists and
   this plan follows it exactly.
3. **A passthrough fold cannot move a golden.** `fold` throws on an unknown type
   (`fold.ts:881–882`), so a case is mandatory; a case that returns `state` unchanged adds no
   `WorldState` field. G1 (`golden.test.ts`) is five scripted actors emitting only
   `agent_spawned`/`agent_moved`/`need_changed` through `TickLoop` — it runs no world system and
   reaches no arbiter, so it is **structurally unmovable** by this feature, exactly as the brief
   says. G2 (`g2.test.ts`) is a scripted fixture that never adjudicates, so it emits no
   `discovery_made` and its state hash is likewise unmoved. **No pin is re-pinned by this plan.**
4. **There is already a deterministic seam for an out-of-band world event.**
   `EngineBridge.wrapTickHandler` (`bridge.ts:134–158`) drains a queue of pending submissions in
   arrival order at a fixed point in every tick and emits their events through `ctx.emit`. Task 3
   adds a second queue beside it. Ordering is fixed, the event lands in the append-only log with
   its own `seq` and `tick`, and replay is exact by construction because replay folds the log and
   the fold is a passthrough.

**Where the inventor credit lands: on the EVENT, and on nothing else.** Not on `rulebook`, not on
`codex`. Reasons, in order:

- The event log is **append-only and ordered** and already durable. It is the only one of the
  three that is an archive by nature; the rulebook is a registry whose rows are `UPDATE`d on
  revert and reactivate (`rulebook.ts:88–96`, `:103–107`). Credit written to a row that gets
  rewritten is credit that can be lost.
- It is the only one of the three the gateway may read.
- **It answers the brief's revert requirement for free.** "The archive must survive a
  `reverted_at_tick`." An append-only log physically cannot lose the entry. Task 7 proves this
  with a test that reverts the recipe and asserts the archive still serves it.
- Adding an `inventor` column to `rulebook` would be a **second copy of the same fact to keep
  right**, in a plane that must not serve it — the identical reasoning `narratorApi.ts:143–146`
  gives for handing the viewer mark *sources* rather than marks.
- `codex` is the **authored** tech tree (`codex.ts:4–5`); its rows are written by the content
  author, not earned by a mind. An inventor column there would be a category error.

**Deviation from the brief, argued.** The brief asks for ws catch-up on the `hello` frame,
following `server.ts:119–121`. **I do not add a `t:'discovery'` ws message.** Evidence: (a) the
event already reaches every *connected* client, because `mirror.poll()` broadcasts every new
event in the `t:'tick'` frame (`server.ts:146–150`) and `discovery_made` is an ordinary row in
`events`; (b) every *late joiner* is served the complete ordered archive by `GET /api/discoveries`
(Task 7), which the panel fetches on mount and refetches on the same interval the Chronicle and
the Timeline already use. A third path carrying the same record over the wire is a third copy to
keep right, and the record is exactly what the brief's own "marks come from the RECORD" law says
must not be duplicated into a live ring. The asset precedent at `server.ts:119–121` **is**
followed — literally and unchanged — for the commissioned **art** in Task 12, which is what that
precedent is for.

**Out of scope, named:**
- The 103-node discovery tree. Stays unwired. Nothing in this plan reads it.
- Town-layout grammar and camera work (separate lanes).
- Changing how adjudication decides. This plan records; it does not rule.
- **Surfacing a revert to the viewer.** The archive survives a revert (proved in Task 7), but
  *showing* "the town later lost this" would need either ops-plane data on the viewer's wire —
  forbidden by §2 — or a world event for what is an operator action, not a town act. Named here
  so the next reader knows it was decided, not forgotten.

---

## §3 — THE THREE WEIGHTS, ARGUED

Three numbers in this plan are editorial rulings. Defaulting any of them would be a plan failure.

**`MARK_WEIGHT.discovery = 18`.** The current table tops out at 16 (`changed`, `first`).
`MARK_WEIGHT` breaks ties for **one pixel on a scrub bar** — `coalesceMarks` keeps the heavier of
two marks that would draw on the same spot (`timelineMarks.ts:269–280`). Two arguments for going
above the ceiling: (1) **rarity makes it cheap.** A run produces a handful of codified verbs
against dozens of births and deaths, so a discovery almost never contests a slot and the weight
costs the other kinds nearly nothing. (2) **it is the only permanent kind.** `sanity.ts`'s header
law is that a codified verb is forever. A death removes one person; a discovery changes what
*everyone* can do for the rest of the run, and a viewer scrubbing a mature timeline wants to land
on the day the town could suddenly do a new thing. 18 rather than 20+ because it stays inside the
band the table already speaks in.

**`CHRONICLE_WEIGHTS.discovery_made = 19`.** Directly beneath `agent_died: 20` and above
`agent_born: 18`. This is a different table answering a different question — what sentence to
show in a reading feed. **Death stays first.** The user is watching a life simulation; a person
dying is the emotional peak and a discovery does not outrank it. Second place, above a birth, is
the honest placement: a birth is a life beginning, a discovery is what that life can now do.

**The two tables disagree on purpose, and that is not a bug.** On the timeline a discovery (18)
outranks a death (14); in the chronicle a death (20) outranks a discovery (19). Deaths are
frequent enough to coalesce into "3 people died" and still read; a discovery is a single
unrepeatable instant, and the scrub bar is the one surface where you *aim* at an instant. Recorded
here so the next reader does not mistake the inversion for drift.

**`MARK_GLYPH.discovery` and `CHRONICLE_GLYPH.key` use INK for their structure.** Measured, not
chosen: on the sand track (`--sand #E8D5BC`) the only palette members clearing 3:1 are
`ink 7.63`, `ink-quiet 4.91`, `deep 11.24`, `night 9.54`. `MARK_STRUCTURE_INKS`
(`timelineMarks.ts:70`) already names `[INK, DEEP]`. HONEY is 1.10 on sand and may only be
interior detail, exactly as the `built` glyph uses it.

---

## §4 — THE PALETTE MEASUREMENT EVERY UI TASK MUST OBEY

Computed with the WCAG formula in `packages/web/src/ui/contrast.test.ts:9–19` over the `:root`
tokens in `packages/web/src/ui/chrome.css`. **This table is the answer to "AA in both bands":**

| Foreground | on `--cream #FFF6E9` | on `--night #322B38` | on `--deep #241F2B` |
|---|---|---|---|
| `--ink #43394A` | **10.20** | 1.25 | 1.47 |
| `--ink-quiet #5F5568` | **6.57** | 1.94 | 2.29 |
| `--cream-quiet #C4B8AE` | 1.81 | **7.03** | **8.28** |
| `--honey #F2C879` | 1.47 | **8.65** | **10.19** |
| `--sage #93B573` | 2.16 | **5.91** | **6.97** |
| `--ember #E8785A` | 2.70 | **4.72** | **5.56** |
| `--rose #C47876` | 3.12 | 4.09 | **4.82** |

> **★ NO SINGLE PALETTE TOKEN CLEARS AA ON BOTH `cream` AND `night`.** The dual-band set is
> **empty**. Any task that paints one colour and hopes it survives both bands has failed before it
> starts. The sheet already solves this the right way and every task here must copy it: **`--ink`
> and `--ink-quiet` for light grounds, `--cream` and `--cream-quiet` for dark grounds**, switched
> by the ground, never thinned by `opacity`.

---

## §5 — FILE STRUCTURE

**Created**

| File | Responsibility |
|---|---|
| `packages/shared/src/discovery.ts` | The vocabulary both planes share: `DiscoveryKind`, `DiscoveryCredit`, `DiscoveryRecordSchema`, `discoveryHeadline`, `DISCOVERY_EVENT`. |
| `packages/shared/src/discovery.test.ts` | Its tests. |
| `packages/gateway/src/discoveries.ts` | `mountDiscoveryApi` — the archive, read-only over the world DB. |
| `packages/gateway/src/discoveries.test.ts` | Its tests, including the survives-a-revert proof. |
| `packages/web/src/ui/discoveryModel.ts` | Pure: the fetched archive → what the panel draws. |
| `packages/web/src/ui/discoveryModel.test.ts` | Its tests. |
| `packages/web/src/ui/DiscoveryPanel.tsx` | The Discovery Record — the readable surface and the end-of-run view. |
| `packages/web/src/ui/DiscoveryPanel.test.ts` | Its tests (node env, `renderToStaticMarkup`). |
| `packages/forge/src/discoveryArt.ts` | Pure `artNeededFor` + the `onDiscovery` watcher that calls `commission()`. |
| `packages/forge/src/discoveryArt.test.ts` | Its tests. |
| `packages/gateway/src/gd.test.ts` | **GATE G-D** — the end-to-end proof. |

**Modified**

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | Export `./discovery.js`. |
| `packages/shared/src/chronicle.ts` | `discovery_made` weight/icon; the `chronicleLine` case. |
| `packages/engine/src/events.def.ts` | The `DiscoveryMade` payload schema. |
| `packages/engine/src/fold.ts` | The validating passthrough case. |
| `packages/agents/src/runtime/bridge.ts` | `announce()` and its drain. |
| `packages/agents/src/runtime/arbiterSeam.ts` | `Codifier` takes a `DiscoveryCredit`. |
| `packages/agents/src/runtime/agentRuntime.ts` | Threads the inventor into `codify`. |
| `packages/arbiter/src/adjudicate.ts` | `onCodified`; credit into both codification paths; F-C's framing fix. |
| `packages/arbiter/src/codify.ts` | `productsOf`; `codify` reports what it minted. |
| `packages/gateway/src/server.ts` | Mount the archive route. |
| `packages/gateway/src/narratorApi.ts` | The marks source carries discoveries. |
| `packages/web/src/ui/timelineMarks.ts` | The `discovery` mark kind. |
| `packages/web/src/ui/importantFeed.ts` | The `key` chronicle glyph. |
| `packages/web/src/ui/route.ts` | `LENSES` gains `discoveries`. |
| `packages/web/src/ui/controlBar.ts` | `LENS_LABEL`, `LENS_GLYPH`, the `find` control glyph. |
| `packages/web/src/ui/StatusStrip.tsx` | `LENS_LABELS`. |
| `packages/web/src/ui/chrome.css` | The panel's classes. |
| `packages/web/src/App.tsx` | Mount the panel on its lens. |
| `packages/agents/scripts/g11-deepworld.ts` | The one live wiring seam. |

---

# PHASE A — THE RECORD EXISTS

### Task 1: `discovery_made`, the world event

**Files:**
- Create: `packages/shared/src/discovery.ts`, `packages/shared/src/discovery.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/engine/src/events.def.ts:109` (after
  `AgentExpressed`), `packages/engine/src/fold.ts:1–22` (the import block) and `:158–161`
  (beside the `agent_expressed` case)
- Test: `packages/shared/src/discovery.test.ts`, `packages/engine/src/fold.test.ts`

**Interfaces:**
- **Consumes:** nothing from an earlier task. `z` from `zod`; `SimEvent` from
  `packages/shared/src/events.js`.
- **Produces:**
```ts
// packages/shared/src/discovery.ts
export const DISCOVERY_EVENT = 'discovery_made'

/** A craft is a Recipe that makes or does something. A word is an expressive verb — the town
 *  learning to name an act that changes nothing. Both are somebody working something out. */
export type DiscoveryKind = 'craft' | 'word'

/** Who worked it out, and the words they used. Travels from the runtime to the arbiter and
 *  back out onto the event, because the arbiter itself never knows who is asking at codify. */
export type DiscoveryCredit = { agentId: string; intent: string }

/** One row of the archive, as the gateway serves it. `by` is resolved to a NAME here because
 *  an id is not a credit. */
export const DiscoveryRecordSchema = z.object({
  seq: z.number().int().positive(),
  tick: z.number().int().nonnegative(),
  recipeId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['craft', 'word']),
  byId: z.string().min(1),
  by: z.string().min(1),
  intent: z.string().min(1),
  makes: z.array(z.string().min(1)),
}).strict()
export type DiscoveryRecord = z.infer<typeof DiscoveryRecordSchema>

export const DiscoveryResponseSchema = z.object({
  discoveries: z.array(DiscoveryRecordSchema),
}).strict()
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>

/** One short line, for a timeline tip and a panel heading. Never quotes the intent — see
 *  `discoveryLine` in chronicle.ts for why. */
export function discoveryHeadline(d: { kind: DiscoveryKind; name: string; by: string }): string
```
```ts
// packages/engine/src/events.def.ts
export const DiscoveryMade: z.ZodObject<{
  recipeId: z.ZodString; name: z.ZodString; kind: z.ZodEnum<['craft','word']>
  byId: z.ZodString; intent: z.ZodString; makes: z.ZodArray<z.ZodString>
}>
```

**Why `byId` and not `agentId`:** the log's existing convention. `agentId` names who an event is
*about* (`agent_died`, `agent_harmed`); `byId` names who *did* it to something else
(`tile_changed.byId`, `fauna_killed.byId`). A discovery is about the thing, credited to a person.

- [ ] **Step 1: Write the failing tests.**

`packages/shared/src/discovery.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  DISCOVERY_EVENT, DiscoveryRecordSchema, DiscoveryResponseSchema, discoveryHeadline,
} from './discovery.js'

const ROW = {
  seq: 12, tick: 3600, recipeId: 'recipe:waterskin', name: 'stitch a waterskin',
  kind: 'craft' as const, byId: 'a1', by: 'Maret',
  intent: 'i want to try carrying water in a stitched hide', makes: ['waterskin'],
}

describe('the discovery record', () => {
  it('names the event type once, for every plane', () => {
    expect(DISCOVERY_EVENT).toBe('discovery_made')
  })

  it('accepts a whole row and refuses a row missing its credit', () => {
    expect(DiscoveryRecordSchema.parse(ROW)).toEqual(ROW)
    const { byId: _byId, ...noCredit } = ROW
    expect(DiscoveryRecordSchema.safeParse(noCredit).success).toBe(false)
  })

  it('refuses an unknown field rather than carrying it to the viewer', () => {
    expect(DiscoveryRecordSchema.safeParse({ ...ROW, verdictJson: '{}' }).success).toBe(false)
  })

  it('lets a word carry no products, and a craft carry several', () => {
    expect(DiscoveryRecordSchema.parse({ ...ROW, kind: 'word', makes: [] }).makes).toEqual([])
    expect(DiscoveryRecordSchema.parse({ ...ROW, makes: ['waterskin', 'cord'] }).makes).toHaveLength(2)
  })

  it('wraps a list of rows', () => {
    expect(DiscoveryResponseSchema.parse({ discoveries: [ROW] }).discoveries).toHaveLength(1)
  })

  it('gives a craft and a word different headlines, and neither quotes the intent', () => {
    const craft = discoveryHeadline({ kind: 'craft', name: 'stitch a waterskin', by: 'Maret' })
    const word = discoveryHeadline({ kind: 'word', name: 'dance', by: 'Maret' })
    expect(craft).toBe('Maret worked out stitch a waterskin')
    expect(word).toBe('Maret found a word: dance')
    for (const line of [craft, word]) expect(line).not.toContain('carrying water')
  })
})
```

Append to `packages/engine/src/fold.test.ts`:
```ts
describe('discovery_made — the record, and nothing in the state', () => {
  const base = genesisState(DEFAULT_CONFIG)
  const payload = {
    recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
    byId: 'a1', intent: 'carry water in a stitched hide', makes: ['waterskin'],
  }
  const evt = { seq: 1, tick: 7, type: 'discovery_made', payload }

  it('folds to a state IDENTICAL to the one it started from', () => {
    const after = fold(base, evt, DEFAULT_CONFIG)
    expect(stateHash(after)).toBe(stateHash(base))
    expect(after).toBe(base)
  })

  it('refuses a discovery with no inventor', () => {
    const { byId: _byId, ...noCredit } = payload
    expect(() => fold(base, { ...evt, payload: noCredit }, DEFAULT_CONFIG)).toThrow()
  })

  it('refuses a kind the archive has no words for', () => {
    expect(() => fold(base, { ...evt, payload: { ...payload, kind: 'vibe' } }, DEFAULT_CONFIG))
      .toThrow()
  })
})
```
Add `stateHash` to that file's `@sj/shared` import if it is not already there.

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/shared/src/discovery.test.ts packages/engine/src/fold.test.ts
```
Expected, and each must be seen before proceeding:
- `discovery.test.ts` — **fails to resolve** `./discovery.js` (`Failed to load url ./discovery.js`).
- `fold.test.ts` "folds to a state IDENTICAL" — **`Error: unknown event type: discovery_made`**,
  thrown from `fold.ts:882`. This is the assertion that proves the fold case is load-bearing: the
  event cannot enter the world at all until it exists.
- `fold.test.ts` "refuses a discovery with no inventor" — this one **passes** in the before-state
  for the wrong reason (the default case throws). **That is a vacuous row.** Note it, and confirm
  in Step 4 that after the case exists it still fails when `byId` is removed and *passes* when it
  is present — Step 4's first assertion is what makes it non-vacuous.

- [ ] **Step 3: Implement.**

`packages/shared/src/discovery.ts`:
```ts
import { z } from 'zod'

export const DISCOVERY_EVENT = 'discovery_made'

export type DiscoveryKind = 'craft' | 'word'
export type DiscoveryCredit = { agentId: string; intent: string }

export const DiscoveryRecordSchema = z.object({
  seq: z.number().int().positive(),
  tick: z.number().int().nonnegative(),
  recipeId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['craft', 'word']),
  byId: z.string().min(1),
  by: z.string().min(1),
  intent: z.string().min(1),
  makes: z.array(z.string().min(1)),
}).strict()
export type DiscoveryRecord = z.infer<typeof DiscoveryRecordSchema>

export const DiscoveryResponseSchema = z.object({
  discoveries: z.array(DiscoveryRecordSchema),
}).strict()
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>

// The intent is the agent's OWN words and it never appears here: a headline reaches the
// chronicle, the chronicle is agent-visible, and a mind reading its own sentence back is a
// loop the one-way glass exists to prevent.
export function discoveryHeadline(d: { kind: DiscoveryKind; name: string; by: string }): string {
  return d.kind === 'word' ? `${d.by} found a word: ${d.name}` : `${d.by} worked out ${d.name}`
}
```

`packages/shared/src/index.ts` — add after `export * from './chronicle.js'`:
```ts
export * from './discovery.js'
```

`packages/engine/src/events.def.ts` — insert immediately after the `AgentExpressed` block (line 109):
```ts
// A mind worked something out that nobody wrote down. `byId` is the inventor, `intent` the
// words they used, `makes` the item kinds the new verb can produce (empty for a coined word).
// The tick is the envelope's; nothing here is duplicated from it.
export const DiscoveryMade = z.object({
  recipeId: z.string().min(1), name: z.string().min(1), kind: z.enum(['craft', 'word']),
  byId: z.string().min(1), intent: z.string().min(1), makes: z.array(z.string().min(1)),
}).strict()
```

`packages/engine/src/fold.ts` — add `DiscoveryMade,` to the `events.def.js` import list (beside
`AgentExpressed,` on line 9), then insert immediately after the `agent_expressed` case (line 161):
```ts
    // The record, and only the record. A discovery changes what the town CAN do — which lives
    // in the verb registry, not in the state — so the state this fold returns is the one it was
    // given, by identity. That is also why no golden can move.
    case 'discovery_made': {
      DiscoveryMade.parse(event.payload)
      return state
    }
```

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/shared/src/discovery.test.ts packages/engine/src/fold.test.ts
```
All PASS. Then the whole suite and the pins:
```bash
pnpm vitest run
pnpm typecheck
```
`packages/shared/src/chronicle.test.ts` — **"covers every event the fold knows"
(`chronicle.test.ts:114–123`) MUST NOW FAIL** with
`discovery_made is neither chronicled nor deliberately silent`. That failure is expected and
correct: it is the vocabulary guard doing its job, and Task 2 closes it. Record the exact text.
`packages/engine/src/golden.test.ts` and `g2.test.ts` PASS unmodified.

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/discovery.ts packages/shared/src/discovery.test.ts \
  packages/shared/src/index.ts packages/engine/src/events.def.ts packages/engine/src/fold.ts \
  packages/engine/src/fold.test.ts
git commit -m "feat(engine): a discovery is a world event, and the log is its archive"
```

---

### Task 2: The town's words for a discovery

**Files:**
- Modify: `packages/shared/src/chronicle.ts:6–25` (`CHRONICLE_WEIGHTS`), `:27–46`
  (`CHRONICLE_ICONS`), `:164–229` (`chronicleLine`)
- Test: `packages/shared/src/chronicle.test.ts`

**Interfaces:**
- **Consumes:** `DiscoveryKind` from Task 1's `packages/shared/src/discovery.ts`; the
  `discovery_made` payload shape `{ recipeId, name, kind, byId, intent, makes }` from Task 1.
- **Produces:**
```ts
// packages/shared/src/chronicle.ts
CHRONICLE_WEIGHTS['discovery_made'] === 19
CHRONICLE_ICONS['discovery_made'] === 'key'
// chronicleLine(ev, look) now returns a sentence for a discovery_made event.
```

**The one-way glass, decided here.** The line names **who** and **what**, and never quotes the
`intent`. Two reasons: the intent is free text a mind wrote, and a chronicle line is agent-visible,
so quoting it feeds a mind's own words back into the world it perceives; and free text cannot be
framing-checked after the fact. The quoted intent lives only in the gateway's JSON (Task 7), which
no agent can reach. The `name` **is** safe to print: it is either an LLM recipe name already
rejected by `framingTainted` (`adjudicate.ts:44–48`) or a coined word, which Task 4 brings under
the same check.

- [ ] **Step 1: Write the failing tests.** Append to `packages/shared/src/chronicle.test.ts`:

```ts
describe('a discovery, in the town’s own words', () => {
  const craft = ev('discovery_made', {
    recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
    byId: 'a1', intent: 'i want to carry water in a stitched hide', makes: ['waterskin'],
  })
  const word = ev('discovery_made', {
    recipeId: 'express:dance', name: 'dance', kind: 'word',
    byId: 'a1', intent: 'i want to dance by the fire', makes: [],
  })

  it('sits second in the feed — under a death, over a birth', () => {
    expect(CHRONICLE_WEIGHTS['discovery_made']).toBe(19)
    expect(CHRONICLE_WEIGHTS['agent_died']).toBeGreaterThan(19)
    expect(CHRONICLE_WEIGHTS['agent_born']).toBeLessThan(19)
  })

  it('has a glyph of its own, shared with nothing else', () => {
    expect(chronicleIcon('discovery_made')).toBe('key')
    const others = Object.entries(CHRONICLE_ICONS).filter(([t]) => t !== 'discovery_made')
    expect(others.map(([, i]) => i)).not.toContain('key')
  })

  it('credits the person by name and says what they worked out', () => {
    expect(chronicleLine(craft, look)).toBe('Rahel found the way of it — stitch a waterskin.')
    expect(chronicleLine(word, look)).toBe('Rahel gave the town a word for it — dance.')
  })

  it('NEVER puts the mind’s own words into a line a mind can read', () => {
    for (const line of [chronicleLine(craft, look), chronicleLine(word, look)]) {
      expect(line).not.toContain('i want to')
      expect(line).not.toContain('stitched hide')
      expect(line).not.toContain('by the fire')
    }
  })

  it('says nothing rather than something wrong when the payload is not one', () => {
    expect(chronicleLine(ev('discovery_made', { kind: 'craft', byId: 'a1' }), look)).toBeNull()
  })

  it('keeps the machinery out of both sentences', () => {
    for (const line of [chronicleLine(craft, look), chronicleLine(word, look)]) {
      expect(line).not.toMatch(/\b(ai|llm|model|prompt|token|agent|recipe|verb)\b/i)
    }
  })
})
```
`ev` and `look` are already defined at the top of that file; do not redeclare them. Add
`CHRONICLE_ICONS` and `CHRONICLE_WEIGHTS` to the file's import from `./chronicle.js` if absent.

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/shared/src/chronicle.test.ts
```
Expected failures, all four load-bearing:
- "sits second in the feed" — `expected undefined to be 19`.
- "has a glyph of its own" — `expected undefined to be 'key'` (`chronicleIcon` falls back to
  `'star'`, so it returns `'star'`, not `'key'`).
- "credits the person by name" — `expected null to be 'Rahel found the way of it — …'`
  (`chronicleLine`'s `default:` returns `null`).
- "covers every event the fold knows" — still failing from Task 1.

The "NEVER puts the mind's own words" and "keeps the machinery out" rows **pass vacuously against
`null`**. That is expected and is why they are written alongside a row that pins the exact
sentence: once Step 3 makes the line real, they become the guard. Note this explicitly in the
commit body.

- [ ] **Step 3: Implement.** In `packages/shared/src/chronicle.ts`:

Add to `CHRONICLE_WEIGHTS`, on the line between `agent_died: 20,` and `agent_born: 18,`:
```ts
  // §3: under a death and over a birth. A person dying is the peak of a life simulation; what
  // that life can now DO is second, and it is the only entry here that is permanent.
  discovery_made: 19,
```
Add to `CHRONICLE_ICONS`, in the matching position:
```ts
  discovery_made: 'key',
```
Add to `chronicleLine`'s switch, immediately before `case 'agent_born':`:
```ts
    // Who and what, never the words they used: the intent is free text a mind wrote and this
    // sentence is one a mind can read. The archive keeps the quote (gateway `/api/discoveries`),
    // and no agent can reach the archive.
    case 'discovery_made': {
      const name = str(p.name)
      const kind = str(p.kind)
      if (name === '' || (kind !== 'craft' && kind !== 'word')) return null
      const who = look.agentName(str(p.byId))
      return kind === 'word'
        ? `${who} gave the town a word for it — ${name}.`
        : `${who} found the way of it — ${name}.`
    }
```

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/shared
```
All PASS, **including "covers every event the fold knows"**, which Task 1 broke and this task
closes — that transition is the proof the vocabulary guard is real.
```bash
pnpm vitest run && pnpm typecheck
```
Whole repo green; `golden.test.ts` and `g2.test.ts` unmodified and passing.

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/chronicle.ts packages/shared/src/chronicle.test.ts
git commit -m "feat(shared): the chronicle has words for a discovery, and none of them are the mind's own"
```

---

### Task 3: `EngineBridge.announce()` — how a discovery reaches the tick

**Files:**
- Modify: `packages/agents/src/runtime/bridge.ts:109–176`
- Test: `packages/agents/src/runtime/bridge.test.ts` (create if absent)

**Interfaces:**
- **Consumes:** `DISCOVERY_EVENT` from Task 1 (used by the test only; `announce` itself is
  type-agnostic).
- **Produces:**
```ts
// packages/agents/src/runtime/bridge.ts — on class EngineBridge
/** An event that is true the moment it is called but has no verb to ride in on. Drained at
 *  the TOP of the next tick, in arrival order, before any queued intent. */
announce(type: string, payload: Record<string, unknown>): void
```

**Why the top of the tick, before intents.** `agentRuntime.#adjudicateFreeform` calls `codify` and
then `#holdIntent` with the brand-new verb, in that order, inside one synchronous stretch. If
intents drained first, the log would read "used the verb" before "the verb existed" — a record
that lies about causality and a replay that is confusing to read. Announcements first makes the
log tell the truth.

- [ ] **Step 1: Write the failing test.** `packages/agents/src/runtime/bridge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, DISCOVERY_EVENT, type SimEvent } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb } from '@sj/engine'
import { EngineBridge } from './bridge.js'

function harness() {
  const store = new EventStore(openDb(':memory:'))
  const loop = new TickLoop({
    store, state: genesisState(DEFAULT_CONFIG), rng: new RngStreams('bridge-test'),
    snapshotEveryTicks: 600, onTick: () => {},
  })
  const bridge = new EngineBridge({ loop, store, simConfig: DEFAULT_CONFIG })
  loop.setOnTick(bridge.wrapTickHandler(() => {}))
  return { store, loop, bridge }
}
const typesOf = (store: EventStore): string[] =>
  store.readFrom(0).map((e: SimEvent) => e.type)

describe('EngineBridge.announce — a fact with no verb to ride in on', () => {
  it('puts the announcement in the world log at the next tick', () => {
    const { store, loop, bridge } = harness()
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
      byId: 'a1', intent: 'carry water in a hide', makes: ['waterskin'],
    })
    expect(typesOf(store)).not.toContain(DISCOVERY_EVENT)  // nothing before the tick
    loop.step()
    expect(typesOf(store)).toContain(DISCOVERY_EVENT)
  })

  it('drains ONCE — a second tick does not re-announce', () => {
    const { store, loop, bridge } = harness()
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:a', name: 'a', kind: 'word', byId: 'a1', intent: 'a', makes: [],
    })
    loop.step(); loop.step(); loop.step()
    expect(typesOf(store).filter((t) => t === DISCOVERY_EVENT)).toHaveLength(1)
  })

  it('keeps arrival order between two announcements in the same tick', () => {
    const { store, loop, bridge } = harness()
    for (const n of ['first', 'second']) {
      bridge.announce(DISCOVERY_EVENT, {
        recipeId: `express:${n}`, name: n, kind: 'word', byId: 'a1', intent: n, makes: [],
      })
    }
    loop.step()
    const names = store.readFrom(0)
      .filter((e: SimEvent) => e.type === DISCOVERY_EVENT)
      .map((e: SimEvent) => (e.payload as { name: string }).name)
    expect(names).toEqual(['first', 'second'])
  })

  it('folds and replays without moving the state — the archive is the log, not the state', () => {
    const { store, loop, bridge } = harness()
    const before = stateHash(loop.state)
    bridge.announce(DISCOVERY_EVENT, {
      recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
      byId: 'a1', intent: 'carry water in a hide', makes: ['waterskin'],
    })
    loop.step()
    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(loop.state))
    // the only difference a tick made is the clock, never the discovery
    expect(loop.state.tick).toBe(1)
    expect(before).not.toBe('')
  })
})
```
Import `stateHash` from `@sj/shared` and `replayFromGenesis` from `@sj/engine` at the top. If
`TickLoop` has no `setOnTick`, construct the loop with
`onTick: (ctx) => wrapped(ctx)` over a `let wrapped` assigned before the first `step()` — read
`packages/engine/src/tickLoop.ts` and use whichever the class actually offers; do not invent an
API.

- [ ] **Step 2: Run it and record the RED.**

```bash
pnpm vitest run packages/agents/src/runtime/bridge.test.ts
```
Expected: **`TypeError: bridge.announce is not a function`** on the first test, and the same on
all four. This is a true RED — the capability does not exist at all.

- [ ] **Step 3: Implement.** In `packages/agents/src/runtime/bridge.ts`:

Beside `#queue` in the field block (line 114), add:
```ts
  #announcements: Array<{ type: string; payload: Record<string, unknown> }> = []
```
Replace the body of `wrapTickHandler` (lines 134–158) with:
```ts
  wrapTickHandler(world: TickHandler): TickHandler {
    return (ctx) => {
      // ANNOUNCEMENTS FIRST. A discovery is what made the intent behind it possible, and the
      // runtime codifies then submits in one synchronous stretch — drain the other way round
      // and the log reads "used the verb" before "the verb existed".
      const announced = this.#announcements
      this.#announcements = []
      for (const a of announced) ctx.emit(a.type, a.payload)

      const queue = this.#queue
      this.#queue = []
      for (const item of queue) {
        const result = submitIntent(
          this.#loop.state,
          this.#simConfig,
          item.agentId,
          item.intent.verb,
          item.intent.params,
        )
        if (result.ok) {
          for (const event of result.events) ctx.emit(event.type, event.payload)
          item.onResult?.({ ok: true })
          item.resolve({ ok: true })
        } else {
          item.onResult?.({ ok: false, reason: result.reason })
          item.resolve({ ok: false, reason: result.reason })
        }
      }
      world(ctx)
      for (const cb of this.#tickCallbacks) cb(ctx.tick)
    }
  }

  // A fact that is already true and has no verb to ride in on. Not a promise: nothing waits on
  // an announcement, and a caller that has already changed the rulebook cannot be told "no".
  announce(type: string, payload: Record<string, unknown>): void {
    this.#announcements.push({ type, payload })
  }
```
Leave `drain()` unchanged: it exists to settle promises nobody will answer, and an announcement
has no promise.

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/agents && pnpm vitest run && pnpm typecheck
```
All green. `golden.test.ts` and `g2.test.ts` PASS unmodified — neither builds an `EngineBridge`.

- [ ] **Step 5: Commit.**

```bash
git add packages/agents/src/runtime/bridge.ts packages/agents/src/runtime/bridge.test.ts
git commit -m "feat(agents): the bridge can announce a fact that has no verb to ride in on"
```

---

### Task 4: The coined word goes through the one-way glass too *(BUG F-C)*

**Files:**
- Modify: `packages/arbiter/src/adjudicate.ts:44–48` (`framingTainted`), `:190–199` (the
  expressive stage)
- Test: `packages/arbiter/src/adjudicate.test.ts`

**Interfaces:**
- **Consumes:** nothing from an earlier task.
- **Produces:**
```ts
// packages/arbiter/src/adjudicate.ts
/** True when a coined word names the machinery. Exported so the test can hold the gate to the
 *  same standard the recipe half is held to. */
export function wordTainted(word: string): boolean
```

**Why this is in this plan.** `framingTainted` returns `false` for anything that is not an
`attempt`, so the expressive path never sees the LLM's coined word. `ExpressiveRulingSchema.word`
is `/^[a-z]{2,24}$/`, which admits `ai`, `model`, `token`, `tool`, `prompt`, `neural`,
`chatbot`, `simulation` — every one of them matched by `FORBIDDEN_FRAMING`. Such a word becomes a
permanent verb and an agent-visible line ("Rahel was seen to model."). Task 2 just gave the same
string a **second** agent-visible surface, so this plan closes the hole before it widens it. This
is the only task in the plan that changes arbiter behaviour, and it changes only what is
**refused**, never what is decided.

- [ ] **Step 1: Write the failing test.** Append to `packages/arbiter/src/adjudicate.test.ts`:

```ts
describe('F-C — a coined word is held to the framing law, like a recipe name', () => {
  it('refuses every machinery word the schema would otherwise admit', () => {
    for (const w of ['ai', 'model', 'models', 'token', 'tokens', 'tool', 'tools',
      'prompt', 'neural', 'chatbot', 'simulation']) {
      expect(wordTainted(w), w).toBe(true)
    }
  })

  it('admits the words the town actually coins', () => {
    for (const w of ['dance', 'sing', 'mourn', 'salute', 'bow', 'keen', 'hum']) {
      expect(wordTainted(w), w).toBe(false)
    }
  })

  it('does not codify a tainted word — no rulebook row, no verb, no ruling', () => {
    const db = makeDb()
    const llm = stubLlm([{ word: 'model', sense: 'sight', durationTicks: 3,
      energyCost: 1, targeted: false, emote: 'they move oddly' }])
    const arbiter = makeArbiter({ db, llm, embedder: stubEmbedder(), tick: () => 5 })
    return arbiter.adjudicate('i want to dance by the fire', CTX).then((v) => {
      expect(v.kind).not.toBe('map')
      expect(new RulebookStore(db).byId('express:model')).toBeNull()
      expect(VERBS['express:model']).toBeUndefined()
    })
  })
})
```
`makeDb`, `stubLlm`, `stubEmbedder` and `CTX` are the helpers that file already defines — read the
top of `adjudicate.test.ts` and reuse them verbatim rather than writing new ones. Import
`wordTainted` from `./adjudicate.js`, `RulebookStore` from `./rulebook.js`, `VERBS` from
`@sj/engine`.

- [ ] **Step 2: Run it and record the RED.**

```bash
pnpm vitest run packages/arbiter/src/adjudicate.test.ts
```
Expected:
- Rows 1 and 2 — **`wordTainted is not exported`** / `ReferenceError`.
- Row 3 — the load-bearing one. Delete the two `wordTainted` rows temporarily and run row 3 alone
  against the before-state; it must fail with the rulebook row **present**:
  `expected RulebookRow { recipeId: 'express:model', … } to be null`, and
  `expected 'express:model' verb to be undefined`. **Record that output.** That is the bug,
  reproduced. Restore the two rows before Step 3.

- [ ] **Step 3: Implement.** In `packages/arbiter/src/adjudicate.ts`:

Add immediately after `framingTainted` (line 48):
```ts
// The other half of the same law. `framingTainted` only ever sees an `attempt`, so the coined
// word — which becomes a permanent verb AND an agent-visible chronicle line — went unchecked.
export function wordTainted(word: string): boolean {
  return FORBIDDEN_FRAMING.test(word)
}
```
In the expressive stage, change line 194's guard from `if (ruling.success) {` to:
```ts
        if (ruling.success && !wordTainted(ruling.data.word)) {
```
The `else` path already exists implicitly: a rejected ruling falls through to Stage 3, the full
adjudication, which is the correct answer for an act the cheap path could not name safely.

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/arbiter && pnpm vitest run && pnpm typecheck
```
All green. Confirm `packages/agents/src/prompt/rulesOfBeing.test.ts` is untouched, so BLOCK1 is
unmoved:
```bash
git diff --stat main...HEAD -- packages/agents/src/prompt/rulesOfBeing.test.ts   # empty
```

- [ ] **Step 5: Commit.**

```bash
git add packages/arbiter/src/adjudicate.ts packages/arbiter/src/adjudicate.test.ts
git commit -m "fix(arbiter): a coined word passes the one-way glass, same as a recipe name"
```

---

# PHASE B — THE CREDIT IS CAPTURED

### Task 5: `onCodified` — both codification paths report what they minted

**Files:**
- Modify: `packages/arbiter/src/codify.ts:168–197`, `packages/arbiter/src/adjudicate.ts:64–73`
  (`ArbiterDeps`), `:75–82` (`Arbiter`), `:103–117` (`codifyExpressive`), `:190–199`, `:251–253`
- Test: `packages/arbiter/src/codify.test.ts`, `packages/arbiter/src/adjudicate.test.ts`

**Interfaces:**
- **Consumes:** `DiscoveryCredit`, `DiscoveryKind` from Task 1
  (`packages/shared/src/discovery.ts`).
- **Produces:**
```ts
// packages/arbiter/src/codify.ts
/** The item kinds a recipe's outcome table can spawn, deduped and sorted so two calls on the
 *  same recipe are byte-equal. This is "what it unlocked". */
export function productsOf(recipe: Recipe): string[]

// packages/arbiter/src/adjudicate.ts
export type Codified = {
  recipeId: string          // 'recipe:waterskin' | 'express:dance'
  name: string              // the town's word for it
  kind: DiscoveryKind       // 'craft' | 'word'
  makes: string[]           // productsOf(recipe); [] for a word
  credit: DiscoveryCredit   // { agentId, intent }
}

// ArbiterDeps gains:
onCodified?: (d: Codified) => void

// Arbiter.codify gains a second, REQUIRED parameter:
codify(recipe: Recipe, credit: DiscoveryCredit): { ruleId: number; verb: string }
```

**Fires on the FIRST INSERT ONLY, in both paths.** Not on the idempotent no-op (`codify.ts:191`
returns an existing active row), and **not on reactivate** (`:186–190`, `adjudicate.ts:107–111`).
A reactivation is an operator re-opening a reverted rule; the town did not invent it twice and the
admin is not its inventor. The original event stays in the log, which is what "the archive
survives a revert" means.

**Required, not optional, on `codify`.** An optional credit would produce silent uncredited
discoveries — the exact failure mode this project has been burned by. There are three call sites
(`agentRuntime.ts:376`, `g9-livingworld.ts:370`, `g11-deepworld.ts:554`) and Task 6 updates all
three.

- [ ] **Step 1: Write the failing tests.**

Append to `packages/arbiter/src/codify.test.ts`:
```ts
describe('productsOf — what a recipe unlocked', () => {
  const recipe = (rows: Array<{ kind: string }>) => ({
    ...BASE_RECIPE,
    outcomeTable: [
      { weight: 7, success: true, label: 'it holds', effects: rows.map((r) => ({
        op: 'spawn_item' as const, kind: r.kind, qty: 1, to: 'agent' as const })) },
      { weight: 3, success: false, label: 'it leaks', effects: [{ op: 'none' as const }] },
    ],
  })

  it('reads every item kind the table can spawn', () => {
    expect(productsOf(recipe([{ kind: 'waterskin' }, { kind: 'cord' }]))).toEqual(['cord', 'waterskin'])
  })

  it('dedupes and sorts, so two calls are byte-equal', () => {
    const r = recipe([{ kind: 'waterskin' }, { kind: 'waterskin' }])
    expect(productsOf(r)).toEqual(['waterskin'])
    expect(JSON.stringify(productsOf(r))).toBe(JSON.stringify(productsOf(r)))
  })

  it('is empty for a recipe that spawns nothing', () => {
    expect(productsOf({ ...BASE_RECIPE, outcomeTable: [
      { weight: 1, success: true, label: 'a knack', effects: [{ op: 'gain_skill', track: 'craft', xp: 5 }] },
    ] })).toEqual([])
  })
})

describe('codify reports the mint — once, and only for a new one', () => {
  const CREDIT = { agentId: 'a1', intent: 'carry water in a stitched hide' }

  it('calls onCodified on the first insert, with the credit and the products', () => {
    const seen: Codified[] = []
    const deps = makeCodifyDeps({ onCodified: (d) => seen.push(d) })
    codify(WATERSKIN, CREDIT, deps)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      recipeId: 'recipe:waterskin', name: WATERSKIN.name, kind: 'craft',
      makes: ['waterskin'], credit: CREDIT,
    })
  })

  it('does NOT call it again when the same recipe is codified twice', () => {
    const seen: Codified[] = []
    const deps = makeCodifyDeps({ onCodified: (d) => seen.push(d) })
    codify(WATERSKIN, CREDIT, deps)
    codify(WATERSKIN, CREDIT, deps)
    expect(seen).toHaveLength(1)
  })

  it('does NOT call it when a reverted rule is re-opened — the town did not invent it twice', () => {
    const seen: Codified[] = []
    const deps = makeCodifyDeps({ onCodified: (d) => seen.push(d) })
    codify(WATERSKIN, CREDIT, deps)
    deps.review.revertByRecipe(WATERSKIN.id, 'admin test', 10)
    codify(WATERSKIN, CREDIT, deps)
    expect(seen).toHaveLength(1)
  })
})
```
`BASE_RECIPE`, `WATERSKIN` and a deps builder already exist in that file in some form — read it
and reuse the real names; if the deps builder does not exist, add
`function makeCodifyDeps(extra = {}) { const db = makeDb(); return { rulebook: new RulebookStore(db), review: new ReviewStore(db), codex: seededCodex(db), tick: 5, ...extra } }`
using that file's own `makeDb`/codex seed helper.

Append to `packages/arbiter/src/adjudicate.test.ts`:
```ts
describe('the expressive path reports its mint too (F-B)', () => {
  it('calls onCodified for a coined word, with kind "word" and no products', async () => {
    const seen: Codified[] = []
    const db = makeDb()
    const llm = stubLlm([{ word: 'dance', sense: 'sight', durationTicks: 3,
      energyCost: 1, targeted: false, emote: 'they move to a rhythm' }])
    const arbiter = makeArbiter({
      db, llm, embedder: stubEmbedder(), tick: () => 5, onCodified: (d) => seen.push(d),
    })
    await arbiter.adjudicate('i want to dance by the fire', CTX)
    expect(seen).toEqual([{
      recipeId: 'express:dance', name: 'dance', kind: 'word', makes: [],
      credit: { agentId: CTX.agentId, intent: 'i want to dance by the fire' },
    }])
  })

  it('does not report a word the town already has', async () => {
    const seen: Codified[] = []
    const db = makeDb()
    const ruling = { word: 'dance', sense: 'sight' as const, durationTicks: 3,
      energyCost: 1, targeted: false, emote: 'they move to a rhythm' }
    const arbiter = makeArbiter({
      db, llm: stubLlm([ruling, ruling]), embedder: stubEmbedder(), tick: () => 5,
      onCodified: (d) => seen.push(d),
    })
    await arbiter.adjudicate('i want to dance by the fire', CTX)
    await arbiter.adjudicate('i want to dance in the rain', CTX)
    expect(seen).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/arbiter
```
Expected:
- every `productsOf` row — `ReferenceError: productsOf is not defined`.
- `codify(WATERSKIN, CREDIT, deps)` — a **TypeScript/arity** failure; under vitest it runs but
  `seen` is `[]`, so `expected [] to have length 1`.
- both expressive rows — `expected [] to deeply equal [ … ]`.

- [ ] **Step 3: Implement.**

In `packages/arbiter/src/codify.ts`, add above `codify`:
```ts
// What a recipe unlocked, as item kinds. Sorted and deduped so the same recipe always yields
// the same array — the forge keys off it and a byte-unstable list would re-commission art.
export function productsOf(recipe: Recipe): string[] {
  const kinds = new Set<string>()
  for (const row of recipe.outcomeTable) {
    for (const e of row.effects) if (e.op === 'spawn_item') kinds.add(e.kind)
  }
  return [...kinds].sort()
}
```
Change `codify`'s signature and its two return paths:
```ts
export function codify(
  recipe: Recipe,
  credit: DiscoveryCredit,
  deps: {
    rulebook: RulebookStore; review: ReviewStore; codex: CodexStore; tick: number
    onCodified?: (d: Codified) => void
  },
): { ruleId: number; verb: string } {
```
(keep the two `throw` guards at `:174–180` exactly as they are), and at the very end replace the
final three lines with:
```ts
  const ruleId = deps.rulebook.insert(recipe, deps.tick)
  registerVerb(verbFromRecipe(recipe))
  deps.review.queue(ruleId, recipe.id, deps.tick)
  // First insert only. A reactivation above is an operator re-opening a reverted rule, and the
  // admin is not its inventor — the original event is already in the log and stays there.
  deps.onCodified?.({
    recipeId: recipe.id, name: recipe.name, kind: 'craft', makes: productsOf(recipe), credit,
  })
  return { ruleId, verb: recipe.id }
```
Add the imports at the top of the file:
```ts
import type { DiscoveryCredit } from '@sj/shared'
import type { Codified } from './adjudicate.js'
```
> `adjudicate.ts` already imports from `codify.js`; this back-import is **type-only** and erases
> at compile time, so it creates no runtime cycle. If `verbatimModuleSyntax` complains, move
> `Codified` into `packages/shared/src/discovery.ts` and import it from there in both files.

In `packages/arbiter/src/adjudicate.ts`:

Add to the top-level types, after `AgentCtx`:
```ts
// What a codification just minted. Fired once, on the first insert, from BOTH paths — the
// recipe half and the coined-word half (F-B). The runner turns it into a world event.
export type Codified = {
  recipeId: string
  name: string
  kind: DiscoveryKind
  makes: string[]
  credit: DiscoveryCredit
}
```
with `import type { DiscoveryCredit, DiscoveryKind } from '@sj/shared'` at the top.

Add to `ArbiterDeps`:
```ts
  // Told what was just minted, so a caller that owns a world can put it in the record. The
  // arbiter itself never touches the world log — it does not have one.
  onCodified?: (d: Codified) => void
```
Change `Arbiter.codify`'s declaration to:
```ts
  codify(recipe: Recipe, credit: DiscoveryCredit): { ruleId: number; verb: string }
```
Change `codifyExpressive`'s signature and its insert path:
```ts
  function codifyExpressive(ruling: ExpressiveRuling, tick: number, credit: DiscoveryCredit): string {
    const row = expressiveRow(ruling)
    const existing = rulebook.byId(row.id)
    if (existing !== null && existing.revertedAtTick === null) return row.id
    if (existing !== null) {
      rulebook.reactivate(row, tick)
      if (!VERBS[row.id]) registerVerb(expressiveVerbFromRuling(row.name, row))
      review.queue(existing.id, row.id, tick)
      return row.id
    }
    const ruleId = rulebook.insert(row, tick)
    if (!VERBS[row.id]) registerVerb(expressiveVerbFromRuling(row.name, row))
    review.queue(ruleId, row.id, tick)
    deps.onCodified?.({
      recipeId: row.id, name: row.name, kind: 'word', makes: [],
      credit,
    })
    return row.id
  }
```
Change its call site (line 195) to pass the credit — the asker is right there:
```ts
          const verdict: Verdict = {
            kind: 'map',
            verb: codifyExpressive(ruling.data, tick(), { agentId: agentCtx.agentId, intent }),
            params: {},
          }
```
Change the `codify` method (lines 251–253) to:
```ts
    codify(recipe, credit) {
      return codifyRecipe(recipe, credit, {
        rulebook, review, codex, tick: tick(),
        ...(deps.onCodified === undefined ? {} : { onCodified: deps.onCodified }),
      })
    },
```

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/arbiter && pnpm typecheck
```
`pnpm typecheck` **will report errors in `packages/agents`** at the three `codify` call sites
(`agentRuntime.ts:376`, `g9-livingworld.ts:370`, `g11-deepworld.ts:554`) —
`Expected 2 arguments, but got 1`. **That is the correct RED for Task 6 and this task does not fix
it.** Record the three error lines verbatim; Task 6 closes them and only then is the tree green.
Run `pnpm vitest run packages/arbiter packages/shared packages/engine` — those three must be green
now.

- [ ] **Step 5: Commit.**

```bash
git add packages/arbiter/src/codify.ts packages/arbiter/src/codify.test.ts \
  packages/arbiter/src/adjudicate.ts packages/arbiter/src/adjudicate.test.ts
git commit -m "feat(arbiter): both codification paths report what they minted, with credit

Typecheck is deliberately RED at the three codify call sites; Task 6 closes them."
```

---

### Task 6: The runtime names the inventor

**Files:**
- Modify: `packages/agents/src/runtime/arbiterSeam.ts:27–30`,
  `packages/agents/src/runtime/agentRuntime.ts:370–382`,
  `packages/agents/scripts/g9-livingworld.ts:363–372`,
  `packages/agents/scripts/g11-deepworld.ts:546–555`
- Test: `packages/agents/src/runtime/agentRuntime.test.ts`

**Interfaces:**
- **Consumes:** `DiscoveryCredit` from Task 1; `Codified` and the two-argument
  `Arbiter.codify(recipe, credit)` from Task 5.
- **Produces:**
```ts
// packages/agents/src/runtime/arbiterSeam.ts
export type Codifier = (
  recipe: { id: string },
  credit: DiscoveryCredit,
) => { ruleId: number; verb: string }
```

**This is F-A closed.** The arbiter cannot know who is asking at codify time; the runtime always
does. `#adjudicateFreeform` owns both halves of the credit — `this.#agentId` and its own
`description` parameter, which is the mind's verbatim intent.

- [ ] **Step 1: Write the failing test.** Append to
  `packages/agents/src/runtime/agentRuntime.test.ts`:

```ts
describe('the inventor is named where the recipe becomes law', () => {
  it('passes the asking mind and its own words to the codifier', async () => {
    const calls: Array<{ recipeId: string; credit: DiscoveryCredit }> = []
    const runtime = makeRuntime()   // this file's own harness
    wireArbiter(runtime, {
      adjudicate: async () => ({
        kind: 'attempt', recipe: { id: 'recipe:waterskin' },
        summary: 'they stitch a hide into a bag',
      }),
      codify: (recipe, credit) => {
        calls.push({ recipeId: recipe.id, credit })
        return { ruleId: 1, verb: recipe.id }
      },
    })
    await runtime.testAdjudicate('i want to carry water in a stitched hide')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.credit).toEqual({
      agentId: AGENT_ID, intent: 'i want to carry water in a stitched hide',
    })
  })

  it('credits the SAME words the arbiter was asked, not a paraphrase', async () => {
    const seen: string[] = []
    let asked = ''
    const runtime = makeRuntime()
    wireArbiter(runtime, {
      adjudicate: async (intent) => {
        asked = intent
        return { kind: 'attempt', recipe: { id: 'recipe:x' }, summary: 's' }
      },
      codify: (_r, credit) => { seen.push(credit.intent); return { ruleId: 1, verb: 'recipe:x' } },
    })
    await runtime.testAdjudicate('weave a basket from river reeds')
    expect(seen[0]).toBe(asked)
  })
})
```
`makeRuntime`, `AGENT_ID` and the way that file drives `#adjudicateFreeform` already exist — read
`agentRuntime.test.ts` and reuse its harness verbatim. If it drives the private method through a
rejected verb rather than a `testAdjudicate` helper, use that route instead; do not add a test
hook to production code.

- [ ] **Step 2: Run it and record the RED.**

```bash
pnpm vitest run packages/agents/src/runtime/agentRuntime.test.ts
```
Expected: `expected undefined to deeply equal { agentId: 'a1', intent: '…' }` — the codifier is
called with exactly one argument, so `credit` is `undefined`. That is the credit being dropped on
the floor, reproduced. Then:
```bash
pnpm typecheck
```
still shows the three `Expected 2 arguments, but got 1` errors from Task 5.

- [ ] **Step 3: Implement.**

`packages/agents/src/runtime/arbiterSeam.ts` — replace the `Codifier` line (27) with:
```ts
/** Who worked it out, and the words they used. The arbiter never knows who is asking at
 *  codify time; the runtime always does, so the credit is threaded rather than guessed. */
export type Codifier = (
  recipe: { id: string },
  credit: DiscoveryCredit,
) => { ruleId: number; verb: string }
```
and add at the top of the file:
```ts
import type { DiscoveryCredit } from '@sj/shared'
```

`packages/agents/src/runtime/agentRuntime.ts` — change line 376 to:
```ts
      verb = this.#codify(verdict.recipe, { agentId: this.#agentId, intent: description }).verb
```

`packages/agents/scripts/g9-livingworld.ts` — line 370 becomes:
```ts
      const out = arbiter.codify(recipe as Recipe, credit)
```
and the enclosing `codify` seam member takes the credit through:
```ts
    codify: (recipe: { id: string }, credit: DiscoveryCredit) => {
      const out = arbiter.codify(recipe as Recipe, credit)
```
(keep the rest of that seam's body byte-identical). Add
`import type { DiscoveryCredit } from '@sj/shared'` to that file.

`packages/agents/scripts/g11-deepworld.ts` — line 554 becomes:
```ts
    codify: (recipe: { id: string }, credit: DiscoveryCredit) =>
      arbiter.codify(recipe as Recipe, credit),
```
Add the same type import.

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run && pnpm typecheck
```
**Both fully green** — this is the commit where Task 5's deliberate typecheck RED closes. Confirm
zero errors:
```bash
pnpm typecheck 2>&1 | tail -3
```
`golden.test.ts` and `g2.test.ts` PASS unmodified.

- [ ] **Step 5: Commit.**

```bash
git add packages/agents/src/runtime/arbiterSeam.ts packages/agents/src/runtime/agentRuntime.ts \
  packages/agents/src/runtime/agentRuntime.test.ts packages/agents/scripts/g9-livingworld.ts \
  packages/agents/scripts/g11-deepworld.ts
git commit -m "feat(agents): the mind that worked it out is named where the recipe becomes law"
```

---

# PHASE C — THE ARCHIVE IS SERVABLE

### Task 7: `GET /api/discoveries` — every discovery, in order, with its credit

**Files:**
- Create: `packages/gateway/src/discoveries.ts`, `packages/gateway/src/discoveries.test.ts`
- Modify: `packages/gateway/src/server.ts:1–14` (imports), `:68–72` (the mount block)
- Test: `packages/gateway/src/discoveries.test.ts`

**Interfaces:**
- **Consumes:** `DiscoveryRecord`, `DiscoveryRecordSchema`, `DISCOVERY_EVENT` from Task 1; the
  `discovery_made` payload written by Tasks 3/5/6; `Router` from `./server.js`; `WorldMirror`
  from `./worldMirror.js`.
- **Produces:**
```ts
// packages/gateway/src/discoveries.ts
export type DiscoveryApiDeps = { db: Database.Database; mirror: WorldMirror }

/** Every discovery the world log holds, oldest first, with the inventor resolved to a name.
 *  Pure over its inputs so the route and the marks source cannot drift apart. */
export function readDiscoveries(
  db: Database.Database,
  nameOf: (agentId: string) => string,
): DiscoveryRecord[]

export function mountDiscoveryApi(router: Router, deps: DiscoveryApiDeps): void
// mounts GET /api/discoveries -> { discoveries: DiscoveryRecord[] }
```

**Read-only, over the world DB only.** No `better-sqlite3` handle to the arbiter's database is
opened anywhere in this file. That is the §2 ruling, enforced by a test.

- [ ] **Step 1: Write the failing tests.** `packages/gateway/src/discoveries.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DiscoveryResponseSchema, type DiscoveryRecord } from '@sj/shared'
import { openArbiterDb, RulebookStore } from '@sj/arbiter'
// the harness this package already uses to stand a gateway over a fixture world:
import { makeFixtureGateway } from './testutil.js'

const D1 = {
  recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
  byId: 'a1', intent: 'i want to carry water in a stitched hide', makes: ['waterskin'],
}
const D2 = {
  recipeId: 'express:dance', name: 'dance', kind: 'word',
  byId: 'a2', intent: 'i want to dance by the fire', makes: [],
}

describe('the archive — every discovery, in order, with its credit', () => {
  let base: string, close: () => Promise<void>, dbPath: string
  beforeAll(async () => {
    ({ base, close, dbPath } = await makeFixtureGateway({
      // two agents named a1/a2, then the two discoveries at ticks 40 and 90
      events: [
        { tick: 40, type: 'discovery_made', payload: D1 },
        { tick: 90, type: 'discovery_made', payload: D2 },
      ],
    }))
  })
  afterAll(async () => { await close() })

  const get = async (): Promise<DiscoveryRecord[]> => {
    const res = await fetch(`${base}/api/discoveries`)
    expect(res.status).toBe(200)
    return DiscoveryResponseSchema.parse(await res.json()).discoveries
  }

  it('serves both, oldest first', async () => {
    const rows = await get()
    expect(rows.map((r) => r.recipeId)).toEqual(['recipe:waterskin', 'express:dance'])
    expect(rows.map((r) => r.tick)).toEqual([40, 90])
  })

  it('answers all four questions: who, when, from what, and what it unlocked', async () => {
    const [first] = await get()
    expect(first!.byId).toBe('a1')
    expect(first!.by).not.toBe('a1')            // resolved to a NAME, not an id
    expect(first!.tick).toBe(40)
    expect(first!.intent).toBe(D1.intent)       // the mind's own words, viewer-side only
    expect(first!.makes).toEqual(['waterskin'])
  })

  it('tells a craft from a word', async () => {
    expect((await get()).map((r) => r.kind)).toEqual(['craft', 'word'])
  })

  it('SURVIVES A REVERT — a reverted recipe is part of the record, not a deletion', async () => {
    const adb = openArbiterDb(`${dbPath}.arbiter`)
    new RulebookStore(adb).insert({ id: 'recipe:waterskin', name: 'stitch a waterskin' }, 40)
    new RulebookStore(adb).revert('recipe:waterskin', 'operator test', 500)
    adb.close()
    const rows = await get()
    expect(rows.map((r) => r.recipeId)).toContain('recipe:waterskin')
  })

  it('answers [] on a world that has invented nothing, never a 500', async () => {
    const bare = await makeFixtureGateway({ events: [] })
    const res = await fetch(`${bare.base}/api/discoveries`)
    expect(res.status).toBe(200)
    expect(DiscoveryResponseSchema.parse(await res.json()).discoveries).toEqual([])
    await bare.close()
  })

  it('never opens the arbiter’s database — the ops plane stays off the viewer’s wire', () => {
    const src = readFileSync(new URL('./discoveries.ts', import.meta.url), 'utf8')
    for (const forbidden of ['rulebook', 'openArbiterDb', 'arbiter', 'rulings', 'codex']) {
      expect(src.toLowerCase(), forbidden).not.toContain(forbidden)
    }
  })
})
```
`makeFixtureGateway` is a stand-in name — read `packages/gateway/src/narratorApi.test.ts` and
`g10.test.ts` and reuse **whichever fixture builder those files already use**, with the same
signature. Do not add a new harness if one exists.

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/gateway/src/discoveries.test.ts
```
Expected: the import of `./discoveries.js` fails to resolve; once that file is stubbed empty, every
`fetch` returns **404** with `{"error":"not found"}` (`server.ts:88–89`), so
`expected 404 to be 200`. The "never opens the arbiter's database" row would pass against an empty
file — **that is vacuous** — so it is paired with the six rows above it that only pass once the
route is real and serving from the world DB.

- [ ] **Step 3: Implement.** `packages/gateway/src/discoveries.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type Database from 'better-sqlite3'
import { DISCOVERY_EVENT, DiscoveryRecordSchema, type DiscoveryRecord } from '@sj/shared'
import type { Router } from './server.js'
import type { WorldMirror } from './worldMirror.js'

export type DiscoveryApiDeps = { db: Database.Database; mirror: WorldMirror }

const sendJson = (res: ServerResponse, body: unknown): void => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// The world's own log IS the archive: append-only, ordered, and physically unable to lose a
// row when a rule is later reverted. Nothing here reaches the ops plane, by construction.
export function readDiscoveries(
  db: Database.Database,
  nameOf: (agentId: string) => string,
): DiscoveryRecord[] {
  const rows = db
    .prepare('SELECT seq, tick, payload FROM events WHERE type = ? ORDER BY tick, seq')
    .all(DISCOVERY_EVENT) as Array<{ seq: number; tick: number; payload: string }>
  const out: DiscoveryRecord[] = []
  for (const r of rows) {
    const p = JSON.parse(r.payload) as Record<string, unknown>
    const parsed = DiscoveryRecordSchema.safeParse({
      seq: r.seq, tick: r.tick,
      recipeId: p.recipeId, name: p.name, kind: p.kind, byId: p.byId,
      by: nameOf(String(p.byId ?? '')), intent: p.intent, makes: p.makes,
    })
    // A row a future writer shaped differently is skipped, never a 500: the observatory is a
    // window, and a window does not break because one pane is unfinished.
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

export function mountDiscoveryApi(router: Router, deps: DiscoveryApiDeps): void {
  router.route('GET', '/api/discoveries', (_req: IncomingMessage, res: ServerResponse) => {
    const state = deps.mirror.state()
    sendJson(res, {
      discoveries: readDiscoveries(deps.db, (id) => state.agents[id]?.name ?? id),
    })
  })
}
```
> The `nameOf` fallback returns the id, which would make `by === byId`. The test asserts they
> differ, so the fixture MUST spawn `a1`/`a2` with real names — check that
> `makeFixtureGateway` emits `agent_spawned` for both before the discoveries.

`packages/gateway/src/server.ts` — add the import beside the others (after line 14):
```ts
import { mountDiscoveryApi } from './discoveries.js'
```
and the mount after `mountLineageApi(router, { db, mirror })` (line 72):
```ts
  mountDiscoveryApi(router, { db, mirror })
```

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/gateway && pnpm vitest run && pnpm typecheck
```
All green. The forbidden-string row now guards a real file.

- [ ] **Step 5: Commit.**

```bash
git add packages/gateway/src/discoveries.ts packages/gateway/src/discoveries.test.ts \
  packages/gateway/src/server.ts
git commit -m "feat(gateway): the discovery archive, read-only over the world log"
```

---

### Task 8: The scrub bar's marks learn about discoveries

**Files:**
- Modify: `packages/gateway/src/narratorApi.ts:1–20` (imports), `:178–189` (the marks route)
- Test: `packages/gateway/src/narratorApi.test.ts`

**Interfaces:**
- **Consumes:** `readDiscoveries` from Task 7; `discoveryHeadline` from Task 1.
- **Produces:**
```ts
// GET /api/timeline/marks response gains one field:
discoveries: Array<{ tick: number; words: string }>
// `words` is discoveryHeadline({ kind, name, by }) — already credited, already prose.
```

**Why a source of its own and not a sixth entry in `MARK_EVENT_TYPES`.** The `events` source
carries only `{ tick, type }` (`narratorApi.ts:188`), which cannot say who worked what out. A
discovery mark whose tip reads "Something happened" is a mark not worth aiming at. `milestones`
already sets the precedent for a source that ships its own words.

- [ ] **Step 1: Write the failing test.** Append to
  `packages/gateway/src/narratorApi.test.ts`:

```ts
describe('the scrub bar can aim at a discovery', () => {
  it('ships discoveries as their own source, with words already in them', async () => {
    const res = await fetch(`${base}/api/timeline/marks`)
    const body = await res.json() as { discoveries?: Array<{ tick: number; words: string }> }
    expect(body.discoveries).toBeDefined()
    expect(body.discoveries).toEqual([
      { tick: 40, words: 'Maret worked out stitch a waterskin' },
      { tick: 90, words: 'Sena found a word: dance' },
    ])
  })

  it('keeps the five event marks it already had, unchanged', async () => {
    const body = await (await fetch(`${base}/api/timeline/marks`)).json() as
      { events: Array<{ type: string }> }
    expect(new Set(body.events.map((e) => e.type))).not.toContain('discovery_made')
  })

  it('is a typed empty on a world that invented nothing, never absent', async () => {
    const body = await (await fetch(`${bareBase}/api/timeline/marks`)).json() as
      { discoveries: unknown }
    expect(body.discoveries).toEqual([])
  })
})
```
The fixture this file already stands up must gain two `discovery_made` events at ticks 40 and 90,
credited to two agents named `Maret` and `Sena`. Extend the existing fixture builder in place
rather than adding a second one, and update any test in the file that asserts a total event count.

- [ ] **Step 2: Run it and record the RED.**

```bash
pnpm vitest run packages/gateway/src/narratorApi.test.ts
```
Expected: `expected undefined to be defined` on the first row — `/api/timeline/marks` has no
`discoveries` key at all. Rows 2 and 3 pass vacuously (`undefined` is not `[]` — row 3 fails too:
`expected undefined to deeply equal []`). Record both.

- [ ] **Step 3: Implement.** In `packages/gateway/src/narratorApi.ts`:

Add to the imports:
```ts
import { discoveryHeadline } from '@sj/shared'
import { readDiscoveries } from './discoveries.js'
```
Add one key to the `/api/timeline/marks` response object, after `changes: changeDays(),`:
```ts
      // Its own source, not a sixth MARK_EVENT_TYPE: the events source carries only tick and
      // type, and a discovery mark that cannot name its inventor is a mark not worth aiming at.
      discoveries: readDiscoveries(deps.db, (id) => deps.mirror.state().agents[id]?.name ?? id)
        .map((d) => ({ tick: d.tick, words: discoveryHeadline(d) })),
```
`MARK_EVENT_TYPES` is **not** touched — the second test row proves it.

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/gateway && pnpm vitest run && pnpm typecheck
```
All green.

- [ ] **Step 5: Commit.**

```bash
git add packages/gateway/src/narratorApi.ts packages/gateway/src/narratorApi.test.ts
git commit -m "feat(gateway): the marks source carries discoveries, credited"
```

---

# PHASE D — THE TOWN CAN SEE IT

### Task 9: A ninth mark kind — the day the town could do a new thing

**Files:**
- Modify: `packages/web/src/ui/timelineMarks.ts:13–23`, `:93–174` (`MARK_GLYPH`), `:188–198`
  (`MARK_WORDS`), `:200–209` (`MarkSources`), `:213–240` (`marksFrom`);
  `packages/web/src/ui/Timeline.tsx:17`, `:147–156`
- Test: `packages/web/src/ui/timelineMarks.test.ts`

**Interfaces:**
- **Consumes:** the `discoveries: Array<{ tick: number; words: string }>` source from Task 8.
- **Produces:**
```ts
// packages/web/src/ui/timelineMarks.ts
export const MARK_KINDS = [
  'death', 'birth', 'built', 'first', 'chapter', 'changed', 'quarrel', 'joined', 'discovery',
] as const
MARK_WEIGHT.discovery === 18
MARK_GLYPH.discovery: MarkPixel[]                      // a key, 7×7, INK structure
MARK_WORDS.discovery: { one: string; many: (n: number) => string }
// MarkSources gains: discoveries: ReadonlyArray<{ tick: number; words: string }>
```

**The weight is 18 and the argument is §3.** The glyph is a **key**: a distinct silhouette against
all eight existing shapes (headstone, sprout, roof, cut diamond, open book, turn, crossed strokes,
down-arrow), and it says *unlocked* without saying *technology*.

- [ ] **Step 1: Write the failing tests.** Append to
  `packages/web/src/ui/timelineMarks.test.ts`:

```ts
describe('the ninth mark — a discovery', () => {
  const SOURCES: MarkSources = {
    chapters: [], milestones: [], moments: [], changes: [], events: [],
    discoveries: [{ tick: 40, words: 'Maret worked out stitch a waterskin' }],
  }

  it('is a kind of its own', () => {
    expect(MARK_KINDS).toContain('discovery')
    expect(new Set(MARK_KINDS).size).toBe(MARK_KINDS.length)
  })

  it('outranks every other kind — §3: rare, and the only permanent one', () => {
    expect(MARK_WEIGHT.discovery).toBe(18)
    for (const k of MARK_KINDS) {
      if (k !== 'discovery') expect(MARK_WEIGHT.discovery).toBeGreaterThan(MARK_WEIGHT[k])
    }
    expect(MARK_WEIGHT.discovery).toBeGreaterThanOrEqual(MARK_MIN_WEIGHT)
  })

  it('draws a SHAPE nobody else draws, not just a colour', () => {
    const shapes = MARK_KINDS.map((k) => JSON.stringify(MARK_GLYPH[k]))
    expect(new Set(shapes).size).toBe(MARK_KINDS.length)
    expect(MARK_GLYPH.discovery.length).toBeGreaterThan(0)
  })

  it('fits the 7×7 grid and paints only the palette', () => {
    for (const [x, y, fill] of MARK_GLYPH.discovery) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(MARK_GLYPH_PX)
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(MARK_GLYPH_PX)
      expect(MARK_GLYPH_PALETTE).toContain(fill)
    }
  })

  it('carries its SHAPE in an ink that clears 3:1 on the sand track', () => {
    const structure = MARK_GLYPH.discovery.filter(([, , f]) => MARK_STRUCTURE_INKS.includes(f))
    expect(structure.length, 'no legible ink in the glyph').toBeGreaterThanOrEqual(12)
  })

  it('reads as a mark, with the gateway’s own words', () => {
    const [mark] = marksFrom(SOURCES)
    expect(mark).toEqual({
      tick: 40, kind: 'discovery', weight: 18,
      words: 'Maret worked out stitch a waterskin',
    })
  })

  it('has a fallback phrase for one and for several', () => {
    expect(MARK_WORDS.discovery.one).toBe('Somebody worked something out')
    expect(MARK_WORDS.discovery.many(3)).toBe('3 things were worked out')
  })

  it('SURVIVES a crowded window — it is the mark a viewer wants to land on', () => {
    const crowded = marksFrom({
      ...SOURCES,
      events: [{ tick: 41, type: 'agent_died' }, { tick: 42, type: 'structure_completed' }],
    })
    const kept = coalesceMarks(crowded, 5000)
    expect(kept.map((m) => m.kind)).toEqual(['discovery'])
  })

  it('a source with no discoveries changes nothing about the other eight', () => {
    const without = marksFrom({
      chapters: [], milestones: [], moments: [], changes: [], discoveries: [],
      events: [{ tick: 10, type: 'agent_died' }],
    })
    expect(without.map((m) => m.kind)).toEqual(['death'])
  })
})
```
Add `MARK_MIN_WEIGHT`, `MARK_GLYPH_PALETTE`, `MARK_STRUCTURE_INKS`, `MARK_WORDS` to that file's
import from `./timelineMarks.js` if absent. **Every existing `MarkSources` literal in the repo now
needs `discoveries: []`** — Step 3 lists them.

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/web/src/ui/timelineMarks.test.ts
```
Expected: `expected [ 'death', …, 'joined' ] to include 'discovery'`;
`expected undefined to be 18`; `expected undefined to deeply equal { tick: 40, … }`. The 3:1 ink
row fails with `Cannot read properties of undefined (reading 'filter')`. The "survives a crowded
window" row is the load-bearing one for the weight: against the before-state `marksFrom` produces
only the death and the built mark, so `kept.map(m => m.kind)` is `['death']`, not `['discovery']`.

- [ ] **Step 3: Implement.** In `packages/web/src/ui/timelineMarks.ts`:

```ts
export const MARK_KINDS = [
  'death', 'birth', 'built', 'first', 'chapter', 'changed', 'quarrel', 'joined', 'discovery',
] as const
```
```ts
/** The weighting the controller ruling asks for, written as a table rather than as a habit.
 *  `discovery` sits above the old ceiling on two arguments: it is rarer than every other kind,
 *  so a high weight costs them almost nothing; and it is the only PERMANENT one — a death
 *  removes one person, a discovery changes what everyone can do for the rest of the run. */
export const MARK_WEIGHT: Readonly<Record<MarkKind, number>> = {
  discovery: 18,
  changed: 16, first: 16, death: 14, birth: 14, joined: 12, quarrel: 12, chapter: 10, built: 8,
}
```
Add to `MARK_GLYPH`, after the `joined` entry:
```ts
  // a key — the day a door opened. HONEY is the ward; INK carries the whole silhouette, so the
  // shape survives the colour being taken away (7.63:1 on the sand track).
  discovery: art(
    '..iii..',
    '.ii.ii.',
    '.ii.ii.',
    '..iii..',
    '...i...',
    '...ihi.',
    '...ih..',
  ),
```
Add to `MARK_WORDS`:
```ts
  // carries the gateway's own credited words, so the fallback is only ever a safety net
  discovery: {
    one: 'Somebody worked something out',
    many: (n) => `${n} things were worked out`,
  },
```
Add to `MarkSources`, after `events`:
```ts
  /** Already credited and already prose — the gateway owns the sentence, because only the
   *  gateway can turn an agent id into a name. */
  discoveries: ReadonlyArray<{ tick: number; words: string }>
```
Add to `marksFrom`, immediately after the `for (const c of sources.changes)` line:
```ts
  for (const d of sources.discoveries) push(d.tick, 'discovery', d.words)
```

In `packages/web/src/ui/Timeline.tsx`, line 17:
```ts
const EMPTY_SOURCES: MarkSources = {
  chapters: [], milestones: [], moments: [], changes: [], events: [], discoveries: [],
}
```
and inside the `setSources` call (line 152):
```ts
            moments: body.moments ?? [], changes: body.changes ?? [], events: body.events ?? [],
            discoveries: body.discoveries ?? [],
```

**Every other `MarkSources` literal must gain `discoveries: []`.** They are, exactly:
`packages/web/src/ui/broadcastReady.test.ts:320`, `packages/web/src/ui/Timeline.test.ts:32`,
`packages/web/src/ui/g12c.test.ts:159` and `:180`. Add the key; change nothing else in those
files.

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/web && pnpm vitest run && pnpm typecheck && pnpm -C packages/web build
```
All green. `broadcastReady.test.ts`'s R5 rows — which assert the three unspeakable events keep
distinct kinds, art and words — must still pass **unmodified apart from the added key**; they are
the proof the ninth kind did not disturb the eight.

**LOOKING LAW.** Foreground a browser on the dev viewer, open the Timeline over a world with a
discovery, and confirm by eye: the key is legible at 3× on the sand track, its 26px hit target is
reachable, and its tip does not run off either edge (`tipSide`, `timelineMarks.ts:55–60`).

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/ui/timelineMarks.ts packages/web/src/ui/timelineMarks.test.ts \
  packages/web/src/ui/Timeline.tsx packages/web/src/ui/Timeline.test.ts \
  packages/web/src/ui/broadcastReady.test.ts packages/web/src/ui/g12c.test.ts
git commit -m "feat(web): a ninth mark — the day the town could do a new thing"
```

---

### Task 10: The live feed says it out loud

**Files:**
- Modify: `packages/web/src/ui/importantFeed.ts:36–117` (`CHRONICLE_GLYPH`),
  `packages/web/src/ui/chronicleFormat.ts:15–33` (`describeEvent`'s delegated block)
- Test: `packages/web/src/ui/importantFeed.test.ts`, `packages/web/src/ui/chronicleFormat.test.ts`

**Interfaces:**
- **Consumes:** `chronicleIcon('discovery_made') === 'key'` and the `discovery_made` case of
  `chronicleLine` from Task 2.
- **Produces:**
```ts
// packages/web/src/ui/importantFeed.ts
CHRONICLE_GLYPH['key']: ChronicleGlyph      // 8×8, GLYPH_PALETTE only
// describeEvent now returns a sentence for a discovery_made event, identical to chronicleLine's.
```

- [ ] **Step 1: Write the failing tests.**

Append to `packages/web/src/ui/importantFeed.test.ts`:
```ts
describe('the discovery glyph', () => {
  it('exists under the icon the chronicle names, and is not the fallback', () => {
    expect(chronicleGlyph('key').pixels).not.toEqual(chronicleGlyph(CHRONICLE_FALLBACK_ICON).pixels)
    expect(chronicleGlyph(chronicleIcon('discovery_made')).pixels)
      .toEqual(chronicleGlyph('key').pixels)
  })

  it('is 8×8 and paints only the palette', () => {
    for (const [x, y, fill] of chronicleGlyph('key').pixels) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(8)
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(8)
      expect(GLYPH_PALETTE).toContain(fill)
    }
  })

  it('is a shape no other chronicle glyph draws', () => {
    const all = Object.entries(CHRONICLE_GLYPH).map(([, g]) => JSON.stringify(g.pixels))
    expect(new Set(all).size).toBe(all.length)
  })

  it('says what it is, for a reader who cannot see it', () => {
    expect(chronicleGlyph('key').label).toBe('a discovery')
  })
})
```

Append to `packages/web/src/ui/chronicleFormat.test.ts`:
```ts
describe('a discovery in the live feed', () => {
  const ev = {
    seq: 9, tick: 40, type: 'discovery_made',
    payload: {
      recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
      byId: 'a1', intent: 'i want to carry water in a stitched hide', makes: ['waterskin'],
    },
  }

  it('reads as the same sentence the chronicle prints — one formatter, not two', () => {
    const state = { agents: { a1: { name: 'Maret' } }, structures: {} } as never
    expect(describeEvent(ev, state)).toBe('Maret found the way of it — stitch a waterskin.')
  })

  it('never leaks the mind’s own words into the ticker', () => {
    expect(describeEvent(ev, null)).not.toContain('i want to')
  })
})
```

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/web/src/ui/importantFeed.test.ts packages/web/src/ui/chronicleFormat.test.ts
```
Expected: the glyph rows fail because `chronicleGlyph('key')` falls back to `star` —
`expected [star pixels] not to equal [star pixels]`, and `expected 'a wonder' to be 'a discovery'`
(or whatever `star`'s label is). The formatter rows fail with `expected null to be 'Maret found
the way of it — …'`, because `describeEvent`'s switch has no `discovery_made` case.

- [ ] **Step 3: Implement.**

In `packages/web/src/ui/importantFeed.ts`, add to `CHRONICLE_GLYPH` after the `star` entry:
```ts
  key: {
    label: 'a discovery',
    pixels: [
      // the ward, INK — the whole silhouette survives the warm pixel being removed
      ...px(INK, [2, 1], [3, 1], [4, 1], [1, 2], [5, 2], [1, 3], [5, 3],
        [2, 4], [3, 4], [4, 4], [3, 5], [3, 6], [4, 6], [3, 7]),
      ...px(HONEY, [3, 2], [3, 3]),
    ],
  },
```
In `packages/web/src/ui/chronicleFormat.ts`, add `case 'discovery_made':` to the block of types
already delegated to the shared formatter (the run beginning at line 20, `case 'agent_died':`), so
it lands beside `case 'agent_expressed':` and falls into the same `return chronicleLabel(ev, state)`.

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/web && pnpm vitest run && pnpm typecheck && pnpm -C packages/web build
```
All green.

**LOOKING LAW.** Foreground the viewer, open the Chronicle lens over a world with a discovery,
and confirm: the key glyph is legible at 16px beside its sentence, the sentence reads as prose,
and nothing quotes the agent's raw intent.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/ui/importantFeed.ts packages/web/src/ui/importantFeed.test.ts \
  packages/web/src/ui/chronicleFormat.ts packages/web/src/ui/chronicleFormat.test.ts
git commit -m "feat(web): the live feed has a glyph and a sentence for a discovery"
```

---

### Task 11: The Discovery Record — the panel, and the end-of-run view

**Files:**
- Create: `packages/web/src/ui/discoveryModel.ts`,
  `packages/web/src/ui/discoveryModel.test.ts`,
  `packages/web/src/ui/DiscoveryPanel.tsx`,
  `packages/web/src/ui/DiscoveryPanel.test.ts`
- Modify: `packages/web/src/ui/route.ts:4`, `packages/web/src/ui/controlBar.ts:42–49` and its
  glyph table, `packages/web/src/ui/StatusStrip.tsx:15`,
  `packages/web/src/ui/chrome.css`, `packages/web/src/App.tsx:11–19` and `:363`

**Interfaces:**
- **Consumes:** `DiscoveryRecord`, `DiscoveryResponseSchema`, `discoveryHeadline` from Task 1;
  `GET /api/discoveries` from Task 7; `AssetRecord` and `store.assetRecords()` from
  `packages/web/src/state/worldStore.ts:23–24`.
- **Produces:**
```ts
// packages/web/src/ui/discoveryModel.ts
export const DISCOVERY_REFETCH_MS = 20_000

/** One leaf of the record: a discovery, plus the art for the first thing it makes when the
 *  forge has produced any. Pure — no fetch, no DOM. */
export type Leaf = {
  record: DiscoveryRecord
  /** `null` until the forge has art for `record.makes[0]`; the leaf reads without it. */
  assetId: string | null
  /** "Day 12, mid-morning" — the moment, in the town's own clock. */
  when: string
  /** discoveryHeadline, for the leaf's heading. */
  headline: string
}

export function leavesOf(
  discoveries: readonly DiscoveryRecord[],
  assets: readonly AssetRecord[],
): Leaf[]

/** The one line at the top of the record. Never a score — an observation. */
export function recordSummary(leaves: readonly Leaf[], throughTick: number): string
```
```tsx
// packages/web/src/ui/DiscoveryPanel.tsx
export function DiscoveryPanel(props: {
  store: WorldStore
  onView: (tick: number | null) => void
}): JSX.Element
```

**What the end-of-run view actually is.** It is **this panel, containing everything** — not a
second artifact to keep right. The panel is a vertical **chain of leaves**, one per discovery,
joined top to bottom by a single rule so that scrolling it *is* scrolling the town's history. Each
leaf is a museum label: the commissioned sprite at 4× nearest-neighbour on the left; the town's
own name for the thing as the heading; **"Day 12, mid-morning — Maret worked this out."**; the
mind's actual words, quoted, underneath (`"I want to try carrying water in a stitched hide."`);
and then what it unlocked. During a run the chain is short and grows; at the end of the
experiment the same chain, scrolled from top to bottom, **is** the answer to *"take a nice look
over what our AI people came up with."* One line at the top holds the whole run:
*"In 41 days, five people worked out nine things."* Clicking a leaf scrubs the world to that tick,
so the record is not a document beside the simulation — it is a way into it.

**Contrast, from §4.** The panel body sits on `--parchment`; text is `--ink` (9.06:1) and
`--ink-quiet` (5.83:1). The leaf's own quote block sits on `--deep` for emphasis and uses
`--cream` (15.02:1) and `--cream-quiet` (8.28:1). **No colour appears on both grounds and no rule
uses `opacity` on a reading surface.**

- [ ] **Step 1: Write the failing tests.**

`packages/web/src/ui/discoveryModel.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { AssetRecord, DiscoveryRecord } from '@sj/shared'
import { leavesOf, recordSummary } from './discoveryModel.js'

const D = (over: Partial<DiscoveryRecord> = {}): DiscoveryRecord => ({
  seq: 1, tick: 17_280, recipeId: 'recipe:waterskin', name: 'stitch a waterskin',
  kind: 'craft', byId: 'a1', by: 'Maret',
  intent: 'i want to carry water in a stitched hide', makes: ['waterskin'], ...over,
})
const A = (kind: string, id = `asset_${kind}`): AssetRecord => ({
  id, seq: 1, class: 'item', desc: kind, kind, meta: null, footprint: { w: 1, h: 1 },
  widthPx: 64, heightPx: 64, status: 'ready', score: 8, attempts: 1, costUsd: 0,
  createdAt: '2026-01-01',
} as AssetRecord)

describe('the leaves of the record', () => {
  it('keeps the archive’s order and gives each leaf its moment and its heading', () => {
    const [leaf] = leavesOf([D()], [])
    expect(leaf!.when).toBe('Day 12, mid-morning')
    expect(leaf!.headline).toBe('Maret worked out stitch a waterskin')
  })

  it('finds the art for the first thing a discovery makes', () => {
    expect(leavesOf([D()], [A('waterskin')])[0]!.assetId).toBe('asset_waterskin')
  })

  it('READS WITHOUT ART — a discovery is never blocked on the forge', () => {
    expect(leavesOf([D()], [])[0]!.assetId).toBeNull()
    expect(leavesOf([D({ kind: 'word', makes: [] })], [])[0]!.assetId).toBeNull()
  })

  it('prefers a ready asset over a placeholder for the same kind', () => {
    const ph = { ...A('waterskin', 'asset_ph'), status: 'placeholder' } as AssetRecord
    expect(leavesOf([D()], [ph, A('waterskin', 'asset_ready')])[0]!.assetId).toBe('asset_ready')
  })

  it('summarises the whole run in one line, and never as a score', () => {
    const line = recordSummary(leavesOf([D(), D({ seq: 2, byId: 'a2', by: 'Sena' })], []), 59_040)
    expect(line).toBe('In 41 days, two people worked out 2 things.')
    expect(line).not.toMatch(/score|point|level|rank/i)
  })

  it('says so plainly when the town has worked nothing out yet', () => {
    expect(recordSummary([], 1440)).toBe('The town has not worked anything out yet.')
  })
})
```
> `when` uses `tickToMoment` from `@sj/shared`; tick 17,280 is day 12 at 00:00, so read
> `tickToMoment`'s actual output before pinning the string and use what it really returns. Pin the
> literal, whatever it is — a test that computes the expectation the same way the code does
> measures nothing.

`packages/web/src/ui/DiscoveryPanel.test.ts` (node env, `renderToStaticMarkup`, following the
pattern in `ChroniclePanel.test.ts`):
```ts
describe('the Discovery Record reads', () => {
  it('answers all four questions on the face of one leaf', () => {
    const html = renderPanel([D()])
    expect(html).toContain('Maret')                       // who
    expect(html).toContain('Day 12')                      // when
    expect(html).toContain('carrying water in a stitched hide')  // from what — the quote
    expect(html).toContain('waterskin')                   // what it unlocked
  })

  it('quotes the mind’s own words HERE and only here', () => {
    expect(renderPanel([D()])).toContain('i want to carry water in a stitched hide')
  })

  it('says the empty state in words, not with a blank panel', () => {
    expect(renderPanel([])).toContain('The town has not worked anything out yet.')
  })

  it('is reachable by keyboard: every leaf is a button with an accessible name', () => {
    const html = renderPanel([D()])
    expect(html).toMatch(/<button[^>]+class="[^"]*leaf/)
    expect(html).toMatch(/aria-label="[^"]*Maret[^"]*"/)
  })

  it('marks the art decorative — the label beside it already says what it is', () => {
    expect(renderPanel([D()], [A('waterskin')])).toMatch(/<img[^>]+alt=""/)
  })
})
```
And a contrast row, in the same style as `contrast.test.ts`:
```ts
describe('the Discovery Record clears AA in both bands', () => {
  const CSS = readFileSync(new URL('./chrome.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const T = tokens(CSS)
  const AA = 4.5

  it('paints its body text on parchment in a token that clears AA', () => {
    const body = ruleBody(CSS, '.discovery-leaf p')
    const name = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(name).toBeDefined()
    expect(contrast(T[name!]!, T['parchment']!)).toBeGreaterThanOrEqual(AA)
  })

  it('paints the quote block’s text on deep in a token that clears AA', () => {
    const body = ruleBody(CSS, '.discovery-quote')
    const name = /color:\s*var\(--([\w-]+)\)/.exec(body)?.[1]
    expect(name).toBeDefined()
    expect(contrast(T[name!]!, T['deep']!)).toBeGreaterThanOrEqual(AA)
  })

  it('NEVER thins a reading surface with opacity', () => {
    for (const sel of ['.discovery-leaf p', '.discovery-quote', '.discovery-leaf h3']) {
      expect(ruleBody(CSS, sel)).not.toMatch(/opacity:/)
    }
  })

  it('holds the type floors and the hit target', () => {
    expect(ruleBody(CSS, '.discovery-quote')).toMatch(/font-size:\s*1[2-9]px/)
    expect(ruleBody(CSS, '.discovery-leaf')).toMatch(/min-height:\s*(2[4-9]|[3-9]\d|\d{3})px/)
  })

  it('keeps its motion inside the band and honours a viewer who asked for none', () => {
    expect(ruleBody(CSS, '.discovery-leaf')).toMatch(/var\(--t-(fast|move|med|slow)\)/)
    expect(CSS).toMatch(/prefers-reduced-motion[\s\S]*discovery-leaf/)
  })
})
```
Import `contrast`, `tokens`, `ruleBody` from `./contrast.test.js` — that file already exports all
three (`contrast.test.ts:11`, `:22`, `:30`).

Append to `packages/web/src/ui/controlBar.test.ts` and `interaction.test.ts` nothing new: their
existing loops over `LENSES` (`controlBar.test.ts:26`, `:79`, `:128`, `:142`;
`controlBarView.test.ts:69`) become the RED for the lens registration automatically.

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/web/src/ui/discoveryModel.test.ts packages/web/src/ui/DiscoveryPanel.test.ts
```
Expected: both fail to resolve their module under test.
```bash
pnpm vitest run packages/web/src/ui/controlBar.test.ts packages/web/src/ui/controlBarView.test.ts
```
Expected once `route.ts` gains the lens but the tables do not:
`expected undefined to be defined` on `LENS_LABEL.discoveries`, and
`expected html to contain 'data-ctl="lens-discoveries"'`. Do the `route.ts` edit first, run these
two, record the failures, then complete Step 3. **This is the ordering that makes the lens guards
bite.**

- [ ] **Step 3: Implement.**

`packages/web/src/ui/discoveryModel.ts`:
```ts
import { tickToMoment, type AssetRecord, type DiscoveryRecord } from '@sj/shared'
import { discoveryHeadline } from '@sj/shared'

export const DISCOVERY_REFETCH_MS = 20_000
const MINUTES_PER_DAY = 1440

export type Leaf = {
  record: DiscoveryRecord
  assetId: string | null
  when: string
  headline: string
}

// Ready beats placeholder for the same kind: the forge retries silently, and a leaf that has
// been given real art must never fall back to the grey square it started with.
function artFor(kind: string | undefined, assets: readonly AssetRecord[]): string | null {
  if (kind === undefined) return null
  const mine = assets.filter((a) => a.kind === kind)
  return (mine.find((a) => a.status === 'ready') ?? mine[0])?.id ?? null
}

export function leavesOf(
  discoveries: readonly DiscoveryRecord[],
  assets: readonly AssetRecord[],
): Leaf[] {
  return discoveries.map((record) => {
    const m = tickToMoment(record.tick)
    return {
      record,
      assetId: artFor(record.makes[0], assets),
      when: `Day ${m.day}, ${m.time}`,
      headline: discoveryHeadline(record),
    }
  })
}

const COUNTED = ['nobody', 'one person', 'two people', 'three people', 'four people', 'five people']
const people = (n: number): string => COUNTED[n] ?? `${n} people`

// An observation, never a score. The town is not winning anything.
export function recordSummary(leaves: readonly Leaf[], throughTick: number): string {
  if (leaves.length === 0) return 'The town has not worked anything out yet.'
  const days = Math.max(1, Math.floor(throughTick / MINUTES_PER_DAY))
  const minds = new Set(leaves.map((l) => l.record.byId)).size
  const thing = leaves.length === 1 ? '1 thing' : `${leaves.length} things`
  return `In ${days} days, ${people(minds)} worked out ${thing}.`
}
```
> `tickToMoment(17_280).time` — read what it actually returns and make the test's pinned string
> match. If it returns `'00:00'` rather than `'mid-morning'`, pin `'Day 12, 00:00'`.

`packages/web/src/ui/DiscoveryPanel.tsx` — a panel that fetches `/api/discoveries` on mount and
every `DISCOVERY_REFETCH_MS`, reads `store.assetRecords()` through `useSyncExternalStore`, and
renders:
```tsx
<section className="discovery-record" aria-label="The discovery record">
  <p className="discovery-summary">{recordSummary(leaves, throughTick)}</p>
  <ol className="discovery-chain">
    {leaves.map((leaf) => (
      <li key={leaf.record.seq}>
        <button
          type="button"
          className="discovery-leaf"
          aria-label={`${leaf.headline}, ${leaf.when}. Go to this moment.`}
          onClick={() => onView(leaf.record.tick)}
        >
          {leaf.assetId === null
            ? <span className="discovery-art discovery-art-none" aria-hidden="true" />
            : <img className="discovery-art" src={`/assets/${leaf.assetId}.png`} alt="" />}
          <span className="discovery-body">
            <h3>{leaf.record.name}</h3>
            <p className="discovery-credit">{leaf.when} — {leaf.record.by} worked this out.</p>
            <p className="discovery-quote">“{leaf.record.intent}”</p>
            {leaf.record.makes.length > 0 && (
              <p className="discovery-makes">
                After this, anyone could make {leaf.record.makes.join(', ')}.
              </p>
            )}
          </span>
        </button>
      </li>
    ))}
  </ol>
</section>
```
The empty state renders the `recordSummary([])` sentence and no `<ol>`. Read
`packages/web/src/ui/ChroniclePanel.tsx:1–60` and copy its fetch/`useSyncExternalStore`/refetch
shape exactly rather than inventing a second one. The asset URL prefix must match what
`mountAssetRoutes` actually serves — read `packages/gateway/src/assetsHttp.ts` and use its real
path.

`packages/web/src/ui/route.ts` line 4:
```ts
export const LENSES = ['map', 'inspector', 'chronicle', 'discoveries', 'society', 'director', 'laws'] as const
```
`packages/web/src/ui/controlBar.ts`:
```ts
export const LENS_LABEL: Readonly<Record<Lens, string>> = {
  map: 'The town', inspector: 'Townsfolk', chronicle: 'Chronicle', discoveries: 'What they made',
  society: 'Bonds', director: 'Moments', laws: 'World laws',
}
export const LENS_GLYPH: Readonly<Record<Lens, string>> = {
  map: 'tile', inspector: 'folk', chronicle: 'scroll', discoveries: 'find',
  society: 'bond', director: 'reel', laws: 'book',
}
```
and add a `find` entry to `CONTROL_GLYPH`, 8 rows of 8, using only `KEY`'s letters — a key, matching
the timeline mark's silhouette so the two surfaces name one thing once:
```ts
  find: art(
    '..iiii..',
    '.ii..ii.',
    '.ii..ii.',
    '..iiii..',
    '...ii...',
    '...iih..',
    '...ii...',
    '...iih..',
  ),
```
`packages/web/src/ui/StatusStrip.tsx` line 15 — add `discoveries: 'What they made',` to
`LENS_LABELS`, matching `LENS_LABEL` exactly (the file's own comment says the bar and the nav
"name one thing once").

`packages/web/src/App.tsx` — import `DiscoveryPanel` beside `ChroniclePanel` (line 13) and mount
it beside line 363:
```tsx
          {shownLens === 'discoveries' && <DiscoveryPanel store={store} onView={onView} />}
```

`packages/web/src/ui/chrome.css` — add the block. Every colour is a token; **no `opacity` on a
reading surface**; the chain rule is the vertical line that makes the panel read as a history:
```css
.discovery-record { padding: 12px 14px; background: var(--parchment); }
.discovery-summary { font-size: 14px; color: var(--ink); margin: 0 0 12px; }
.discovery-chain { list-style: none; margin: 0; padding: 0 0 0 14px; border-left: 2px solid var(--sand); }
.discovery-leaf {
  display: flex; gap: 12px; width: 100%; min-height: 64px; padding: 10px;
  text-align: left; background: var(--cream); border: 1px solid var(--sand); border-radius: 3px;
  margin: 0 0 10px; cursor: pointer;
  transition: background var(--t-fast) var(--ease-tap), border-color var(--t-fast) var(--ease-tap);
}
.discovery-leaf:hover, .discovery-leaf:focus-visible { background: var(--parchment); border-color: var(--ink-quiet); }
.discovery-leaf h3 { font-size: 14px; color: var(--ink); margin: 0 0 4px; }
.discovery-leaf p { font-size: 12px; color: var(--ink-quiet); margin: 0 0 4px; }
.discovery-credit { color: var(--ink); }
.discovery-quote {
  font-size: 12px; color: var(--cream-quiet); background: var(--deep);
  padding: 6px 8px; border-radius: 2px; margin: 6px 0;
}
.discovery-makes { color: var(--ink-quiet); }
.discovery-art { width: 48px; height: 48px; image-rendering: pixelated; flex: 0 0 48px; }
.discovery-art-none { background: var(--sand); border: 1px dashed var(--ink-quiet); }
@media (prefers-reduced-motion: reduce) { .discovery-leaf { transition: none; } }
```
> `.discovery-credit` and `.discovery-makes` override the `p` colour, so the contrast test's
> selectors must be the ones actually asserted. `--ink` on `--cream` is 10.20; `--ink-quiet` on
> `--cream` is 6.57; `--cream-quiet` on `--deep` is 8.28. All three clear AA. **The test reads
> `.discovery-leaf p` against `--parchment`, which is the panel ground behind the leaf — `--ink-quiet`
> on `--parchment` is 5.83, which also clears.**

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/web && pnpm vitest run && pnpm typecheck && pnpm -C packages/web build
```
All green, including `controlBar.test.ts:142` ("every lens is reachable") and
`controlBarView.test.ts:69`, which now cover seven lenses.

**LOOKING LAW.** Foreground a browser on the dev viewer over a world with at least two
discoveries, one with commissioned art and one without. Confirm by eye, in **both** the day and
night bands: the chain reads top to bottom as a history; the quote block is legible on `--deep`;
the leaf without art reads fine with its dashed placeholder; Tab reaches every leaf and Enter
scrubs; nothing shifts when the clock ticks.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/ui/discoveryModel.ts packages/web/src/ui/discoveryModel.test.ts \
  packages/web/src/ui/DiscoveryPanel.tsx packages/web/src/ui/DiscoveryPanel.test.ts \
  packages/web/src/ui/route.ts packages/web/src/ui/controlBar.ts \
  packages/web/src/ui/StatusStrip.tsx packages/web/src/ui/chrome.css packages/web/src/App.tsx
git commit -m "feat(web): the Discovery Record — what our people came up with, in one chain"
```

---

# PHASE E — ART ON DEMAND

### Task 12: A discovery that names a thing with no art commissions one

**Files:**
- Create: `packages/forge/src/discoveryArt.ts`, `packages/forge/src/discoveryArt.test.ts`
- Modify: `packages/forge/src/index.ts` (export the new module)
- Test: `packages/forge/src/discoveryArt.test.ts`

**Interfaces:**
- **Consumes:** `Codified` from Task 5 (`packages/arbiter/src/adjudicate.ts`) — imported
  **structurally**, not by package, to avoid a forge→arbiter dependency: the watcher takes
  `{ name: string; makes: string[] }`. `Forge.commission` (`packages/forge/src/forge.ts:13`),
  `AssetCodex` (`packages/forge/src/codex.ts:30`).
- **Produces:**
```ts
// packages/forge/src/discoveryArt.ts
/** The item kinds a discovery names that the codex has no art for. Sorted, deduped. */
export function artNeededFor(makes: readonly string[], known: ReadonlySet<string>): string[]

/** The words the image model is given. Not agent-visible — this text never enters the world. */
export function itemCommissionText(kind: string, discoveryName: string): string

export type DiscoveryArtWatcher = {
  /** Fire-and-forget. Returns immediately; the art arrives when it arrives. */
  onDiscovery(d: { name: string; makes: readonly string[] }): void
  /** Awaits everything in flight. Tests only — the live run never waits on art. */
  settle(): Promise<void>
}

export function watchDiscoveryArt(deps: {
  forge: Pick<Forge, 'commission'>
  codex: Pick<AssetCodex, 'listSince' | 'onAssetReady'>
  onError?: (kind: string, err: unknown) => void
}): DiscoveryArtWatcher
```

**Art must never block a discovery.** `commission()` never rejects (`forge.ts:24`) — every path
registers a record, `ready` or `placeholder`. `onDiscovery` therefore returns synchronously and
swallows nothing it should not: the only way it can fail is the codex write, and that is reported
through `onError` rather than thrown. The discovery event is already in the log before this is
ever called.

**This cannot touch determinism.** Commissioning writes to the `assets` table, which is not the
event log and is not folded. It runs off the tick and its timing is irrelevant to replay. Stated
here because "the forge, on the live path" is the kind of change that looks like it should move a
golden, and it cannot.

- [ ] **Step 1: Write the failing tests.** `packages/forge/src/discoveryArt.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { artNeededFor, itemCommissionText, watchDiscoveryArt } from './discoveryArt.js'

const stubCodex = (kinds: string[]) => ({
  listSince: () => kinds.map((k, i) => ({ id: `asset_${k}`, seq: i + 1, kind: k } as never)),
  onAssetReady: (_cb: (r: never) => void) => {},
})

describe('what a discovery still needs drawing', () => {
  it('asks for the kinds the codex has never seen', () => {
    expect(artNeededFor(['waterskin', 'cord'], new Set(['cord']))).toEqual(['waterskin'])
  })
  it('asks for nothing when everything is drawn', () => {
    expect(artNeededFor(['cord'], new Set(['cord']))).toEqual([])
  })
  it('asks for nothing for a coined word, which makes nothing', () => {
    expect(artNeededFor([], new Set())).toEqual([])
  })
  it('dedupes and sorts, so the same discovery never commissions twice', () => {
    expect(artNeededFor(['b', 'a', 'a'], new Set())).toEqual(['a', 'b'])
  })
})

describe('the commission text', () => {
  it('describes the thing, and names the discovery it came from', () => {
    const text = itemCommissionText('waterskin', 'stitch a waterskin')
    expect(text).toContain('waterskin')
    expect(text.length).toBeGreaterThan(20)
  })
  it('turns a slug into words — a kind is a slug in the engine and prose to a model', () => {
    expect(itemCommissionText('water_skin', 'x')).toContain('water skin')
    expect(itemCommissionText('water_skin', 'x')).not.toContain('water_skin')
  })
})

describe('the watcher', () => {
  it('commissions one item per undrawn kind, as class "item" on a 1×1 footprint', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'asset_1' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(1)
    expect(commission.mock.calls[0]![1]).toEqual({ w: 1, h: 1 })
    expect(commission.mock.calls[0]![2]).toBe('item')
  })

  it('does NOT commission art the codex already has', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex(['waterskin']) })
    w.onDiscovery({ name: 'stitch a waterskin', makes: ['waterskin'] })
    await w.settle()
    expect(commission).not.toHaveBeenCalled()
  })

  it('does not commission the same kind twice, even across two discoveries', async () => {
    const commission = vi.fn().mockResolvedValue({ id: 'a' })
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    w.onDiscovery({ name: 'one', makes: ['waterskin'] })
    w.onDiscovery({ name: 'two', makes: ['waterskin'] })
    await w.settle()
    expect(commission).toHaveBeenCalledTimes(1)
  })

  it('RETURNS IMMEDIATELY — art never blocks a discovery', () => {
    let resolve = (): void => {}
    const commission = vi.fn(() => new Promise((r) => { resolve = () => r({ id: 'a' }) }))
    const w = watchDiscoveryArt({ forge: { commission }, codex: stubCodex([]) })
    const before = Date.now()
    w.onDiscovery({ name: 'slow', makes: ['waterskin'] })
    expect(Date.now() - before).toBeLessThan(50)
    resolve()
  })

  it('survives a forge that throws, and reports it rather than crashing the run', async () => {
    const seen: string[] = []
    const commission = vi.fn().mockRejectedValue(new Error('provider down'))
    const w = watchDiscoveryArt({
      forge: { commission }, codex: stubCodex([]), onError: (k) => seen.push(k),
    })
    w.onDiscovery({ name: 'x', makes: ['waterskin'] })
    await w.settle()
    expect(seen).toEqual(['waterskin'])
  })
})
```

- [ ] **Step 2: Run them and record the RED.**

```bash
pnpm vitest run packages/forge/src/discoveryArt.test.ts
```
Expected: the whole file fails to resolve `./discoveryArt.js`. This is the honest RED for a
capability the codebase does not have — §0's addition to row 7 recorded that nothing outside
`packages/forge/scripts` has ever called `commission()`.

- [ ] **Step 3: Implement.** `packages/forge/src/discoveryArt.ts`:

```ts
import type { AssetCodex } from './codex.js'
import type { Forge } from './forge.js'

export function artNeededFor(makes: readonly string[], known: ReadonlySet<string>): string[] {
  return [...new Set(makes)].filter((k) => !known.has(k)).sort()
}

// A kind is a slug in the engine and PROSE to a model — the same law the chronicle follows.
// This text never enters the world, so it is not agent-visible and the framing law does not
// reach it; it is kept plain anyway.
export function itemCommissionText(kind: string, discoveryName: string): string {
  const words = kind.replace(/_/g, ' ')
  return `A single ${words}, the object itself, lying still — the thing a townsperson gets when they ${discoveryName}.`
}

export type DiscoveryArtWatcher = {
  onDiscovery(d: { name: string; makes: readonly string[] }): void
  settle(): Promise<void>
}

export function watchDiscoveryArt(deps: {
  forge: Pick<Forge, 'commission'>
  codex: Pick<AssetCodex, 'listSince' | 'onAssetReady'>
  onError?: (kind: string, err: unknown) => void
}): DiscoveryArtWatcher {
  // Every kind the codex has ever registered, kept live. `listSince(0)` seeds it once; the
  // ready callback keeps it current, including for art this watcher did not ask for.
  const known = new Set<string>()
  for (const rec of deps.codex.listSince(0)) if (rec.kind !== null) known.add(rec.kind)
  deps.codex.onAssetReady((rec) => { if (rec.kind !== null) known.add(rec.kind) })

  const inFlight = new Set<Promise<unknown>>()

  return {
    onDiscovery(d) {
      for (const kind of artNeededFor(d.makes, known)) {
        // Claimed BEFORE the await, so a second discovery naming the same kind in the same
        // breath does not pay for it twice.
        known.add(kind)
        const p = deps.forge
          .commission(itemCommissionText(kind, d.name), { w: 1, h: 1 }, 'item')
          .catch((err: unknown) => {
            // commission() contracts never to reject; if it somehow does, the kind goes back
            // so a later discovery can try again, and the run does not stop for a picture.
            known.delete(kind)
            deps.onError?.(kind, err)
          })
          .finally(() => { inFlight.delete(p) })
        inFlight.add(p)
      }
    },
    async settle() {
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}
```
Add `export * from './discoveryArt.js'` to `packages/forge/src/index.ts`.

- [ ] **Step 4: Verify.**

```bash
pnpm vitest run packages/forge && pnpm vitest run && pnpm typecheck
```
All green. **`packages/forge/src/forgeConfig.test.ts` is untouched**, so the forge config pin is
unmoved:
```bash
git diff --stat main...HEAD -- packages/forge/src/forgeConfig.test.ts   # empty
```

- [ ] **Step 5: Commit.**

```bash
git add packages/forge/src/discoveryArt.ts packages/forge/src/discoveryArt.test.ts \
  packages/forge/src/index.ts
git commit -m "feat(forge): a discovery that names an undrawn thing commissions its picture"
```

---

# PHASE F — THE WHOLE RUN, WIRED AND PROVEN

### Task 13: The live seam — one wiring, end to end

**Files:**
- Modify: `packages/agents/scripts/g11-deepworld.ts:1–40` (imports), `:538–557` (the arbiter
  construction and the watched seam)
- Test: none new. **This file is a live-LLM runner and no test in this repo drives it.** Task 14
  is the proof; this task is the two-line wiring the proof depends on, and it is deliberately
  thin for that reason.

**Interfaces:**
- **Consumes:** `EngineBridge.announce` (Task 3); `ArbiterDeps.onCodified` and `Codified`
  (Task 5); `DISCOVERY_EVENT` (Task 1); `watchDiscoveryArt` (Task 12);
  `createForge`/`AssetCodex` (existing, `packages/forge`).
- **Produces:** nothing another task consumes. This is the top of the tree.

**Keep the logic OUT of this file.** Everything below is a call into something a test already
covers. If a step here needs a new branch or a new computed value, it belongs in a tested module
instead.

- [ ] **Step 1: Read what is already there.** Open `g11-deepworld.ts:538–557`. The
  `makeArbiter({ ... })` call and the `watched` seam are the only two things this task edits. Note
  that `bridge` is already in scope at that point (`:491`) and `loop.tick` is the tick source.

- [ ] **Step 2: Confirm the before-state.** `g11-deepworld.ts` contains no `createForge`, no
  `AssetCodex`, and no `announce`:
```bash
grep -n "createForge\|AssetCodex\|announce\|onCodified" packages/agents/scripts/g11-deepworld.ts
```
Expected: **no output.** Record it — this is the measurement that says the seam does not exist.

- [ ] **Step 3: Implement.** Add the imports:
```ts
import { AssetCodex, createForge, watchDiscoveryArt } from '@sj/forge'
import { DISCOVERY_EVENT } from '@sj/shared'
import type { Codified } from '../../arbiter/src/adjudicate.js'
```
Immediately before the `makeArbiter` call, stand the forge up over the same DB:
```ts
  // The forge, on the live path for the first time. Art is commissioned OFF the tick and lands
  // in the `assets` table, which is not the event log — nothing here can reach replay.
  const assetCodex = new AssetCodex(db)
  const discoveryArt = watchDiscoveryArt({
    forge: createForge({ client: imageClient, judge: visionJudge, codex: assetCodex, refs: styleRefs }),
    codex: assetCodex,
    onError: (kind, err) => console.error(`art for ${kind} failed:`, err),
  })
```
> `imageClient`, `visionJudge` and `styleRefs` are whatever `packages/forge/scripts/gen-library.ts`
> constructs for the same purpose. **Read that file and copy its construction verbatim.** Do not
> invent a client. If this run has no image budget configured, guard the whole block behind the
> same env check `gen-library.ts` uses and leave `discoveryArt` as a no-op watcher — a run without
> art must still record discoveries.

Then change the `makeArbiter` call to carry the one callback:
```ts
  const arbiter = makeArbiter({
    db, llm: arbiterLlm, embedder, tick: () => loop.tick, vocabulary: VOCABULARY,
    // THE SEAM. A codification is a world fact, so it goes into the world's log; and if it
    // names a thing nobody has drawn, the forge is asked for a picture. Neither can fail the
    // codification, which has already happened by the time this runs.
    onCodified: (d: Codified) => {
      bridge.announce(DISCOVERY_EVENT, {
        recipeId: d.recipeId, name: d.name, kind: d.kind,
        byId: d.credit.agentId, intent: d.credit.intent, makes: d.makes,
      })
      discoveryArt.onDiscovery({ name: d.name, makes: d.makes })
    },
  })
```

- [ ] **Step 4: Verify.**

```bash
pnpm typecheck && pnpm vitest run
```
Both green. **Do not run the script** — it makes live LLM calls, which this plan forbids. Prove
the wiring by reading it back:
```bash
grep -n "onCodified\|bridge.announce\|discoveryArt.onDiscovery" packages/agents/scripts/g11-deepworld.ts
```
Expected: exactly three lines, in that order.

- [ ] **Step 5: Commit.**

```bash
git add packages/agents/scripts/g11-deepworld.ts
git commit -m "feat(agents): the live run records what its minds work out, and asks for its picture"
```

---

### Task 14: GATE G-D — the record, proved end to end

**Files:**
- Create: `packages/gateway/src/gd.test.ts`
- Test: itself

**Interfaces:**
- **Consumes:** every artefact of Tasks 1–12. This task creates nothing new.
- **Produces:** nothing. It is the gate.

**What G-D claims:** *a discovery made by a mind is credited, recorded, replayed, served, marked,
read, and drawn — and none of the four pins moved.*

- [ ] **Step 1: Write the gate.** `packages/gateway/src/gd.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CHRONICLE_WEIGHTS, DISCOVERY_EVENT, DiscoveryResponseSchema, chronicleIcon, chronicleLine,
  discoveryHeadline, stateHash,
} from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, replayFromGenesis } from '@sj/engine'
import { EngineBridge } from '@sj/agents'
import { MARK_WEIGHT } from '../../web/src/ui/timelineMarks.js'
import { artNeededFor } from '@sj/forge'
import { readDiscoveries } from './discoveries.js'

const PAYLOAD = {
  recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft' as const,
  byId: 'a1', intent: 'i want to carry water in a stitched hide', makes: ['waterskin'],
}

describe('GATE G-D — a discovery is credited, recorded, replayed, served, marked and drawn', () => {
  it('1. reaches the world log through the bridge, and replays bit-identically', () => {
    const store = new EventStore(openDb(':memory:'))
    const loop = new TickLoop({
      store, state: genesisState(), rng: new RngStreams('gd'), snapshotEveryTicks: 600,
      onTick: () => {},
    })
    const bridge = new EngineBridge({ loop, store, simConfig: undefined as never })
    // use this file's real construction — see discoveries.test.ts's harness
    bridge.announce(DISCOVERY_EVENT, PAYLOAD)
    loop.step()
    expect(store.readFrom(0).some((e) => e.type === DISCOVERY_EVENT)).toBe(true)
    expect(stateHash(replayFromGenesis(store))).toBe(stateHash(loop.state))
  })

  it('2. carries all four credits, and the archive resolves the inventor to a name', () => {
    const db = worldWith([{ tick: 40, type: DISCOVERY_EVENT, payload: PAYLOAD }], { a1: 'Maret' })
    const [row] = readDiscoveries(db, (id) => ({ a1: 'Maret' } as Record<string, string>)[id] ?? id)
    expect(row!.by).toBe('Maret')            // who
    expect(row!.tick).toBe(40)               // when
    expect(row!.intent).toBe(PAYLOAD.intent) // from what
    expect(row!.makes).toEqual(['waterskin'])// what it unlocked
  })

  it('3. reads as a sentence, weighted second in the feed, with a glyph of its own', () => {
    const ev = { seq: 1, tick: 40, type: DISCOVERY_EVENT, payload: PAYLOAD }
    const look = { agentName: () => 'Maret', structureKind: () => 'x', mysteryProse: () => null }
    expect(chronicleLine(ev, look)).toBe('Maret found the way of it — stitch a waterskin.')
    expect(CHRONICLE_WEIGHTS['discovery_made']).toBe(19)
    expect(chronicleIcon('discovery_made')).toBe('key')
  })

  it('4. is the heaviest thing on the scrub bar', () => {
    expect(MARK_WEIGHT.discovery).toBe(18)
    expect(Math.max(...Object.values(MARK_WEIGHT))).toBe(18)
  })

  it('5. never quotes the mind’s own words where a mind can read them', () => {
    const ev = { seq: 1, tick: 40, type: DISCOVERY_EVENT, payload: PAYLOAD }
    const look = { agentName: () => 'Maret', structureKind: () => 'x', mysteryProse: () => null }
    const line = chronicleLine(ev, look)!
    expect(line).not.toContain(PAYLOAD.intent)
    expect(discoveryHeadline({ ...PAYLOAD, by: 'Maret' })).not.toContain(PAYLOAD.intent)
  })

  it('6. asks the forge for the one thing nobody has drawn', () => {
    expect(artNeededFor(PAYLOAD.makes, new Set())).toEqual(['waterskin'])
    expect(artNeededFor(PAYLOAD.makes, new Set(['waterskin']))).toEqual([])
  })

  it('7. NOT VACUOUS: a payload with no inventor never becomes a record', () => {
    const { byId: _b, ...noCredit } = PAYLOAD
    const db = worldWith([{ tick: 40, type: DISCOVERY_EVENT, payload: noCredit }], {})
    expect(readDiscoveries(db, (id) => id)).toEqual([])
  })

  it('8. NOT VACUOUS: the archive is non-empty for the world it is measured on', () => {
    const db = worldWith([{ tick: 40, type: DISCOVERY_EVENT, payload: PAYLOAD }], { a1: 'Maret' })
    expect(readDiscoveries(db, () => 'Maret').length).toBeGreaterThan(0)
  })
})
```
`worldWith(events, names)` is a small local helper that opens an in-memory world DB, writes an
`events` table with those rows and returns the handle — model it on the fixture builder
`discoveries.test.ts` already uses. **Rows 7 and 8 exist because this project has shipped an
assertion over an empty set:** row 8 proves the archive under test is not empty, and row 7 proves
the filter that keeps a malformed row out is the thing doing the keeping.

- [ ] **Step 2: Prove the gate is RED against the before-state.** On a scratch worktree at
  `main` (`bbc6f05`), drop this file in and run it:
```bash
pnpm vitest run packages/gateway/src/gd.test.ts
```
Expected: **every one of the eight rows fails** — `DISCOVERY_EVENT` does not exist, `readDiscoveries`
does not exist, `MARK_WEIGHT.discovery` is `undefined`, `chronicleLine` returns `null`. Record the
count: `8 failed`. Delete the scratch worktree. A gate that would have passed before the work is a
gate that measures nothing.

- [ ] **Step 3: Run it on the branch.**
```bash
pnpm vitest run packages/gateway/src/gd.test.ts
```
Expected: `8 passed`.

- [ ] **Step 4: Verify the whole tree, and the pins.**
```bash
pnpm vitest run
pnpm typecheck
pnpm -C packages/web build
pnpm vitest run packages/gateway/src/g12c.test.ts
git status --porcelain          # empty
git diff --stat main...HEAD -- packages/engine/src/golden.test.ts packages/engine/src/g2.test.ts \
  packages/forge/src/forgeConfig.test.ts packages/agents/src/prompt/rulesOfBeing.test.ts
```
The last command must print **nothing**: the four pinned files are byte-identical to `main`, so
`g12c.test.ts`'s `pinAt` extraction passes on the live assignment and its merge-base byte-freeze
on `golden.test.ts` passes too. **No pin is re-pinned by this plan**, so no task here needs the
`Previous value:` discipline.

Then verify in a **fresh worktree**, from clean:
```bash
git worktree add ../sj-verify-discovery discovery-plan
cd ../sj-verify-discovery && pnpm install --frozen-lockfile && pnpm vitest run && pnpm typecheck
```

- [ ] **Step 5: Commit.**
```bash
git add packages/gateway/src/gd.test.ts
git commit -m "test(gateway): GATE G-D — every invention credited, archived and watchable"
```

---

## §6 — SELF-REVIEW

**1. Spec coverage.** Every one of the brief's six in-scope items maps to a task.

| In-scope item | Tasks |
|---|---|
| 1. Credit — who, when, from what, what it unlocked | 1 (the payload), 5 (`Codified` + `productsOf`), 6 (the inventor threaded), 7 (`by` resolved to a name). §2 says why it lands on the event and nowhere else. |
| 2. A world event at codification, reaching the chronicle and every client, catch-up for late joiners | 1 (the event + fold), 2 (the chronicle), 3 (the tick seam), 5+6 (both codification paths fire it), 7 (late-joiner catch-up over HTTP, with the argued deviation from the ws precedent in §2). |
| 3. The archive query | 7. |
| 4. A UI surface — a mark kind and a readable panel | 9 (the mark, weight argued in §3), 10 (the live feed), 11 (the panel). |
| 5. Forge on demand, reaching every client including late joiners | 12 (the watcher), 13 (the wiring). Late joiners get the art through the **existing, unchanged** `server.ts:119–121` asset catch-up — the precedent the brief names, used for exactly what it is for. |
| 6. The end-of-experiment view | 11. It is the same panel containing everything: a chain of leaves, one summary line, each leaf clickable back into the run. §"What the end-of-run view actually is". |

Bonus coverage the brief did not ask for but its own hazards required: Task 4 (the coined word's
framing check, bug F-C).

**2. Placeholder scan.** No `TBD`, no "similar to Task N", no "add appropriate handling". Every
code step carries the actual code. Six places tell the implementer to **read an existing file and
reuse its real helper** rather than inventing one — Task 3's `TickLoop` on-tick API, Task 5's
`makeCodifyDeps`, Task 6's `agentRuntime.test.ts` harness, Task 7's `makeFixtureGateway`, Task 11's
`tickToMoment` output and asset URL prefix, Task 13's image-client construction. Those are
deliberate: naming a helper that may not exist under that name is how a plan produces a
compile error, and each one says exactly which file to open.

**3. Type consistency.** Checked across every task: `DiscoveryCredit` is `{ agentId, intent }` in
Tasks 1, 5, 6, 13. `Codified` is `{ recipeId, name, kind, makes, credit }` in Tasks 5, 12, 13. The
event payload is `{ recipeId, name, kind, byId, intent, makes }` in Tasks 1, 2, 3, 7, 13, 14 —
`byId` on the event, `agentId` inside the credit, and Task 13's seam is the one place that maps
`d.credit.agentId → byId`. `DiscoveryRecord` adds `seq`, `tick` and `by` on top of the payload in
Tasks 1, 7, 8, 11, 14. `discovery` (the mark kind) and `discovery_made` (the event type) are used
consistently and never swapped. `MARK_WEIGHT.discovery = 18` in Tasks 9 and 14;
`CHRONICLE_WEIGHTS.discovery_made = 19` in Tasks 2 and 14.

**4. Interface check.** Every `Consumes` cites a previous `Produces`: T2←T1, T3←T1, T5←T1,
T6←T1,T5, T7←T1, T8←T1,T7, T9←T8, T10←T2, T11←T1,T7, T12←T5, T13←T1,T3,T5,T12, T14←all. Task 1 and
Task 4 consume nothing, which is correct — they are the roots.

**5. Cross-task RED.** Task 5 deliberately leaves `pnpm typecheck` red at three call sites and
Task 6 closes it. That is documented in three places — Task 5 Step 4, Task 5's commit message and
Task 6's Step 2 — so an executor who reads only one of the two tasks still learns why the tree is
red when they arrive. It is the only step in the plan that ends non-green, and it is deliberate:
making `credit` optional to keep the tree green would have permitted silent uncredited
discoveries, which is the failure mode this whole plan exists to prevent.

---

## §7 — CONCERNS, RECORDED

1. **A discovery announced in the last tick before shutdown is lost.** `announce` queues for the
   next tick; if the loop never steps again, the rulebook has the row and the log does not. The
   window is one tick and the loop steps continuously, so this is a paper cut rather than a hole,
   but it is a real asymmetry between the two records. Not worth a task; worth knowing.
2. **Task 13 has no test.** `g11-deepworld.ts` is a live-LLM runner and nothing in the repo drives
   it. The wiring is therefore three lines, each a call into a module Tasks 3, 5 and 12 cover, and
   Step 4 verifies by reading the file back. That is the best available proof short of a live run,
   which this plan forbids.
3. **The image-client construction in Task 13 is the one genuinely unknown edit.** It is copied
   from `gen-library.ts`, which the plan tells the executor to read. If that file's construction
   needs an env var this run does not set, the plan's own instruction is to no-op the watcher — a
   run without art must still record discoveries, which is the same law `commission()` itself
   follows.
4. **`tickToMoment`'s exact output is not pinned in this document.** Task 11's test pins a literal
   string, and the plan tells the implementer to read the function's real output first. Writing a
   guessed literal here would have produced a test that fails for the wrong reason.
5. **The revert is recorded but not shown.** §2 rules this out of scope with its reasoning. If the
   controller wants "the town lost the knack of this" on screen, it needs a second world event for
   an operator action, and that is a design decision, not an omission.
