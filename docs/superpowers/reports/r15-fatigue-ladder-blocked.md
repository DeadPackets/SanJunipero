# R15 — the fatigue ladder: written, measured, reverted

Controller ruling R-C (C11 batch 10) asked for three things and called them code-side:
recovery must be **repeatable**; **sleep** must lift the ladder, not herbs alone; and a body
must be able to **rest before collapsing**. All three were written in batch 11, measured
against the frozen G2 fixture, and reverted. This file is the measurement, so a later
authorized regen does not have to take it again.

## What was written

| Part | Where | What it did |
|---|---|---|
| sleep lifts the ladder | `verbs.ts`, `sleep.onComplete` | also emits `affliction_recovered {kind:'fatigue'}` when the body carries one, so a night clears the affliction exactly as it already cleared the collapse counter — and clears it every time |
| rest before collapsing | `verbs.ts`, `sleep.validate` | `mayLieDownRough`: a body outdoors may lie down once `energy < needs.debuffThreshold` (30), not only after it has already fallen over |
| the refusal teaches it | `verbs.ts` | *"there is no bed here; find somewhere to lie down — weary enough and the bare ground will do"* |

## What it does to G2

| Measurement | G2 as pinned | with R15 |
|---|---|---|
| `GOLDEN_G2_HASH` | `665a824948155304d7dcc1131e821e89299dd73d6cb5c976287955edc5a5fa11` | **`c1c51b42aa340f0e5ae0d8cc321b602345f6ec4fee4e4d20b48f7e692b946d9c`** |
| deaths | `idler:hunger`, `fisher:poison`, **`farmer:fatigue`** | `idler:hunger`, `fisher:poison` |
| structures at the end | 6 | **5** |
| graves | 3 | **2** |
| G1 `GOLDEN_DAY_HASH` | `f487a26b…` | **unmoved** |
| forge `stateHash(DEFAULT_CONFIG)` | `482f1203…` | **unmoved** — R15 touches no dial |

**Each half breaks it independently.** Tested separately: the sleep-clears-fatigue half alone
fails G2, and the lie-down-early half alone fails G2.

**This is not an accident of the fixture.** G2's own row reads *"C11 is live in this run: bodies
thirst, wear out, are poisoned, and are buried"*, and the Farmer's death **is** the "wear out".
A ruling that makes exhaustion survivable makes that death not happen. There is no formulation
of R-C that leaves the pin still.

## Why it matters, measured on the live gate

The batch-11 G11b run landed 16 of 17 with the ladder still in place. In that run:

| | count | share |
|---|---:|---|
| `sleep` + `wake` among completed acts | 164 of 321 | **51%** |
| ratchet refusals (`no bed here`, `already asleep`, `collapsed and unable to act`) | 186 of 250 | **74%** |
| survival tax as measured | 209 of 322 | 64.9% |
| **survival tax with the ratchet churn removed** | 45 of 158 | **28.5%** |

The emergence-tuning law's target is ≤40%, ideally ~30%. **The town is inside that band the
moment this one mechanism stops spending half its turns.** No dial needs to move; the fix is
already written.
