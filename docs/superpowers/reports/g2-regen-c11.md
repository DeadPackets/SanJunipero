# G2 regen #5 — C11 Task 37, the chunk's single deliberate golden move

`GOLDEN_G2_HASH` moved once in C11, here.

| | value |
|---|---|
| Before (C9 Task 16) | `6f2529fba61a0d9e3a219da05235c0ff19e105d610f96e57aa9d0cc073d82fc8` |
| **After (C11 Task 37)** | **`665a824948155304d7dcc1131e821e89299dd73d6cb5c976287955edc5a5fa11`** |
| G1 `GOLDEN_DAY_HASH` | `f487a26b…` — **unmoved**, before and after every step |
| `stateHash(DEFAULT_CONFIG)` | `482f1203…` — **unmoved**; C11's one schema move was Task 2 |

The fixture, the seed (`g2-scripted`) and the tick count (4320) are unchanged. What changed is
the config the fixture runs under — `G2_CONFIG` went from fourteen `enabled:false` pins to
`SimConfigSchema.parse({})` — and one new scripted sequence in `scripted.ts`.

## What each part of Task 37 did to this fixture

Measured, not assumed: the hash was read after every commit.

| Part | Landed | Moved G2? |
|---|---|---|
| (a) A\* admissible heuristic | `99c4ed8` | **No.** G2's routes are short and on uniform grass; the cheapest tile is a road and this fixture has none. |
| Illness bridge (batch-2 r1) | `0c9f923` | **No.** The dawn injury-infection roll only fires for an open wound, and nothing in three scripted days wounds anybody — `agent_injured` never appears in the run, before or after. |
| (b) Scripted night theft | `f3a60fd` | **No, at first.** The sequence rides `nightWitness.enabled`, which was still pinned off — the same device the fixture already uses for `reproduction.enabled` and the sexes. |
| `weaponKinds?` on `RecipeSchema` (batch-4 r1) | `f566c3c` | **No.** Optional, no default, absent from every authored row; the forge pin is byte-identical. |
| (c) The unpin + regen | this commit | **Yes.** Fourteen laws switched on at once, and the theft above fired with them. |

## Event counts, before and after

Every delta ≥ 1 with the law that produced it. The per-law column is each flag turned on
**alone** against the fully-pinned baseline, so an interaction between two laws shows up as a
difference between the per-law figure and the combined one.

| Event | Before | After | Δ | Why |
|---|---:|---:|---:|---|
| `need_changed` | 59866 | 89973 | +30107 | Two more bodies in the world (`+34584` alone), less the meals and collapses the other laws removed. |
| `thirst_changed` | 0 | 22589 | +22589 | **thirst**: a second clock on every living body, every tick. Six bodies now, not four. |
| `hp_changed` | 0 | 7588 | +7588 | **mortality**: the hp bar is live — dawn recovery, and the per-tick drains hunger, poison, fatigue and thirst bill to it. |
| `fauna_moved` | 0 | 990 | +990 | **fauna**: deer and rabbits walk on their own. |
| `agent_moved` | 914 | 708 | −206 | **foodVariety** (−162) and **warmth** (−30): a body that gets less out of a meal and pays for the cold collapses sooner and walks less. |
| `action_progressed` | 3971 | 3902 | −69 | Same cause: fewer completed actions to progress. |
| `action_completed` | 80 | 74 | −6 | **foodVariety** −8, **warmth** −3, **nightWitness** +3 (two takings and one extra Farmer walk). |
| `action_started` | 82 | 77 | −5 | Same. |
| `structure_progressed` | 2880 | 2903 | +23 | The Builder's hut is interrupted and resumed a different number of times once collapse timing moves. |
| `fauna_spawned` | 0 | 12 | +12 | **fauna**: the initial stocking, capped. |
| `affliction_worsened` | 0 | 9 | +9 | **mortality**: the fatigue ladder climbing a rung each time a body falls. |
| `agent_afflicted` | 0 | 4 | +4 | **mortality**: three first-rung fatigue afflictions and the Fisher's poisoning at tick 3432. |
| `tile_changed` | 1 | 5 | +4 | **regrowth**: four forest-edge tiles seeded to sapling at midnight. Tile 1 is still the Farmer's tilling. |
| `agent_aged` | 11 | 14 | +3 | +6 for the two new bodies, −3 because three of the original four now die before the last dawn. |
| `grave_placed` | 0 | 3 | +3 | **mortality**: `graveEnabled`, one stone per death, on the tile the body fell on. |
| `traffic_decayed` | 0 | 3 | +3 | **desirePaths**: the nightly sweep of the traffic table. |
| `agent_died` | 1 | 3 | +2 | **mortality**: see the death table below. |
| `agent_spawned` | 4 | 6 | +2 | (b): the Thief and the Keeper. |
| `item_taken` | 0 | 2 | +2 | (b): the same knife, at 22:01 on day 2 and 12:01 on day 3. |
| `item_moved` | 4 | 9 | +5 | +3 for the theft (two takings and the restow between them), +2 for items dropped on the tile by the two new deaths. |
| `item_spawned` | 10 | 11 | +1 | (b): the knife. Its id is `item_knife`, which ends in no number, so no minted id shifted. |
| `item_qty_changed` | 10 | 11 | +1 | **foodVariety**: one more partial meal, because a fish is worth less than a flat restore. |
| `action_interrupted` | 2 | 3 | +1 | **warmth**/**foodVariety**: one extra collapse interrupting an action in progress. |
| `agent_collapsed` | 13 | 12 | −1 | Net: **foodVariety** −2 and **warmth** −1 against later deaths leaving fewer bodies to fall. |
| `agent_slept` | 13 | 10 | −3 | Three of the four are dead before the last night. |
| `agent_woke` | 9 | 7 | −2 | Same. |
| unchanged | | | 0 | `tick_advanced` 4320, `weather_changed` 16, `wildlife_changed` 10, `skill_gained` 17, `structure_planned` 3, `structure_damaged` 6, `structure_completed` 1, `fire_ignited` 1, `fire_spread` 1, `fire_extinguished` 2, `crop_planted` 1, `item_spoiled` 1, `item_owner_changed` 4, `agent_entered` 1. |

## The three deaths

| Tick | Body | Cause | Law |
|---|---|---|---|
| 1715 | Idler | `hunger` | **mortality**. C9 killed him at `zeroHungerSinceTick + 1441` = 2842; `hungerHpDrainPerTick` empties the bar 1127 ticks sooner and the attribution still says hunger. |
| 3642 | Fisher | `poison` | **mortality**. He eats a spoiling fish at tick 3432, takes a poison affliction, and the drain finishes him. |
| 4272 | Farmer | `fatigue` | **mortality**. The fatigue ladder: she has no bed in this fixture (only the Builder does), collapses at 1022, 1426, 2925 and 3897, and the last rung kills her. |

## Laws that came off the pin and changed nothing here

`illness`, `fertility`, `roads`, `mapGrowth` and `constructs` each leave the hash **byte-identical**
when switched on alone. That is correct, not a miss: nobody is ill or wounded, nobody irrigates,
nobody paves, the map is not asked to grow, and the recognizer is ops-plane and writes no world
state. `warmth` and `light` are on and are inert by arithmetic — a spring meadow sits inside the
comfort band and nothing in this fixture works after dark.

## Named assertions that are NOT in this fixture

The plan's step 2 asks for five named laws. Three land and are asserted: a thirst clock runs, the
night theft is unwitnessed and the day theft is witnessed, and every death carries a `DeathCause`
from `DEATH_CAUSES`. Two do not fire here and were **not** faked:

- **A desire-path tile wearing through.** The traffic table accumulates and decays, but no tile
  crosses the wear threshold in three days on this fixture's short routes. `traffic_decayed` is
  asserted instead. Owner: Task 38 (G11a), which dials the threshold down deliberately.
- **A fauna kill.** No scripted actor hunts. `fauna_spawned` and `fauna_moved` are asserted
  instead. Owner: Task 38, which forces the roll.
