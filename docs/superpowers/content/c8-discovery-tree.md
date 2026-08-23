# C8 Genesis — Discovery Tree

Source of authority: `packages/arbiter/src/canon.ts` (`CANON`, `ERAS`, `ERA_ORDER`, `GENESIS_CODEX`)
and the guard in `packages/arbiter/src/setting.test.ts`. Consumed by the `experiment` verb + engine
roll; each successful node creates a codex entry credited to its finder and spreads only by teaching,
trading, or spying.

The ladder is a ladder of **reach**, not of centuries. San Junipero already has a generator, houses,
a storehouse, a well, and hands that keep their own machinery running. What it does not have is a
factory, a yard that pours metal, or a counter that will sell it a finished part. So a node's era
answers one question — *how far out of the valley's reach is this thing?* — and the answer is very
often **an agreement between people**, because that is the only kind of new thing a cut-off valley
can make in quantity.

## Data conventions (for SDD conversion)

- One node per block. Fields, always in this order: `id`, `name`, `era`, `prereqs`, `skill`, `conditions`, `unlocks`, `desc`.
- `id`: unique kebab-case key. **Exception, and it is binding:** the thirteen ids the canon has already
  landed keep the exact spelling `canon.ts` gives them, snake_case and all (`machine_repair`, `work_rota`,
  `common_store`, `food_preserving`). Those thirteen are asserted by `setting.test.ts`; renaming one to
  match a house style would break a shipped guard.
- `era`: one of the five names in `ERAS` — `handwork`, `arrangement`, `works`, `machinery`, `industry`.
  (The earlier draft numbered eras 1–5; `ERA_ORDER` still ranks them 1–5, but the value written here is
  the name, because that is what the type accepts.)
- `prereqs`: comma-separated node ids, or `(none)`. The graph is a DAG; a node may only cite nodes from
  its own or an earlier era, and never forms a cycle.
- **Genesis reachability, the hard one.** A node is reachable at genesis if every one of its prereqs is
  one of the eight practised crafts. `GENESIS_CODEX` says exactly five nodes may be reachable at genesis
  — `work_rota`, `common_store`, `food_preserving`, `memorial`, `bridging` — so every other node in this
  file cites at least one prereq that is *not* a practised craft. That is checkable, and it is checked.
- `skill`: `track rung>=N` — minimum rung in one track to attempt the experiment. Rung scale: 0 untrained,
  1 dabbler, 2 practiced, 3 competent, 4 expert, 5 master. Tracks are the twelve in
  `packages/shared/src/config.ts`: farming, carpentry, cooking, medicine, fishing, foraging, brewing,
  masonry, tailoring, smithing, scholarship, art.
- `conditions`: engine-checkable non-skill requirements; `(none)` for pure-craft nodes. Used chiefly by
  `[SOCIAL]` nodes, whose discovery depends on population and interaction history, not craft alone.
- `unlocks` namespaces: `verb:` (a new base action), `recipe:` (craftable), `structure:` (buildable),
  `item:` (object type), `resource:` (harvestable/world material), `practice:` (passive rule change),
  `institution:` (codex-recognized shared arrangement), `doctrine:` (knowledge that modifies rolls).
- `desc`: one line, in the town's own voice. Never as a designer, never referencing anything outside the
  world. A shared arrangement is always *described* and never given its proper name — the town has to
  arrive at the name itself.
- The base verbs from C2 (walk, eat, speak, give, take, build, craft, plant, harvest, fish, forage, write,
  read, sleep, tend, teach, attack, experiment) exist from day zero; this tree only adds on top of them.
  (The earlier draft had another name for these. That name is on `CONSTRUCT_VOCABULARY`, so it is gone
  from this file even in editorial matter, where it would only ever have been a standing false alarm.)
- The eight `handwork` nodes are **not discoveries**. They are the crafts the town wakes up practising,
  written here so the graph has roots and so every path can be traced back to a pair of hands.
- Node counts: handwork = 8, arrangement = 26, works = 35, machinery = 22, industry = 12. **Total = 103.**
  `[SOCIAL]` nodes = **52 of 103 (50.5%)** — 0 / 16 / 18 / 9 / 9 by era.

**Why 103, and why half of it is social.** The canon says the new thing this town finds "is far more
often an arrangement between its people … than a machine nobody here could build". A tree where 11 nodes
in 104 are social says the opposite, so social nodes are now the bare majority — more than half, because
the canon says *more often*, but only just, because an arrangement has to be an arrangement *about*
something, and the crafts are what there is to arrange.

---

## ERA handwork — what these hands already do

The eight crafts the town practises on its first morning. No prereqs, no discovery: this is the floor
every other node stands on.

### node
- id: farming
- name: Farming
- era: handwork
- prereqs: (none)
- skill: farming rung>=1
- conditions: (none)
- unlocks: resource:seed_stock, practice:worked_ground
- desc: Ground turned, seed put in, weeds pulled — the year's argument with the soil, which the soil sometimes wins.

### node
- id: fishing
- name: Fishing
- era: handwork
- prereqs: (none)
- skill: fishing rung>=1
- conditions: (none)
- unlocks: resource:fish, practice:river_worked
- desc: Two branches of river and a person who knows where the water slows: supper, most evenings.

### node
- id: foraging
- name: Foraging
- era: handwork
- prereqs: (none)
- skill: foraging rung>=1
- conditions: (none)
- unlocks: resource:berries, resource:mushroom, resource:herb
- desc: Which greens feed, which purge, and which quietly kill — told apart at a glance, by anyone raised near a hedge.

### node
- id: carpentry
- name: Carpentry
- era: handwork
- prereqs: (none)
- skill: carpentry rung>=1
- conditions: (none)
- unlocks: resource:wood, item:plank, practice:wood_worked
- desc: A tree read rightly falls where it is told and splits along its own secrets; the rest is patience and a sharp edge.

### node
- id: masonry
- name: Masonry
- era: handwork
- prereqs: (none)
- skill: masonry rung>=1
- conditions: (none)
- unlocks: resource:stone, practice:stone_laid
- desc: Stone chosen, squared, and set where it will still be sitting when nobody remembers who set it.

### node
- id: tailoring
- name: Tailoring
- era: handwork
- prereqs: (none)
- skill: tailoring rung>=1
- conditions: (none)
- unlocks: item:cloth, item:garment, practice:cloth_worked
- desc: Cutting, seaming, taking in, letting out — a garment is a thing that keeps being finished.

### node
- id: cooking
- name: Cooking
- era: handwork
- prereqs: (none)
- skill: cooking rung>=1
- conditions: (none)
- unlocks: recipe:stew, recipe:roast_fish, practice:fed_daily
- desc: Fire, water, and whatever came in the door — the one craft here that gets judged three times a day.

### node
- id: machine_repair
- name: Machine repair
- era: handwork
- prereqs: (none)
- skill: smithing rung>=1
- conditions: (none)
- unlocks: verb:mend_machine, practice:generator_kept_running
- desc: The generator runs because somebody feeds it and somebody listens to it; what breaks here is mended here.

---

## ERA arrangement — one careful step out

Everything on this rung is one step from a pair of practising hands. Five of them are what the town can
reach on its first morning; the rest are one step past those. Most are not made things at all.

### node [SOCIAL]
- id: work_rota
- name: A turn agreed for the fields
- era: arrangement
- prereqs: farming
- skill: farming rung>=1
- conditions: at least 3 residents worked the same ground within one day
- unlocks: practice:agreed_turns, institution:work_rota
- desc: Not everyone in the same field on the same morning and nobody in it the next — a turn, said out loud, and kept.

### node [SOCIAL]
- id: common_store
- name: A store held in common
- era: arrangement
- prereqs: farming
- skill: farming rung>=1
- conditions: at least 2 residents put food into the same building
- unlocks: practice:pooled_food, institution:common_store
- desc: The day the storehouse stopped being whoever-gets-there-first and became a promise with names on it.

### node
- id: food_preserving
- name: Keeping food past its week
- era: arrangement
- prereqs: cooking
- skill: cooking rung>=2
- conditions: (none)
- unlocks: practice:slowed_spoiling, recipe:dried_fish
- desc: Air, smoke, salt, cold: four ways of arguing with rot, and the whole difference between autumn and February.

### node [SOCIAL]
- id: memorial
- name: A stone raised for the dead
- era: arrangement
- prereqs: masonry
- skill: masonry rung>=1
- conditions: at least 1 resident died and was buried
- unlocks: structure:raised_stone, practice:the_dead_marked
- desc: There is already one standing stone out past the edge that nobody here can explain. Now there is one we can.

### node
- id: bridging
- name: Bridging
- era: arrangement
- prereqs: carpentry
- skill: carpentry rung>=2
- conditions: (none)
- unlocks: structure:bridge, practice:far_bank_reached
- desc: Two spans, a deck, and a handrail for the nervous — and suddenly the far bank is a neighbour instead of a view.

### node [SOCIAL]
- id: water-turn
- name: A turn at the well
- era: arrangement
- prereqs: work_rota
- skill: farming rung>=1
- conditions: at least 2 residents drew from the same well within one day
- unlocks: practice:water_turns
- desc: Whoever draws last leaves the bucket on the hook. It sounds like nothing. It is the reason nobody carries water twice.

### node [SOCIAL]
- id: short-share
- name: Who eats first when there is not enough
- era: arrangement
- prereqs: common_store
- skill: cooking rung>=1
- conditions: the common store held fewer than 3 days of food
- unlocks: practice:short_rations, institution:short_share
- desc: Children, then the sick, then whoever worked hardest, then the rest of us — settled while there is still food, because after is too late.

### node [SOCIAL]
- id: count-aloud
- name: The count said out loud
- era: arrangement
- prereqs: common_store
- skill: scholarship rung>=1
- conditions: at least 10 items taken from the common store
- unlocks: practice:store_counted, institution:running_count
- desc: Somebody says the number at the door every evening, so that nobody has to trust their own hopeful arithmetic.

### node [SOCIAL]
- id: place-names
- name: A name that sticks to a place
- era: arrangement
- prereqs: memorial
- skill: scholarship rung>=1
- conditions: at least 3 residents used the same word for the same place
- unlocks: practice:named_ground, institution:place_names
- desc: The bend where the boy fell in stops being the bend where the boy fell in and becomes a word two people can meet at.

### node [SOCIAL]
- id: lent-and-returned
- name: The lent thing brought back
- era: arrangement
- prereqs: common_store
- skill: carpentry rung>=1
- conditions: at least 5 items handed from one resident to another and handed back
- unlocks: practice:lending, institution:lending_word
- desc: You may take the good saw. You bring it back sharp, or you bring back a reason. Both are accepted; silence is not.

### node [SOCIAL]
- id: two-on-one
- name: Two hands on one job
- era: arrangement
- prereqs: work_rota
- skill: carpentry rung>=1
- conditions: 2 residents completed one build together
- unlocks: practice:paired_labour
- desc: Some things a person cannot do alone and will try anyway, once, until somebody agrees to hold the other end.

### node [SOCIAL]
- id: sick-relieved
- name: The sick let off their turn
- era: arrangement
- prereqs: work_rota
- skill: medicine rung>=1
- conditions: at least 1 resident missed a day's work through illness
- unlocks: practice:sick_relief, doctrine:illness_excuses_labour
- desc: A fever is not idleness, and a town that cannot tell the two apart will work its own people into the ground.

### node [SOCIAL]
- id: shown-not-told
- name: Shown, hand over hand
- era: arrangement
- prereqs: work_rota
- skill: scholarship rung>=1
- conditions: 1 resident taught another the same craft on 2 separate days
- unlocks: practice:apprenticing, institution:apprenticing
- desc: Watching is not learning. You stand behind them, you put your hands over theirs, and you let them ruin the first three.

### node [SOCIAL]
- id: crossing-kept
- name: The crossing kept up
- era: arrangement
- prereqs: bridging
- skill: carpentry rung>=2
- conditions: a bridge stood through at least 1 storm
- unlocks: practice:crossing_maintained
- desc: A bridge nobody owns is a bridge nobody checks, right up until the morning it is a bridge nobody has.

### node [SOCIAL]
- id: dead-owed
- name: What is owed to the dead
- era: arrangement
- prereqs: memorial
- skill: masonry rung>=1
- conditions: at least 1 resident died and was buried
- unlocks: practice:burial_owed, institution:burial_owed
- desc: Who digs, who washes, who stands there, and how long the rest of us stop working — agreed once, so grief never has to negotiate.

### node [SOCIAL]
- id: the-word-given
- name: A word given and kept
- era: arrangement
- prereqs: lent-and-returned
- skill: scholarship rung>=1
- conditions: at least 3 promises made and kept between residents
- unlocks: practice:promises_bind
- desc: Nothing written, nothing witnessed, and it holds anyway — which is either the cheapest thing this valley owns or the dearest.

### node [SOCIAL]
- id: the-child-minded
- name: Somebody watching the children
- era: arrangement
- prereqs: work_rota
- skill: cooking rung>=1
- conditions: at least 1 child resident and 2 adults working the same day
- unlocks: practice:child_minding
- desc: One pair of eyes stays behind so eight hands can go out. It is the cheapest trade the town will ever make.

### node
- id: smoke-shed
- name: The shed run with a slow smoke
- era: arrangement
- prereqs: food_preserving
- skill: cooking rung>=2
- conditions: (none)
- unlocks: structure:smokehouse, recipe:smoked_fish, recipe:smoked_meat
- desc: Green wood, a low fire, a door kept shut for two days — what the smoke takes out of the meat, the winter cannot take out of you.

### node
- id: root-cellar
- name: The cold hole under the floor
- era: arrangement
- prereqs: food_preserving, masonry
- skill: masonry rung>=2
- conditions: (none)
- unlocks: structure:root_cellar, practice:winter_keeping
- desc: Dig down far enough and the ground stays the same cool all year, free, for as long as anyone keeps the drain clear.

### node
- id: souring-crock
- name: Vegetables left to go sour on purpose
- era: arrangement
- prereqs: food_preserving
- skill: cooking rung>=2
- conditions: (none)
- unlocks: recipe:soured_vegetables
- desc: Salt, water, a weight, and three weeks of nerve — it smells like a mistake for a fortnight and then it is food until spring.

### node
- id: salvage-sorting
- name: The pile everything dead goes onto
- era: arrangement
- prereqs: common_store
- skill: smithing rung>=1
- conditions: (none)
- unlocks: structure:salvage_pile, resource:scrap, resource:salvaged_part
- desc: Nothing broken gets thrown away any more; it gets carried to the pile and sorted by what it might still be.

### node
- id: seasoned-stack
- name: Timber stacked and left alone
- era: arrangement
- prereqs: bridging
- skill: carpentry rung>=2
- conditions: (none)
- unlocks: item:seasoned_plank, practice:timber_seasoning
- desc: Green wood twists a year after you nail it. Stack it right, walk away for two summers, and it forgives you.

### node
- id: mending-not-making
- name: Mending in place of making
- era: arrangement
- prereqs: common_store
- skill: tailoring rung>=2
- conditions: (none)
- unlocks: practice:garments_mended, recipe:patched_garment
- desc: There is no counter to buy a new one from, so every worn knee is a small decision about how long we intend to be here.

### node
- id: line-and-twine
- name: Twine spun from the nettle bank
- era: arrangement
- prereqs: mending-not-making
- skill: tailoring rung>=2
- conditions: (none)
- unlocks: item:twine, item:rope
- desc: Nettle stalks rotted in the shallows, beaten soft, and twisted against themselves — they hold far more than they have any right to.

### node
- id: set-lines
- name: Lines set overnight
- era: arrangement
- prereqs: line-and-twine
- skill: fishing rung>=2
- conditions: (none)
- unlocks: verb:set_line, practice:overnight_catch
- desc: Baited, weighted, and tied off to a root — the river works the night shift and asks nothing for it.

### node [SOCIAL]
- id: the-catch-shared
- name: The catch split at the bank
- era: arrangement
- prereqs: common_store
- skill: fishing rung>=1
- conditions: at least 2 residents fished the same water within one day
- unlocks: practice:catch_shared
- desc: Whoever held the line, the fish come up the bank into one pile and go out again by who is thinnest, not by who was quickest.

---

## ERA works — a thing that needs a place built for it

Further out: undertakings that need a structure raised, a season's patience, or a standing agreement that
more than one person has to keep. Nothing here arrives from outside; everything here is dug, built,
boiled, or agreed.

### node
- id: mill-race
- name: The race dug from the upper fork
- era: works
- prereqs: bridging, seasoned-stack
- skill: masonry rung>=3
- conditions: (none)
- unlocks: structure:mill_race, resource:falling_water
- desc: Six weeks of spades to move the river four feet sideways, and after that the water works for nothing, forever.

### node
- id: gravity-line
- name: Water brought down by its own fall
- era: works
- prereqs: mill-race
- skill: masonry rung>=3
- conditions: (none)
- unlocks: structure:water_line, practice:water_at_the_door
- desc: Take it from high up, keep the fall steady the whole way, and water arrives at the door without anybody carrying it.

### node
- id: slow-filter
- name: Sand made to clean the water
- era: works
- prereqs: gravity-line
- skill: medicine rung>=2
- conditions: (none)
- unlocks: structure:sand_filter, doctrine:clean_water_keeps_the_gut
- desc: A barrel of graded sand the water walks through slowly. What lives on the top inch is doing the work, so never scrub it.

### node
- id: ram-pump
- name: The pump that runs on the river's own knock
- era: works
- prereqs: gravity-line, salvage-sorting
- skill: smithing rung>=3
- conditions: (none)
- unlocks: structure:ram_pump, practice:water_uphill
- desc: Let the falling water slam a valve shut and the shock throws a little of it uphill. No fuel, no hands, and a knock you hear from the square.

### node
- id: charcoal-heap
- name: Wood cooked in its own smoke
- era: works
- prereqs: smoke-shed
- skill: smithing rung>=2
- conditions: (none)
- unlocks: item:charcoal
- desc: A heap covered in earth and smothered for three days comes out black, light, and hot enough to trouble things wood never could.

### node
- id: ash-lye
- name: Water run through hardwood ash
- era: works
- prereqs: charcoal-heap
- skill: brewing rung>=2
- conditions: (none)
- unlocks: item:lye
- desc: It comes out slick between the fingers and eats the fingers shortly after. Handle it the way you handle a hot pan.

### node
- id: rendered-fat
- name: Fat rendered down and kept
- era: works
- prereqs: smoke-shed
- skill: cooking rung>=3
- conditions: (none)
- unlocks: item:rendered_fat
- desc: Cooked low until it runs clear and strained into a jar, it keeps a year and turns up in soap, lamps, and bearings alike.

### node
- id: soap-boiling
- name: Soap boiled from ash-water and fat
- era: works
- prereqs: ash-lye, rendered-fat
- skill: medicine rung>=3
- conditions: (none)
- unlocks: item:soap, doctrine:washed_hands_carry_less
- desc: Fat and ash-water boiled to a cake that lifts filth off skin and, quietly, keeps the fever out of the next room.

### node
- id: sealed-jars
- name: Food sealed hot in glass
- era: works
- prereqs: root-cellar
- skill: cooking rung>=3
- conditions: (none)
- unlocks: recipe:sealed_jar, practice:year_round_keeping
- desc: The jars we have, we have. The lids are counted twice a year, and a lid that seals is worth more than what is under it.

### node [SOCIAL]
- id: hearth-not-anyones
- name: A hearth that belongs to nobody
- era: works
- prereqs: short-share, cooking
- skill: cooking rung>=3
- conditions: at least 3 residents ate from the same fire on 5 separate days
- unlocks: structure:common_kitchen, practice:one_fire_fed
- desc: Five fires burning five suppers is five times the wood for no more food. One fire, and whoever is nearest feeds it.

### node
- id: sick-room
- name: A room kept clean for the ill
- era: works
- prereqs: sick-relieved, soap-boiling
- skill: medicine rung>=3
- conditions: (none)
- unlocks: structure:sick_room, doctrine:the_ill_kept_apart
- desc: Scrubbed, aired, and apart from where people sleep — so that one bad week does not become everybody's bad month.

### node
- id: splint-and-set
- name: A pull, a splint, a season
- era: works
- prereqs: sick-relieved
- skill: medicine rung>=3
- conditions: (none)
- unlocks: verb:set_bone, item:splint
- desc: One clean pull while somebody holds the shoulders, then straight timber and a wrapping — a bad season instead of a short life.

### node
- id: herb-bed
- name: The healing plants brought to a bed
- era: works
- prereqs: sick-relieved, foraging
- skill: medicine rung>=2
- conditions: (none)
- unlocks: structure:herb_bed, resource:tended_herb
- desc: Dug up out of the hedgerows and planted where we can find them in the dark, so that mercy is never out of season.

### node
- id: still-and-spirit
- name: Strong drink drawn off a slow fire
- era: works
- prereqs: souring-crock, salvage-sorting
- skill: brewing rung>=3
- conditions: (none)
- unlocks: structure:still, item:spirit
- desc: Salvaged pipe, a cold coil, and a fire you never take your eyes off. What comes off first is poison; throw it away and mean it.

### node
- id: drawn-in-spirit
- name: Virtue pulled out of a plant and kept
- era: works
- prereqs: still-and-spirit, herb-bed
- skill: medicine rung>=4
- conditions: (none)
- unlocks: recipe:tincture
- desc: Strong drink pulls things out of a leaf that water never reaches, and then holds them for years in a small dark bottle.

### node
- id: pit-saw
- name: One log, two people, a long day
- era: works
- prereqs: seasoned-stack
- skill: carpentry rung>=3
- conditions: (none)
- unlocks: item:sawn_board, practice:boards_from_logs
- desc: One above, one below, and a blade taller than either of them. The one below eats sawdust all day and everyone knows it.

### node
- id: frame-and-brace
- name: Post, beam, and a brace that argues with the wind
- era: works
- prereqs: pit-saw
- skill: carpentry rung>=3
- conditions: (none)
- unlocks: structure:framed_building
- desc: The joint carries the load or the building lies to you for a year and then tells the truth all at once.

### node
- id: loom-from-scrap
- name: A loom put together out of what was lying about
- era: works
- prereqs: mending-not-making, salvage-sorting
- skill: tailoring rung>=3
- conditions: (none)
- unlocks: structure:loom, item:woven_cloth, recipe:warm_garment
- desc: A frame, a comb, and a great deal of counting. The first yard is unwearable. The tenth is warmer than anything we came here with.

### node [SOCIAL]
- id: the-record-kept
- name: Writing it down so it stops depending on who remembers
- era: works
- prereqs: count-aloud
- skill: scholarship rung>=2
- conditions: at least 20 exchanges of goods between residents
- unlocks: item:ledger_book, institution:written_record
- desc: Who gave what to whom, put down in a book where memory and friendship can no longer quarrel about it.

### node [SOCIAL]
- id: standing-store
- name: A store with a door and a keeper
- era: works
- prereqs: common_store, count-aloud
- skill: carpentry rung>=3
- conditions: population at least 5 and the common store held more than 30 items
- unlocks: structure:standing_store, institution:store_keeper
- desc: A door that shuts, and one person answerable for what is behind it — which is a burden dressed up as an honour, and they know it.

### node [SOCIAL]
- id: heard-in-one-place
- name: The argument brought to one ground at one hour
- era: works
- prereqs: place-names, shown-not-told
- skill: scholarship rung>=2
- conditions: population at least 5 and at least 2 disputes aired before witnesses
- unlocks: structure:meeting_ground, institution:hearing
- desc: We argue at a set time on set ground instead of everywhere at once, which does not make us agree but does let the rest of us work.

### node [SOCIAL]
- id: the-quarrel-not-fought
- name: A quarrel put to a third person
- era: works
- prereqs: heard-in-one-place
- skill: scholarship rung>=2
- conditions: at least 1 fight between residents
- unlocks: practice:third_person_asked, institution:go_between
- desc: Two people who cannot speak to each other will both speak to a third, and the third is not there to be right — only to carry.

### node [SOCIAL]
- id: said-the-same-twice
- name: A ruling said the same way the second time
- era: works
- prereqs: heard-in-one-place, the-record-kept
- skill: scholarship rung>=3
- conditions: at least 3 disputes settled before witnesses
- unlocks: institution:standing_ruling, item:written_ruling
- desc: What we keep deciding anyway, written down once, so that it stops depending on who is shouting and who is tired.

### node [SOCIAL]
- id: set-aside-for-the-short
- name: A share put by for whoever comes up short
- era: works
- prereqs: short-share, standing-store
- skill: farming rung>=3
- conditions: at least 1 resident went a day without food while the store held some
- unlocks: practice:relief_share, institution:relief
- desc: Taken off the top before anyone is hungry, because a share voted after the hunger starts is a share nobody votes for.

### node [SOCIAL]
- id: the-night-watch
- name: Somebody awake while the rest are not
- era: works
- prereqs: work_rota, two-on-one
- skill: foraging rung>=2
- conditions: at least 1 fire, flood, or theft occurred at night
- unlocks: practice:night_watch, institution:watch
- desc: It is a wasted night nine times in ten, and the tenth is the only reason there is still a storehouse.

### node [SOCIAL]
- id: the-work-nobody-wants
- name: The foul job shared out
- era: works
- prereqs: work_rota, the-record-kept
- skill: farming rung>=2
- conditions: at least 1 job refused by 2 residents within one day
- unlocks: practice:foul_work_shared
- desc: The drain, the ditch, the dead animal. Written into the turn like anything else, or it lands forever on whoever complains least.

### node [SOCIAL]
- id: taught-on-purpose
- name: Children taught, and the hours found for it
- era: works
- prereqs: shown-not-told, the-record-kept
- skill: scholarship rung>=3
- conditions: at least 2 children resident
- unlocks: structure:school_room, institution:teaching_hours
- desc: Two hours out of the working day, given up on purpose, for a return nobody here will live to collect in full.

### node [SOCIAL]
- id: the-year-written-down
- name: The year set down so nothing surprises us twice
- era: works
- prereqs: the-record-kept
- skill: scholarship rung>=3
- conditions: 1 full year lived in the valley
- unlocks: institution:kept_year, practice:sowing_dates
- desc: Last frost, first run of fish, when the ground takes seed — written where we can check it, so the year stops ambushing us.

### node [SOCIAL]
- id: the-thing-owed
- name: A debt that outlives the mood it was made in
- era: works
- prereqs: the-record-kept, lent-and-returned
- skill: scholarship rung>=3
- conditions: at least 15 debts recorded and unsettled
- unlocks: institution:standing_debt
- desc: You helped me roof the shed in April and it is now November. One of us remembers that clearly and one of us does not.

### node [SOCIAL]
- id: hands-hired-out
- name: Work done on another's ground, and what it is worth
- era: works
- prereqs: the-thing-owed, work_rota
- skill: farming rung>=3
- conditions: at least 10 days of labour done by one resident on another's ground
- unlocks: practice:labour_priced, institution:day_work
- desc: A day is a day, except that a day of ditching is not a day of mending, and pretending otherwise ends friendships.

### node [SOCIAL]
- id: the-ground-divided
- name: Which ground is whose, and who says so
- era: works
- prereqs: place-names, said-the-same-twice
- skill: masonry rung>=3
- conditions: at least 2 disputes over ground settled before witnesses
- unlocks: institution:held_ground, item:boundary_stone
- desc: A stone at each corner and an agreement about the stones, because the stones alone have never stopped anybody.

### node [SOCIAL]
- id: who-decides-what
- name: Who may say yes on the town's behalf
- era: works
- prereqs: heard-in-one-place, standing-store
- skill: scholarship rung>=3
- conditions: population at least 6 and at least 5 rulings made before witnesses
- unlocks: institution:standing_voice
- desc: Not who is cleverest — who is allowed to answer when there is no time to ask everybody, and what happens if they answer wrong.

### node [SOCIAL]
- id: the-day-left-alone
- name: One day in the turn when the ground is left alone
- era: works
- prereqs: work_rota, the-year-written-down
- skill: cooking rung>=2
- conditions: at least 60 consecutive days of work under an agreed turn
- unlocks: practice:rest_day, institution:the_left_day
- desc: Nothing gets sown, nothing gets built, and the arguing is done sitting down. It costs a day and buys back a season of tempers.

### node [SOCIAL]
- id: what-the-river-can-stand
- name: How much any one of us may take from the river
- era: works
- prereqs: set-lines, the-catch-shared
- skill: fishing rung>=3
- conditions: the day's catch fell for 10 consecutive days
- unlocks: practice:catch_limited, doctrine:the_river_can_be_emptied
- desc: It looked endless for two summers and then it did not. Nobody takes more than the agreed number, and in a thin year the number comes down.

### node [SOCIAL]
- id: the-name-carved
- name: Names cut where the town can read them
- era: works
- prereqs: memorial, the-record-kept
- skill: masonry rung>=3
- conditions: at least 2 residents died
- unlocks: structure:name_stone, institution:kept_names
- desc: Cut deep, because shallow letters go in forty years and forty years is nothing to a stone or to us.

---

## ERA machinery — what the valley already has, kept alive and made to do a second job

The reach here is not manufacture. Nobody pours metal and nobody buys a part. Everything on this rung is
salvaged out of a dead machine, cut to fit where the right part will never come, driven off water instead
of fuel, or agreed between the people who have to share it.

### node
- id: part-off-a-dead-machine
- name: A machine stripped for what still turns
- era: machinery
- prereqs: salvage-sorting
- skill: smithing rung>=3
- conditions: (none)
- unlocks: item:bearing, item:shaft, item:fitting, practice:stripping
- desc: Take the bearings, the shaft, the springs and every screw, label the lot, and remember which machine they came out of.

### node
- id: made-to-fit
- name: A part cut to fit where the right one will never come
- era: machinery
- prereqs: part-off-a-dead-machine, pit-saw
- skill: smithing rung>=4
- conditions: (none)
- unlocks: recipe:fitted_part, item:wooden_bushing, practice:substitution
- desc: It will not be the part that was there. It has to be the size the hole is, and it has to last until we can make a better one.

### node
- id: gasket-and-seal
- name: A seal cut out of something that was never a seal
- era: machinery
- prereqs: made-to-fit
- skill: smithing rung>=3
- conditions: (none)
- unlocks: item:gasket, practice:sealed_joint
- desc: Trace the flange onto the sheet, cut inside the line, and tap the holes through with the bolt itself. It will weep for a day and then hold.

### node
- id: line-shaft
- name: One turning thing driving six
- era: machinery
- prereqs: part-off-a-dead-machine, frame-and-brace
- skill: carpentry rung>=4
- conditions: (none)
- unlocks: structure:line_shaft, practice:one_drive_many
- desc: A shaft under the roof and a pulley wherever anybody needs one — one thing turning, and the whole building doing work.

### node
- id: belting
- name: Belting cut and laced from what we had
- era: machinery
- prereqs: line-shaft, mending-not-making
- skill: tailoring rung>=3
- conditions: (none)
- unlocks: item:drive_belt
- desc: Cut on the straight, laced not glued, and always slack enough to slip before something dearer than the belt breaks.

### node
- id: wheel-in-the-race
- name: A wheel set in the race and made to turn
- era: machinery
- prereqs: mill-race, line-shaft
- skill: carpentry rung>=4
- conditions: (none)
- unlocks: structure:water_wheel, practice:power_without_fuel
- desc: The river was going that way anyway. All we did was put something in its path and take a share of the argument.

### node
- id: the-grinding-shed
- name: Grain ground by the river instead of by arms
- era: machinery
- prereqs: wheel-in-the-race
- skill: farming rung>=3
- conditions: (none)
- unlocks: structure:mill, resource:flour, recipe:bread
- desc: What used to be a woman's whole morning is now a noise from the far bank and a sack on the step by noon.

### node
- id: the-saw-that-runs
- name: A saw driven off the shaft
- era: machinery
- prereqs: line-shaft, pit-saw
- skill: carpentry rung>=5
- conditions: (none)
- unlocks: structure:powered_saw, practice:boards_by_the_day
- desc: Boards by the day instead of by the week, and a machine that will take a hand off in the time it takes to be careless once.

### node
- id: rewound
- name: A burnt winding taken off and laid on again
- era: machinery
- prereqs: part-off-a-dead-machine, made-to-fit
- skill: smithing rung>=5
- conditions: (none)
- unlocks: recipe:rewound_motor, doctrine:a_motor_is_wire_and_iron
- desc: Count the turns as you strip it, because a dead motor is only wire and iron, and the wire can be laid on again by anyone patient enough.

### node
- id: current-off-the-river
- name: Current drawn from the wheel instead of the fuel
- era: machinery
- prereqs: wheel-in-the-race, rewound
- skill: smithing rung>=5
- conditions: (none)
- unlocks: structure:river_generator, practice:current_without_fuel
- desc: The wheel turns whether we ask it to or not. Belt it to a rewound motor and it gives back light for nothing but the maintaining.

### node
- id: wood-gas
- name: An engine fed on wood smoke when the fuel is gone
- era: machinery
- prereqs: charcoal-heap, gasket-and-seal
- skill: smithing rung>=5
- conditions: (none)
- unlocks: structure:gas_producer, practice:engine_on_wood
- desc: Starve a wood fire of air, filter what comes off, and an engine will run on it, badly, forever. Never do it indoors.

### node
- id: current-stored
- name: Current put by for a night with no river
- era: machinery
- prereqs: current-off-the-river, sealed-jars
- skill: smithing rung>=5
- conditions: (none)
- unlocks: structure:cell_bank, practice:current_kept
- desc: Glass, lead off the salvage pile, and a shed nobody sleeps in. It gives back less than you put in and it is still worth it.

### node
- id: the-cold-room
- name: A room kept cold by the machine instead of the season
- era: machinery
- prereqs: current-off-the-river, root-cellar
- skill: cooking rung>=4
- conditions: (none)
- unlocks: structure:cold_room, practice:cold_all_year
- desc: August with a January corner in it. The whole town's meat lives in there now, which means the whole town watches the machine.

### node [SOCIAL]
- id: hours-of-the-generator
- name: What the current is spent on, and by whose word
- era: machinery
- prereqs: count-aloud, made-to-fit
- skill: scholarship rung>=3
- conditions: the generator ran short of fuel at least once
- unlocks: practice:current_rationed, institution:current_hours
- desc: Light in the sick-room before light in the kitchen, and nothing at all after ten — argued out once, in daylight, while nobody was frightened.

### node [SOCIAL]
- id: the-machine-that-is-nobodys
- name: A machine held by the town and kept by one pair of hands
- era: machinery
- prereqs: standing-store, part-off-a-dead-machine
- skill: scholarship rung>=3
- conditions: at least 3 residents used the same machine within one week
- unlocks: institution:kept_machine, practice:machine_keeper
- desc: Everybody may use it. One person is answerable for it. Those two sentences have to be said together or the machine is dead by autumn.

### node [SOCIAL]
- id: the-shed-that-is-open
- name: A place where anyone may take what they need
- era: machinery
- prereqs: lent-and-returned, the-machine-that-is-nobodys
- skill: carpentry rung>=3
- conditions: at least 25 lendings recorded between residents
- unlocks: structure:open_shed, institution:open_holding
- desc: No lock, a board by the door, and your name against what you took. It works entirely because everyone can see the board.

### node [SOCIAL]
- id: one-size-for-everything
- name: Every thread and every hole cut to the same few sizes
- era: machinery
- prereqs: made-to-fit, the-record-kept
- skill: smithing rung>=4
- conditions: at least 10 fitted parts made
- unlocks: doctrine:parts_interchange, institution:agreed_sizes
- desc: Three sizes of hole, four of thread, and never another. It is a dull rule and it is the difference between a repair and a whole afternoon.

### node [SOCIAL]
- id: what-fits-what
- name: A written account of which part goes in which machine
- era: machinery
- prereqs: one-size-for-everything, the-record-kept
- skill: scholarship rung>=4
- conditions: at least 20 repairs recorded
- unlocks: item:parts_book, doctrine:repair_time_down
- desc: Every machine drawn once, badly, with its sizes beside it — so that the next repair does not begin with an hour of measuring.

### node [SOCIAL]
- id: let-it-die-on-purpose
- name: Choosing which machine stops so the others go on
- era: machinery
- prereqs: the-machine-that-is-nobodys, hours-of-the-generator
- skill: scholarship rung>=4
- conditions: 2 machines needed the same part and only 1 such part existed
- unlocks: doctrine:deliberate_retirement, practice:harvested_machine
- desc: Somebody has to say out loud which one we stop mending, in front of the person who uses it, before the choice makes itself at midnight.

### node [SOCIAL]
- id: the-part-not-taken
- name: The part left in a dead machine
- era: machinery
- prereqs: let-it-die-on-purpose
- skill: smithing rung>=4
- conditions: at least 3 machines stripped for parts
- unlocks: doctrine:salvage_restraint
- desc: We stopped stripping them bare. What is left in there is the only stock of that part anybody will ever have, and it keeps better in place.

### node [SOCIAL]
- id: the-hands-that-know-it
- name: A craft taught to a second pair of hands on purpose
- era: machinery
- prereqs: taught-on-purpose, the-machine-that-is-nobodys
- skill: scholarship rung>=4
- conditions: 1 craft held by exactly 1 living resident for 30 days
- unlocks: doctrine:no_craft_held_by_one, practice:second_pair
- desc: If only one of us can do it, then it is not something the town knows — it is something one person knows, and people fall in rivers.

### node [SOCIAL]
- id: paid-in-turns
- name: Work traded for work with nothing changing hands
- era: machinery
- prereqs: hands-hired-out, the-thing-owed
- skill: scholarship rung>=4
- conditions: at least 30 days of labour recorded on both sides of a standing debt
- unlocks: institution:labour_traded
- desc: Four days of your roofing against six of my ditching, both written down, and neither of us any poorer for having no coin between us.

---

## ERA industry — the largest thing one valley can hold

The far edge of reach. Nothing on this rung is a factory and nothing on it is bought: these are the ways a
town gets large enough, and organised enough, to outlast the people who made it. Most of them are things
agreed rather than things built, because at this distance an agreement is the only thing left that a
valley this size can still afford.

### node
- id: current-to-every-roof
- name: Line strung from the race to every door
- era: industry
- prereqs: current-off-the-river, current-stored
- skill: smithing rung>=5
- conditions: (none)
- unlocks: structure:distribution_line, practice:light_in_every_house
- desc: Every roof on the same wire, which means every fault is everyone's fault, and the whole town learns what a fuse is in one evening.

### node
- id: the-second-hearth
- name: A second place to live, at the far fork
- era: industry
- prereqs: bridging, frame-and-brace, the-ground-divided
- skill: carpentry rung>=5
- conditions: (none)
- unlocks: structure:outer_settlement
- desc: Far enough that a fire there is not a fire here, close enough that a shout carries in the right wind. That is the whole calculation.

### node
- id: the-craft-written-down
- name: A craft set down whole
- era: industry
- prereqs: what-fits-what, taught-on-purpose
- skill: scholarship rung>=5
- conditions: at least 20 crafts recorded in writing
- unlocks: item:craft_book, doctrine:craft_survives_its_holder
- desc: Every step, in order, including the three that are obvious to whoever wrote them and to nobody else alive.

### node [SOCIAL]
- id: made-to-be-mended
- name: Making a thing so a stranger can open it
- era: industry
- prereqs: what-fits-what, one-size-for-everything
- skill: smithing rung>=5
- conditions: at least 5 parts made that fitted a machine their maker never saw
- unlocks: doctrine:built_for_repair
- desc: Screws, not glue. Sizes off the agreed list. Room for a hand. Built for somebody who is not born yet and will curse you either way.

### node [SOCIAL]
- id: the-year-planned-whole
- name: The valley's whole work laid out a year ahead
- era: industry
- prereqs: the-year-written-down, hands-hired-out
- skill: scholarship rung>=5
- conditions: 2 full years lived in the valley
- unlocks: institution:year_plan, practice:planned_sowing
- desc: Every field, every pair of hands, and every week of the year on one sheet — wrong by March, and still better than five people guessing.

### node [SOCIAL]
- id: everyone-put-their-name-to-it
- name: What we agreed, written once, with every name under it
- era: industry
- prereqs: said-the-same-twice, who-decides-what
- skill: scholarship rung>=5
- conditions: population at least 12 and at least 10 standing rulings
- unlocks: item:signed_agreement, institution:the_agreement
- desc: Not new rules. The ones we have been keeping anyway, gathered onto one sheet, so that agreeing to them becomes a thing a person does on a day.

### node [SOCIAL]
- id: the-store-that-outlives-us
- name: A store filled by people who will not eat from it
- era: industry
- prereqs: set-aside-for-the-short, the-year-planned-whole
- skill: farming rung>=5
- conditions: the common store held more than 1 year of food
- unlocks: institution:standing_reserve, doctrine:stores_across_years
- desc: Untouched through a thin winter on purpose, which is the hardest thing this town has ever agreed to do and the proof it can.

### node [SOCIAL]
- id: accounts-across-years
- name: What is owed, carried past the year it was owed in
- era: industry
- prereqs: the-thing-owed, paid-in-turns
- skill: scholarship rung>=5
- conditions: at least 100 recorded debts, at least 10 of them older than 1 year
- unlocks: institution:carried_accounts
- desc: A debt older than the quarrel that made it, still on the page, still settled eventually — which is how a town becomes something you can lend to.

### node [SOCIAL]
- id: the-last-of-the-fuel
- name: Deciding out loud what the last of it is for
- era: industry
- prereqs: hours-of-the-generator, let-it-die-on-purpose
- skill: scholarship rung>=5
- conditions: fewer than 30 days of fuel remained
- unlocks: doctrine:last_fuel_spent_by_agreement
- desc: There is a bottom to the drum and we have seen it. What is left goes to the pump and the sick-room, agreed while we can still be reasonable.

### node [SOCIAL]
- id: the-names-of-everyone-who-was-here
- name: Every name the valley has held, kept in one place
- era: industry
- prereqs: the-name-carved, the-craft-written-down
- skill: scholarship rung>=5
- conditions: at least 5 residents died
- unlocks: structure:record_house, institution:kept_roll
- desc: Born, came, went, died — one line each, under one dry roof, so that being forgotten stops being the ordinary end of a person here.

### node [SOCIAL]
- id: the-valley-counted
- name: A count of every person, every year
- era: industry
- prereqs: the-year-planned-whole, accounts-across-years
- skill: scholarship rung>=5
- conditions: 3 full years lived in the valley
- unlocks: institution:yearly_count
- desc: Once a year, everyone stands still long enough to be counted, and the number is read out whether it has gone up or down.

### node [SOCIAL]
- id: what-we-will-not-do
- name: The line the town draws, and writes down
- era: industry
- prereqs: everyone-put-their-name-to-it, let-it-die-on-purpose
- skill: scholarship rung>=5
- conditions: at least 3 rulings that forbade something
- unlocks: doctrine:the_forbidden, institution:the_line_drawn
- desc: The shortest page we keep, and the only one written when nothing was happening — because a line drawn during the trouble is not a line.
