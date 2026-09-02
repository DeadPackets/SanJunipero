# San Junipero viewer — why it is not enjoyable to watch, and what would make it so

Design lead critique, 2026-09-02. Read-only: live site at https://sanjunipero.deadpackets.pw, 5-minute
headless watch at 1440x900 plus a 390x844 phone pass, and the source under `packages/web`.
Screenshots: `scratchpad/vision/shots/desk-*.png`, `phone-*.png`, `burst-*.png`.
Mocks: `ui-mock-A.html`, `ui-mock-B.html`, `ui-mock-C.html` (same directory as this file).

Method note (impeccable `critique` format): ⚠️ DEGRADED: single-context — design review and
browser evidence were gathered by one agent; the detector (`detect.mjs`) was not run. Skills invoked:
`impeccable critique`, `frontend-design`, `make-interfaces-feel-better`; their vocabulary is used below.

---

## 1. Verdict

**The town is a beautiful map with nobody on it.** In a 5-minute unattended watch at a desk the camera
never moved, no cut happened, one person was visible for 90 s and then nobody, and from 90 s to 300 s
fewer than **0.05 % of pixels changed between 30-second screenshots** — the only motion was the
dusk tint easing in. The information layer is inverted: **eleven permanent place labels** shout in
caps while speech collapses to a "…" glyph and laws, customs and bonds never reach the screen at all;
the director that the owner picked as the default on 2026-08-28 is wired to `?broadcast=1` only
(`App.tsx:72`), so the desk viewer gets a static wide shot forever. What is missing is not polish but
**a subject**: something on screen that is alive every second, a camera that goes to the story, and
a story surface that says what just happened.

---

## 2. What I saw — timeline of one 5-minute watch (desk, 1440x900, 09:06–09:11 UTC)

| t | sim clock | on screen | what drew the eye | dead time |
|---|---|---|---|---|
| 0 s | — | "San Junipero / Looking for the town…" title card on night purple | the title | — |
| 5–10 s | 19:44 | whole town at zoom 1, 11 labelled buildings, sun arc, "CLOUDY 14°", one person standing at the well | **the labels** — 11 caps plates in Silkscreen are the highest-contrast thing on screen | — |
| 10–30 s | 19:53 | identical frame; 0.01 % pixel change 20→30 s | nothing | 20 s |
| 30–90 s | 19:55→20:25 | dusk tint crossfades in (3 % change per 15–30 s); the one person at the well does not move; a checkerboard placeholder appears at Yusuf's door (`desk-090.png`) | the fire pit's glow, the only warm pixel | 60 s |
| 90–300 s | 20:25→22:09 | **0.01–0.05 % change per 30 s.** Nobody visible. Night blue, one lit fire pit, a second checkerboard in the river | nothing; eyes go to the signpost, which is the largest bright object | 210 s |
| burst (200 ms × 10) at 300 s | 22:09 | 3.6 % change on 3 of 9 intervals — the fire flicker and a tint step; the rest 0.01–0.2 % | — | — |
| click on town centre | 22:20 | subject ring (one arm, "Story") over the fire pit; nameplate "THE FIRE PIT"; toponym "THE FIRE PIT" still drawn; a person appears near Omar's house with a **"…" glyph instead of words** (`desk-click.png`) | three labels for one object | — |
| hover | 22:22 | hover plate "FIRE PIT / the fire pit" (kind + name) added on top of the two labels | redundancy | — |
| phone 390x844 | 22:40 | sky bar collides into **"DAY 0 · SPRINGLOUDY 8°"**; signpost is 45 % of the width; zero people visible; two checkerboards | the signpost | all of it |

Measured facts behind the table (script: `shots/capture.py`, diff: PIL, threshold 12/255):
- 2 s real per sim minute (`shared/src/time.ts:1` TICK_REAL_MS 2000): a day is 48 min, night 21:00–06:00 is **18 real minutes** with everybody asleep.
- Director cue (`DIRECTOR · name`) never appeared in any DOM dump: `useAutoCut(route.broadcast)` at `App.tsx:72` arms it only for `?broadcast=1` (`ui/autoCut.ts:12`).
- `/api/chronicle` has **11 entries, all "The … is finished." at tick 1**; `/api/dispatches` is empty (`papers: [], captions: []`). The ticker and the Chronicle arm have nothing after founding day to show.
- `/api/heat`: 43 windows, 5 people; the latest windows score 1–8; the strongest ever was Omar 22 (window 480–539). `agent_spoke` is worth 2 and `item_moved` 1 (`gateway/src/heat.ts:5-15`); a death is 20. The director is a disaster scorer, not a drama scorer.
- `/api/society`: amara↔yusuf talk 97, omar↔salma talk 74 — there **are** two strong pairs in the data and nothing on the stage shows them.
- Frame rate: not measured (FPS overlay `f` not pressed); nothing in the screenshots suggests it is the problem.

---

## 3. Diagnosis by layer

### 3.1 Motion and game-feel
- **Idle is one frame.** `charPose` (`render/charAnim.ts:98-113`) returns the `idle` row with `bobY: 0` whenever a body is not walking. Standing bodies are statues; the only life on a still person is the 0.3 Hz squash for four work verbs (`render/ambient.ts:33-35`). Pixel-art practice is a 2-frame 1 px breath at 400–500 ms holds (see §4).
- **Walk cycle is fine on paper** — 4 frames at 8 fps (`charAnim.ts:17-18`), stride tied to ground (`STRIDE_TILES 1.8`, `charAnim.ts:119`) — but almost nobody walks in view, and a walk arrives with no anticipation, no footfall, no dust, no turn.
- **The camera never moves at a desk.** `DirectorMode` centres home at `OVERVIEW_ZOOM 1` and stays (`ui/DirectorMode.tsx:11, 72-80`). Follow is a 12 %/frame lerp (`render/cameraRig.ts:130`), zoom eases in 180 ms (`render/camera.ts:9`) — good primitives, unused. Even the broadcast director cuts at most every 8 s (`ui/directorCut.ts:3`) and turns the quiet round every 60 ticks = **2 real minutes** on one face (`directorCut.ts:37`).
- Ambient motion exists but is thin: 80 tree crowns swaying by whole pixels, water shimmer, one bird V every 20–45 s, chimney smoke (`render/smoke.ts`), rain/snow/storm particles with splashes (`render/weatherFx.ts`) — all good, all off-camera at zoom 1 where a crown is 12 px. No cloud shadows, no critters on the ground, no wind on grass.
- Juice: bounces exist for a finished structure (`ambient.ts:292-299`, 1.0→1.18 over 260 ms) and bubbles fade in (`fadeArtIn`); nothing marks a line being spoken, a law being made, a bond changing. The motion table (`ui/motion.ts:10-17`) caps everything at 300 ms except `ambient` — right for chrome, but the world itself has no vocabulary for "something happened here".

### 3.2 Legibility of state (who is doing what, and why)
- **The one-slot glyph is correct and invisible.** `OVERHEAD_PRIORITY` (`render/overhead.ts:23-32`) is a well-argued spec, but at zoom 1 the slot is a 20 px plate with a 16 px emote over a 52 px body — and in the watch it rendered as a **checkerboard** (the emote atlas cell was missing: `desk-090.png`, Yusuf's door). A talker shows a "talk" glyph; a person inventing a law shows nothing.
- **Speech collapses.** The click screenshot shows a speaker wearing "…" (`bubbles.ts:393-396`, `bubbleShown` → glyph). Root cause unverified from screenshots alone; the effect is that the one event the owner cares most about — a line of talk — reached the viewer as three dots.
- **Work is a word, not a picture.** Act chips print the gerund under the feet (`render/acts.ts:202`) and progress is seven blocks over the head (`overhead.ts:72-83`). Both are honest; neither is watchable. Stardew shows a swing; we show "Chopping".
- **Relationships have no surface on the stage.** Bonds live in a paper page (`paper/pages/BondsGraph.tsx`, `BondOrbit.tsx`). `drivesOf` returns `[]` (`ui/status.ts:120-124`) — the P22 hook for "what a person wants" was never fed. A viewer cannot tell that Amara and Yusuf have talked 97 times.

### 3.3 Information rhythm (bubbles vs glyphs vs paper)
- **Inverted hierarchy.** Eleven toponyms are drawn at full alpha from the 0.5 stop up (`render/toponyms.ts:32-33`), i.e. always, in caps, on ink plates — the loudest text in the product names the furniture. A picked building then wears three labels at once (toponym + nameplate `stage/Nameplate.tsx` + hover plate `ui/interaction.ts`), as `desk-hover.png` shows.
- **Speech is long, then gone.** A bubble lives 3.5 s + 40 ms/char up to 240 chars (`bubbles.ts:42-45, 67-69`) and is 420 world px wide (`bubbles.ts:53`) — a paragraph slab that vanishes with nothing left behind. No turn-taking is visible: the second speaker's bubble appears wherever the placer puts it; the first speaker's is not dimmed; nobody turns to face anybody.
- **The story surface is empty.** The desk has one line of story chrome, `.stage-cue` (`chrome.css:1196`), which prints only "DIRECTOR · name". Laws, customs, inventions, bond changes go straight to the paper, which is closed by default. The Chronicle ticker is broadcast-only and its feed has 11 founding-day entries.
- The paper itself is good reading (Fraunces titles, `--measure 62ch`, tabular data) — but it is a document, and the owner asked for a thing to *watch*.

### 3.4 Camera and director
- **Default is off at a desk** (`App.tsx:72`); the owner's 2026-08-28 pick "auto-director by default" did not land for the desk viewer.
- **The heat scorer optimises for catastrophe** (`gateway/src/heat.ts:5-15`): died 20, fire 12/10, injured 8, built 6, collapsed 6, harvested 3, spoke 2, moved 1. No weight for law/custom/naming/bond/discovery events; no bonus for two people speaking within earshot. In a healthy town heat is flat (scores 1–8) and the "quiet round" carousel takes over: one face for two minutes, cut, next face.
- Cuts are a hard `centerHome`/`setFollow` swap with no card, no dip, no naming of the scene; dwell is decided by `CUT_MIN_MS 8000` and `STICKY_FACTOR 1.25` (`directorCut.ts:3-5`), not by whether a conversation is still going.
- `DIRECTOR_ZOOM 3` on a 1440-wide screen frames one body 156 px tall; two speakers 2 tiles apart fit, three do not.

### 3.5 Atmosphere (light, weather, time, sound, ambient life)
- **Night is a flat blue wash.** The clock tint bottoms at `[0.45, 0.52, 0.95]` (`render/tints.ts:2-11`); the sky gradient adds at most `SKY_MAX_ALPHA 0.16` (`render/atmosphere.ts:15`); lamp pools cap at `0.32` alpha (`render/lightPools.ts:29`). With everyone indoors from 21:00 there is nothing to light for 18 real minutes. `desk-300.png` is the result: one warm circle in a blue field.
- Dawn/dusk are a 90-minute (3 real min) crossfade with no long shadows, no sky colour on roofs beyond the 0.16 screen, no golden hour.
- Weather grades the whole frame with a diagonal matrix (`tints.ts:15-20`) — subtle enough that "CLOUDY" reads only in the chip.
- **No sound at all**, and no diegetic cue for it — no wind, no fire crackle, no crickets, no bell when a law is made. Every reference in §4 treats sound as the cheapest liveness there is.
- Ambient life: birds 20–45 s apart, smoke, shimmer. No animals, no children, no laundry, no carts — nothing that moves on its own when the minds are idle.

### 3.6 Typography and chrome
- Tokens and ladders are disciplined (`chrome.css:3-111`): 2 px spacing base, 7-step type ladder, one motion table proven against `motion.ts`, per-band contrast measured. This is real craft.
- But the **chrome outweighs the world**. On a phone the signpost is 4 planks × 22 px × 2 = 176 px tall and ~350 px wide (`chrome.css:1249-1300`), a quarter of the screen; on desktop it is the brightest object at night. The sun arc bar is a 600 px group at the top edge that says "DAY 0 · SPRING" all day.
- Caps everywhere: toponyms, sky chips, stamp, cue, signpost. Silkscreen and Press Start 2P have no lowercase register in use, so every mark reads at the same volume.
- Bug: under 900 px the sky bar collapses to `auto auto` and the two chips overlap — `DAY 0 · SPRINGLOUDY 8°` (`chrome.css:1171-1173`, `phone-000.png`).

### 3.7 Onboarding for a first-time viewer (persona "Jordan")
- First frame: a title card, then a map with eleven labels and a "?" — no sentence about what this is or what to look at. The stamp fades after 3 s (`stage/QuietStamp.tsx:7`), so "LIVE" is gone before it is understood.
- Nothing invites the click. The one interaction that rewards (Story sheet) is behind a ring on a body that is rarely on screen.
- No empty-state honesty: at 22:00 the town is asleep and the viewer is told nothing — "The town sleeps until 06:00" would keep them or let them go.

### 3.8 Mobile (persona "Casey")
- Zero people visible in both phone shots; chips collide; two checkerboard placeholders at 2× DPR are big and obvious; the signpost dominates; touch targets are fine (44 px). The phone build is a map, not a show.

### Nielsen heuristics (impeccable scoring, mode: Experience)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | LIVE stamp fades in 3 s; no "asleep until 06:00"; director cue never appears at a desk |
| 2 | Match system / real world | 3 | "Between things", "Worn out" — good voice; "THE FIRE PIT / fire pit" plate is machine redundancy |
| 3 | User control and freedom | 3 | Esc ladder is thorough (`ui/interaction.ts` escapeStep); no way to ask "show me something" |
| 4 | Consistency and standards | 3 | One motion table, one label placer; three simultaneous labels on a pick breaks it |
| 5 | Error prevention | n/a | watch-only surface |
| 6 | Recognition over recall | 2 | who is who, who likes whom, what was just decided — all recall, all in the paper |
| 7 | Flexibility and efficiency | 3 | keys for pan/zoom/fullscreen/director; no "jump to the last moment" |
| 8 | Aesthetic and minimalist | 2 | labels and signpost outweigh people; night is a flat wash |
| 9 | Error recovery | n/a | — |
| 10 | Help and documentation | 3 | "?" keymap exists; no first-frame orientation |
| **Total** | | **21/32 (66 %) — Acceptable** | |

Cognitive-load checklist: 3 failures (visual hierarchy, single focus, working memory: the viewer must open Folk to know who anyone is).

---

## 4. What the best references do that we do not (one line each)

- **Smallville viewer** — an emoji over every head translating the *action* ("✍️📖" for writing in journal) and full text when agents share a tile; we show a hunger icon and "…". (Generative Agents paper, https://ar5iv.labs.arxiv.org/html/2304.03442)
- **AI Town critique** — viewers called it "rectangles moving in random directions" and "boringly nice"; the failure mode is ours too: polite drift with no stakes on screen. (HN, https://news.ycombinator.com/item?id=37128293)
- **Dwarf Fortress** — a major announcement pauses and *centres the camera on the event*; the log is dated and every entry can be zoomed to. (https://dwarffortresswiki.org/index.php/Announcement)
- **RimWorld** — the AI Storyteller is a *pacing curve* (tension rises, then rests), and every event is a coloured envelope stacked at the screen edge with "jump to". Sylvester: deep sims fail when players cannot see cause and effect — "stories end up buried and unobserved". (https://rimworldwiki.com/wiki/AI_Storytellers, https://tynansylvester.com/2013/06/the-simulation-dream/)
- **Project Horseshoe "cozy"** — cozy needs "passive NPC-watching", life that "goes on independent of the player", diegetic sound with a visible source, warm light of clear origin, and ritual (day/night, seasons, harvest). (https://projecthorseshoe.com/reports/featured/ph17r3.htm)
- **Townscaper** — seagulls perch and fly off when the roof changes; a toy is watchable because small creatures react to the world. (https://www.gamedeveloper.com/game-platforms/how-townscaper-works-a-story-four-games-in-the-making)
- **Animal Crossing** — 24 hourly music tracks × 3 weather variants; villagers idle by stretching, reading, singing, and gathering to watch you work. (https://nookipedia.com/wiki/Animal_Crossing_Clock)
- **Stardew** — 0.7 s per game minute, gradual seasonal nightfall, the music stops and night ambience replaces it; walks are 4 frames, idles 2 frames on 200–400 ms holds. (https://stardewvalleywiki.com/Day_Cycle)
- **Pixel animation practice** — a 1 px vertical breath on 2 frames at 400–500 ms reads as alive; head bob on a triangle wave; clouds as the first parallax layer; birds on slow curves "for almost no effort". (https://pixnote.net/en/learn/animation/, https://www.slynyrd.com/blog/2024/5/24/pixelblog-50-human-walk-cycle)
- **Lofi Girl** — loops every 30–60 s, only minor elements move, an ambient sound layer (rain, clock, trains); the value is a "silent roommate". (https://lofi.radio/blog/what-is-lofi-girl/)
- **Nothing, Forever** — 20 k concurrent because you could "tune in and out at any time"; it died when it became two characters standing silently at a fridge — our night. (https://streamscharts.com/news/AI-twitch-series)
- **Vlambeer "Art of Screenshake"** — permanence (things stay), camera lerp, camera leading the facing, hit-stop, "meaning": the cheapest juice is a camera that reacts. (https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/)
- **Juice it or lose it** — "juice is something you add on top of a thing that already works": easing, scale on hit, flash, trails, sound — one slider each. (https://www.gdcvault.com/play/1016487/Juice-It-or-Lose)
- **SC2 / Dota observer UI** — a directed camera that auto-follows important events; the bottom third shown on demand; "who is doing what" delineated per side. (http://1217design.com/ui/, https://liquipedia.net/dota2/DotaTV)
- **Sports graphics** — a graphic must be understood in 2 s; a score bug is 5–10 % of the frame; a lower third holds only while its subject is the shot. (https://infinitecreation.io/tutorial-scorebug-overlays)
- **Calm technology** — the Dangling String: a display that twitches once per packet, whirls under load; the periphery should always show *how much* is happening. (https://calmtech.com/papers/coming-age-calm-technology)

---

## 5. Proposals, ranked by impact per effort

### Do now (days)

| # | The viewer will see | Files | Size | Check |
|---|---|---|---|---|
| 1 | **The camera goes to the story by itself** at a desk, hands back 20 s after any input | `App.tsx:72` (`useAutoCut(true)`), `ui/autoCut.ts`, `ui/DirectorMode.tsx:10-11` (DIRECTOR_ZOOM 3→2 at ≥1280 px so two speakers fit) | 2 h + a day of tuning | 5-min unattended watch: ≥3 cuts, ≥5 % pixel change between 30 s frames |
| 2 | **Cuts land on talk and change, not disasters** | `gateway/src/heat.ts:5-15`: `agent_spoke` 2→6; add law/custom/naming/discovery/bond events at 10–15; +8 "scene bonus" when two people speak within earshot in one window | 3 h | during a two-person conversation `/api/heat` top window beats a lone harvester |
| 3 | **Standing people breathe** — 1 px, 2-phase, 450 ms hold, per-body phase from `gaitOf` | `render/charAnim.ts:98-113` (idle returns `bobY` from a 2-step clock), `render/characters.ts:447-457` | 3 h | 200 ms burst: every standing body differs frame to frame |
| 4 | **Labels get out of the way**: toponyms full only at zoom ≥ 2, hover/pick at 1; one label per picked thing (nameplate wins, toponym hides, hover plate drops the kind line) | `render/toponyms.ts:32-33`, `stage/Nameplate.tsx`, `ui/interaction.ts` hoverPlate | 2 h | at zoom 1 the only text over the town is speech and the cue |
| 5 | **Visible defects gone**: two checkerboard placeholders on prod (an entity kind with forge placeholder art), `SPRINGLOUDY` chip collision, "…" where words should be | asset codex for the placeholder kind; `chrome.css:1171-1173` (`gap` + `justify-content: space-between`); `render/bubbles.ts:393-396` (find why `bubbleShown` was false at zoom 1) | 3 h | phone shot shows two chips; no `Texture.EMPTY`/checkerboard on screen; a spoken line is readable at zoom 1 |
| 6 | **A conversation looks like one**: partners turn to face each other, the current line types in at ~28 chars/s, the previous line dims to 60 % and stays until the reply lands, a small pip under the listener | `render/characters.ts` (facing toward partner while `talking`), `render/bubbles.ts` (typed reveal, hold-until-reply) | 1–2 days | a watcher names who replied to whom without opening Chronicle |
| 7 | **"What just happened" on the stage**: the cue slot prints law / custom / invention / bond events for 6 s with a 16 px pixel icon, then fades; the same event bounces the two bodies (reuse `ambient.ts:292-299`) | `stage/DirectorCue.tsx`, `App.tsx` (feed from `store.onEvents`), `chrome.css:1196` | 4 h | every law/custom event is on screen ≤ 1 s after arrival; the Chronicle feed must carry them (today it has 11 founding rows) |
| 8 | **Cloud shadows** drifting with `windNow()`, multiply, 3–5 blobs | new `render/clouds.ts` on `groundDecal` | 3 h | overview frame changes ≥ 1 % every 10 s with nobody moving |

### Later (weeks)

| # | The viewer will see | Files | Size | Check |
|---|---|---|---|---|
| 9 | **Night worth watching**: raise the night floor toward `[0.5, 0.58, 0.95]`, warm window glow on every hearth house, fireflies over grass, moon on the arc lighting roofs; a "The town sleeps until 06:00" card and a director that skips or time-lapses night | `render/tints.ts:2-11`, `lightPools.ts`, `ambient.ts`, `DirectorMode.tsx`; gateway/engine for night pacing | 3–4 days | a 22:00 screenshot has ≥3 light sources and ≥1 moving thing |
| 10 | **Sound, opt-in, diegetic**: wind, fire crackle, rain, crickets, a bell when a law is made, a hum near a talker; a "♪" toggle and a text cue chip so the deaf viewer gets the same signal | new `ui/sound.ts` (WebAudio, synthesized — no assets) | 2–3 days | muted by default; every sound has a visible source on screen |
| 11 | **Broadcast framing at the desk**: scene card on a cut ("At the fire pit · Amara & Yusuf"), lower-third caption with a 28 px bust for the current line, cast strip with state words, chronicle crawl — all already built for `?broadcast=1` (`stage/Broadcast.tsx`, `ui/broadcast.ts`) | `App.tsx:316-317` conditions; `chrome.css` broadcast rules | 2 days | a first-time viewer answers "who is talking, where, about what" in 2 s |
| 12 | **Relationships on the stage**: bond deltas as emotes (heart/crack) that rise off both heads; a hairline between two people who share a bond ≥ N while both are in frame; feed `drivesOf` (`ui/status.ts:120-124`) so a person can wear "wants: a bucket" | engine must emit bond deltas as events; `render/characters.ts`, `overhead.ts` | 3 days | the 97-talk pair reads as a pair at a glance |
| 13 | **Ambient life**: a cat, hens, laundry lines, a cart on the road — three-state critters (idle, wander, flee) | new `render/critters.ts` | 3 days | something moves in every 10 s window at zoom 1 |
| 14 | **Onboarding**: a 2-line first frame that fades on the first cut ("Five people. Watch them make a town. The camera finds the moments; drag to take it.") and an honest asleep card | `ui/firstFrame.ts`, `index.html` card | 3 h | a new viewer's first interaction is a click on a person |

Not a UI fix but blocking several rows: **the Chronicle feed has no story in it** (11 rows, all
tick 1) and dispatches are empty. Rows 7 and 11 print whatever the feed carries; the narrator lane
must write laws, customs, names and bond changes into it or the stage has nothing to say.

---

## 6. The three mocks

All three run the same fake town and the same three scripted scenes (a law at the fire pit, an
invention at the well, a quarrel outside the storehouse), so the differences are the bet, not the data.
Single HTML files, no external resources except Google Fonts. Open in any browser.

**A — Alive** (`ui-mock-A.html`): the current chrome kept as-is — sun arc, quiet stamp, signpost,
"?" — and everything under it moved. Idle breath, footfall dust, chimney smoke, cloud shadows, birds,
tree sway, a camera that breathes and drifts toward the scene, speech that types in turn, place names
only on hover, a mood emote (heart / crack / idea) when a bond or law lands, and the cue line naming
the law. This is the bet that **the Signpost direction is right and only the world was dead**. Lowest
risk, keeps every 2026-08-28 pick. Screenshot: `shots/mock-A-2.png`.

**B — Broadcast** (`ui-mock-B.html`): the town as television. Letterbox bars, a LIVE bug with the
clock, hard cuts with a black dip to whoever is doing something, a scene card ("At the fire pit ·
Amara & Yusuf"), a lower-third caption with the speaker's bust and the line typing in, a cast strip
on the right with every person's state word and a red ring on who is on camera, a bond toast, and a
Chronicle crawl. Bubbles shrink to "…" in the world because the caption carries the words. This is
the bet that **legibility beats immersion**: a first-time viewer knows who, where, and what in two
seconds, and the phone player is the same frame. It replaces the Signpost with a cast strip and a
crawl, so it reopens the 2026-08-28 direction. Screenshot: `shots/mock-B-2.png`.

**C — Diorama** (`ui-mock-C.html`): fewer words, more light. Golden hour with long shadows, a deep
blue night with lamp pools and window glow, fireflies, rain and snow you can switch on, a tilt-shift
blur at the top and bottom edges so the town reads as a model on a table, a soft serif clock, and a
"Today in San Junipero" journal card that writes one line per moment in a diarist's voice. Sound is
real: a WebAudio soundscape (wind, fire, rain, crickets at night) behind a "♪ SOUND" toggle, with
text cue chips ("♪ crickets", "♪ a knife on wood") so the signal survives muted. This is the bet that
**atmosphere and ritual are the stickiness** — the Lofi-Girl / Animal Crossing thesis — and that the
story can be a quiet journal rather than a caption. It keeps the paper idea (the journal is paper on
the stage) and drops the signpost. Screenshot: `shots/mock-C-2.png`.

Recommendation if forced to pick one: **A now, then B's caption and scene card on top of it** —
A fixes the dead world with no re-ruling; B's two chrome pieces are the fastest route to "who, where,
what"; C's light and sound are the polish that makes people leave the tab open.

---

## Appendix — files cited

`packages/web/src/App.tsx`, `ui/autoCut.ts`, `ui/DirectorMode.tsx`, `ui/directorCut.ts`,
`ui/motion.ts`, `ui/status.ts`, `ui/broadcast.ts`, `ui/chrome.css`, `render/charAnim.ts`,
`render/characters.ts`, `render/overhead.ts`, `render/bubbles.ts`, `render/acts.ts`,
`render/ambient.ts`, `render/atmosphere.ts`, `render/tints.ts`, `render/lightPools.ts`,
`render/weatherFx.ts`, `render/toponyms.ts`, `render/landmarks.ts`, `render/camera.ts`,
`render/cameraRig.ts`, `render/StageMount.tsx`, `stage/SkyArc.tsx`, `stage/QuietStamp.tsx`,
`stage/Broadcast.tsx`, `stage/SubjectRing.tsx`, `stage/Nameplate.tsx`, `stage/Figures.tsx`,
`paper/Signpost.tsx`, `packages/gateway/src/heat.ts`, `packages/shared/src/time.ts`.
