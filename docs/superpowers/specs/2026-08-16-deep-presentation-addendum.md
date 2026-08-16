# San Junipero — Spec Addendum: C12 "Deep Presentation"

**Date:** 2026-08-16
**Status:** DRAFT — pending user review. Extends the root spec (`2026-08-15-san-junipero-design.md` §7/§8/§15), the C10 plan (`2026-08-16-10-presentation.DRAFT.md` — C12 builds on its surfaces, duplicates none of its tasks), and consumes the C11 addendum (`2026-08-16-deep-world-addendum.DRAFT.md`).
**Chunk order:** after C11, before C8. Mobile + shareability are **IN scope** (user re-accepted 2026-08-16, "amazing experience" bar).
**Scope authority:** v1-core-findings-ledger.md §B2 + §B3 + §A3 (art half) + §B4 in full, under the §D rulings — plus the C12 consequences of the social-constructs + milestones ruling of 2026-08-16 (C11 §10; rendered here in §16).
**Level:** SPEC — systems, interfaces, config, gate outline. Task plan follows C9/C10 landing.

**The philosophy in one sentence: C11 makes the world true; C12 makes it *felt* — on a desk, on a phone, and in a chat thread — without ever writing a byte of world state.** Read-only by construction (spec §8); presentation-only viewer-side randomness (C6 Task 14 law); living-documentary law (no points, quests, leaderboards, meters); human framing in every string; tone rule everywhere (grave scenes go still — and, if audio ships, quiet).

---

## 1. Consumed C11 interfaces (binding; mirrors C11 addendum §16)

**Events (world):** `tile_changed`, `world_grown`, `agent_harmed`, `agent_afflicted`, `affliction_worsened`, `affliction_recovered`, `agent_tended`, `grave_placed`, `agent_drank`, `item_filled`, `fire_extinguished`, `item_equipped`, `item_unequipped`, `item_lit`, `item_snuffed`, `item_burned_out`, `structure_fueled`, `fauna_spawned`, `fauna_moved`, `fauna_killed`, `forageable_spawned`, `forageable_depleted`, `forageable_regrown`, `agent_expressed`, `agent_died.cause/byId`.
**Events (ops-plane):** `construct_recognized`, `construct_named`, `construct_recurred`.
**State/types:** `AgentBody.hp/thirst/afflictions/equipped`, `WorldState.fauna/forageables/traffic`, `TileId 8|9|10`, `FaunaKind`, `ForageableKind`, `AfflictionKind`, `DeathCause`, structure kinds `well|bridge|fire_pit|grave`, `ConstructSchema`, `MilestoneRow` (tiered extension of C7 milestones).
**Pure functions/consts:** `fertilityAt`, `CHUNK_TILES`, `chunkOf`, widened `terrainCostFor`.
**Chronicle:** C11's weight/icon/label rows + weight-16 observer-voice construct/milestone entries (already in the shared tables — C12 renders, does not redefine).
**Data surfaces C12 owns over C11 data:** `/api/overlays/traffic`, `/api/constructs`, `/api/milestones` extended shape (tier/domain/provenance, additive on C10's).
From C9: `insideId`, `co_slept` partnership, `agent_born.parents`, ownership fields, World Laws panel pattern. From C10: tileset/bake pipeline, `ChroniclePanel`, `BondDetailPanel`, `MomentsLens`, `hoverLabel`, `StatusStrip`, `/moment/<id>` route, postcard thumbnail.

### A8 amendment additions (2026-08-16 evening ruling round — identical block in C11 §16 and C12 §1)

**Pure functions/consts (`@sj/shared`):** `lightLevelAt`, `visionRadiusAt`, `LIGHT_GLOW_RADIUS` (C11 §19 — C12 renders glow pools and dark-vignette from the same constants the physics uses).
**Perception field (agent-visible, diegetic):** perception packet `light: 'bright'|'dim'|'dark'` (C11 §19).
**Config (world-law, `TOGGLABLE_PATHS`):** `nightWitness.enabled` / `nightWitness.nightFactor` / `nightWitness.duskFactor`, `light.glowRadius.{torch,lantern,hearth,fire_pit}`.
**Ops-plane rows/types (narrator DB):** `semantic_first_detected` (`SemanticFirstRow`, C11 §20), `semantic_candidates`; `MilestoneRow.tier` widened to `1|2|2.5|3`; `arcs` + `arc_episodes` tables (`ArcRow`, `ArcEpisodeRow`, C12 §27); `lexicon` rows (`LexiconRow`, C12 §28).
**Ops config (narrator/gateway-side, not world-law):** `semanticFirsts.*` (C11 §20), `arcs.*` (C12 §27), `lexicon.*` (C12 §28), `study.publicData` (C12 §29), `broadcast.*` (C12 §25).
**Endpoints/routes (C12-owned, read-only):** `/api/arcs`, `/api/lexicon`, `/api/conversations`, `/api/agents/<id>/memory`, `/api/agents/<id>/heatmap`, `/api/study/export` (admin-token), `/data` (public study page, flag-gated), `/broadcast` route.
**Viewer contracts:** character-dock mood-derivation table over the 7-expression portrait sets (C12 §25, extends §11 `moodOf`); clip export WebM+GIF (C12 §26, ruled).
**C13 parallel-lane shared additions (manifest/schema only — C13 addendum):** `TilesetManifest.autotile` block (15-tile dimetric road connection set) + `roadAutotile(neighbors)` pure fn (`@sj/shared`); `FurnishingKind` widened by the furniture library + codex `meta.interior` placement fields (consumed by C10 T10/T11).

## 2. Work animations + visible carried items (ledger B2.1)

Paper-doll rig rows (the base-spec honest exception — composed, never generated), one new sheet row per action family, driven by a pure `animFor(agentState, currentAction) → AnimKey` mapping in `@sj/web`:

| Action family | Anim | Notes |
|---|---|---|
| till/plant/dig_channel | till-swing | shared row; tool sprite overlaid from held item |
| chop | chop | squash-and-stretch per Style Bible |
| build/pave/craft | hammer | |
| fish | cast + idle-bob | splash particle on resolve (§5) |
| eat/drink | eat | cup variant when `agent_drank` |
| sit (fire pit / idle social) | sit | loose-circle staging §13 |
| talk | talk gesture | alternates with bubble timing §13 |
| tend | kneel | grave tone exempt-from-cartoon rule applies |
| **carry** | carry pose + **held item sprite rendered in-hands** | the single highest-value row (ledger); item icon atlas §10 doubles as the carried-sprite source |
| hunt | lunge | |
| sleep | lying (exists) | unchanged |

Equipped garments (`item_equipped`) render as paper-doll clothing layers — C11's clothing line is visible variety for free. All rows tone-director-governed.

## 3. Construction stages (ledger B2.2)

No building pop-in: structure render keyed off build progress fraction — `planned` (ground stakes + outline decal) → `frame` (scaffolding asset — exists) → `complete` (final art). Thresholds exported consts (`STAGE_FRAME_AT = 0.4` etc.). Applies to every buildable kind including C11's `well` and `bridge` (bridge stages render over water). Purely a render mapping over existing structure state; zero engine change.

## 4. Crop stage art (ledger B2.3)

4 visible growth stages on farmland, from the crop's stage state; discovery crops already get a 4-stage sheet in one generation (spec §7) — C12 wires base crops to the same convention and renders stage + `fertilityAt` lushness tint (subtle, palette-law compliant). Hover label (C10 `hoverLabel`) already carries stage text.

## 5. Particle system (ledger B2.4) — tone-director-governed

One budgeted particle engine (`packages/web/src/render/particles.ts`), viewer-side RNG only, hard budget `PARTICLE_BUDGET` (default 400 sprites; **halved on coarse pointers**, §17):

chimney/fire_pit smoke (while `structure_fueled`), footstep dust, rain splash, fire sparks + `fire_extinguished` steam puff, fishing splash, seasonal falling leaves, fireflies at dusk (summer), snow (§8). Every emitter registers with the tone director: grave tone → all emitters suppressed (renderer goes still — Style Bible law). Emitters attach to events/state from §1; nothing is invented.

## 6. Atmosphere: day-night grading, directional shadows, storm fix (ledger B2.5)

- **Dawn/dusk ramps:** the multiply-quad tint (spec §15) gains an authored 24-point color ramp (golden dawn, deep blue night with warm window glow — Style Bible atmosphere table made continuous). Exported const table, no RNG.
- **Directional shadows:** the character/structure shadow blob stretches and rotates by sun position — pure function `shadowFor(timeOfDay) → {scaleX, skew, alpha}`; long at dawn/dusk, tight at noon, off at night (lamplight pools instead, below).
- **Night light:** lit sources from C11 (`item_lit` torches, `structure_fueled` hearth/fire_pit, hut windows when occupied at night) render warm radial glow pools; interior warm spill from windows.
- **STORM GRADING FIX (the complaint that started this):** the storm `ColorMatrixFilter` caps desaturation at `STORM_SATURATION_FLOOR = 0.75` and shifts hue toward grey-green (Style Bible) instead of grey-out. **Never grey-out** — asserted in G12 with a saturation measurement on a storm-frame capture.

## 7. Water shimmer, wind sway, weather extras (ledger B2.6/B2.7)

River flow shimmer (scrolling highlight mask over water chunks, direction from the river's authored flow), lake glints, wind sway on trees/crops (vertex tilt oscillation, amplitude by weather wind), lightning flash (one-frame screen flash + delayed rumble if audio ships — tone-suppressed), snow particles in winter, dawn fog (low-alpha scrolling bands, burns off by mid-morning). All viewer-side, all deterministic-optional (viewer RNG allowed), all budget-capped.

## 8. Chunked ground + big-map rendering (C11 §9 contract)

C12 implements the consumer half of the C11 chunk contract: ground baked per 32×32 chunk (`CHUNK_TILES`/`chunkOf`), rebake only chunks dirtied by `tile_changed`/`world_grown`; new tile art for `path`(8), `sapling`(9), `channel`(10) extends C10's `TILE_KIND`/painter (4 variants each, same palette law). Viewport entity culling (agents/fauna/forageables/particles outside view + margin skip render). Camera bounds + min-zoom fit derive from live map size and update on `world_grown`. C10's single-bake `rebakeGround` is superseded here; everything else in C10's ground pipeline stands.

## 9. Ambient fauna — renderer-only (ledger B1.6 delegation, ruling D2)

Birds (flocks that scatter when the camera or an agent nears), butterflies over meadow/farm chunks, fireflies at summer dusk. **Never in world state, never evented, never hashed** — pure viewer-side sprites with viewer RNG (C6 Task 14 law), tone-suppressed, culled, budget-capped, halved on phones. Explicitly the other half of C11 §4's split; huntable fauna render from `fauna_*` events instead.

## 10. Art pool — the C5-pipeline half of C11's genesis content (ledger A3)

Commission list through the existing forge pipeline (Style Bible enforced; sim never blocks on art — placeholders stand in):
- **Structures:** well, bridge (over-water variants), fire_pit (lit/unlit), grave (the tone-rule object — modest, no cartoon), wagon polish, standing stone polish.
- **Terrain:** path/sapling/channel tile sets (code-painted first per C10 Task 1 convention, forge-upgraded later).
- **Fauna sprites:** deer/rabbit (idle/walk/flee), fish-school water shadow; ambient birds/butterflies/fireflies (tiny, few frames).
- **Items + icon atlas:** every C11 item (waterskin, bucket, torch, lantern, herb, hide, cloth, garment, venison, rabbit_meat, stew, pale/field mushroom, clay, rope…) at 16–24 px **plus a 16 px icon variant** — one atlas feeds the inspector inventory grid (§11), carried-item rendering (§2), and share cards (§18).
- **Forageable nodes:** berry bush (full/picked), mushroom patches (the pale variant looks *almost* the same — the art must not label the danger; knowledge is the town's), herb patch, clay deposit, stone outcrop.
- **Paper-doll layers:** garment layer set per age band.

## 11. Inspector depth (ledger B3.1)

The agent inspector (C6 surface, C10-polished) gains:
- **Bars:** hunger, thirst, energy, warmth, health (hp) — palette-colored, no numbers by default (documentary, not HUD; exact values on hover/long-press). Afflictions listed in human framing ("feverish", "a wounded leg" — a pure `afflictionPhrase(kind, severity)` map; banned: "severity", "hp").
- **Inventory grid** with §10 icon atlas + ownership marks (C9 §2 names).
- **Skills** as plain phrases ("a practiced hand at fishing") — never numeric levels; **current doing** in human framing (existing translation layer).
- **Mood-wired expression portraits:** the 7-expression portrait sets exist unused. A pure `moodOf(agentState, recentEvents) → Expression` (viewer-side: body state + last-N chronicle-weighted events involving the agent; exported thresholds) drives which portrait renders — inspector and hover cards. No engine mood stat is added; this is presentation inference, labeled as such in code.
- **Relationship summary:** top bonds from `/api/bonds` (C10 contract) inline.

## 12. Family trees / lineage panel (ledger B3.2)

New inspector tab + society-lens subview: genealogy derived from `agent_born.parents` (C9) and partnership inference (`co_slept` ledger via `/api/bonds` kind `partner`/`kin`). Renders kin lines, households (who co-sleeps where), generations. Gateway gains **`/api/lineage`** (read-only scan of `agent_born` + bonds; typed empty until the first birth). Detection-display only: the panel never names "families" beyond kin facts; surnames appear only if the town invents them (narrator detection).

## 13. Conversation staging + selection affordances (ledger B3.6/B3.7)

- **Staging (renderer-side placement nudges only):** talking agents turn to face each other; bubble timing alternates; ≥ 3 participants drift into a loose circle (sub-tile render offsets — world coordinates untouched); C9's shoulder-offset for shared tiles (A4) is honored.
- **Selection affordances:** hover outline recolor + selected ring on every clickable — characters, buildings (incl. graves/wells/bridges), items, crops, fauna, forageables. Extends C10 Task 5's hover/name-tag layer with the new entity classes; same `hoverLabel` contract, new cases ("a deer", "a berry bush, picked bare", "\<Name>'s grave").

## 14. Minimap + bookmarks (ledger B3.3)

128×128 needs orientation: a corner minimap (1 px/tile canvas, downscaled from chunk bakes; dirty-chunk refresh; viewport rectangle; click-to-jump), resizing on `world_grown`. Camera bookmarks: plaza, river/first bridge, followed agent + user-set slots (localStorage). Fauna/agents render as single-pixel dots by class color — palette hexes, no gamification iconography.

## 15. Map overlays as lenses (ledger B3.4)

Three toggleable tint overlays over the world canvas (documentary lenses, not game UI):
- **Ownership** — structure/item owner tint (C9 §2 data, client-side).
- **Fertility** — `fertilityAt` heat computed client-side over terrain (no endpoint).
- **Traffic heat** — the desire-path counters; gateway gains **`/api/overlays/traffic`** (read-only grid snapshot; C12-owned endpoint over C11's `WorldState.traffic`). The same data that wears paths is viewer candy — you watch the town's habits ahead of the dirt.
Overlay legends in human framing ("well-trodden", "rich soil near water").

## 16. Constructs & Milestones — the town's own words (C11 §10 consequences, ruled 2026-08-16)

C12 **renders** the recognizer and the milestone framework; it detects nothing (detection is arbiter/narrator-side — the ledger's presentation-side "gathering detector" is subsumed there).

- **Constructs panel** (Society lens subview, from `/api/constructs`): per construct — type, the agent-coined name **with its provenance quote rendered verbatim** ("they call it *the Ember Nights* — 'come back for the ember nights,' Salma said, Day 34"), participants (portrait chips → inspector), anchor place, first/latest occurrence, and **jump-to-moment** (scrub deep-link to `firstTick` / any recurrence). Unnamed constructs render exactly as ruled: "a gathering not yet named" — never a placeholder name, never the taxonomy word alone as if the town said it.
- **Milestones panel** (from the extended `/api/milestones`): filterable by tier/domain (body, craft, town, kinship, culture…), each row = observer-voice label + day + jump-to-moment. Tier-3 rows carry the provenance quote when named.
- **Chronicle:** construct/milestone firsts render at weight 16 in the observer dynamic — "The town held its first festival — they call it \<name>." / "The town held its first wedding — they call it a \<their word>." Unnamed: "…a ceremony not yet named." The banned-vocabulary scan extends: viewer copy never presents a taxonomy type as the town's own word unless provenance exists.
- **Share cards:** construct and milestone firsts are prime share material (§18) — the OG card for a milestone moment carries the observer-voice line and (tier 3) the coined name. `/moment/<id>` deep links from the panels are the share handles.
- **One-way glass:** display-only; nothing here writes anywhere, and no viewer surface leaks back to minds by construction.

## 17. Mobile — touch-first stage + portrait layout (ledger B4.1–B4.4, IN scope, ruled)

| Concern | Spec |
|---|---|
| Touch stage | One-finger pan; pinch zoom with integer-snap (pixel law); double-tap a character → follow; **long-press = hover twin** — every hover affordance (name tags, popovers, bar values, overlay legends) has a long-press equivalent; hover-only UI is banned by test (an affordance registry pairs each hover handler with its touch twin — G12 asserts the registry is total). |
| Portrait layout | Lenses as a **bottom sheet** (swipe up over the stage; peek/half/full detents — a pure `sheetReducer` state machine, unit-tested); lens bar as a thumb-reach bottom tab row; timeline as a compact scrubber above the tab row; inspector as a card sheet, not a side panel. Landscape ≈ desktop layout. |
| Hit targets | 44 px minimum everywhere; the 52×72 character hit rect already clears it; all chips/tabs/legend swatches audited (G12 automated CSS/DOM scan). |
| Phone performance | Cap `devicePixelRatio` work at 2; **halve particle + ambient-fauna budgets on coarse pointers**; culling (§8) mandatory. **60 fps on a mid-range phone is a G12 gate line.** |
| PWA | Installable: manifest (name, pixel-art icon set, `display: standalone`, theme color from palette), service worker caching the app shell only (never world data — the socket is the truth), safe-area insets respected by the sheet/tab layout. The town on a home screen. |
| Spectate ergonomics | **Wake-lock toggle** (Screen Wake Lock API, off by default, released on hide); **away-recap**: returning after ≥ 1 sim-hour absent (visibility/socket-gap detection) shows the "while you were away" card — C7 digest reuse (C6 shell, C7 content), one tap to dismiss or to open the full digest. |

## 18. Shareability (ledger B4.6)

- **Share cards:** `/moment/<id>` (C10 route) and **new `/agent/<id>`** share route render OG/Twitter preview images server-side: gateway `GET /og/moment/<id>.png`, `/og/agent/<id>.png` — composed with `sharp` from palette, pixel frame, day stamp, cast/portrait, location motif (+ scene per the ruling below). Deterministic per (id, day), cached on disk. A shared moment must look gorgeous in a chat thread.
- **Share button:** on moments, agents, and the current view — native share sheet on mobile (`navigator.share`), copy-link on desktop. Human-framed copy ("Share this moment from San Junipero — Day 41").
- Card renderer style: **PENDING USER RULING, §20.**

## 19. OPEN QUESTION — ambient audio in v1 (PENDING USER RULING) (ledger B3.5)

| Option | Behavior | Cost/risk |
|---|---|---|
| **A. Yes, off-by-default toggle (controller default)** ◀ | Web Audio sprite player; small authored CC0/synthesized set: birdsong (day/meadow), crickets (night), rain, river proximity, hammering during builds, fire crackle at the fire_pit; tone director mutes on grave scenes; volume + mute persisted (localStorage); autoplay-policy safe (starts only on user gesture) | ~1 task + asset curation; transformative for "finished" feel; zero determinism surface |
| B. Yes, on-by-default | Same, defaulting on | Autoplay friction, surprise audio — against documentary quiet |
| C. Cut to v1.x | None | Cheapest; the ledger calls audio "cheap, transformative" — cutting it costs the finished feel |

## 20. OPEN QUESTION — share-card renderer style (PENDING USER RULING) (ledger open Q7)

| Option | What renders | Cost/risk |
|---|---|---|
| **A. Pixel postcard composition (controller default)** ◀ | Frame + day stamp + cast portraits + location motif — the C10 thumbnail language, upscaled; pure `sharp` composition, no renderer involved | Cheap, stylized, deterministic, consistent with C10; less "wow" — the scene itself isn't pictured |
| B. Headless scene snapshot | A true render of the actual moment (headless Pixi/canvas server-side at the moment's tick via snapshot+replay) | Heavier: a second renderer runtime + replay on request; the wow of *this exact scene* in a chat preview |
| C. Hybrid | A ships in C12; B lands v1.x behind the same URL | Default path if A is ruled; keeps the URL contract stable |

## 21. Settings, flags, determinism (pattern statement — argued deviation)

The C9 §19 world-law mandate applies to **world physics**. C12's systems are presentation; putting renderer toggles in the world event log would make viewers' pixels world state and break the read-only law. Pattern instead:
- Every C12 system gets an exported config const + an **enable flag in a viewer Settings panel** (particles, ambient fauna, shadows, audio, minimap, overlays, wake-lock, reduced-motion supercut that honors `prefers-reduced-motion`), persisted per-viewer (localStorage).
- Server-side pieces (OG cards, `/api/lineage`, `/api/overlays/traffic`, `/api/constructs`, extended `/api/milestones`, PWA) get gateway config + env flags, ops-side.
- **Zero writes to `events`/world tables; zero engine RNG.** Goldens G1/G2 cannot move; CI proof in the gate task. All copy passes the human-framing + banned-gamification scans (C10 precedent, extended to mobile/share/audio strings).

## 22. Boundary statements (no duplication)

- **C10 owns and C12 does not reopen:** tileset pipeline + flat-diamond fallback, showcase dev map, status strip, chronicle panel mechanics + scrub-to-event, bonds panel + graph, moments player + `/moment/<id>` deep link, interior scenes, hover/name-tag base layer, focus/keyboard nav. C12 *extends* declared C10 contracts only: `TILE_KIND` (+8/9/10), `hoverLabel` (new cases), chronicle rendering (C11 rows), thumbnail language (→ OG cards), route table (+`/agent/<id>`).
- **C11 owns** every mechanic C12 draws: no C12 system invents world behavior (ambient fauna is the one renderer-native class, per ruling). Construct/milestone **detection** is C11's arbiter/narrator side; C12 renders registries only (§16).
- **C9 owns** world-law machinery; C12's World Laws panel involvement is display-only (already C9 §19's viewer panel).
- **C7/C8:** away-recap reuses C7 digest content; C8's rehearsal gains the phone protocol as a checklist item (edit list in the C12 plan's audit task).

## 23. What is deliberately NOT authored / banned

No points, quests, leaderboards, meters, streaks, achievements (living-documentary law — banned-string test extends to every new surface including PWA copy and share cards). No AI/tool/prompt vocabulary anywhere viewer-facing. No mood *stat* in the engine — expressions are viewer inference. No authored family names, no "healer" badges, no danger labels on pale mushrooms.

## 24. GATE G12 — outline (C9 G9 style; full protocol written with the plan)

**G12a — automated suite** (CI, $0):
- Pure functions exact: `animFor` mapping table total over action families; `shadowFor` monotonic day curve; `moodOf` thresholds; `sheetReducer` detent transitions; `afflictionPhrase` total over `AfflictionKind` with banned-word scan; minimap downscale + `world_grown` resize; overlay color fns; OG card composition deterministic (byte-identical for same id/day); chunk-dirty consumer matches `chunkOf` for scripted `tile_changed`/`world_grown` streams.
- Affordance-registry totality: every hover affordance has a long-press twin (the ban as a test).
- Hit-target audit: DOM scan ≥ 44 px on every interactive element in portrait layout.
- Copy scans: gamification ban + human-framing ban across all new strings (incl. share/PWA/audio UI).
- `/api/lineage` + `/api/overlays/traffic` + `/api/constructs` + extended `/api/milestones` on scripted fixtures; typed empties when data absent; never 500.
- Naming-law copy tests: a fixture construct with `name: null` renders "a gathering not yet named" exactly; a named one renders the provenance quote verbatim; observer-voice templates for milestone firsts exact per tier; no taxonomy word rendered as the town's own coinage without provenance.
- Read-only proof: full repo suite green; goldens G1/G2 untouched.
- Budget assertions: particle/ambient budgets halve under a mocked coarse-pointer environment.

**G12b — human-evidenced protocol** (evidence pasted into the gate report):
1. **Desktop:** two browsers at 60 fps (rolling ≥ 58) on the 128×128 genesis town with particles, weather, shadows, ambient fauna, overlays cycling. Screenshots.
2. **Phone (gate line):** a named mid-range device class (e.g. Pixel-8a-tier) holds 60 fps on the map lens; touch protocol passes — pan, pinch integer-snap, double-tap follow, long-press name tag + bar values; portrait bottom sheet at all three detents; landscape ≈ desktop.
3. **Storm fix:** storm-frame capture measured saturation ≥ the floor — never grey-out. Before/after against the C6 complaint frame.
4. **Grave tone:** a death scene shows stillness — particles suppressed, ambient fauna gone, audio (if ruled in) silent, expression portraits somber. Screenshot + (if audio) recording.
5. **The day breathes:** dawn→noon→dusk→night timelapse capture shows ramps, shadow sweep, window glow, torch pools; a build site shows all construction stages; a carried item is visible in-hands; crops show 4 stages.
6. **Big-map ops:** minimap jump, bookmarks, all three overlays legible; a mid-run pave/`world_grown` rebakes only dirty chunks (chunk debug counter evidence).
7. **Lineage:** after the staged C9 birth fixture, the family tree renders parents→child; households visible.
7b. **Constructs & milestones:** with a fixture registry (one named festival, one unnamed gathering, tier-1/2/3 milestone rows), the Constructs panel shows the provenance quote and jump-to-moment scrubs to `firstTick`; the Milestones panel filters by tier/domain; the chronicle shows the observer-voice firsts; a milestone OG card renders the coined name.
8. **Share:** `/moment/<id>` and `/agent/<id>` unfurl with the OG card in a real chat client (screenshot); share button works on phone (native sheet) and desktop (copy-link).
9. **PWA + spectate:** install to home screen, standalone launch, safe-area correct; wake-lock holds the screen; leaving ≥ 1 sim-hour and returning shows the away-recap with real digest content.

## 25. BROADCAST LAYER — the Twitch product (A8 ruling round: CORE v1, ruled 2026-08-16 evening)

A zero-interaction mode that is always showing the most interesting thing WITH context. Read-only
by construction like everything in C12; the living-documentary law binds every string.

### Auto-directed broadcast

| Piece | Spec |
|---|---|
| Route + attract mode | `/broadcast` renders the broadcast layout directly (also embed/OBS-friendly via `?chrome=minimal` — canvas, lower-third, ticker only). In the normal observatory, **attract mode**: no pointer/touch/key input for `broadcast.attractAfterMin` (default 3 min, viewer setting) → fade into broadcast mode; any input exits instantly back to the prior lens. |
| Director heat | The C6 director's heat feed upgraded: `sceneHeat = narratorHeat (C7 heat_scores) × arcBoost (§27) × recencyDecay`. Camera holds the top-heat live scene; minimum shot length `BROADCAST_MIN_SHOT_S = 8` (no strobe-cutting); cut vs pan chosen by screen distance (near → pan, far → letterboxed cut). Exported consts, viewer-side only. |
| Lower-third captions | Narrator-sourced: the current scene's chapter/scene line when one exists, else the humanized current-action line for the shot's subject ("Omar casts again as the light goes"). Observer voice, never mechanics. Grave tone: caption style goes quiet (no slide-in), per the tone director. |
| Chronicle ticker | A bottom crawl of recent chronicle entries with weight ≥ `TICKER_MIN_WEIGHT` (default 8), observer voice, milestone entries visually distinct (weight-16 star class). Pauses on hover/long-press (readable), never on grave tone (the record keeps being kept — stillness is the stage's job). |
| Picture-in-picture | When a second live scene's heat ≥ `BROADCAST_PIP_RATIO` (0.7) × the main shot's AND it is spatially distinct (outside the main viewport), a corner mini-viewport opens on it (second low-res render pass of the same stage; budget-capped, off on coarse pointers). Max one PiP; min hold `PIP_MIN_S = 10`; suppressed under grave tone (one still thing at a time). Simultaneous drama stops being an either/or. |
| Ambient audio | If §19 rules audio in, broadcast mode is its natural home (starts only after the user gesture that opened the page/mode — autoplay-safe). |

### Character dock (user ask, verbatim scope)

A bottom bar of featured villagers — the cast rail.

- **Chip anatomy:** portrait bust rendered from the agent's 7-expression portrait set via the mood table below + a 16×16 mood glyph (existing emote set — deterministic, code-drawn) + an activity icon (one per §2 action family: work/talk/eat/walk/sleep/tend/hunt/fish/idle) + name. All palette-law; hit target ≥ 44 px (§17).
- **Interaction:** click/tap a chip → follow-cam that agent (inspector follow, C6). Long-press → hover card (§17 twin law).
- **Auto-rotation:** dock shows top `DOCK_SIZE` (default 6) agents by rolling per-agent heat (sum of heat for scenes involving the agent over the last sim-day), with hysteresis `DOCK_SWAP_COOLDOWN_S = 90` so chips don't churn; a followed agent is pinned while followed. Deaths leave the dock after one somber beat (portrait to `asleep`-still, then removed — tone rule).
- **Mobile:** the dock IS the bottom-sheet's top row in portrait layout (§17) — one component, two homes.

### Mood-derivation table (formalizes §11's `moodOf`; the dock and inspector share the one function)

Priority order — first match wins; thresholds are exported consts. Inputs: body state (C11 `hp/afflictions/needs`), the agent's last-N chronicle-weighted events (viewer-side, per §11).

| Expression | Trigger |
|---|---|
| asleep | agent sleeping |
| angry | involved in `attack` within `MOOD_WINDOW` (2 sim-hours), or own item in a witnessed `item_taken`, or hostile exchange flagged by bond history |
| sad | bonded agent's `agent_died`/`grave_placed` within the window; partnership dissolution (C9 rows); own affliction at high severity |
| surprised | perceived `mystery_event` or `world_grown` within the window; first-witness of an accepted-verb/item debut |
| weary | energy < 25, or `fatigue`/`illness` affliction present, or collapse within the window |
| happy | all needs above comfort band AND a positive event in the window (received `give`, shared meal, birth in household, milestone participation) |
| neutral | default |

No engine mood stat exists (§23 ban stands); this is viewer inference, and the table is the
contract so the dock, inspector, and share cards never disagree about a face.

**G12 additions:** `moodOf` table exact over fixture states (each row triggered + priority order asserted); dock rotation deterministic over a scripted heat series (hysteresis honored); attract mode enters at the threshold and exits on input; ticker filters by weight; PiP opens/closes on the scripted heat ratio and never under grave tone; `/broadcast?chrome=minimal` renders canvas+captions only; broadcast strings pass the gamification/human-framing scans. **Human-evidenced:** 10 unattended minutes of broadcast mode on the gate fixture stay watchable — cuts land on the staged drama, captions match the shots, dock rotates to the actors (screen recording pasted).

## 26. CLIP EXPORT — WebM + GIF (A8 ruling round: ruled 2026-08-16 evening)

Share cards (§18) are the still; clips are the moving version — the viral mechanic.

| Piece | Spec |
|---|---|
| Sources | (a) **Moment clip**: one button on the moments player (C10 T8/9) captures that moment's range; (b) **Scrub-range clip**: in/out handles on the timeline scrubber capture an arbitrary range; (c) **Live clip**: "clip the last 30s" on the broadcast layer (rolling capture only while enabled in settings — memory-bounded ring buffer). |
| WebM path | Compositor canvas = world canvas + caption bar, recorded via `canvas.captureStream(30)` + `MediaRecorder` (`video/webm;codecs=vp9`, fallback vp8). The range plays through the existing MomentPlayer replay while recording — no second renderer. Cap `CLIP_MAX_WEBM_S = 45`. |
| GIF path | Fallback and always-offered alternative (ruled: BOTH ship): frames sampled at ≤ 15 fps, max width 480 px, encoded in a Web Worker by a vendored single-file GIF encoder (gifenc-class; no CDN, no server). Cap `CLIP_MAX_GIF_S = 8` (GIF size grows brutally; the cap is the law). Browsers without MediaRecorder (Safari variants) get the GIF path automatically. |
| Caption overlay | Baked into the pixels (not a DOM overlay): day stamp + one observer-voice caption line (the moment's narrator line, or the §25 lower-third line for scrub ranges), palette-styled bar, pixel font. Grave-tone moments bake the quiet caption style. |
| File naming | `san-junipero_day<D>_<HHMM>_<slug>.webm|gif` — slug from the caption (kebab, ≤ 32 chars, deterministic). |
| Share handoff | `navigator.canShare({files})` → native share sheet with the file; else download + the `/moment/<id>` link copied alongside (clip and card share one deep link). Copy is human-framed ("Save this moment — Day 41"). |
| Relation to §18 | The OG card remains the link-unfurl face; the clip is the in-thread payload. The clip button sits beside the share button on moments, timeline, and broadcast surfaces. |

Determinism/read-only: capture reads pixels already rendered; zero writes, zero engine RNG,
budget-governed (capture disabled when FPS < 45 on the device rather than degrading the town —
an honest refusal beats a stuttering clip).

**G12 additions:** slug/naming pure fn exact; caps enforced (a 60s range clamps to 45s WebM / 8s GIF); GIF worker output decodes to the sampled frame count on a fixture range; caption bake present in a pixel test (bar region non-transparent, day stamp glyphs match); share fallback path (no `canShare`) downloads and copies the link. **Human-evidenced:** one WebM and one GIF of the staged gate drama, played back in a chat client, captions legible (files pasted into the gate report).

## 27. STORY ARCS — threading days into storylines (A8.2, presentation + narrator side)

C7 scenes are day-bound; viral stories span days. The arc detector gives multi-day drama a spine
— and C11 §19 (night-witness) supplies its flagship genre: the deal at noon, the theft in the
dark, the confrontation at dawn.

### Detector (narrator-side, ops-plane — same class as chapters; agents never see arcs)

- **Daily pass** (nightly narrator batch): deterministic candidate threading first — events across days are linked when they share ≥ 2 of {participant pair, object id, place within radius 4} inside a rolling `arcs.windowDays` (default 14). Candidate threads with ≥ `arcs.minEpisodes` (default 2) episodes go to one LLM call for typing + episode summaries (structured output, event-id citation law applies — every episode cites its event range; non-citing output voided).
- **Types:** `feud | courtship | crime | project | custom` — `custom` keeps the taxonomy open, exactly like constructs. A `crime` arc typically threads `item_taken` (often unwitnessed at night, §19) with later speech/confrontation events — detected, never authored.
- **Schema (narrator-DB additions, declared):** `arcs {id, type, title, participants: string[], objects: string[], places: [{x,y}|structureId], status: 'ongoing'|'dormant'|'concluded', firstTick, lastTick, heat}` + `arc_episodes {id, arcId, day, eventSeqFrom, eventSeqTo, summary, jumpTick}`. `title` is observer voice ("The matter of the missing bread"); any town-coined name for the affair appears only as a provenance quote (naming law — identical to constructs).
- **Status law:** `dormant` after `arcs.dormantDays` (default 5) without an episode; `concluded` only by detector judgment with a citing final episode; dormant arcs revive on a new episode.
- **Config (ops-side):** `arcs.enabled: true`, `windowDays: 14`, `minEpisodes: 2`, `dormantDays: 5`, `heatBoost: 1.5`, `dailyBudgetUsd: 0.10` (skip + alert on cap, like §20's detector).

### Surfaces (C12 renders; detection stays ops-side)

- **Storylines lens:** ongoing arcs ranked by heat — type badge, observer-voice title, cast chips, episode list (day + summary + **jump-to-moment** per episode), and a **recap card** per arc (the §18 card language: cast, episode beats, day range — shareable). Dormant/concluded sections below the fold.
- **Director feed:** a live scene involving an ongoing arc's participants multiplies its heat by `arcs.heatBoost` — the camera learns to follow storylines (§25 consumes this; the multiplier is the only coupling).
- **Chronicle:** arc *conclusions* (not every episode) enter the chronicle at weight 12, observer voice ("The matter of the missing bread has found its end").
- `/api/arcs` (read-only, typed empty until the first arc).

**G12 additions:** threading heuristic exact on a fixture stream (shared-participant+object across 3 days → one candidate; disjoint events → none); episode citation guard voids a non-citing fixture response; status transitions (ongoing→dormant→revived) on scripted gaps; `/api/arcs` typed-empty; Storylines lens jump-to-moment scrubs to `jumpTick`; heat multiplier applied in the director feed calc (pure fn test). **Human-evidenced:** the staged gate drama (a planted 3-day fixture arc) renders as one storyline with episodes and a recap card; the broadcast camera visibly favors its participants.

## 28. THOUGHT-STREAM SURFACES — the study made watchable (A8.1/A8.4 viewer half)

Thoughts are the product's goldmine; today they are bubbles + inspector. Four surfaces, all
display-only. **One-way glass governs *injection*, not *display*** — thoughts and memories have
been viewer-visible since the root spec (§8 thought wisps; §9 narrator reads thoughts); nothing
here opens a byte of write path toward a mind.

| Surface | Spec |
|---|---|
| **Inner Voices lens** | Live scrolling feed of thoughts town-wide (from the ws delta stream the wisps already ride). Filters: by agent (chips), by text search, and — once §20 tier-2.5 hits exist — by concept chip (observer taxonomy, labeled as ours not theirs). **Tasteful rate-limiting:** at most `INNER_VOICES_MAX_PER_MIN` (default 20) rendered; overflow drops lowest self-rated `importance` first; a mind's consecutive thoughts collapse into one expandable run. Silence is rendered honestly — a sleeping town shows an empty, quiet feed, not filler. |
| **Emergent-lexicon panel** | Coined words with adoption curves: consumes toponyms (C9 inscriptions), construct names (C11 §10.2 provenance), and recurring novel n-grams (narrator-side detection: tokens absent from a base wordlist, uttered by ≥ `lexicon.minSpeakers` (default 2) distinct speakers, ≥ `lexicon.minUses` (default 4) uses). Each row: the word (verbatim), first utterance quote + provenance, and a speakers-over-time adoption curve. `LexiconRow {word, firstEventSeq, firstQuote, byId, speakerDays: [{day, speakers}]}`; `/api/lexicon`. The naming law is this panel's native language — every word on it is, by construction, the town's own. |
| **Conversations lens** | Threaded dialogue transcripts: `agent_spoke` events grouped into threads by earshot cluster + gap ≤ `CONVO_GAP_TICKS` (default 10) (deterministic, gateway-side over the event log; `/api/conversations?day=`). Rendered as a readable script — speakers, verbatim lines, place + time stamp, jump-to-moment per thread. Interior conversations honor what was witnessable: the transcript exists (we hold the glass), and the UI labels it "behind closed doors" so viewers savor the irony knowingly. |
| **Memory inspector tab** | New inspector tab: a viewer-side read of the selected agent's memory store — recent `memories` rows (verbatim), `facts`, ledger summaries, journal (journal display exists; this unifies). Gateway `/api/agents/<id>/memory` (read-only, per-agent DB opened readonly, paginated, `agent_id`-fenced exactly like the mind's own retrieval). The dramatic-irony payoff: watch Omar's memory of the deal while the Conversations lens shows what he *said* — the §20 lie detector's evidence, browsable by hand. |

**G12 additions:** rate-limiter drop order exact (importance-ranked) on a fixture burst; thread grouping deterministic on a scripted speech day (earshot + gap rules); lexicon n-gram detector exact on a fixture transcript (below-threshold words excluded; toponym + construct names included with provenance); `/api/lexicon` + `/api/conversations` + `/api/agents/<id>/memory` typed empties + never-500; memory endpoint refuses cross-agent joins by construction (fencing test). **Human-evidenced:** Inner Voices stays readable during the gate run's busiest hour (screenshot); a fixture coined word shows a two-speaker adoption curve.

## 29. STUDY PACK — replication export + science panels (A8.4: ruled FULL PACK in v1)

Journal-grade instrumentation. Reproducibility is what reviewers ask first; the answer ships in
the product, not in a promise.

### Replication-package export

One archive (`san-junipero-study_<worldId>_day<D>.tar.gz`), assembled on demand:

| File | Contents |
|---|---|
| `manifest.json` | world id, export day/tick, schema versions, file checksums (SHA-256), generator commit |
| `seed.json` + `config-history.jsonl` | genesis seed + base sim-config, then every `config_changed` event — the full world-law history |
| `models.json` | pinned model IDs for minds/arbiter/narrator/detectors + provider routing config (the pinned-snapshot law made citable) |
| `events.jsonl` | the complete append-only world event log (the world IS this file: seed + config + events replays the identical world, bit-for-bit — the golden-replay law as a scientific claim) |
| `llm-transcripts.jsonl` | every prompt/response pair from the `llm_calls` table (minds, arbiter, narrator, detectors), with token/cost columns. Honesty note baked into the README: transcripts are the *record* of the nondeterministic half; they replay as data, not as regenerated behavior |
| `relationships.csv`, `constructs.jsonl`, `milestones.jsonl` (tiers 1–3 incl. 2.5), `arcs.jsonl`, `lexicon.csv` | the derived registries, with provenance columns |
| `README.md` + `LICENSE` | citation block, column dictionaries, replay instructions |

Access: **admin surface** (supervisor panel, token-gated) always; **public `/data` page** when
`study.publicData: true` (ops flag) — export link, world facts, citation block. Export runs
streamed (the event log will be large); rate-limited; never blocks the tick loop (reads a
snapshot + WAL, SQLite's whole point).

### Science panels (viewer-visible — Study lens; documentary framing, no dashboards-speak)

| Panel | Spec |
|---|---|
| Bonds-network timelapse | The §12/C10 bonds graph with a day scrubber: graph state at day D reconstructed from bond `history` rows (deterministic); play button animates the town's social fabric knitting. |
| Vocabulary growth | Curve of cumulative coined words over days (§28 lexicon data) with milestone markers where tier-2.5/3 firsts land. |
| Norm-adoption curves | For each accepted verb/item (C9 codification + C11 §10.1): uses-per-day since acceptance across distinct agents — watching an invention become a custom. Data from the event log via `/api/study/adoption` (folded into the export too). |
| Movement/territory heatmap | Per-agent: `/api/agents/<id>/heatmap` — per-tile visit counts folded from that agent's `agent_moved` events (gateway scan, cached per day). Renders through the SAME overlay renderer as §15's traffic lens (C11 traffic surface reused) — one agent's paths against the town's. |

All panels are lenses over exported-quality data — a viewer can check the paper's figures
against the live town. Human framing holds even here: axis labels name days and words, never
"metrics"; the gamification ban applies (curves are records, not scores).

**G12 additions:** export archive on the gate fixture contains every manifest file with matching checksums; `events.jsonl` from the export replays to the fixture's state hash (the scientific claim as a CI assertion); transcripts row count matches `llm_calls`; `/data` 404s when `study.publicData` is false and renders when true; heatmap fold deterministic + identical through the overlay renderer path; adoption curve exact on a fixture codification. **Human-evidenced:** the export downloads and unpacks; the bonds timelapse scrubs smoothly across the staged run; one figure (vocabulary curve) screenshot-matches its exported CSV.

---

## Deviations & assumptions (logged, not silently decided)

1. World-law-toggle mandate applied as viewer settings + ops config for presentation systems (§20) — the alternative (renderer flags in the world event log) would violate the read-only law. Flagged for controller confirmation.
2. Expression wiring uses viewer-side mood inference (`moodOf`), not an engine mood stat — adding one would be C-engine scope and none was ruled.
3. `/agent/<id>` is a new share route (the ledger names it); it is additive to C10's route table, not a change to it.
4. Ambient audio assets assumed authored/CC0-curated, not generated — no LLM/image spend in this chunk beyond the §10 forge commissions (which ride the existing C5 pipeline budget).
5. Minimap reads the chunk bakes rather than raw terrain — one source of truth for ground pixels; costs a refresh hook on rebake.
6. Away-recap trigger threshold (≥ 1 sim-hour) is an exported const, not config — taste value, cheap to change at plan time.
7. (A8 round) Live-clip capture uses an opt-in rolling ring buffer, not always-on recording — memory honesty on phones beats feature completeness; moment/scrub clips cover the retroactive case.
8. (A8 round) `/api/conversations` groups speech gateway-side rather than client-side — history queries over long runs need the DB, and the grouping rule stays deterministic + testable in one place.
9. (A8 round) The memory inspector exposes memory rows read-only via the gateway rather than shipping the per-agent DB to the client — fencing stays server-enforced, pagination stays cheap.
10. (A8 round) PiP is a second low-res render pass of the same Pixi stage, not a second WorldStore — one truth, two cameras; budget-capped and desktop-first.

---

## AMENDMENT LOG — A8 ruling round (2026-08-16 evening)

Under the A8 rulings (ledger §A8 + §D: **broadcast = core v1**, **clips = WebM+GIF**, **C13 =
new parallel chunk**, **study = full pack**), this addendum was amended. Existing sections
§1–§24 are untouched and unrenumbered; changes are strictly additive:

1. **§25 added — Broadcast layer.** Ruled core v1: auto-directed camera (director heat × arc
   boost), lower-third captions, chronicle ticker, attract mode, PiP, and the character dock
   with the formal mood-derivation table over the 7-expression portrait sets (extends §11's
   `moodOf`; dock doubles as the §17 mobile bottom-sheet top row). G12 lines added inline.
2. **§26 added — Clip export.** Ruled WebM+GIF: in-browser capture (MediaRecorder WebM,
   worker-encoded GIF fallback/alternative), baked caption overlay, length caps, deterministic
   file naming, share-sheet handoff; clips are the moving twin of §18's still cards.
3. **§27 added — Story arcs.** Narrator-side arc detector threading events across days by
   shared participants/objects/places into typed storylines (feud/courtship/crime/project/
   custom); narrator-DB schema additions (`arcs`, `arc_episodes`) declared; Storylines lens +
   recap cards + jump-to-moment; arcs feed director heat (§25's `arcBoost`). Crime arcs are the
   consumer of C11 §19's night-witness physics.
4. **§28 added — Thought-stream surfaces.** Inner Voices lens (rate-limited live thoughts),
   emergent-lexicon panel (coined words + adoption curves), Conversations lens (threaded
   transcripts), memory inspector tab — with the binding clarification that one-way glass
   governs injection, not display.
5. **§29 added — Study pack.** Ruled full: replication-package export (seed, config history,
   model IDs, event log, LLM transcripts, registries — one archive, admin + flag-gated public
   `/data` link) and four science panels (bonds timelapse, vocabulary growth, norm adoption,
   per-agent heatmap reusing the §15 traffic surface).
6. **§1 extended** with the "A8 amendment additions" shared-interface block, declared
   identically in the C11 addendum §16 (night-witness fns/config + tier-2.5 rows consumed here;
   arc/lexicon/study/broadcast surfaces owned here; C13 manifest additions noted).
7. **Deviations 7–10 added** (this round, above).

## POST-REVIEW USER RULINGS (2026-08-16 evening, final round — binding)

1. **Audio: IN v1, off by default** (§19 PENDING RULING resolved): ships in C12 with the
   viewer toggle + caption/transcript accessibility twin; broadcast mode surfaces the toggle
   prominently on first entry.
2. **Share-card stills: pixel postcard** (§20 PENDING RULING resolved): composed card (framed
   art, day stamp, cast, provenance quote), server-side for OG previews; true scene-snapshot
   upgrade is a post-v1 candidate. Motion clips stay WebM+GIF (§26).
