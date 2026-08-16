# San Junipero v1 — core-feature findings ledger

Started 2026-08-16 (post-C10-review discussion). User mandate: v1 is a FINISHED simulation,
not an MVP. Findings class: core features in the world engine, UI, animations, interactions,
visualization. Ops/moderation/scale findings were REJECTED for v1 scope (user ruling) —
except the BudgetGuard reservation race fix, which stays (C9 probe-bug list).
This ledger accumulates; nothing here is scheduled until the user rules on it.

## A. User findings (2026-08-16) — binding direction, expanded by controller

### A1. Full mortality model (user: death ≠ old-age only)
Causes: injury, poison, illness, fatal fatigue, fatal hunger, fatal thirst, murder, old age.
Controller expansion:
- Replace binary alive with `hp` + `afflictions: [{kind, severity, sinceTick}]`.
- Sources: `attack` → injury (severity by tool/weapon); spoiled food eaten → poison
  (ties C9 spoilage — spoilage stops being cosmetic); illness as seeded event w/ proximity
  contagion; repeated unrecovered collapse → fatal fatigue; hunger/thirst clocks → death.
- Murder = injury death with an attacker id in the event → witnessed `agent_died{cause:'slain'}`
  is the justice-emergence seed (no authored punishment — the town decides).
- Recovery arcs: rest, eating, herb item (forageable), a `tend` verb (care for the sick —
  bonds material, healer-role emergence).
- Graves: dead agents leave a grave structure at rest site; grave tone rule already exists.
- Every cause = config dial + enable flag (world-law toggles pattern, admin dashboard).
- Chronicle/narrator: `cause` in agent_died payload, human-framed labels per cause.

### A2. Roads built BY agents (user) + road-adjacent building preference (agreed finding)
- New verb `pave` (or `lay_road`): converts a passable tile to road tile 7; costs stone/gravel;
  requires tool? (shovel). C9 T1b already gives roads path preference.
- Build-site preference: road adjacency enters the build verb's site scoring/prompt context as
  a benefit (haul speed), never a hard rule — emergence, not authoring.
- DESIRE PATHS (controller): track per-tile walk traffic; grass above threshold wears to dirt
  path (auto tile change, engine law); heavily used dirt is what agents will want to pave.
  Trails appear where life actually flows — zero authoring, pure emergence, highly visible.

### A3. Designed genesis town + content pool (user)
Starting settlement (spec §10 upgrade): communal fire pit (social anchor), well, 2–3 starter
huts, storehouse, workshop shed, wagon (lore prop), standing stone (mystery anchor), plaza +
short starter road spine (A2 grows it).
Item pool: founder kits (axe, hoe, knife, seeds, 3 days food, waterskin), communal stock
(timber, stone, rope, cloth), forageables on map (berry bushes, mushroom patches — poisonous
variant ties A1, herbs for healing, clay deposit, stone outcrops).
Fauna pool: see B3.

### A4. Hard collision + real pathfinding everywhere (user)
Engine A* + footprint blocking already exist; the walk-through was renderer interpolation
(fixed 2026-08-16: polyline stepping). Remaining to guarantee:
- Mid-walk replans when a structure completes across an in-flight path.
- Door-tile-only entry (C9 T2) including pathfinding TO the door, not the footprint edge.
- Big-map A* budget: on 128×128, per-intent A* needs a node cap + cached region graph
  (or JPS) before it melts the tick loop.
- Agent-agent: no hard collision (deliberate), but renderer shoulder-offset when two bodies
  share a tile so they never visually merge.

### A5. River/lake (user) → full water system (controller expansion)
- Terrain: river with a fork + a lake (spec §10 already names the forking river — make it real).
- Thirst stat + `drink` verb (river/lake/well) — gives water a survival role, feeds A1.
- Fishing spots (river/lake tiles), fish as food (spoils fast — C9 spoilage teeth).
- Water hauling: bucket/waterskin items; irrigation (watered farmland yields more — fertility).
- BRIDGES: buildable structure = road over water; river splits the map so the first bridge is
  an earned town milestone (chronicle first).
- Firefighting: water + bucket vs fire spread — closes the fire loop with agency.

### A6. Much bigger map, viewport-filling, growable (user)
- v1 baseline 96×96 or 128×128 (vs showcase 48×48); camera bounds + min-zoom fit.
- Growth mechanism: map expansion as a world-law event appending border rows/cols
  (replay-safe, event-sourced — "the world grows as the town does").
- Perf consequences: chunked ground bake (rebake only dirty chunks), A* caps (A4),
  entity culling outside viewport.

### A7. Social constructs: emerge naturally → arbiter labels (user, 2026-08-16 — KEYSTONE)
User verbatim intent: politics, religion, festivals, gatherings, parties "and more" occur
naturally, then get LABELLED by the arbiter → observer dynamic "agents held their first
festival and called it XXX". Give agents the TOOLS to achieve this.
Controller expansion (spec'd into C11 addendum, messaged to the spec author):
- TOOLS half: time awareness + persistent planned intentions (planning requires shared future
  reference); expressive novel verbs via arbiter adjudication (dance/sing/pray — the
  accepted-ITEMS law generalized to accepted-VERBS: no-mutation expressive verbs are cheap
  approvals, enter a global list); ritual items via existing generative-items law; existing
  speak/give/teach/inscribe + genesis gathering anchors.
- ARBITER half: construct recognizer over the event stream (recurrence of co-location +
  expressive acts + shared speech tokens + offerings + deference) → registry
  {type, name|null, anchor, participants, firstTick, recurrences}. NAMING LAW: the name comes
  ONLY from agents' own speech/inscriptions (arbiter recognizes TYPE, town coins NAME;
  unnamed stays unnamed). ONE-WAY GLASS: taxonomy never enters agent prompts — labels never
  cause behavior. Events construct_recognized/named/recurred (agent-invisible), config dials.
- Subsumes B5.2 gathering detector (moves from presentation-side to arbiter-side; C12 renders).
- C12: Society lens Constructs panel (name + provenance quote), high-weight "first <construct>"
  chronicle entries in the observer voice, prime share-card material.
- This is the arbiter's PRODUCTION JOB — the C4 god-layer stops being only an item/verb judge.
- EXTENSION (user, same day): detect "literally ALL the milestones any society could have" —
  three-tier milestone framework: Tier 1 engine firsts (direct events: first harvest, first
  birth, first death per cause, first bridge, first invented item/verb, first winter survived…);
  Tier 2 pattern firsts (rules over events/relationship rows: first friendship, first fight,
  first relationship, first BREAKUP (needs dissolution semantics in C9 T11/12 — declared
  interface requirement), first affair, first orphan, first grandparent…); Tier 3
  arbiter-judged construct firsts (first festival, first WEDDING (ceremony ≠ partnership),
  first funeral, first council, first market, first song/dance, open-ended 'custom' type).
  One registry (extends C7 firsts ledger), every milestone = high-weight chronicle entry in
  observer voice + share card + C12 Milestones panel with jump-to-moment. Naming law +
  one-way glass apply at all tiers.

## B. Controller findings — same class, new (brainstorm sweep 1)

### B1. Engine systems
1. **Warmth/cold**: seasons+weather exist but have no teeth — cold nights drain energy unless
   near hearth/indoors/clothed → clothing craft line (also visual variety on sprites).
2. **Light**: night darkness is real; torches/lanterns/hearth glow = safety + fire-risk
   tradeoff; working at night needs light.
3. **Food variety**: bread/fish/berries/meat/stew with mild variety benefit → cuisine and
   shared-meal emergence (fire pit anchor).
4. **Forest regrowth law**: saplings regrow chopped forest slowly — wood scarcity cycles
   instead of one-way deforestation death.
5. **Farmland fertility gradient**: yield scales with water proximity/irrigation — location
   value, land disputes, irrigation projects.
6. **Huntable/ambient fauna split**: engine fauna = simple non-LLM wander entities (deer,
   rabbit, fish) that flee/get hunted/fished; ambient fauna = renderer-only (birds, butterflies,
   fireflies). Domestication (chickens/goats, pens) = v1.x candidate, not v1.

### B2. Animation & visualization
1. **Work animations**: till-swing, chop, build-hammer, fishing cast, EAT, sit, talk gesture —
   the town reads as alive only when hands do what the log says. Carry pose with the held item
   VISIBLE is the single highest-value one.
2. **Construction stages**: planned → stakes/outline → frame/scaffolding (asset exists) →
   complete; no building pop-in.
3. **Crop stage art**: 4 visible growth stages on farmland.
4. **Particles**: chimney smoke, footstep dust, rain splash, fireflies, seasonal leaves,
   fire sparks, fishing splash — all presentation-side, tone-director-governed.
5. **Day-night grading**: dawn/dusk color ramps, longer directional shadows by sun position
   (stretch the blob), interior warm light spill from windows at night; storm grading FIXED
   (cap desaturation — never grey-out; the complaint that started this).
6. **Water animation**: flow shimmer on river, lake glints; wind sway on trees/crops.
7. **Weather extras**: lightning flash, snow (seasons), dawn fog.

### B3. UI & interaction
1. **Inspector depth**: hunger/energy/health/warmth bars, inventory grid with item icons,
   skills, current doing in human framing, portrait wired to MOOD (expression portrait sets
   already exist — 7 expressions, unused in UI!), relationship summary.
2. **Family trees**: once reproduction lands, a lineage/genealogy panel — households, kin
   lines; the generational payoff view for long-run viewers.
3. **Minimap** + camera bookmarks (plaza, river, my-followed-agent) for the big map.
4. **Map overlays as lenses**: ownership tint, farmland fertility, foot-traffic heat
   (the desire-path data doubles as viewer candy).
5. **Ambient audio**: birdsong/crickets/rain/hammering/river — Web Audio, sprite-based,
   off by default toggle. Cheap, transformative for "finished" feel.
6. **Conversation staging**: talking agents turn to face each other, alternate bubble timing;
   groups form loose circles (renderer-side placement nudges only).
7. **Selection affordances**: hover outline recolor + selected ring on any clickable thing
   (chars, buildings, items, crops, fauna).

### B4. Mobile + shareability (user RE-ACCEPTED 2026-08-16 — in v1 scope, "amazing experience" bar)
1. **Touch-first stage**: one-finger pan, pinch zoom (integer-snap), double-tap to follow a
   character, long-press = hover (name tags/popovers need a touch equivalent — hover doesn't
   exist on phones, so every hover affordance gets a tap/long-press twin).
2. **Portrait layout**: lenses as a bottom sheet (swipe up over the stage), lens bar as a
   thumb-reach bottom tab row, timeline as a compact scrubber; inspector as a card sheet, not
   a side panel. Landscape = current desktop-ish layout.
3. **Touch hit targets**: 44px minimum everywhere (the 52×72 character hit rect already
   clears it; UI chips/tabs must too).
4. **Performance on phone**: pixel art is cheap — but cap devicePixelRatio work, halve
   particle budgets on coarse pointers, and keep 60fps on a mid-range phone as a G-gate line.
5. **PWA**: installable, standalone display, app icon from the pixel art, safe-area insets —
   the town on a home screen.
6. **Share cards**: `/moment/<id>` and `/agent/<id>` links render OG/Twitter preview images
   (server-side postcard render: day stamp + cast + a framed pixel scene) — a shared moment
   must look gorgeous in a chat thread. Add a "share this moment" button (native share sheet
   on mobile, copy-link on desktop).
7. **Spectate ergonomics**: wake-lock toggle while watching; "what happened while you were
   away" recap card on return (C7 digest reuse).

### B5. Controller sweep 2 (2026-08-16, while fix agents ran)
1. **Emergent toponyms**: `inscribe` at a location can name a PLACE ("the Ford", "Omar's
   Field"); the map renders emergent labels once a name is inscribed and adopted (repeated in
   speech). The town literally writes its own map — zero authoring, huge viewer payoff.
2. **Gathering detector** (presentation-side): ≥N agents co-located at leisure → chronicle
   candidate + moments seed. Festivals/funerals/markets get DETECTED, never scheduled.
   Pairs with graves + inscribe: funerals become possible without a funeral system.
3. **Seasonal terrain states**: river freezes in winter (crossable ice — the map's topology
   changes seasonally!), snow-covered tiles, mud after rain (slower walk). Engine terrain
   modifiers, replay-safe, visually dramatic.
4. **Visible stockpiles**: wood stacks/grain sacks that grow with stored count — the town's
   wealth readable at a glance from the map, no UI needed.
5. **Building wear/patina**: structures weather visually with age and hp — history you can
   see. Repair verb already implied by roof-patch episode; wear makes repair legible.
6. **Night sky**: stars + MOON PHASES on the night grade — a free calendar the minds may
   independently start using for timekeeping vocabulary (emergence hook, cheap visual).
7. **Per-character bubble identity**: subtle per-agent bubble tint/glyph so regular viewers
   recognize who's talking before reading the name.
8. **Accessibility as core UI**: colorblind-safe lens palettes, captions/transcript toggle for
   ambient audio, prefers-reduced-motion already law — extend to particles.
9. **Town history page**: C7 chapters concatenated into a scrolling "story so far" — the
   shareable lore artifact for new viewers (pairs with B4 share cards).

### A8. Twitch-ready + study-of-LLMs framing (user, 2026-08-16 evening — REFINEMENT MANDATE)
User intent: end product genuinely fun to observe, Twitch.tv-ready, viral-sensation grade,
journal-publishable study of LLMs in a near-real-life simulation. Named asks: interactive
colorful Town view; character bar with auto-follow + mood/activity status icons; viral-moment
capture ("first thought about god", "haggling then night theft"); vision-LLM asset QA
(google/gemini-3.7-flash); interiors; prebuilt good city template; proper grid alignment +
path creation; wide premade item/furniture pool + agent-made items.

Controller expansion — the six systems this decomposes into:

**A8.1 Thought-stream science (the study core).** Thoughts are the product's goldmine and
today they're only bubbles + inspector. Add: (a) "Inner Voices" live feed lens — scrolling
selected thoughts town-wide, filter by agent/concept; (b) CONCEPT-EMERGENCE DETECTOR (tier
2.5 of the milestone framework — semantic firsts detected by an ops-side LLM pass over
speech+thought transcripts): first thought about god/afterlife, first fear of death, first
expression of love, first justice/fairness claim, first JOKE, first metaphor, first LIE
(agent's speech contradicts its own thought/memory — detectable because we hold both sides
of the glass; drama + study gold), first plan spanning days, first mention of the past
("remember when"). Naming law + one-way glass apply; every hit = milestone + share card.
(c) Emergent-lexicon panel: coined words (toponyms, construct names, novel recurring
n-grams) with adoption curves across speakers.

**A8.2 Story arcs.** C7 scenes are day-bound; viral stories span days ("haggled at noon,
stole at night, confronted at dawn"). Arc detector (narrator-side): thread events sharing
participants+objects+places across days into named storylines (feud, courtship, project,
crime) with episode lists; Storylines lens + arc recap cards; arcs feed the director's heat.
MECHANICAL PREREQ (engine): night-witness coupling — witness radius for `item_taken`/`attack`
must depend on darkness + light sources (C11 light system) so night crime is actually
possible and lanterns actually deter. Without it the user's viral theft story cannot happen.

**A8.3 Broadcast layer (the Twitch product).** A zero-interaction mode that is always
showing the most interesting thing WITH context: auto-directed camera (C6 director heat +
arcs), lower-third narrator captions, chronicle ticker crawl, ambient audio, auto
picture-in-picture for simultaneous drama; attract-mode (idle N min → broadcast). CHARACTER
DOCK (user ask): bottom bar of featured villagers — portrait bust + MOOD glyph (the unused
7-expression portrait sets, driven by afflictions/needs/recent events) + activity icon +
name; click chip → follow-cam; auto-rotation by heat. CLIP EXPORT: in-browser WebM/GIF
capture of a moment/scrub-range with caption overlay — the shareable clip is the viral
mechanic (share cards are the still version).

**A8.4 Study instrumentation (journal-grade).** Replication package export: seed + full
config + model IDs + event log + prompt/response transcripts + relationship rows + construct
registry as one downloadable archive (CSV/JSONL) — reproducibility is what journals will ask
first. Metrics panels (viewer-visible, not ops): social-network density over time (bonds
graph timelapse scrubber), vocabulary growth curve, norm-adoption curves (accepted
verbs/items over time), movement/territory heatmaps per agent. Memory inspector tab: what
does Omar remember (viewer-side read of his memory store; one-way glass is about injection,
not display). Conversations lens: threaded dialogue transcripts.

**A8.5 Content Forge (asset pipeline upgrade + content library).**
(a) VISION-QA GATE: every generated asset passes a structured vision-LLM rubric
(google/gemini-3.7-flash via OpenRouter) against the style bible — palette compliance,
single-figure, transparency, proportion/pitch, facing correctness, detail-density score vs
Omar reference — with auto-retry + feedback loop; human eyeball remains final only for
masters. (Would have auto-caught: Amara density, Nadia facing, standing-stone patch.)
(b) PREMADE LIBRARY: 40–60 items with world sprite + inventory icon: tools, foods,
materials, ritual objects, and FURNITURE (bed, table, chair, bench, shelf, crate, barrel,
rug, hearth, lantern, loom, anvil…) — interiors need real furniture art, not placeholders;
god-layer agent-invented items generate on demand through the SAME pipeline + vision gate.
(c) CITY TEMPLATE: upgrade showcase map to a genesis city — districts (homes, market
square, farm belt, riverfront), 8–12 prebuilt buildings WITH furnished interiors, road grid,
empty plots for growth. (d) GRID/ALIGNMENT: automated alignment validator (building feet vs
footprint diamond, pixel + vision check) killing the "unnatural placement" class; road
AUTOTILING (dimetric connection set: straight/corner/T/cross) so paths read as paths.

**A8.6 Deliberate non-features (drama preservation).** No paired atomic `trade` verb —
exchange stays give+speech, so trust asymmetry (and betrayal) exists; haggling and
theft-after-a-deal are possible BECAUSE trade requires trust. Logged so nobody "fixes" it.

Chunk placement (pending ruling): A8.2 night-witness + A8.1 detector hooks → C11; A8.1
lenses, A8.2 Storylines, A8.3 broadcast+dock+clips, A8.4 panels/export → C12; A8.5 →
proposed NEW parallel lane C13 "Content Forge" (pipeline + content, can run alongside
C9/C10 like the old asset lane).

## C. Cross-cutting notes
- Every new engine system: config section + enable flag + world-law toggle (admin dashboard +
  viewer World Laws panel) — established C9 pattern.
- Every new event type: chronicle weight/icon/label + narrator vocabulary + humanizer framing.
- Everything above obeys the emergence law: mechanics and costs, never goals or morals.
- Sequencing reality: A1/A5/A6 + B1 are engine (C9-family scope); A2/A3 + B3 straddle;
  B2 + most of B3 are presentation (C10-family scope). Re-chunking proposal pending user
  ruling — current C9 (32 tasks) and C10 (12 tasks) do NOT absorb this without a new chunk
  or two; controller recommends: C9 as approved → C10 as approved → C11 "Deep World"
  (engine: A1 A2 A5 A6 B1 fauna) → C12 "Deep Presentation" (B2, B3, A3 art pool) → C8 → v1.

## D. Rulings + open questions
RULED (user, 2026-08-16): D1 map = **128×128** baseline. D2 fauna = **huntable engine fauna
+ ambient**. D4 thirst = **survival clock** (config-dialed, slower than hunger). D6 chunk
shape = **C11 "Deep World" + C12 "Deep Presentation"** after C9/C10 (mobile+share in C12).

RULED (user, 2026-08-16 evening, A8 round): broadcast layer = CORE v1 (C12); clip export =
WebM + GIF; asset work = NEW PARALLEL CHUNK C13 "Content Forge" (gate G13: vision-QA pass
rate + human eyeball on library sheet); study instrumentation = FULL PACK in v1 (export +
panels).

STILL OPEN:
3. Audio in v1: yes/no? (controller default if unruled: yes, off-by-default toggle)
5. Illness contagion on/off at genesis (plague arcs are dramatic but can wipe a young town)?
   (controller default if unruled: on, low dial, world-law toggle)
6. Chunk shape: accept C11/C12 split above (B4 mobile+share lands in C12), or fold into
   expanded C9/C10?
7. Share-card renderer: pixel postcard composition (cheap, stylized) or true scene snapshot
   (headless render of the actual moment — heavier, more wow)?
