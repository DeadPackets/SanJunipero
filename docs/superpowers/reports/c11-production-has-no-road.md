# Production has no road

Two live G11b runs, eight sim-days between them, forty-two mind-days, 765 acts. **Nobody has
built, crafted, tilled, planted, harvested, chopped, paved, inscribed or written anything.** The
single production-classified act in either run is one `stow` — putting an item into a building.

This file is the diagnosis, kept because the finding outlives the batch. It was read out of C11
batch 13's surviving run database and confirmed against batch 14's. It cost nothing: no live
call was made for any of it.

## The finding in one sentence

**Every verb the town used takes a target the perception names. Every verb it never used takes
a coordinate the perception never names.**

| verb | what it asks for | did the perception supply it | used in 4 days |
|---|---|---|---:|
| `drink` | a place to stand | *"A well (structure_9) stands at (68, 69) … you could stand beside it at (67, 68)"* | 16 |
| `forage` | a `nodeId` | *"You see berry bushes heavy with fruit (node_80) at (66, 55)"* | 18 |
| `enter` | a `structureId` | *"its doorway is at (62, 62) — stand there and you can go in"* | 17 |
| `eat` / `take` / `tend` | an `itemId` / `targetId` | every item and every body is named with its mark | 15 / 7 / 7 |
| **`build`** | **`{kind, x, y}`** | **no spot to build on is ever named** | **0** |
| **`chop`** | **`{x, y}` on a forest tile** | **no tree, forest or timber is ever named** | **0** |
| **`till`** | **`{x, y}` on grass or dirt** | **no tillable tile is ever named** | **0** |
| **`plant`** | **`{x, y, kind}` on farmland** | **no farmland is ever named, and none existed** | **0** |

Counted over all 378 perceptions the minds were handed:

```
212/378  a place to stand beside a thing
214/378  a doorway to walk to
225/378  a forageable with a mark and a place
  0/378  a spot you could build on
  0/378  a tile you could till or plant on
  0/378  a tree, forest or timber named at all
  0/378  the stuff you hold, matched to a thing you could make
```

## The makeables line indicts itself

It rides block 6 of every prompt — 342 characters, a pure function of the config, identical for
every mind on every tick regardless of what it holds or where it stands:

> *"What your hands know how to raise, **given the stuff and a spot to put it**: a bridge (6
> wood), a hut (10 wood), a well (8 stone). What they know how to shape: cloth (2 fiber),
> garment (2 cloth, or 2 hide), plank (1 wood), stew (…), torch (1 fiber and 1 wood)."*

The world names neither the stuff nor the spot.

## The stuff was there, twice over, and they read it aloud

```
tick 0  item_spawned  20 wood   into structure_6 (the storehouse)
tick 0  item_spawned  12 stone  into structure_6
```

A hut costs 10 wood. A bridge costs 6. A well costs 8 stone. **66 of 378 perceptions printed
`You can see 20 wood (item_42) at (61, 68).`** Amara, the storekeeper, stood inside that
building and read that line, and recited the tally in fourteen separate thoughts across four
days:

> t747  *"Drink is done. Storehouse next — count it clear: 20 wood, 12 stone, 4 rope, 4 cloth."*
>
> t5158 *"The count is done. Twenty wood, twelve stone, four rope, four cloth — and now the last
> number is mine. The store held. I could not."*

**Not one of the 378 perceptions ever said "You are carrying wood."** The seven `take` acts in
the run took an axe, a hoe, a knife, a seed pouch and a waterskin. Never a material.

## A mind formed the intent on four separate days and never found the road

Yusuf is the carpenter with a grudge against the river:

> t943  *"Rain doesnt stop the survey. I need the river's shape before I cut a single beam."*
> t1106 *"Still heading north. The river has to pinch somewhere above; that's where I build."*
> t1572 *"Cold and dark is no time for timber. A bridge begins with a clear morning."*
> t2853 *"Storm and night. Nothing to build or cut tonight. I'll sleep with my axe close."*
> t3158 *"The storm passed. I am still set. A bridge will wait for daylight."*

Yusuf's whole four days: 27 sleeps, 26 speaks, 21 wakes, 19 walks, 4 takes, 3 eats, 1 exit, 1
enter. **0 builds, 0 chops.** He had an axe, the bridge needed 6 wood, and the store held 20 six
tiles from his door. He walked north to survey a river every day, because **a river is a place
the perception names and a build site is not.**

## The other three hypotheses, and why they are not the cause

**Economics is real but downstream.** A hut is 2880 ticks — two full sim-days. `wheat` has
`growthDays: 8`, so on a four-day run planting can never pay and no gate can ever show a
harvest. Against that, `hungerDecayPerTick 0.035` over 1440 ticks against `eatRestoreHunger 60`
means **0.84 meals a day keeps a body level**, and foraging takes a few ticks. So producing
genuinely is worse than foraging for three of the five makeables. **But an economics argument
cannot explain the case where the economics are favourable**: Yusuf's bridge is 6 wood against
20 in the store and 480 ticks against four days, he said he wanted it on four separate days, and
he never began it.

**Vocabulary is refuted.** The makeables line was in every prompt and the minds demonstrably
read that block — they quote its neighbouring content back verbatim, and they name `bridge`,
`build` and `cloth` themselves. The words reached them and they used them. What never happened
is the step after: nobody ever said *where*. The makeables were nouns in a tally, never a target
for an act.

## A second, independent fault: nothing says a neighbour is starving

`conditionProse` is the only channel by which one body reads another's state. Its rungs, worst
first: an affliction, then `hp < 30% of max` → **"badly hurt"**, then `hunger < 5` → **"hollowed
out with hunger"**. Starvation drains hp, so the hp rung claims the sentence first and hunger
never gets to speak.

The last thing anyone saw of each of the three founders who starved to death:

```
omar  died t4981 (hunger).  t4956, by salma: "Omar (omar) sleeps at (61, 70), badly hurt."
salma died t5101 (hunger).  t5100, by amara: "Salma (salma) sleeps at (68, 62), badly hurt."
amara died t5112 (hunger).  t5101, by nadia: "Amara (amara) sleeps at (68, 68), badly hurt."
```

**All three read as injured. Not one read as hungry.** Omar is the healer; he answers a hurt
with `tend`, which feeds nobody. Not one of the 121 utterances mentions anyone else being
hungry. There were **0 gives**. And ownership is legible where hunger is not — Amara at t2580:
*"The bread in the hut is Nadia's, and she is sleeping. I can't take that without asking. The
bush is heavy; it will feed me without debt."* She walked away from food she could see.

Batch 14's run moved this a little — the first 2 gives ever recorded, 6 shared fire meals, 2
deaths instead of 3 — but the channel is unchanged.

## What would close it

1. **The perception owes production the same courtesy it gives thirst**: a spot to build on, a
   tree to fell, a tile to till, each with its coordinate, on the same terms as *"you could
   stand beside it at (67, 68)"*.
2. **The makeables line should be about this mind**, not about the config. *"There are 20 wood
   in the storehouse at (61, 68) — enough for a hut"* is a different sentence from *"a hut (10
   wood)"*.
3. **`conditionProse` must not let a wound eat a famine.** Hunger 5 is the collapse threshold and
   the debuff line is 30; a neighbour should read as hungry well before they read as hurt.
4. **`wheat.growthDays: 8` makes farming unfalsifiable on a 4-day gate.** Either the gate grows
   or the crop shrinks.

Full evidence: `cleanup/c11-batch13-report.md`, `cleanup/c11-batch14-report.md`.
