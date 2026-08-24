# C8 plan — v5b → v6 delta

One line per change, so the diff is reviewable without re-reading the plan.

Input: `2026-08-24-02-genesis-rehearsal-v5b.DRAFT.md` (9 981 lines, 66 tasks, written against `main` @ `645a8d9`).
Output: `2026-08-24-03-genesis-rehearsal-v6.DRAFT.md` (10 152 lines, **66 tasks — none added, none deleted, none renumbered**), written against `main` @ **`9d76b97`**.

**Three lanes landed between the two: `many-hands`, `first-night`, `unpin`.** Everything below is a consequence of one of them, or of reading all 9 981 lines against the tree.

---

## 1. The unpin amendment — the four hash pins are gone

| # | Change | Where |
|---|---|---|
| 1 | **`C3` DELETED OUTRIGHT — 43 lines**, the largest global constraint in the document: the four-pin table, the seven-file census, the decoy paragraph, the stale-branch comparison, the four verification commands and the "one re-pin, spent once" rule | Global Constraints |
| 2 | **`C4` PROMOTED into C3's slot** and expanded: the determinism contract, plus a table of what each deleted pin was protecting and the hash-free assertion that guards it now, plus the mutation finding | Global Constraints |
| 3 | **★ NEW LAW recorded in C4: assert a MID-LOG fold, never a whole-log one.** The unpin lane's mutation proved a whole-log fold-twice test does not bite (an even event count cancels a parity fault) and only the mid-log row caught it — and mid-log is where `WorldMirror.stateAt()` scrubs | C4 |
| 4 | **`C16`'s trailing clause struck** — *"anything that gives G1's scripted agents an `activity` moves the G1 golden and is therefore forbidden outside Phase F"*. There is no G1 hash to move | C16 |
| 5 | **`C17` STRUCK and replaced by `C17′`** — a pin is no longer verified by grepping a literal, but *a check whose subject may not exist must fail loudly when it does not* survives, and the three tasks that rely on it are named | C17 |
| 6 | **T1 Step 0's census greps INVERTED** — from "find eleven literals across seven files, expect twelve lines" to `git grep -cE "[0-9a-f]{64}"` **expecting zero**, plus a check that the mid-log fold row is present | T1 |
| 7 | **T1's expected item 2 rewritten** — the four-branch stale-hash STOP table is gone; the STOP is now "a hash literal has come back" | T1 |
| 8 | **Precondition 2 RETIRED, not discharged** — "re-read all four pins from the merged tip" has no subject | Phase A preconditions |
| 9 | **"The keystone's single regen is still UNSPENT" struck** from the precondition box | Phase A |
| 10 | **Phase F's header rewritten**: it is an ordinary phase. A four-row table names what the keystone used to force and what is now free | Phase F |
| 11 | **T28 gutted and rewritten whole** — the word *once* in its title was doing the work; the two changes and their reasons are unchanged, and the *"never amend block 1 again"* rule keeps its force with a better reason: **block 1 is the cached prefix and T37/T41 measure what a change costs in dollars** | T28 |
| 12 | T28's `BLOCK1_SHA256` export, its re-pin test row, its re-pin step and its four-line hash commit body **deleted**; the row that replaces the pin test asserts **two unlike people open with the same prefix** | T28 |
| 13 | **T29 gutted and rewritten whole** — retitled *"Four physics numbers"*; **six of its nine files leave the file list** because they contained nothing but hashes | T29 |
| 14 | T29's golden regeneration, three-literal re-pin, **attribution table**, nine-re-pin-sites box, `g9.test.ts` source-text warning, `g2.test.ts:33` load-bearing-comment warning and grep read-back — **≈46 lines deleted** | T29 |
| 15 | **★ the one idea in the regen that was not ceremony is KEPT and restated**: predict which change moves which assertion, and record any prediction that was wrong. Four predictions written out | T29 Step 3 |
| 16 | **★ a check the regen used to provide by accident is now asked for deliberately**: `git diff packages/shared/src/config.ts` is read line by line, four lines expected, **five is a STOP** | T29 Step 3 |
| 17 | T29's *"anything discovered after Phase F begins"* exclusion struck — Phase F does not begin | T29 |
| 18 | **T51 check 9 DELETED — 17 lines** (the census, the eleven-file list, the twelve-line count and the path-diff note). **Its expected count was already wrong**: it asserted twelve and the tree returned nineteen | T51 |
| 19 | **T51 check 9 REPLACED** by the inverse: `git grep -cE "[0-9a-f]{64}"` expecting zero, plus a check that the mid-log fold row survives | T51 |
| 20 | **Seventeen tasks lose a cross-package "pins unmoved" verification step**: T7, T9, T10, T11, T14, T18, T21, T22, T55, T56, T57, T58, T59, T61, T62, T63, T64 | throughout |
| 21 | **T7's `block1Sha256()` test row replaced** — both symbols were deleted; the row now asserts the cache-stable prefix directly for two unlike identities | T7 |
| 22 | **T14's commit body** loses `BLOCK1_SHA256 … UNMOVED`; the `CANON` sha256 is relabelled **a move proof, not a pin** — computed on both sides of one commit and thrown away | T14 |
| 23 | **T21 Step 0b's "paste two hashes into the commit body" deleted**; T21's `GOLDEN_DAY_HASH` assertion becomes a fold-equality row | T21 |
| 24 | **T22's three-hash Step 4 replaced** — the invariant is asserted directly by the task's own first row (`DEFAULT_CONFIG.structures.recipes[kind]` is `undefined` for every seed kind), which is what the hashes were a proxy for | T22 |
| 25 | **T62's three-pin Step 4 replaced** by its own `stateHash` row, which names the structure that would have gained the field | T62 |
| 26 | **Nine `(C3)` citations repointed to `(C4)`** with their reasoning rewritten from "a pin would move" to "the config every recorded run replays against would change" | T4, T29, T55, T62 ×3, T64 ×2, F3 header |

## 2. The re-sequencing — new, and the largest structural change

| # | Change | Where |
|---|---|---|
| 27 | **★★ NEW SECTION: THE WAVE TABLE** — twelve waves, with *needs from the wave before* and *contends on* as separate columns, because **file contention is a merge problem and never a scheduling one** | after the numbering box |
| 28 | **Wave 1 holds twenty-five tasks**; waves 1–3 hold forty-eight of the sixty-six | wave table |
| 29 | **★ THE TRUE CRITICAL PATH: fourteen tasks** — `T5 → T15 → T16 → T18 → T32 → T36 → T34 → T58 → T59 → T50 → T51 → T52 → T53 → T54` | wave table §2 |
| 30 | **★ two edges on it are task-boundary accidents, and cutting them gives twelve**: T36's instrument (Steps 1–3) needs nothing and is wave 1 while only Step 4 is the live baseline; and T58's three admin roster lines pull the whole of Phase F2 behind the whole of Phase G. **The second is a real edit and v6 names it rather than making it** | wave table §2 |
| 31 | **★ nineteen tasks named as newly parallelisable**, in four groups: the keystone's queue (T28 ∥ T29, T29's four changes, F2/F3 released), the seventeen that lost a pin check, OD22's two dependents (T21, T22), and six whose phase position hid that they depend on nothing (T66, T26, T44, T45, T24, T36's instrument) | wave table §3 |
| 32 | **★ four edges named as REAL and non-negotiable**: `T57 → T29` (C25's pairing ruling), the lever order, T32 as a genuine join of nine, and the measurement order in Phase H — **the code halves of L1–L4 are wave 1; the runs are a queue** | wave table §4 |
| 33 | **Nine file-contention hotspots named**, worst first: `prose.ts` (8 tasks), `bridge.ts` (6), `perception.ts` (6), `supervisor.ts` (4), `verbs.ts` (4) | wave table §1 |

## 3. What landed on `main` since v5b

| # | Change | Where |
|---|---|---|
| 34 | **★ Precondition 5 DISCHARGED — `first-night` merged.** `git merge-base --is-ancestor 1941a5f main` is true; all three defects fixed by `fd687fb`, `1b3929e`, `0a8726c` | Phase A preconditions |
| 35 | **The nine-task contingency box rewritten from open questions into a record.** Six of nine needed no change; three did (T66, T55, T59) and each carries a one-line instruction | end of document |
| 36 | **★ the hazard v5b feared did not happen, for a reason nobody predicted**: `first-night` was *"the one lane authorised to move G1"*, and `unpin` deleted G1 first. Two lanes against one hazard, and the hazard was removed from underneath | contingency box |
| 37 | **G8 criterion 2 is REACHABLE** — the town survives its first night. **It was never weakened while it was unreachable**, and that is recorded | T50 |
| 38 | **★ OD22 IS FIXED ON `main` (`8056f1f`). T21 Step 0 DELETED** — the nine lines it printed are landed as `joinableSite` at `verbs.ts:1070`, consumed by `buildSiteOf` and `stepBuild` through `siteToRaise` | T21 |
| 39 | **★ and the lane went further than v5b's fix would have**: `stepBuild` now emits `action_progressed {ticks: hands}`, so **five hands cost a fifth of each builder's clock**. Under v5b's fix alone joint building would have been legal and **irrational** — five wages for one house — and criterion 7 gates it | T21 |
| 40 | **T22 UNBLOCKED**; its fixture's throw is kept but re-aimed from *"go and wire OD22"* to *"OD22 landed at `8056f1f` and something has taken it out"* | T22 |
| 41 | **★ `stepBuild` TAKES THREE ARGUMENTS AGAIN** — `(state, config, agentId)` at `verbs.ts:1902`. v5 said three and was wrong; v5b corrected it to two and is now wrong the other way. **Fourth revision in a row on one signature.** T22's three call sites corrected | T22 |
| 42 | **T22 consumes the landed `handsOnSite(state, siteId)`** rather than writing its own counter — it is the number `stepBuild` already uses as its rate, and two counters for one number is the drift T49 refuses elsewhere. A new row asserts it | T22 |
| 43 | **G8 criterion 7's joint-build clause goes from UNPASSABLE to passable**, and the note recording that it was not weakened while unpassable is kept | T50 |
| 44 | **`main` = `9d76b97`, 316 files / 4 730 tests / tsc 0** replaces `645a8d9` throughout the header, the binding-inputs table and T1 Step 0's ancestor check | header, T1 |

## 4. Defects found by reading, and fixed in place

| # | Change | Where |
|---|---|---|
| 45 | **★ T12's fixture was broken and broke all ten rows below it** — `node()` defaulted `era: 1` against v5's own `z.enum(ERAS)`, so `parse` throws on the first call. **The identical defect v5 caught in T14, left standing in the task that defines the enum.** Fixed, with the two `era: 3` / `era: 2` rows | T12 |
| 46 | **★ T14's printed implementation contradicted its own box** — `era: ERAS[n.era - 1]!`, three paragraphs after explaining that this is `ERAS[NaN]` is `undefined`. Fixed to the identity | T14 |
| 47 | **T14's `freshArbiterDb()` was called and never defined.** Written out, once, with `seeded()` built on it | T14 |
| 48 | **★ T25 and T57 disagreed about whether `speak` counts, and T25 imports T57's function** — 0 vs 1 for a town of pure talk. **Resolved in favour of T57** (the count is honest: speaking is social), and **the law's floor becomes a second function, `nonSpeakSocialVerbs`**, so the two can never drift again | T25, T57, T49 |
| 49 | **★ T43 and T50 both wrote a `*.livetest.ts`, and that runner no longer exists** — `unpin` deleted all three files, `vitest.live.config.ts` and `pnpm test:live`. **A file on that pattern is executed by nothing and reports no failure.** Neither makes a live call; both become ordinary `.test.ts` in the main suite | T43, T50 |
| 50 | **★ T64 called four `Sim` members T32 does not declare**, one of which (`forgeCallCount`) exists nowhere in the plan or the tree. Declared on `Sim` in T32 — where a type is produced once — and renamed **`forgeCommissionCount`** to the number it actually asserts | T32, T64 |
| 51 | **★ `elder-death-unexpected` was a gate that would have punished the feature.** Phase F2 exists to make an elder death possible; v5b failed the run if one happened. **Reported, not gated.** `births: 1` stays a failure — 72-day gestation makes a birth *impossible*, not merely unexpected | T49, T50 criterion 13 |
| 52 | **T49's furniture row was vacuous** — `expect(bare.furnishings.placed).toBe(0)` asserted a property of the fixture the line above wrote. Replaced with two assertions against `checkRehearsal` and the schema | T49 |
| 53 | **T22's test name lied** — *"BOTH HEAVY KINDS ALREADY STAND IN THE TOWN"* checked one, and the town stands no `shed`. Renamed, and the absence is now asserted | T22 |

## 5. The honest read — new section

| # | Change | Where |
|---|---|---|
| 54 | **★★★ NEW SECTION: THE HONEST READ**, four parts, placed before the Goal so an executor reads it before dispatching | after the wave table |
| 55 | **★★ §1 — C8 MEASURES ACTIVITY, NOT MOTIVE, AND SAYS SO LOUDLY.** Every gated criterion is satisfiable by a town that does each thing **once** and then stops for three weeks; `D_b`/`D_c` are maximised by five minds each stuck in a **different** rut. **`chooseWantLine` is the only place a want is produced, and nothing ever reads whether the road was walked** — the drives layer can be wholly inert and every number is unchanged | honest read §1 |
| 56 | **Three motive measures named, all computable from the log this plan already writes, none scheduled** — answer rate, cost paid, persistence under interruption — **with a recommendation that if one is added it is the answer rate**, a join over two existing tables at zero live spend | honest read §1 |
| 57 | **§2 — fourteen vacuous, contradictory or dead items by number.** Nine fixed in place, five named and left with the reason each is a controller's call rather than an executor's | honest read §2 |
| 58 | **§3 — nine tasks assuming a capability that changed**, and the finding that **not one of the 66 is already done**: what landed is prerequisites, not tasks | honest read §3 |
| 59 | **§3 names the live hazard `first-night` created** — `masonIntent` and `SJ_DEV_JOINT` are a **scripted demonstration policy**, T32 must not wire it, and criterion 5 must never be scored against a run in which it was building. T50 must assert both were off | honest read §3 |
| 60 | **§4 — 66 is right in count and wrong in shape.** T24, T32 and T50 are secretly ten tasks; T31, T35 and T23 are one each. **Recommendation: keep 66, split three at execution time without renumbering** — a task number is an identity, not a unit of work | honest read §4 |
| 61 | **One scope-reduction candidate examined and KEPT and listed: T27's `comparableRuns`.** It is reproducibility machinery, but `D_r` measures *difference* (U31's ask) and a `D_r` across two prompt versions means nothing — the guard is what makes the measurement honest. **Named so the controller may rule the other way; it is a ten-minute follow-up** | honest read §4 |

## 6. Housekeeping

| # | Change | Where |
|---|---|---|
| 62 | File renamed `2026-08-24-02-…-v5b.DRAFT.md` → **`2026-08-24-03-genesis-rehearsal-v6.DRAFT.md`**; T1 Step 1's `git mv` repointed | filename, T1 |
| 63 | Title and Status re-labelled **v6**; a *"WHY v6 EXISTS"* box added above v5b's, which is kept | header |
| 64 | **`many-hands` / `first-night` / `unpin` added to the binding-inputs table**; the sprint row repointed from `645a8d9` to `9d76b97` | header |
| 65 | Amendment row **B** rewritten from *"the four pins are re-derived"* to *"SUPERSEDED — the four pins are gone"* | header |
| 66 | **OD12's recommendation annotated**: still ACCEPTED, but its reasoning is superseded — the key lands in T29 because `config.ts` is the highest-contention file in the tree and one editor per file is a merge rule, **not** because a keystone forbids a second one | Open Decisions |
| 67 | **T59's *"the one member Phase F's keystone bundle carries"* rewritten** — there is no bundle; the key lands in T29 and T59 reads it | T59 |
| 68 | **A sixth precondition row added, and it says there are none left** | Phase A |

---

## What v6 did NOT do

- **No task added, deleted or renumbered.** 66 tasks, 15 phases, every document position unchanged.
- **No code change.** `git diff --stat main -- packages/` is empty. Three lanes are live in `packages/`; this revision writes only under `docs/`.
- **No criterion weakened.** Criterion 7 went from unpassable to passable by a landed fix, not a lower bar. Criterion 2 the same. The one criterion that moved (13's elder death) moved from **gate to report**, and it moved because gating it would have failed a run for producing the feature Phase F2 exists to build.
- **Nothing deleted that builds.** The scope reduction came to ≈150 lines of pin ceremony and one 43-line global constraint. Zero of the 66 tasks die.
