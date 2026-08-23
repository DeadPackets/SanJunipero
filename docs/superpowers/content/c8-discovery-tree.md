# C8 Genesis — Discovery Tree (DRAFT)

Source of authority: spec §3 (Discovery system), §4 (adjacency doctrine), §10 (five eras: agriculture → crafts → metallurgy → chemistry → engineering). Consumed by the `experiment` verb + engine roll; each successful node creates a codex entry credited to its inventor and spreads only by teaching, trading, or spying.

## Data conventions (for SDD conversion)

- One node per block. Fields, always in this order: `id`, `name`, `era`, `prereqs`, `skill`, `conditions`, `unlocks`, `desc`.
- `id`: unique kebab-case key. `prereqs`: comma-separated node ids, or `(none)`. The graph is a DAG; a node may only cite nodes from its own or earlier eras, and never forms a cycle.
- `skill`: `track rung>=N` — minimum rung in one track to attempt the experiment. Rung scale: 0 untrained, 1 dabbler, 2 practiced, 3 competent, 4 expert, 5 master (spec leaves the scale unnamed; fixed here).
- `conditions`: engine-checkable non-skill requirements; `(none)` for pure-tech nodes. Used chiefly by `[SOCIAL]` nodes (institutions), whose discovery depends on population and interaction history, not craft alone.
- `unlocks` namespaces: `verb:` (new Tier-1 action), `recipe:` (craftable), `structure:` (buildable), `item:` (object type), `resource:` (harvestable/world material), `practice:` (passive rule change), `institution:` (codex-recognized social technology), `doctrine:` (knowledge that modifies rolls).
- `desc`: one line, in-world codex voice. Human framing law applies: no field ever references anything outside the world.
- Tier-1 verbs from C2 (walk, eat, speak, give, take, build, craft, plant, harvest, fish, forage, write, read, sleep, tend, teach, attack, experiment) exist from day zero; this tree only adds new content on top of them.
- Reachability: every era-1 node with no prereqs requires only rung 1 in a track some founder starts with, or a track reachable by brief practice from rung 0 (learn-by-doing).
- Node counts: era 1 = 27, era 2 = 31, era 3 = 18, era 4 = 16, era 5 = 12. Total = 104. `[SOCIAL]` nodes = 11.

---

## ERA 1 — Roots (survival, food, fire, first fields)

### node
- id: fire-craft
- name: Fire-Making
- era: 1
- prereqs: (none)
- skill: foraging rung>=1
- conditions: (none)
- unlocks: verb:light_fire, structure:fire_pit
- desc: Dry moss, a bowed spindle, and patience coax a live coal out of dead wood.

### node
- id: forage-lore
- name: Forager's Eye
- era: 1
- prereqs: (none)
- skill: foraging rung>=1
- conditions: (none)
- unlocks: resource:berries, resource:edible_roots, resource:wild_herbs
- desc: Which greens feed, which purge, and which quietly kill — told apart at a glance.

### node
- id: stone-tools
- name: Knapped Stone Tools
- era: 1
- prereqs: (none)
- skill: carpentry rung>=1
- conditions: (none)
- unlocks: item:stone_axe, item:stone_knife, item:hammerstone
- desc: River flint struck at the right angle gives an edge that bites wood and hide.

### node
- id: fishing-line
- name: Hook and Line
- era: 1
- prereqs: (none)
- skill: fishing rung>=1
- conditions: (none)
- unlocks: item:hook_and_line, practice:bank_fishing_yield_up
- desc: A carved bone hook and a steady hand turn the river into a larder.

### node
- id: camp-hygiene
- name: Clean Camp
- era: 1
- prereqs: (none)
- skill: medicine rung>=1
- conditions: (none)
- unlocks: structure:midden_pit, doctrine:camp_sickness_rolls_down
- desc: Waste buried downwind and downstream keeps the flux out of the cookpot.

### node
- id: seed-saving
- name: Seed Saving
- era: 1
- prereqs: forage-lore
- skill: farming rung>=1
- conditions: (none)
- unlocks: item:seed_stock
- desc: The plumpest heads are not for eating; next year lives in a dry pouch.

### node
- id: cordage
- name: Twisted Cordage
- era: 1
- prereqs: forage-lore
- skill: tailoring rung>=1
- conditions: (none)
- unlocks: item:cordage, item:rope
- desc: Nettle and bark fiber, twisted against themselves, hold more than they should.

### node
- id: open-fire-cooking
- name: Open-Fire Cooking
- era: 1
- prereqs: fire-craft
- skill: cooking rung>=1
- conditions: (none)
- unlocks: recipe:roast_fish, recipe:roast_roots, practice:cooked_food_nourishes_more
- desc: Fire turns what the meadow gives into meals that hold body and soul together.

### node
- id: lean-to
- name: Lean-To Shelter
- era: 1
- prereqs: stone-tools
- skill: carpentry rung>=1
- conditions: (none)
- unlocks: structure:lean_to
- desc: Poles, pitch, and thatch against the weather — a roof is the first argument won against the sky.

### node
- id: felling
- name: Felling and Splitting
- era: 1
- prereqs: stone-tools
- skill: carpentry rung>=1
- conditions: (none)
- unlocks: verb:fell_tree, item:log, item:firewood
- desc: A tree read rightly falls where it is told and splits along its own secrets.

### node
- id: herb-poultice
- name: Herb Poultice
- era: 1
- prereqs: forage-lore
- skill: medicine rung>=1
- conditions: (none)
- unlocks: recipe:poultice
- desc: Crushed yarrow and honey packed in a wound argue with the rot, and often win.

### node
- id: snares
- name: Snare Lines
- era: 1
- prereqs: cordage
- skill: foraging rung>=2
- conditions: (none)
- unlocks: verb:set_snare, resource:small_game
- desc: A loop on a game trail hunts all night while the trapper sleeps.

### node
- id: hide-curing
- name: Hide Scraping and Curing
- era: 1
- prereqs: snares, stone-tools
- skill: tailoring rung>=1
- conditions: (none)
- unlocks: item:cured_hide, item:waterskin
- desc: Scraped, stretched, and smoked, a skin stops being meat and starts being goods.

### node
- id: basketry
- name: Reed Basketry
- era: 1
- prereqs: cordage
- skill: tailoring rung>=1
- conditions: (none)
- unlocks: item:basket
- desc: River reeds woven over-and-under carry a harvest that two hands cannot.

### node
- id: garden-plot
- name: Turned Garden Plot
- era: 1
- prereqs: seed-saving
- skill: farming rung>=1
- conditions: (none)
- unlocks: structure:garden_plot
- desc: Broken sod, buried seed, pulled weeds — the first deliberate acre of a new world.

### node
- id: compost
- name: Compost Heap
- era: 1
- prereqs: garden-plot
- skill: farming rung>=2
- conditions: (none)
- unlocks: structure:compost_heap, practice:soil_fertility_up
- desc: Rot, properly heaped, is not waste but next season's strength.

### node
- id: wild-grain
- name: Wild Grain Harvest
- era: 1
- prereqs: forage-lore
- skill: farming rung>=1
- conditions: (none)
- unlocks: resource:wild_grain
- desc: The tawny grass by the river fork carries seed a person can live on.

### node
- id: grain-field
- name: Grain Field
- era: 1
- prereqs: wild-grain, garden-plot
- skill: farming rung>=2
- conditions: (none)
- unlocks: structure:grain_field
- desc: Wild seed sown thick in turned ground: the gamble every town is founded on.

### node
- id: quern
- name: Quern and Grinding
- era: 1
- prereqs: wild-grain, stone-tools
- skill: cooking rung>=1
- conditions: (none)
- unlocks: item:quern, resource:flour
- desc: Two stones and an aching shoulder turn hard grain into soft possibility.

### node
- id: clay-digging
- name: Riverbank Clay
- era: 1
- prereqs: (none)
- skill: foraging rung>=1
- conditions: (none)
- unlocks: resource:raw_clay
- desc: The grey seam under the cutbank holds its shape when wet and its promise when dry.

### node
- id: sun-brick
- name: Sun-Dried Brick
- era: 1
- prereqs: clay-digging
- skill: masonry rung>=1
- conditions: (none)
- unlocks: item:mud_brick
- desc: Clay and straw pressed in a frame and left to the sun make a wall that owes nothing to the forest.

### node
- id: clay-oven
- name: Clay Hearth Oven
- era: 1
- prereqs: sun-brick, open-fire-cooking
- skill: masonry rung>=2
- conditions: (none)
- unlocks: structure:clay_oven
- desc: A domed hearth holds heat long after the fire dies, and bakes instead of burns.

### node
- id: flatbread
- name: Flatbread
- era: 1
- prereqs: clay-oven, quern
- skill: cooking rung>=2
- conditions: (none)
- unlocks: recipe:flatbread
- desc: Flour, water, salt if you have it, a hot stone — the oldest promise kept daily.

### node
- id: drying-rack
- name: Drying and Smoking Rack
- era: 1
- prereqs: cordage, open-fire-cooking
- skill: cooking rung>=2
- conditions: (none)
- unlocks: structure:drying_rack, recipe:dried_fish, recipe:smoked_meat
- desc: What sun and smoke take out of meat, the winter cannot take out of you.

### node
- id: herb-garden
- name: Herb Garden
- era: 1
- prereqs: garden-plot, herb-poultice
- skill: medicine rung>=2
- conditions: (none)
- unlocks: structure:herb_garden
- desc: The healing plants brought home to a tended bed, so mercy is never out of season.

### node
- id: log-cabin
- name: Log Cabin
- era: 1
- prereqs: felling, lean-to
- skill: carpentry rung>=2
- conditions: (none)
- unlocks: structure:log_cabin
- desc: Notched logs, packed moss, a real door: the first building worth calling home.

### node
- id: reed-fish-trap
- name: Reed Fish Trap
- era: 1
- prereqs: fishing-line, basketry
- skill: fishing rung>=2
- conditions: (none)
- unlocks: structure:fish_trap
- desc: A woven throat the fish swim into and cannot puzzle out of — the river working night shifts.

---

## ERA 2 — Hands (crafts, preservation, husbandry, first institutions)

### node
- id: pit-kiln
- name: Pit Kiln
- era: 2
- prereqs: sun-brick, fire-craft
- skill: masonry rung>=2
- conditions: (none)
- unlocks: structure:pit_kiln
- desc: A banked fire in a brick-lined pit reaches heats an open hearth never dreams of.

### node
- id: fired-pottery
- name: Fired Pottery
- era: 2
- prereqs: pit-kiln, clay-digging
- skill: art rung>=1
- conditions: (none)
- unlocks: item:clay_pot, item:storage_jar
- desc: Kiln-hardened clay rings like stone and holds water, grain, and secrets.

### node
- id: tanning-vats
- name: Bark-Tannin Vats
- era: 2
- prereqs: hide-curing, fired-pottery
- skill: tailoring rung>=3
- conditions: (none)
- unlocks: item:leather
- desc: Oak bark steeped sour turns stiff hide into leather that outlasts its wearer.

### node
- id: loom
- name: Warp-Weighted Loom
- era: 2
- prereqs: cordage
- skill: tailoring rung>=2
- conditions: (none)
- unlocks: structure:loom
- desc: Threads hung under stone weights, crossed a thousand patient times, become cloth.

### node
- id: flax
- name: Flax Growing and Retting
- era: 2
- prereqs: garden-plot
- skill: farming rung>=2
- conditions: (none)
- unlocks: resource:flax_fiber
- desc: A blue-flowered crop grown not for eating but for the thread hidden in its stalks.

### node
- id: linen
- name: Linen Cloth
- era: 2
- prereqs: loom, flax
- skill: tailoring rung>=3
- conditions: (none)
- unlocks: item:linen_cloth
- desc: Flax spun fine and woven close: cool in summer, dear in trade.

### node
- id: garments
- name: Cut and Sewn Garments
- era: 2
- prereqs: tanning-vats
- skill: tailoring rung>=3
- conditions: (none)
- unlocks: recipe:warm_clothes, practice:cold_resistance_up
- desc: Clothes cut to the body instead of draped on it — winter's teeth blunted at the seam.

### node
- id: joinery
- name: Mortise and Tenon Joinery
- era: 2
- prereqs: felling
- skill: carpentry rung>=3
- conditions: (none)
- unlocks: item:wooden_pegs, practice:frame_construction
- desc: Wood locked into wood without iron: the joint carries the load or the building lies.

### node
- id: frame-house
- name: Timber-Frame House
- era: 2
- prereqs: joinery
- skill: carpentry rung>=3
- conditions: (none)
- unlocks: structure:timber_house
- desc: Post, beam, and brace raised in a day by many hands — a house, and the habit of raising one together.

### node
- id: dry-stone
- name: Dry-Stone Walling
- era: 2
- prereqs: stone-tools
- skill: masonry rung>=2
- conditions: (none)
- unlocks: structure:stone_wall
- desc: Stone set on stone, each holding its neighbor down, no mortar owed to anyone.

### node
- id: lime-burning
- name: Lime Burning
- era: 2
- prereqs: pit-kiln
- skill: masonry rung>=3
- conditions: (none)
- unlocks: item:quicklime
- desc: Grey hillstone roasted white and slaked hissing in water — a powder that bites and binds.

### node
- id: mortar
- name: Lime Mortar
- era: 2
- prereqs: lime-burning
- skill: masonry rung>=3
- conditions: (none)
- unlocks: structure:mortared_wall
- desc: Lime, sand, and water set stone against the centuries instead of the seasons.

### node
- id: animal-pen
- name: Animal Husbandry
- era: 2
- prereqs: snares, grain-field
- skill: farming rung>=2
- conditions: (none)
- unlocks: structure:animal_pen, resource:goats
- desc: Wild kids raised tame at the fence line: milk, hair, and dung on four obliging legs.

### node
- id: dairy
- name: Dairy Craft
- era: 2
- prereqs: animal-pen
- skill: cooking rung>=3
- conditions: (none)
- unlocks: recipe:cheese, recipe:butter, item:animal_fat
- desc: Milk taught to keep — curd, salt, and patience against the lean months.

### node
- id: ard-plough
- name: Wooden Ard Plough
- era: 2
- prereqs: animal-pen, joinery
- skill: farming rung>=3
- conditions: (none)
- unlocks: item:wooden_plough, practice:field_labor_halved
- desc: A hooked beam behind a beast opens in a morning what breaks a person's week.

### node
- id: irrigation
- name: Ditch Irrigation
- era: 2
- prereqs: grain-field
- skill: farming rung>=3
- conditions: (none)
- unlocks: structure:irrigation_ditch, practice:drought_resistance_up
- desc: The river persuaded, one spade-cut at a time, to visit the fields on schedule.

### node
- id: mash-ferment
- name: Grain Mash and Fermentation
- era: 2
- prereqs: fired-pottery, quern
- skill: brewing rung>=2
- conditions: (none)
- unlocks: recipe:ale, recipe:leavened_bread
- desc: Wet grain gone strange in a warm crock: bubbling, alive, and worth guarding.

### node
- id: berry-wine
- name: Berry Wine
- era: 2
- prereqs: fired-pottery, forage-lore
- skill: brewing rung>=2
- conditions: (none)
- unlocks: recipe:wine, item:strong_drink
- desc: Summer fruit sealed away and let quarrel with itself until it comes out singing.

### node
- id: salt-boiling
- name: Salt from the Brine Pool
- era: 2
- prereqs: fired-pottery
- skill: cooking rung>=2
- conditions: (none)
- unlocks: item:salt
- desc: The bitter pool by the river fork, boiled down pot after pot, leaves grey crystals worth their weight in favors.

### node
- id: salting
- name: Salt Preservation
- era: 2
- prereqs: salt-boiling
- skill: cooking rung>=3
- conditions: (none)
- unlocks: recipe:salted_fish, recipe:salted_meat
- desc: Packed in salt, autumn's plenty keeps its appointment with winter's table.

### node
- id: dugout-canoe
- name: Dugout Canoe
- era: 2
- prereqs: felling
- skill: carpentry rung>=2
- conditions: (none)
- unlocks: structure:canoe, practice:deep_river_fishing
- desc: A single trunk hollowed by adze and ember, and suddenly the far bank is a neighbor.

### node
- id: knotted-nets
- name: Knotted Fishing Nets
- era: 2
- prereqs: cordage, fishing-line
- skill: fishing rung>=3
- conditions: (none)
- unlocks: item:fishing_net
- desc: A thousand small knots that together lift a hundred fish — wealth made of string and evenings.

### node
- id: tinctures
- name: Herbal Tinctures
- era: 2
- prereqs: berry-wine, herb-garden
- skill: medicine rung>=3
- conditions: (none)
- unlocks: recipe:tincture
- desc: Strong drink pulls virtue out of herbs that water never reaches, and keeps it for years.

### node
- id: bonesetting
- name: Splints and Bonesetting
- era: 2
- prereqs: herb-poultice
- skill: medicine rung>=2
- conditions: (none)
- unlocks: verb:set_bone, item:splint, practice:safer_childbirth
- desc: A clean pull, a straight splint, and a broken limb becomes a bad season instead of a short life.

### node
- id: charcoal-clamp
- name: Charcoal Clamp
- era: 2
- prereqs: felling
- skill: smithing rung>=1
- conditions: (none)
- unlocks: item:charcoal
- desc: Wood smothered and cooked in its own smoke burns twice as hot and clean — fuel for fires not yet imagined.

### node
- id: ink
- name: Ink and Pigments
- era: 2
- prereqs: forage-lore, fired-pottery
- skill: art rung>=2
- conditions: (none)
- unlocks: item:ink, item:pigments
- desc: Oak galls, soot, and river ochre — the colors with which a town starts remembering out loud.

### node
- id: parchment
- name: Scraped Parchment
- era: 2
- prereqs: hide-curing
- skill: scholarship rung>=2
- conditions: (none)
- unlocks: item:parchment
- desc: A hide scraped to translucence takes ink and outlives every memory trusted to breath.

### node [SOCIAL]
- id: storehouse-compact
- name: Storehouse Compact
- era: 2
- prereqs: (none)
- skill: scholarship rung>=1
- conditions: at least 3 residents present in one conversation concerning the shared stores
- unlocks: institution:rationing_compact, practice:agreed_portions
- desc: The day the storehouse stopped being whoever-gets-there-first and became a promise with names on it.

### node [SOCIAL]
- id: tally-ledger
- name: Tally Ledger
- era: 2
- prereqs: parchment
- skill: scholarship rung>=2
- conditions: at least 15 completed exchanges of goods between residents
- unlocks: institution:ledger, item:ledger_book
- desc: Who gave what to whom, scratched down where memory and friendship can no longer quarrel over it.

### node [SOCIAL]
- id: meeting-circle
- name: Meeting Circle
- era: 2
- prereqs: storehouse-compact
- skill: scholarship rung>=2
- conditions: population at least 5, and at least 2 disputes aired before witnesses
- unlocks: institution:council, structure:meeting_stones
- desc: A ring of log seats where the town argues on purpose, at a set time, instead of everywhere at once.

### node [SOCIAL]
- id: season-calendar
- name: Season Calendar
- era: 2
- prereqs: parchment
- skill: scholarship rung>=2
- conditions: one full year lived on the meadow
- unlocks: institution:calendar, practice:planting_dates
- desc: The year caught on parchment — last frost, first spawn, seed-time — so the town stops being surprised by what always happens.

---

## ERA 3 — Ore (metallurgy, waterpower, tokens and law)

### node
- id: prospecting
- name: Ore Prospecting
- era: 3
- prereqs: stone-tools
- skill: smithing rung>=2
- conditions: (none)
- unlocks: resource:copper_ore
- desc: The green stains on the rocky hill are not moss; the hill has been keeping metal all along.

### node
- id: mine-adit
- name: Mine Adit
- era: 3
- prereqs: prospecting, joinery
- skill: masonry rung>=3
- conditions: (none)
- unlocks: structure:mine_adit, resource:tin_ore
- desc: A timbered mouth driven into the hillside, following the vein down into the dark.

### node
- id: copper-smelt
- name: Copper Smelting
- era: 3
- prereqs: prospecting, pit-kiln, charcoal-clamp
- skill: smithing rung>=3
- conditions: (none)
- unlocks: item:copper_ingot
- desc: Green stone fed to a charcoal fire bleeds out shining and pours like angry honey.

### node
- id: copper-tools
- name: Copper Working
- era: 3
- prereqs: copper-smelt
- skill: smithing rung>=3
- conditions: (none)
- unlocks: item:copper_knife, item:copper_pot, item:copper_fittings
- desc: The first metal edge in the valley — soft as metals go, and still better than any stone.

### node
- id: bronze
- name: Bronze Alloying
- era: 3
- prereqs: copper-smelt, mine-adit
- skill: smithing rung>=4
- conditions: (none)
- unlocks: item:bronze_ingot, item:bronze_tools
- desc: A measure of tin in the copper, and the soft metal comes out of the crucible with a temper.

### node
- id: bloomery
- name: Bloomery Furnace
- era: 3
- prereqs: copper-smelt, mortar
- skill: smithing rung>=4
- conditions: (none)
- unlocks: structure:bloomery
- desc: A mortared chimney-furnace, charcoal-fed and bellows-fanned, hot enough to trouble iron.

### node
- id: iron-bloom
- name: Iron Bloom
- era: 3
- prereqs: bloomery
- skill: smithing rung>=4
- conditions: (none)
- unlocks: item:iron_bloom
- desc: A spongy, glowing fistful of the commonest metal in the world, and the hardest won so far.

### node
- id: smithy
- name: Smithy and Anvil
- era: 3
- prereqs: iron-bloom, frame-house
- skill: smithing rung>=4
- conditions: (none)
- unlocks: structure:smithy
- desc: Anvil, bellows, quench-trough, and a ringing that tells the whole valley the town means to stay.

### node
- id: iron-tools
- name: Iron Tools
- era: 3
- prereqs: smithy
- skill: smithing rung>=4
- conditions: (none)
- unlocks: item:iron_axe, item:iron_saw, item:nails, item:hinges
- desc: Nails, hinges, saws, axeheads — iron quietly replacing cleverness with capability.

### node
- id: iron-plough
- name: Iron-Shod Plough
- era: 3
- prereqs: iron-tools, ard-plough
- skill: farming rung>=4
- conditions: (none)
- unlocks: item:iron_plough, practice:heavy_soil_tillable
- desc: An iron share bites the heavy riverside clay the wooden ard only ever scratched.

### node
- id: glassmaking
- name: Glassmaking
- era: 3
- prereqs: pit-kiln, lime-burning
- skill: art rung>=3
- conditions: (none)
- unlocks: item:glass_gob
- desc: River sand, ash, and lime fused in the kiln's white heart into something clear as frozen water.

### node
- id: glass-vessels
- name: Blown Glass Vessels
- era: 3
- prereqs: glassmaking
- skill: art rung>=3
- conditions: (none)
- unlocks: item:glass_jar, item:glass_vial, item:window_pane
- desc: A gob of melt on a hollow pipe, a steady breath, and the town owns its first transparent things.

### node
- id: water-wheel
- name: Water Wheel
- era: 3
- prereqs: joinery, irrigation
- skill: carpentry rung>=4
- conditions: (none)
- unlocks: structure:water_wheel, structure:gristmill, practice:milling_labor_freed
- desc: The river fork put to work at last — a turning wheel that grinds grain and never tires.

### node
- id: copper-still
- name: Copper Still
- era: 3
- prereqs: copper-tools, mash-ferment
- skill: brewing rung>=4
- conditions: (none)
- unlocks: structure:still, item:spirits
- desc: Wine's ghost caught in a cooled copper coil — fiercer than any ferment, and useful beyond drinking.

### node
- id: surgery
- name: Surgeon's Craft
- era: 3
- prereqs: bronze, bonesetting, tinctures
- skill: medicine rung>=4
- conditions: (none)
- unlocks: verb:surgery, item:surgeons_kit
- desc: Fine bronze blades, boiled thread, and steady nerve — mending done under the skin.

### node [SOCIAL]
- id: stamped-tokens
- name: Stamped Tokens
- era: 3
- prereqs: copper-smelt, tally-ledger
- skill: smithing rung>=3
- conditions: at least 40 debts recorded in a ledger and still outstanding
- unlocks: institution:currency, item:stamped_token
- desc: Little copper rounds struck with the town's mark — a promise you can hand to a third person.

### node [SOCIAL]
- id: law-stone
- name: Written Law
- era: 3
- prereqs: meeting-circle, parchment
- skill: scholarship rung>=3
- conditions: at least 3 disputes judged before witnesses
- unlocks: institution:written_law, item:law_scroll
- desc: The rules the circle keeps reaching anyway, written down once so they stop depending on who is shouting.

### node [SOCIAL]
- id: market-day
- name: Market Day
- era: 3
- prereqs: tally-ledger
- skill: scholarship rung>=3
- conditions: population at least 8, and at least 50 completed exchanges between residents
- unlocks: institution:market_day, structure:market_stalls
- desc: One fixed morning when everyone brings their surplus to the same ground, and haggling becomes a festival.

---

## ERA 4 — Essences (chemistry, physic, paper, powder)

### node
- id: lye-works
- name: Potash and Lye
- era: 4
- prereqs: charcoal-clamp, fired-pottery
- skill: brewing rung>=3
- conditions: (none)
- unlocks: item:lye, item:potash
- desc: Water dripped through hardwood ash comes out slick, caustic, and strangely eager to work.

### node
- id: soap
- name: Soap Boiling
- era: 4
- prereqs: lye-works, dairy
- skill: medicine rung>=3
- conditions: (none)
- unlocks: item:soap, doctrine:wound_infection_rolls_down
- desc: Fat and lye boiled to a cake that lifts filth from skin and, quietly, death from wounds.

### node
- id: mordant-dyes
- name: Mordant Dyes
- era: 4
- prereqs: lye-works, linen
- skill: tailoring rung>=4
- conditions: (none)
- unlocks: recipe:dyed_cloth
- desc: Madder red and weld yellow fixed fast in the fiber — cloth that finally keeps its promises through washing.

### node
- id: apothecary
- name: Apothecary Bench
- era: 4
- prereqs: glass-vessels, tinctures
- skill: medicine rung>=4
- conditions: (none)
- unlocks: structure:apothecary_bench, practice:remedy_potency_up
- desc: Glass, measures, and labeled rows — healing moved from a satchel to a science of shelves.

### node
- id: poppy-draught
- name: Sleeping Draught
- era: 4
- prereqs: apothecary
- skill: medicine rung>=5
- conditions: (none)
- unlocks: recipe:anesthetic_draught
- desc: A measured bitter spoonful, and the patient sleeps through what no one should be awake for.

### node
- id: fever-bark
- name: Fever Bark
- era: 4
- prereqs: apothecary, forage-lore
- skill: medicine rung>=5
- conditions: (none)
- unlocks: recipe:febrifuge
- desc: The bitter bark from the wet hollows, properly drawn, breaks fevers that once broke families.

### node
- id: lenses
- name: Ground Lenses
- era: 4
- prereqs: glass-vessels
- skill: art rung>=4
- conditions: (none)
- unlocks: item:ground_lens, item:spectacles
- desc: Clear glass ground on a curve bends light to human purposes — old eyes read again.

### node
- id: far-glass
- name: Far-Glass
- era: 4
- prereqs: lenses
- skill: scholarship rung>=5
- conditions: (none)
- unlocks: item:far_glass
- desc: Two lenses in a tube pull the far bank, the hawk, and the storm-front close enough to study.

### node
- id: seeds-of-sickness
- name: Seeds of Sickness
- era: 4
- prereqs: lenses, bonesetting
- skill: medicine rung>=5
- conditions: (none)
- unlocks: doctrine:contagion_halved_by_boiling_and_washing
- desc: Under the strong lens, pond water is a zoo — and the healer starts boiling everything, on a hunch that holds.

### node
- id: saltpeter-beds
- name: Saltpeter Beds
- era: 4
- prereqs: compost, animal-pen
- skill: farming rung>=4
- conditions: (none)
- unlocks: item:saltpeter
- desc: Dung, ash, and straw nursed under a roof for seasons yield a white crust that crackles in flame.

### node
- id: black-powder
- name: Black Powder
- era: 4
- prereqs: saltpeter-beds, charcoal-clamp
- skill: scholarship rung>=4
- conditions: (none)
- unlocks: item:black_powder
- desc: Saltpeter, charcoal, and the yellow hill-seam ground together — a pinch of thunder that must be treated as a guest, never a servant.

### node
- id: blasting
- name: Mine Blasting
- era: 4
- prereqs: black-powder, mine-adit
- skill: masonry rung>=5
- conditions: (none)
- unlocks: verb:blast, resource:deep_ore
- desc: A drilled hole, a charge, a long fuse and longer sprint — the hill gives up in a morning what picks asked for in years.

### node
- id: rag-paper
- name: Rag Paper
- era: 4
- prereqs: linen, water-wheel
- skill: scholarship rung>=4
- conditions: (none)
- unlocks: item:paper
- desc: Worn-out linen beaten to pulp under the mill hammers and dried in sheets — cheap enough, at last, to waste on thinking.

### node
- id: fired-cement
- name: Fired Cement
- era: 4
- prereqs: mortar, bloomery
- skill: masonry rung>=5
- conditions: (none)
- unlocks: item:cement, practice:waterproof_construction
- desc: Lime and clay burned together set hard even under water — stone the town makes rather than finds.

### node [SOCIAL]
- id: schoolhouse
- name: Schoolhouse
- era: 4
- prereqs: rag-paper, season-calendar
- skill: scholarship rung>=4
- conditions: at least 2 children resident in the town
- unlocks: institution:school, structure:schoolhouse
- desc: A bench, a slate, and the town's decision that every child will read — whatever their parents were.

### node [SOCIAL]
- id: town-archive
- name: Town Archive
- era: 4
- prereqs: rag-paper, law-stone
- skill: scholarship rung>=4
- conditions: at least 100 written documents in existence in the town
- unlocks: institution:archive, structure:archive_room
- desc: Deeds, rulings, ledgers, and letters gathered under one dry roof — the town's memory, fireproofed as best we can.

---

## ERA 5 — Works (engineering, steam, print, spark)

### node
- id: screw-lathe
- name: Screw and Lathe
- era: 5
- prereqs: iron-tools, water-wheel
- skill: smithing rung>=5
- conditions: (none)
- unlocks: item:iron_screw, structure:lathe, practice:precision_parts
- desc: A wheel-driven lathe that cuts true threads — parts that fit other parts, made to match instead of made to fudge.

### node
- id: clockwork
- name: Clockwork Escapement
- era: 5
- prereqs: screw-lathe
- skill: smithing rung>=5
- conditions: (none)
- unlocks: structure:town_clock, item:gear_train
- desc: A toothed wheel let slip one tick at a time — the day cut into equal honest pieces for the first time.

### node
- id: blast-furnace
- name: Blast Furnace
- era: 5
- prereqs: bloomery, fired-cement, water-wheel
- skill: smithing rung>=5
- conditions: (none)
- unlocks: structure:blast_furnace, item:cast_iron
- desc: Wheel-driven bellows and a cement-lined stack run day and night, pouring iron by the trough instead of the fistful.

### node
- id: crucible-steel
- name: Crucible Steel
- era: 5
- prereqs: blast-furnace
- skill: smithing rung>=5
- conditions: (none)
- unlocks: item:steel
- desc: Iron cooked sealed in clay crucibles until it comes out singing — edges that hold and springs that remember.

### node
- id: sealed-boiler
- name: Sealed Boiler
- era: 5
- prereqs: crucible-steel, screw-lathe
- skill: smithing rung>=5
- conditions: (none)
- unlocks: item:sealed_boiler, item:safety_valve
- desc: A riveted steel drum that holds furious steam and, thanks to a small hissing valve, its temper.

### node
- id: steam-engine
- name: Steam Engine
- era: 5
- prereqs: sealed-boiler, clockwork
- skill: scholarship rung>=5
- conditions: (none)
- unlocks: structure:steam_engine, practice:power_beyond_river
- desc: Fire, water, and machined iron breathing in a shed — strength that no longer asks the river's permission.

### node
- id: printing-press
- name: Printing Press
- era: 5
- prereqs: rag-paper, screw-lathe, ink
- skill: scholarship rung>=5
- conditions: (none)
- unlocks: structure:printing_press, practice:documents_copied_cheaply
- desc: Cast letters, a screw, and an inked plate — one afternoon's writing becomes a hundred identical mornings' reading.

### node
- id: amber-spark
- name: Amber and Spark
- era: 5
- prereqs: far-glass, linen
- skill: scholarship rung>=5
- conditions: (none)
- unlocks: doctrine:static_attraction_observed
- desc: Amber rubbed with linen lifts chaff and bites the knuckle with a tiny snap — a power with no name yet.

### node
- id: lightning-jar
- name: Lightning Jar
- era: 5
- prereqs: amber-spark, glass-vessels
- skill: scholarship rung>=5
- conditions: (none)
- unlocks: item:lightning_jar
- desc: A foil-wrapped glass jar that stores the snapping power and gives it back all at once — the strangest thing the town has ever made on purpose.

### node
- id: arch-bridge
- name: Stone Arch Bridge
- era: 5
- prereqs: fired-cement, dry-stone
- skill: masonry rung>=5
- conditions: (none)
- unlocks: structure:stone_bridge
- desc: A cement-set arch over the river fork, keystone last — two banks made one town for as long as stone lasts.

### node [SOCIAL]
- id: ledger-house
- name: Ledger House
- era: 5
- prereqs: stamped-tokens, town-archive
- skill: scholarship rung>=5
- conditions: at least 200 token exchanges recorded
- unlocks: institution:bank, structure:ledger_house
- desc: A strong room and a trusted book where tokens rest and promises earn interest — wealth learning to sit still.

### node [SOCIAL]
- id: town-charter
- name: Town Charter
- era: 5
- prereqs: law-stone, printing-press
- skill: scholarship rung>=5
- conditions: population at least 15
- unlocks: institution:charter, item:printed_charter
- desc: The laws, the offices, and the town's own name, printed and posted for every wall — who we are, agreed to in ink.
