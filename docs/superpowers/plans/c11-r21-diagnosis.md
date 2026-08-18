# R21 — why the town talks and cannot feed itself

The committed G11b run took 196 accepted acts in two sim-days: 43% survival, 2% production,
35% social, 20% walking. One meal against 8.4 needed. Zero tends, zero joint builds, one give.
Five causes were named as candidates. This is the measurement that decides between them,
taken on the same genesis town the live gate runs on
(`packages/agents/src/prompt/r21.diagnosis.test.ts`, `$0`, no network) and read back out of the
committed run's own transcript (`packages/agents/data/g11-transcript.md`).

## Verdicts

| # | Candidate | Verdict | The number that decides it |
|---|---|---|---|
| 1 | the prose never names the opportunity | **CONFIRMED — primary** | 59 of 222 refusals are one missing sentence |
| 2 | perception omits it | **CONFIRMED — secondary** | 0 forageables and 0 fauna in every founder's opening packet |
| 3 | refusal text teaches nothing | **CONFIRMED — contributing** | 8 of 9 refusals name no place, no distance and no thing to fetch |
| 4 | distance makes it irrational | **REFUTED** | 17–21 steps at 1 tick a tile: 2% of a waking day |
| 5 | the minds genuinely chose otherwise | **REFUTED** | one mind said "berries" in 44 turns; another looked for the sick in 33 |

**The town is not choosing not to work. It is being told the wrong thing, shown too little,
and taught nothing by the refusals.**

## The refusal ledger — 222 refusals against 196 accepted acts

53% of everything the five minds tried was refused. By reason:

| Count | Refusal | Root |
|---:|---|---|
| 35 | `enter: already inside` | **the body does not know it is indoors** |
| 33 | `sleep: there is no bed here` | the fatigue ladder (R15) |
| 28 | `wake: collapsed and unable to act` | the fatigue ladder (R15) |
| 24 | `walk: you are indoors; step outside first` | **the body does not know it is indoors** |
| 24 | `sleep: already asleep` | the body does not know it is asleep |
| 23 | `speak: collapsed and unable to act` | the fatigue ladder (R15) |
| 12 | `drink/fill` malformed or nothing held | |
| 5 | `enter: collapsed` | the fatigue ladder |
| 4 | `walk: already at that spot` | |
| 3 | `forage: not close enough to gather` | a node named and never reached |
| 31 | everything else | |

**59 of them — 26.6% — are the single sentence "you are inside your hut".** 61 more are the
fatigue ratchet, which R15 owns. Together the two account for **54% of every refusal in the
run.**

## Candidate 1 — the prose. CONFIRMED, and it is worse than silence

### 1a. A body indoors is told to go indoors

This is the whole of what a founder standing inside her own hut is told:

> It is day 1, day, early spring. **You stand at (68, 60).** The sun is out. The air is mild.
> A hut (structure_3) stands at (68, 60), 2 tiles wide and 2 tiles tall; **its doorway is at
> (68, 62) — stand there and you can go in.** You can see 1 axe (item_24) at (68, 60). …

No line says she is under a roof. The one line about the roof she is under instructs her to
walk to its doorway and enter it. She takes the instruction; `walk` answers *"you are indoors;
step outside first"* and `enter` answers *"already inside"*. That loop ran 59 times.

`perceptionToProse` never reads `insideId` — the packet does not carry it at all, and the
`indoors` branch inside `composePerception` is used only to *narrow* what is visible, never to
say where the body is.

### 1b. A body already walking is told it is standing still

`PerceptionPacket.self.activity` is composed by the engine, typed on the mind side, and
**never rendered**. A founder seventeen ticks into a walk to the berry bushes reads
"You stand at (68, 62)" and decides again. In the committed run one mind restated the same
intent — go east, pick berries — in **44 separate turns** and never gathered once.

### 1c. Thirst was given a road and hunger was not

`prose.ts` gives a dry body a wayfinding line:

> The nearest water you know of lies at (50, 62).

A hungry body with an empty satchel gets *"Your stomach gnaws at you."* and nothing else. The
existing hunger line fires only when food is **already in the hands**
(`if (hunger < 30 && world?.isEdible)` over `packet.self.inventory`), which on the first
morning is empty — the founders' kit is spawned onto the hut's shelf, not into their hands.

**The run drank 15 times and ate once.** The need with a road got answered; the need without
one did not. That single asymmetry is the cleanest evidence in the batch, and the previous
batch's own comment records that the water line was added for exactly this reason.

### 1d. The makeable vocabulary is never spoken

`build` asks for a `kind`; `craft` asks for a `recipe`. The world knows **four** buildable
kinds (`hut`, `well`, `bridge`, `grave`) and **six** recipes (`plank`, `cloth`, `garment` in
config; `stew`, `hide_garment`, `torch` in `SEED_RECIPES`).

**Not one of them is named to a mind anywhere.** `CAPABILITIES` names `garment` and `torch`
only as things to *hold*; `packages/agents/src/` contains no reference to `recipes` at all.
By the canon-vocabulary law that governed the batch-7 amendment — *a word a mind is never
given is a word it never uses* — production is a pair of verbs with no nouns.

The corroboration is exact: **the only production verb that fired more than once in the whole
run is `till`**, the one production verb whose target is a pair of coordinates and needs no
noun the mind was never given.

## Candidate 2 — perception. CONFIRMED

### 2a. Nothing edible is in sight on the first morning

True walking distances — a capped A\* returns how far it got, not how far it is, so every
figure below is from a search that finished:

| Founder | Standing at | Berry bush | Herb patch | Mushrooms | Reeds | Clay | Stone |
|---|---|---:|---:|---:|---:|---:|---:|
| amara | (62, 62) | 20 | 54 | 42 | 21 | — | — |
| yusuf | (65, 62) | 18 | 51 | 39 | 24 | — | — |
| nadia | (68, 62) | **17** | 54 | 36 | 27 | — | — |
| omar | (71, 62) | 18 | 57 | 33 | 30 | — | — |
| salma | (74, 62) | 21 | 60 | 30 | 33 | — | — |

**Seven of the twenty authored nodes are across the river and cannot be walked to at all** —
two of the three herb patches, both clay banks and all three stone outcrops. So the healer's
nearest remedy was **fifty-four steps** away, most of a working morning, and the town could
not have paved a tile or sunk a well from the ground even if it had wanted to. The nearest
animal with meat on it is 27 steps and moves.

`movement.sightRadius` is **12**. Every founder's opening packet carries
`forageables: []` and `fauna: []`. A thing's mark "becomes known to you only once you stand
beside where it rests and see it", so **no mind can ever name a `nodeId` or a `faunaId` from
the town**, and `forage` with no argument needs a forest tile at the elbow — the forest edge is
at x ≈ 90, thirty tiles east.

This is what closes the door on the shared stew as well: `craft stew` wants meat, meat comes
from `hunt` or `fish`, `hunt` wants a `faunaId`, and no animal is ever visible. The chain is
broken at its first link.

### 2b. A body carries no visible condition

`PerceivedAgent` carries exactly eight fields: `id`, `name`, `x`, `y`, `activityVerb`,
`collapsed`, `asleep`, `ageBand` (plus `worn` when dressed). **Nothing about hp, illness,
injury or affliction.**

So the healer cannot see the fever. In the committed run Omar — whose standing goal is to look
after the town's health — thought about who might be ill in **33 separate turns**:

> "No one looks ill yet." · "Nobody's coughed or gone quiet in a way that worries me."
> "Nadia's voice is clear and easy — no tell of fever." · "Morning's clear and no one's ailing
> that I can see."

Salma was six tiles away with the staged fever the gate seeds, and she died of it.

**Zero tends is not a choice. It is a blind man being asked to spot a rash.** The same
blindness closes `give`: nothing tells a mind that anyone else is hungry.

## Candidate 3 — the refusals. CONFIRMED

Every designed overlap, asked from a founder's own doorway on the first morning:

| Asked | Answer | Does it teach a path? |
|---|---|---|
| `forage` | no forest nearby | **no** — names a forest when the world's food is in patches |
| `forage {nodeId}` | not close enough to gather | **no** — no distance, no direction |
| `hunt` | hunt needs a {faunaId} | **no** — and there is no way to learn one |
| `fish` | no water there | **no** — the river is 13 tiles west and unnamed |
| `craft stew` | not enough meat | **no** — never says where meat comes from |
| `craft garment` | not enough cloth | **no** |
| `build hut` | not close enough to build | **no** |
| `tend` | not adjacent to the patient | **no** — and there is no visible patient |
| `douse` | nothing is burning there | **no** |
| `pave` | not enough stone | **no** |
| `eat` (loaf on the shelf) | not holding that | **no** — never says "take it first" |
| `craft bread` | no such recipe: bread — **perhaps someone nearby knows how, or it wants discovering** | **yes** |

One refusal in twelve leaves a door open, and it is the one for a craft the world has never
heard of. Addendum §9 asks for the opposite ratio.

## Candidate 4 — distance. REFUTED

17–21 tiles to a berry bush, `movement.baseTicksPerTile` = 1, every one of them on a path that
finishes. The worst round trip is **42 ticks of a 960-tick waking day — 4.4%**. Nothing about
the geometry makes gathering irrational. **This is not an abundance problem first; it is an
effectiveness problem first**, exactly as the emergence-tuning law's diagnostic predicts. R14
still shortens the walk, but it is the second lever, not the first.

## Candidate 5 — mind choice. REFUTED

The two behaviours that fired zero times are the two the minds talked about most:

| Mind | Wanted | Turns spent saying so | Times it happened |
|---|---|---:|---:|
| nadia | to gather berries | **44** | 0 |
| omar | to find and tend the sick | **33** | 0 |

A mind that states the same intention forty-four times across two sim-days has chosen. The
world did not let the choice land.

## What this implies, in the law's order

1. **EFFECTIVENESS (this batch).** The body must know where it is (indoors/outdoors) and what
   it is already doing; hunger must get the road thirst has; a body must be able to see that
   another body is in a bad way; refusals must name a place, a distance or a thing to fetch.
   These four are code-side and between them address 59 refusals, both zero-count social
   overlaps, and the meal count.
2. **ABUNDANCE (R14).** Forageable nodes inside the founders' horizon, so `forage` has a
   nameable target on the first morning. Three were added, all on the town's side:

   | Node | Place | Nearest founder | Furthest founder | In sight of |
   |---|---|---:|---:|---|
   | berry_bush | (66, 55) | nadia, 9 | salma, 15 | all five |
   | berry_bush | (70, 67) | omar, 6 | amara, 13 | all five |
   | herb_patch | (73, 58) | salma, 5 | amara, 15 | all five |

   Every founder now wakes up able to name at least two patches, the nearest bush is 6–11
   steps instead of 17–21, and the healer has herbs for the first time. Nothing was moved and
   nothing was placed over the water: the far bank still answers a capped search.
3. **CONTROLLER-VALUED.** The makeable vocabulary is the highest-leverage thing left, and its
   natural home is block 1, which is frozen. Reported, not taken.
