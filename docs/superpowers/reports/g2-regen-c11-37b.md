# G2 regen #6 — C11 Task 37b, the gate-remediation regen

Authorized by the batch-11 controller rulings (R-G), on the evidence that G11b correctly
rejected the world the previous pin was holding. **C11's second and final regen.** There is no
third: society work that needs config lands at C8's keystone, which is a new chunk legitimately
re-pinning once.

The discipline is Task 37's. Code-only items landed first with the goldens frozen; each config
change landed in its own commit with its before/after measured; the pins moved in exactly one
commit; this file is the attribution.

## The pins

| Pin | Before | After | Moved by |
|---|---|---|---|
| G2 `GOLDEN_G2_HASH` | `665a8249…` | **`c1c51b42…`** | step 2a alone |
| forge `stateHash(DEFAULT_CONFIG)` | `482f1203…` | **`a90bd747…`** | steps 2b and 2c |
| G1 `GOLDEN_DAY_HASH` | `f487a26b…` | `f487a26b…` | **nothing — and nothing can** |
| `BLOCK1_SHA256` | `28c1fce0…` | `28c1fce0…` | **nothing — the amendment stays spent** |

`c1c51b42…` is the value the batch-11 implementer measured for R15 before reverting it
(`r15-fatigue-ladder-blocked.md`). Re-deriving it independently, in a different order, behind
five other changes, is the strongest evidence available that the attribution below is right.

G1 cannot move for any change in this batch: it is the replay proof, not a world run. Its
`TickLoop` folds the events its `onTick` hands it and runs no world system at all, so no dial
and no verb reaches it. It was re-measured after every step regardless.

## Attribution — every change, and what it did to G2

Measured per step, not inferred. "Unmoved" means the fixture was re-run after that step and
hashed to the same value.

| # | Change | G2 | Why |
|---|---|---|---|
| 1a | makeable vocabulary in the volatile block | unmoved | Prompt text. It never reaches the engine; the fixture has no minds in it. |
| 1b | take-then-eat seam | unmoved | The scripted Idler is *given* a fish and eats it from its own hands. No scripted act reaches for a meal it is not holding, so the new path never runs. |
| 1c | blank-answer retry | unmoved | Runtime only. The fixture makes no calls. |
| **2a** | **R15, the fatigue ladder** | **`665a8249…` → `c1c51b42…`** | **The Farmer's fatigue death stops happening.** See below. |
| 2b | `warmth.insulation.garment` 2 → 12 | unmoved | Three spring days, and nobody in the fixture owns a coat. `insulationOf` returns 0 for every body in it, so the dial multiplies nothing. |
| 2c | `mortality.drainPerTick.injury` 0.05 → 0.025 | unmoved | Nobody in the fixture is wounded. No `injury` affliction is ever minted, so the drain is never read. |

### 2a is the whole of the move

G2's own C11 row reads *"bodies thirst, **wear out**, are poisoned, and are buried"*, and the
Farmer's death **is** the wearing out. Ruling R-C makes exhaustion answerable, so the death does
not happen. There is no formulation of R-C that leaves this pin still — which is why the batch-11
implementer wrote it, measured it, reverted it and escalated rather than taking the move alone.

The behavioural diff on the fixture:

| | before | after |
|---|---|---|
| deaths | `idler:hunger`, `fisher:poison`, **`farmer:fatigue`** | `idler:hunger`, `fisher:poison` |
| structures at the end | 6 | **5** |
| graves / `grave_placed` | 3 / 3 | **2 / 2** |
| `agent_collapsed` | 3 | 3 — unchanged |
| fatigue minted (`agent_afflicted`) | 3 | 3 — unchanged |
| fatigue lifted (`affliction_recovered`) | 0 | **3, one per night slept** |

**The ladder is not switched off.** The falls still happen and still put the Farmer on it; what
changed is that each night now takes him back off. The regenerated row says so by naming the
three mints and the three lifts, because a hash alone would still pass if a law quietly stopped
firing.

## Why the other five were kept out of the pin's way

Each was measured against the frozen fixture before the regen and shown inert, which is what
made a single-commit regen possible. Steps 1a–1c landed with all four pins green and empty
diffs on `config.ts`, `g2.test.ts`, `golden.test.ts` and `forgeConfig.test.ts`. Steps 2b and 2c
moved the forge pin only; G2 was re-run after each and did not move.

## The dials, and the arithmetic behind them

**`warmth.insulation.garment` 2 → 12.** `isExposed` is a threshold on
`ambient + insulation >= comfortBand`. At 2 the coat decided one band of twelve — an autumn dusk
— and nothing whatever in winter. Twelve is the gap at the mildest winter hour (comfortBand 8
over ambient −4), it is the least that reaches winter at all, and it reaches no hour past that
one: winter dusk (−8), winter night (−12) and a snowing winter day (−6) still want a roof or a
fire. The batch-5 winter ladder holds unchanged, with rung 1 now the coat's own rung.

**`mortality.drainPerTick.injury` 0.05 → 0.025.** A grave wound killed in 4.8 hours and a
serious one in half a day — less time than being seen across a meadow and walked to, so the
designed social overlap could not physically occur. Untended survival goes 1.58 → 4.29 d (minor),
0.54 → 1.23 d (serious), 0.20 → 0.43 d (grave). Tended and asleep now saves a serious wound as
well as a minor one; it still does not save a grave one (90 hp/day against 108), so a herb in
somebody else's hand remains the only answer to the worst tier.

**The energy budget was NOT changed**, on the controller's amendment. The 133.92-of-100 figure
is what a body spends if it never sleeps; batch 11's own numbers show 16 awake / 8 asleep closing
with 30 to spare. The ratchet was what prevented normal sleep, so **R15 is the energy fix**, and
spending a dial on the symptom would have polluted this table.
